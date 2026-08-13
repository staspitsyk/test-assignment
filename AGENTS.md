# AGENTS.md — Antigravity Agent Orchestration & Coding Invariants

## System Role & Operational Rules
This repository hosts **test-assignment**, a high-concurrency NestJS + Docker microservice integrating the DocketAlarm US legal search API.

All autonomous AI coding sessions operating in this repository MUST strictly follow these rules:

1. **Architecture & Tech Stack Lock**:
   - Runtime: Node.js 20 LTS | Framework: NestJS 11 | Language: TypeScript (`strict: true`).
   - Outbound HTTP: `undici` shared `Agent` (NO `@nestjs/axios` or `axios`).
   - Resilience: `cockatiel` (`Policy.wrap(bulkhead, breaker, retry, timeout)`).
   - Rate limiting: `bottleneck` with `datastore: 'ioredis'`.
   - Cache & Coalescing: `async-cache-dedupe` with Redis storage.
   - Redis: `ioredis` 5.x | Config: `@nestjs/config` + `zod`.
   - Logging: `nestjs-pino` + `nestjs-cls` (pino payload standard: `{ event: 'snake_case', ... }`).
   - Test Mocking: `undici.MockAgent` (NO `nock`).

2. **Domain Invariants**:
   - Max 250 results cap per merged query across all candidate aliases (enforced at query planner level).
   - `party:(name:...) AND is:docket` is mandatory for all upstream DocketAlarm queries.
   - Court Classifier check order: UNCATEGORIZED overrides (e.g. Tax Court) -> COUNTY -> STATE -> FEDERAL -> UNCATEGORIZED default.
   - State abbreviation trap: standard state abbreviations (like NY, IN, OR) do NOT auto-expand in DA; full court names must be used (`state-courts.ts`).
   - Single Node process per container. All shared state (cache, rate-limit buckets, token lock) resides in Redis.

3. **Code & Quality Standards**:
   - Strict typing: `no implicit any`. Use `unknown` and type narrowing.
   - Explicit return types on all exported functions/methods.
   - Inject pino logger — NEVER use `console.log`.
   - NEVER use empty `catch (e) {}` or return dummy fallback data. Map all upstream errors to domain exceptions (`UpstreamUnavailable`, `UpstreamRateLimited`, etc.).
   - All external DA queries and response formats MUST remain isolated inside `docket-alarm/` module.

4. **Task Execution Protocol**:
   - Implement assigned task completely.
   - Run verification commands (unit/integration tests) and show full output.
   - Do NOT commit or push code unless explicitly instructed.
