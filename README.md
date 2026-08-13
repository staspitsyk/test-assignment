# Intelligo × DocketAlarm — Production Legal Results Microservice

High-concurrency, stampede-resistant NestJS microservice integrating the [DocketAlarm](https://www.docketalarm.com/api/v1.1/) US legal search API. Exposes `POST /api/v1/legal_results` to receive an entity (Person or Company) and return matching legal cases where the subject appears as a **party**, sorted newest-first with court-authority pre-sorting.

---

## 🏛️ Key Architectural Features

- **Query Planner & Narrowing Ladder**: Enforces the 250-result product cap via an upstream probing ladder (`party:(name:...) AND is:docket` -> `+court:(...) AND is:state` -> `+from:-10years`) rather than client-side truncation.
- **Stampede & Cache Coalescing**: Uses `async-cache-dedupe` with Redis storage to provide in-process Promise single-flight and cross-pod cache coalescing with Stale-While-Revalidate (SWR).
- **Outbound HTTP Resilience**: Powered by a shared `undici` `Agent` pool (keep-alive, max 100 connections) wrapped in a `cockatiel` policy stack (`bulkhead`, `circuitBreaker`, `retry`, `timeout`).
- **Cluster-Wide Rate Limiting**: `bottleneck` using `ioredis` datastore with dynamic AIMD (Additive Increase / Multiplicative Decrease) adaptation responding to HTTP 429 and `Retry-After` headers.
- **Shared Token Election**: 90-minute DocketAlarm tokens cached in Redis using `SET NX PX` election lock and `da:token:new` PubSub notification for seamless token rotation.
- **Court Classifier & Authority Sorting**: Deterministic court tier classification (`FEDERAL > STATE > COUNTY > UNCATEGORIZED`) with specialty court override rules (`'United States Tax Court'`).
- **State Abbreviation Bypass**: Sidesteps DocketAlarm's expansion traps (e.g. `NY`, `IN`, `OR`) using explicit full court name mappings.
- **Full Observability Triad**: Structured Pino logging + `nestjs-cls` AsyncLocalStorage correlation IDs (`X-Request-Id`), Prometheus metrics endpoint (`GET /metrics`), and OpenTelemetry tracing shell.
- **Zero-Downtime Graceful Shutdown**: Intercepts SIGTERM/SIGINT signals to flip readiness (`/health/ready` -> 503), wait 5s for load balancer propagation, stop accepting connections, drain in-flight requests up to 25s, and cleanly close Redis/Bottleneck connections.

---

## 📐 System Architecture & Request Execution Flow

### 1. High-Level Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Controller as LegalResultsController
    participant Service as LegalResultsService
    participant Cache as ResultCacheService<br/>(async-cache-dedupe)
    participant Redis as Redis Storage
    participant Fanout as FanoutService
    participant Planner as QueryPlanner
    participant DAClient as DocketAlarmClient
    participant LimiterPolicy as Bottleneck & Cockatiel
    participant DA as DocketAlarm API

    Client->>Controller: POST /api/v1/legal_results
    Controller->>Controller: Zod Validation (RequestDto)
    alt Invalid Input (422)
        Controller-->>Client: HTTP 422 (invalid_entity)
    end

    Controller->>Service: processEntity(requestDto)
    Service->>Cache: getLegalResults(normalizedEntity)
    Cache->>Redis: Check Key: legal:results:<sha256>

    alt Cache HIT (SWR active)
        Redis-->>Cache: Return Cached JSON
        Cache-->>Service: Return Cached Envelope (1ms)
        Service-->>Controller: Return Response (meta.cache = "hit")
        Controller-->>Client: HTTP 200 OK
    else Cache MISS
        Redis-->>Cache: Key Null / Stale
        Cache->>Cache: Acquire Single-Flight Lock
        Cache->>Fanout: run(normalizedEntity)

        loop For Each Alias Candidate (concurrency: 3)
            Fanout->>Planner: planAndSearch(candidate, entityType, address)

            loop Query Narrowing Ladder Probing
                Planner->>DAClient: search(ladderQuery, limit=1)
                DAClient->>LimiterPolicy: execute(request)
                LimiterPolicy->>DA: GET /api/v1.1/search/?q=...&limit=1
                DA-->>LimiterPolicy: HTTP 200 { count: N }
                LimiterPolicy-->>DAClient: Return SearchResponse
                DAClient-->>Planner: Return Count (N)

                alt Count <= 250
                    Planner->>DAClient: Paginate Pages (limit=50, max 250)
                    DAClient->>DA: GET /api/v1.1/search/?q=...&limit=50
                    DA-->>DAClient: Page Results
                    DAClient-->>Planner: Raw Results Array
                    Planner-->>Fanout: Yield Up to 250 Results
                else Count > 250 AND More Steps
                    Planner->>Planner: Advance to Next Ladder Step (i++)
                else Count > 250 AND Ladder Exhausted
                    Planner->>DAClient: Paginate Narrowest Query to 250
                    DAClient-->>Planner: Raw Results Array (partial)
                    Planner-->>Fanout: Yield Truncated 250 Results (meta.partial = true)
                end
            end
        end

        Fanout->>Fanout: Merge All Candidate Yields
        Fanout->>Fanout: Deduplicate by (court, docket)
        Fanout->>Fanout: Classify Court Authority & Sort (Federal > State > County > Uncategorized)
        Fanout->>Fanout: Truncate Merged Union to 250 Cap
        Fanout-->>Cache: Return Final LegalResult[]

        Cache->>Redis: SET legal:results:<sha256> (TTL 30m / 60s)
        Cache-->>Service: Return LegalResultsResponse
        Service-->>Controller: Return Response (meta.cache = "miss")
        Controller-->>Client: HTTP 200 OK
    end
```

### 2. Query Planner Narrowing Ladder & Probing Flow

```mermaid
flowchart TD
    Start["Incoming Search Request"] --> SelectLadder{"Entity Type?"}

    SelectLadder -- Person --> PersonLadder["PERSON_LADDER:<br/>1. party:(name:'First Last') AND is:docket<br/>2. + court:(<State Courts>) AND is:state<br/>3. + from:-10years"]
    SelectLadder -- Company --> CompanyLadder["COMPANY_LADDER:<br/>1. party:(name:'CompanyName') AND is:docket<br/>2. party:(name:'CompanyName Type') AND is:docket<br/>3. + from:-10years"]

    PersonLadder --> Step0["Set Step i = 0"]
    CompanyLadder --> Step0

    Step0 --> BuildQuery["Build Query string for steps [0..i]"]
    BuildQuery --> ProbeCall["Probe Upstream: search(query, limit=1)"]
    ProbeCall --> CheckCount{"Count <= 250?"}

    CheckCount -- YES --> Paginate["Paginate Query up to Count<br/>(Max 5 pages x 50 items = 250 max)"]
    Paginate --> FormattedResults["Return Results Envelope<br/>(meta.truncated = false)"]

    CheckCount -- NO --> CheckLadder{"More Ladder Steps Available?"}

    CheckLadder -- YES --> AdvanceStep["Advance Step: i = i + 1"]
    AdvanceStep --> BuildQuery

    CheckLadder -- NO --> Exhausted["Ladder Exhausted!<br/>Paginate narrowest query up to 250 max"]
    Exhausted --> TruncatedResults["Return Results Envelope<br/>(meta.truncated = true, meta.partial = true, meta.unnarrowable = true)"]
```

---

## 🛠️ Tech Stack

| Domain | Technology |
|---|---|
| **Runtime & Framework** | Node.js 20 LTS, NestJS 11, TypeScript (`strict: true`) |
| **Outbound HTTP** | `undici` (Shared `Agent` with keep-alive) |
| **Resilience & Fault Tolerance** | `cockatiel` |
| **Rate Limiting** | `bottleneck` (`datastore: 'ioredis'`) |
| **Caching & Single-Flight** | `async-cache-dedupe` (Redis storage) |
| **Redis Client** | `ioredis` 5.x |
| **Config & DTO Validation** | `@nestjs/config`, `zod`, `nestjs-zod` |
| **Logging & Correlation** | `nestjs-pino`, `nestjs-cls` |
| **Metrics & Observability** | `prom-client`, `@opentelemetry/sdk-node` |
| **Health Checks** | `@nestjs/terminus` |
| **Test HTTP Mocking** | `undici.MockAgent` |
| **Containerization** | Docker, Docker Compose (2 app replicas + Redis 7) |

---

## 🚀 Quick Start (Docker Compose)

### 1. Environment Setup
Copy `.env.example` to `.env` and fill in your DocketAlarm credentials:

```bash
cp .env.example .env
```

Edit `.env`:
```env
DA_USERNAME="your_docketalarm_username"
DA_PASSWORD="your_docketalarm_password"
```

### 2. Launch the Application Stack
Start 2 application replicas and Redis 7 in detached mode:

```bash
docker compose up --build -d
```

### 3. Verify Health Endpoints
```bash
# Liveness check (process alive)
curl -sf http://localhost:3000/health/live

# Readiness check (Redis connected, token ready, circuit closed)
curl -sf http://localhost:3000/health/ready
```

---

## 📖 API Reference

### 1. Search Endpoint (`POST /api/v1/legal_results`)

#### Request Payload Example (Person with Address)
```json
POST /api/v1/legal_results
Content-Type: application/json

{
  "entityId": 43432,
  "entityType": "Person",
  "sender": "INTELLIGO",
  "entityDetails": {
    "name": [
      { "full": "Bradley Friedman", "confidence": 0.9 },
      { "full": "Brad Friedman", "confidence": 0.6 }
    ],
    "address": [
      { "full": "123 Ocean Drive, Miami, FL 33139", "confidence": 0.95 }
    ]
  }
}
```

#### Request Payload Example (Company)
```json
POST /api/v1/legal_results
Content-Type: application/json

{
  "entityId": 55,
  "entityType": "Company",
  "entityDetails": {
    "name": [
      { "full": "Westlake Services", "confidence": 1.0, "type": "LLC" }
    ]
  }
}
```

#### Success Response Envelope (HTTP 200)
```json
{
  "results": [
    {
      "court": "Florida Middle District Court",
      "docket": "8:23-cv-01234",
      "title": "Friedman v. Acme Corp",
      "link": "https://www.docketalarm.com/cases/...",
      "dateFiled": "2024-01-15T00:00:00.000Z",
      "courtTier": "FEDERAL"
    }
  ],
  "meta": {
    "entityId": 43432,
    "entityType": "Person",
    "count": 1,
    "upstream_count": 1,
    "truncated": false,
    "partial": false,
    "unnarrowable": false,
    "cache": "miss",
    "requestId": "req-8f92a10b",
    "elapsedMs": 142
  }
}
```

#### Rejection Responses (HTTP 422 `invalid_entity`)
Returned when request input violates entity rules (e.g. single-token person name, empty company name, or all candidates below `ALIAS_CONFIDENCE_THRESHOLD` 0.5):
```json
{
  "error": {
    "code": "invalid_entity",
    "message": "Person entity name must contain both first and last name",
    "requestId": "req-12345"
  }
}
```

---

### 2. Prometheus Metrics (`GET /metrics`)
Exposes custom application and system metrics for scraping:

```bash
curl -s http://localhost:3001/metrics | grep -E '(upstream_|cache_|circuit_|token_|dedup_)'
```

Key Metrics Exposed:
- `upstream_duration_seconds`: Histogram of DocketAlarm call durations.
- `upstream_status_total`: Counter of DocketAlarm responses by HTTP status code.
- `cache_hits_total`: Cache result counters (`hit`, `miss`, `stale`, `bypass`).
- `circuit_state`: Circuit breaker status gauge (`0`=Closed, `1`=HalfOpen, `2`=Open).
- `dedup_wins_total`: Counter of coalesced stampede wins (`in_process`, `cross_pod`).

---

## 🧪 Testing & Verification

### Run Unit & Integration Tests
Executes 15 test suites and 72 tests covering query planning, court classification, token elections, Bottleneck AIMD rate limiting, and Cockatiel circuit breakers:

```bash
npm test
```

### Run E2E Golden Entity Fixtures Test
Runs full end-to-end integration tests using `undici.MockAgent` against the 5 golden entity fixtures (`bradley-friedman`, `gilbert`, `westlake`, `goldman-sachs`, `christopher-brien`):

```bash
npm run test:e2e
```

### Run Stampede Coalescing Verification
Assures that 50 concurrent identical requests coalesce to **EXACTLY 1 upstream search call**:

```bash
npx jest test/integration/stampede.integration-spec.ts
```

### Run Empirical Probe Suite (Against Real DocketAlarm Credentials)
Runs live account probes to inspect token concurrency, rate-limit headers, and upstream error strings:

```bash
npm run probes
```

---

## 📂 Repository Structure

```
src/
├── main.ts                          # Bootstrap: enableShutdownHooks, helmet, ValidationPipe, SIGTERM drain
├── app.module.ts                    # Root module composition
├── config/                          # Zod environment schema validation & APP_CONFIG token
│   ├── config.module.ts
│   ├── config.schema.ts
│   └── config.token.ts
├── shared/
│   ├── redis/                       # Global RedisModule wrapping ioredis 5.x & PubSub pair
│   ├── logger/                      # nestjs-pino + nestjs-cls (correlation IDs)
│   ├── errors/                      # Domain exceptions & global AllExceptionsFilter
│   ├── health/                      # /health/live & /health/ready (Terminus)
│   └── observability/               # Prometheus /metrics controller & OTel bootstrap
├── docket-alarm/                    # ISOLATED MODULE — Only layer speaking DA API
│   ├── docket-alarm.client.ts       # Public search() client method
│   ├── docket-alarm.http.ts         # Undici shared Agent pool dispatcher
│   ├── docket-alarm.token.service.ts # Redis token cache, SET NX PX election & PubSub refresh
│   ├── docket-alarm.policy.ts       # Cockatiel Policy.wrap(bulkhead, breaker, retry, timeout)
│   ├── docket-alarm.limiter.ts      # Bottleneck rate limiter with AIMD adaptation
│   ├── docket-alarm.types.ts        # Internal DA request/response DTOs
│   └── docket-alarm.errors.ts       # DA shape to domain error mapping
└── legal-results/                   # Product API feature module
    ├── legal-results.controller.ts  # POST /api/v1/legal_results
    ├── legal-results.service.ts     # Service orchestrator (normalize -> cache -> fanout -> sort -> envelope)
    ├── dto/                         # Request and response Zod DTOs
    ├── query-planner/               # Ladder data, court-classifier, state-courts, address-parser
    ├── alias-fanout/                # Bounded pMap (concurrency 3), dedup by (court, docket), 250 cap
    ├── sort/                        # Court authority pre-sort & filing-date desc
    └── cache/                       # async-cache-dedupe Redis SWR + single-flight service
```

---

## 📜 License

MIT