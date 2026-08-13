# test-assignment — Intelligo × DocketAlarm

NestJS + Docker service integrating the [DocketAlarm](https://www.docketalarm.com/api/v1/) US legal source. One endpoint — `POST /api/v1/legal_results` — takes an Intelligo entity (Person or Company) and returns matching legal cases in which the subject appears as a **party**, sorted newest-first with court-authority pre-sort.

Home assignment. Backend only. Design lives in the plan file (`~/.claude/plans/for-sure-i-will-prancy-tide.md`); this file carries the invariants and rules Claude needs at load time.

## Tech stack — locked

- **Runtime:** Node.js 20 LTS
- **Framework:** NestJS 11 (or latest stable)
- **Language:** TypeScript, `strict: true`
- **HTTP client (outbound):** `undici` — one shared `Agent` with keep-alive. **Not** `@nestjs/axios`.
- **Resilience:** `cockatiel` — one `Policy.wrap(bulkhead, breaker, retry(decorrelatedJitter), timeout)` per DA client method
- **Outbound rate limit:** `bottleneck` with `datastore: 'ioredis'` — cluster-wide token bucket + AIMD from 429/`Retry-After`
- **Cache + single-flight:** `async-cache-dedupe` with Redis storage — SWR and coalescing in one library
- **Redis:** `ioredis` 5
- **Config:** `@nestjs/config` + `zod` via `validate` hook, typed via `z.infer`
- **DTO validation:** `nestjs-zod`
- **Logging:** `nestjs-pino` + `nestjs-cls` (AsyncLocalStorage-based correlation IDs)
- **Metrics:** `prom-client` at `/metrics`
- **Traces:** `@opentelemetry/sdk-node` + auto-instrumentation for undici/ioredis/pino
- **Health:** `@nestjs/terminus`, split `/health/live` and `/health/ready`
- **Test HTTP mocking:** `undici.MockAgent`. `nock` doesn't intercept undici.
- **Containerization:** Docker + Docker Compose

**Never introduce alternatives without approval** (no axios, no winston, no joi, no nock, no opossum, no @nestjs/axios). If a decision looks wrong, surface the reasoning and wait — don't swap silently.

## Domain invariants — never violate

**Each external DA request must return ≤250 results.** Product cap, not a DA cap (DA allows ~1000 via offset). The service probes `count` first (`limit=1`) and narrows the query via the ladder until it fits. If exhausted and still >250 → HTTP 200 with the narrowest set (up to 250) + `meta: { truncated: true, partial: true, unnarrowable: true, upstream_count }`. Never silently truncate.

**Party filter is mandatory.** `party:(name:...) AND is:docket`. Never a client-side filter. `is:docket` prevents document-level result rows.

**Highest-confidence name is the base term.** Ties → first-in-array. Candidates below `ALIAS_CONFIDENCE_THRESHOLD` (default 0.5) are dropped from both single-name and alias-fan-out paths.

**Person narrowing ladder (task-mandated order):**
1. `party:(name:"FirstName LastName") AND is:docket`
2. `+ AND court:(<OR-joined full state court names>) AND is:state` — driven by address parser; multi-state inputs (e.g. 4-address Robert Gilbert case) are OR-joined in ONE `court:(...)` clause, one DA call, not N.
3. `+ AND from:-10years`

**Company narrowing ladder (task-mandated order):**
1. `party:(name:"CompanyName") AND is:docket`
2. `party:(name:"CompanyName CompanyType") AND is:docket` — companyType (`LLC`, `Inc.`, …) woven into the name term. Note: `type:` inside `party:(...)` means party ROLE (plaintiff/defendant), NOT corporate suffix. Address is NOT in the company ladder.
3. `+ AND from:-10years`

**Sort contract:**
- Court-authority pre-sort: `FEDERAL > STATE > COUNTY > UNCATEGORIZED`. Classification is derived from the `court` string.
- Then filing date descending. Missing/unparseable `date_filed` → sort key `+Infinity` (last).
- Deterministic tiebreak on `(court, docket)`.

**Court classifier** — checks in this order (order matters — `'United States Tax Court'` contains `'United States'`):
1. UNCATEGORIZED overrides (curated list starting with `'Tax Court'`)
2. COUNTY (`'County'`, `'Court of Common Pleas'`, `'Magisterial District Court'`)
3. STATE (`'State,'`, `'Superior Court'`, `'State Supreme'`)
4. FEDERAL (`'U.S.'`, `'United States'`, `'Federal'`, `'District Court'`, `'Circuit'`, `'Bankruptcy Court'`)
5. UNCATEGORIZED (default)

**Alias fan-out** — search all name candidates ≥ threshold. Bounded concurrency (`pMap`, `concurrency: 3`). Merged, deduped by `(court, docket)`. **250 cap is on the merged output, not per alias.** Hard budget: max 30 upstream calls per incoming request.

**State abbreviation trap** — DA auto-expands state abbreviations to `abbrev OR "full state"` **except `OR`, `IN`** (Oregon, Indiana). The `state-courts.ts` map uses full court names for every state, never bare abbreviations.

**Scale invariants** — every shared piece of state lives in Redis (result cache, single-flight lock, DA token, Bottleneck bucket). One Node process per container. Horizontal scaling is via replicas (`deploy.replicas` / K8s Deployment), never Node's `cluster` module — the plan file documents why.

## External API — DocketAlarm

- Endpoint: `GET https://www.docketalarm.com/api/v1.1/search/`
- Auth: `Authorization: Bearer <login_token>`. Login: `POST /api/v1.1/login/` with `{username, password}` → `login_token` valid **90 min**. v1.1 rejects `login_token` in the URL.
- Sort: `o=-date_filed` (newest-first native).
- Pagination: `limit` max 50, `offset + limit < 1000`. Our 250 budget = 5 pages.
- Probe: `limit=1` to read `count`, decide narrow-or-fetch, then paginate.
- CI / dev-safe: pass `test=1` to skip billing (auto-appended when `NODE_ENV === 'test'` OR `DA_TEST_MODE === true`).
- Response fields we consume: `count`, `search_results[].{court, docket, title, link, date_filed}`.
- Errors: `{success:false, error:"..."}`. Map to domain exceptions (`UpstreamUnavailable`, `UpstreamRateLimited`, `UpstreamAuthFailed`, `UpstreamQueryError`). Never leak the DA `error` string to the caller (log it, don't return it).

**Confirmed operators** (from DA's Terms & Connectors reference):
- `court:(...)` — supports boolean OR/AND (`court:("Court A" OR "Court B")`). No `state:` or `jurisdiction:` operators exist.
- `is:docket`, `is:state`, `is:pacer`, `is:opinion`, `is:pleading` — result-type / jurisdiction filters.
- `party:(name:X type:role firm:(...))` — `name`, `name_exact`, `type` (party role), `firm`, `attorney`.
- Date syntax: `from:M/D/YYYY to:M/D/YYYY`, relative `from:-10years`, `next:1year`, `last:1year`, natural `yesterday`/`today`.

**Empirical questions to answer once credentials are wired** (see `test/probes/`):
1. Concurrent tokens — does a new `/login/` invalidate the previous token?
2. Rate limits — headers, per-endpoint QPS ceiling, `Retry-After` behavior.
3. Full error-string taxonomy — instrument logs for first-N-days capture.
4. `count` accuracy at high values.
5. `party:(name:(A OR B))` composition semantics for alias fan-out.

## Edge cases the service must handle

- DA unavailable / 5xx / timeout → cockatiel opens breaker; return `503 upstream_unavailable` with `retryAfter`. No partial results passed off as complete.
- Rate-limited by DA (429) → Bottleneck halves reservoir, honors `Retry-After`, retries via cockatiel; if breaker opens, surface as retryable.
- **Parallel identical requests** → `async-cache-dedupe` in-process Promise map + Redis cache coalesce to 1 upstream fan-out per unique entity (per pod and across pods).
- **Duplicate requests over time** → SWR cache (TTL 30 min, stale 5 min, both configurable). Cache key is a SHA-256 of the normalized entity (excludes `entityId` and `sender`).
- Input with empty `name[]`, all-below-threshold, single-token Person name, empty Company name → `422 invalid_entity`. No DA call.
- Narrowing exhausted and still >250 → `200` + `meta: { truncated, partial, unnarrowable, upstream_count }` (never refuse).
- Multi-state address input → OR-joined in a single `court:(...)` clause. Fully ambiguous address (no state parses) → `+state` step is skipped, planner jumps to `+10years`.
- SIGTERM → `/health/ready` flips to 503 → sleep 5s → close server → drain in-flight up to 25s → close Redis/Bottleneck/OTel → exit.

## Operating rules

- **Plan mode for anything spanning >1 file, or introducing a module/dependency.** Present the plan; wait for approval before editing.
- **Tests are the gate.** A task is not complete until the relevant test command passes. Run it; paste the actual output.
- **One concern per change.** Implement → verify → move on. Don't batch unrelated edits.
- **Missing a fact?** State the exact question and stop. Do not guess file paths, API shapes, or config keys.
- **Prefer editing existing files** over creating new ones the task didn't ask for.
- **Never commit without being asked.** Never push. Never merge.
- **Credentials never in chat.** DA username/password live only in `.env` (gitignored). `.env.example` shows the shape.

## Coding standards

- TypeScript `strict: true`. No `any` — use `unknown` and narrow.
- Explicit return types on exported functions.
- NestJS module-per-feature. Controller → Service → (Client). No HTTP or DA calls in controllers.
- Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true })` — `sender` is a passthrough field per the task's sample data.
- Never `console.log`. Use the injected pino logger.
- Never `catch (e) {}`. Every catch either handles, re-throws with context, or maps to a domain exception.
- Never hardcode secrets, URLs, or tokens.
- Never leak DA response shapes, stack traces, or credentials to the caller. Global `AllExceptionsFilter` produces the wire envelope; domain exceptions decide the HTTP status.
- Log-line convention (pino payload): `{event: 'snake_case_name', ...fields}` for greppability.
- Providers are **singletons**. Never REQUEST-scope the DA client, Redis, Bottleneck, or TokenService — that fragments in-process state and kills keep-alive.

## Repository layout

Reflects the target shape per the plan. Not fully scaffolded yet — file surfaces are added as tasks land.

```
src/
├── main.ts                             # bootstrap, enableShutdownHooks, helmet, ValidationPipe
├── app.module.ts
├── config/                             # zod-validated env, typed APP_CONFIG token
├── shared/
│   ├── redis/                          # ioredis-5 + PubSub pair, @Global
│   ├── logger/                         # nestjs-pino + nestjs-cls
│   ├── observability/                  # otel bootstrap, prom-client, /metrics controller
│   ├── errors/                         # domain exceptions + AllExceptionsFilter
│   └── health/                         # /health/live and /health/ready (Terminus)
├── docket-alarm/                       # the ONLY module that speaks DA
│   ├── docket-alarm.client.ts          # public surface: search(query)
│   ├── docket-alarm.http.ts            # undici Dispatcher (one Agent)
│   ├── docket-alarm.token.service.ts   # Redis-cached token + SET NX PX + PubSub refresh
│   ├── docket-alarm.policy.ts          # cockatiel Policy.wrap(...)
│   ├── docket-alarm.limiter.ts         # Bottleneck cluster-wide + AIMD
│   ├── docket-alarm.types.ts           # internal DTOs — never leak
│   └── docket-alarm.errors.ts          # DA shape → domain error mapping
└── legal-results/                      # the product endpoint
    ├── legal-results.controller.ts     # POST /api/v1/legal_results
    ├── legal-results.service.ts        # orchestrates: pick names → planner → cache → client → sort
    ├── dto/                            # zod request + response schemas
    ├── query-planner/                  # LADDER as data, court-classifier, state-courts, address-parser
    ├── alias-fanout/                   # pMap + dedup + 250-cap enforcement
    ├── sort/                           # court-tier then date-desc
    └── cache/                          # async-cache-dedupe(storage: redis)

test/
├── unit/                               # colocated *.spec.ts also OK
├── integration/                        # nest boots, undici MockAgent, real Redis
├── fixtures/                           # entities/*.json (5 golden inputs), DA response fixtures
└── probes/                             # manual empirical DA probes; NOT in CI
```

## Running the stack

```bash
docker compose up --build -d              # app (2 replicas) + Redis + optional otel-collector
docker compose exec app npm test          # unit + integration (MockAgent, no DA calls)
docker compose exec app npm run test:e2e  # e2e via supertest + MockAgent
docker compose exec app npm run probes    # OPTIONAL — hits real DA; requires DA_USERNAME/DA_PASSWORD

curl -sf http://localhost:3000/health/live
curl -sf http://localhost:3000/health/ready
curl -s http://localhost:3000/metrics | grep -E '^(upstream_|cache_|circuit_|token_|dedup_)'
```

## Claude infrastructure

Not yet added. When we introduce recurring workflows or domain patterns (query-planner edits, DA client resilience tuning, empirical probe workflows), prefer **skills under `.claude/skills/<name>/SKILL.md`** over expanding this file. CLAUDE.md loads every session; skills are on-demand. Keep this file under 200 lines.
