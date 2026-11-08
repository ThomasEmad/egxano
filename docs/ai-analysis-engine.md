# Meza AI Analysis Engine v2 — Architecture & Operations

## 1. Overview

The AI analysis engine turns verified platform data into expert-grade stock
reports. Its core invariants:

1. **Deterministic calculations, AI interpretation.** Every number a report
   mentions is computed by backend code from verified database values. The LLM
   receives facts (with formulas, periods and provenance) and writes analysis —
   it never calculates, never invents, and missing data is stated as missing.
2. **One report per data identity, shared by all users.** `reportKey` is a
   SHA-256 over `companyId + financial dataHash + technical hash + price date +
   prompt/config/engine versions + language`. Identical inputs → identical
   report served from `AiAnalysisReport` with zero inference. Page visits never
   trigger AI calls.
3. **No duplicate generation.** A Postgres-backed job queue with a
   `UNIQUE(reportKey)` constraint and conditional (lease-based) claims makes
   concurrent requests collapse into a single generation (proven by an
   integration test that runs 5 concurrent enqueues and 3 concurrent claims).
4. **Graceful degradation.** If every provider fails after all retries, a
   deterministic rule-based report (clearly flagged `degraded`) is stored so
   the UI never shows a dead tab or fake numbers.

## 2. Components

| Layer | Files | Role |
| --- | --- | --- |
| Technical engine | `src/lib/technical/*` | SMA/EMA/RSI(Wilder)/MACD/Bollinger/Stochastic/ATR/OBV/hist-vol/S&R zones/trend alignment over real daily OHLCV (`PriceBar`). Sparse data suppresses oscillators instead of guessing. |
| Financial extensions | `src/lib/financial/report-metrics.ts` | Growth, ROIC, liquidity, coverage, CAGR, earnings quality, P/S, EV/EBITDA — null-safe, provenance-tagged. |
| Snapshot builder | `src/lib/ai/analysis-snapshot.ts` (existing) | Verified financial context, single statement basis, `unavailable` encoding, dataHash. |
| Orchestrator | `src/lib/ai/orchestrator/*` | Provider-agnostic adapters, per-provider circuit breakers + RPM caps, concurrency semaphore, exponential backoff, usage accounting, kill switch + spend cap. |
| Report pipeline | `src/lib/ai/report/*` | Deterministic identity, prompt v3 (financial + technical + combined + invalidation sections, AR/EN), zod output validation (sections, table shape, stance, bounds, self-reference leak check). |
| Jobs | `src/lib/ai/jobs/*` | Postgres queue: enqueue (dedup), conditional claim, 90s leases, retry with backoff (5 attempts), stale recovery, identity-drift guard, degraded fallback artifact. |
| API | `src/app/api/v1/...` | See §4. |
| UI | `src/components/egx/company-detail.tsx`, `src/app/companies/quick-analysis.tsx` | Async polling UX, freshness/completeness badges, premium refresh, degraded + failure states. |

## 3. AI provider integration

All providers implement one adapter interface (`AiProviderAdapter`).
Configuration is 100% env-driven — no model or vendor names in code:

- **Primary (legacy, unchanged):** `AI_API_KEY`, `AI_BASE_URL`, `AI_MODELS`
  (priority chain), `AI_API_KEYS` (rotation), `AI_THINKING`, `AI_MAX_TOKENS`.
- **Additional providers:** `AI_PROVIDERS="id1,id2"` with per-provider
  `AI_PROVIDER_<ID>_BASE_URL / _API_KEY / _API_KEYS / _MODELS / _THINKING / _RPM`.
  Production currently adds the free **Pollinations** fallback
  (`AI_PROVIDERS=pollinations`).
- **Sandbox SDK (`z-ai-web-dev-sdk`):** last-resort adapter where the SDK can
  authenticate (sandbox/self-hosted); it fails fast on Vercel.
- **Budget shares:** the first provider gets ≤40% of the window, the rest split
  the remainder equally — a hung provider cannot starve the fallbacks.
- **Resilience:** per-provider circuit breaker (4 consecutive failures → 3min
  open), token-bucket RPM, exponential backoff with jitter, per-attempt
  timeouts, retirement self-healing discovery (inherited from provider v5).

## 4. API endpoints

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/v1/companies/{id}/ai-analysis?lang=` | GET | user | Latest completed report + generation status. 15s shared read cache. |
| `/api/v1/companies/{id}/ai-analysis` | POST | user | Request/generate. Returns **200** (report, cached or just generated), **202** (generating — poll status), 400 NO_DATA, 429 quota/rate-limit. Quota (free 3/month) charged only on real enqueues. |
| `/api/v1/companies/{id}/ai-analysis/status` | GET | user | Lightweight poll (3s shared cache); releases expired leases. |
| `/api/v1/companies/{id}/ai-analysis/history` | GET | user | Paginated report history (cursor). |
| `/api/v1/companies/{id}/ai-analysis/refresh` | POST | premium | Force regeneration of the current identity (dedup-safe). |
| `/api/v1/companies/{id}/ai-analysis/metadata` | GET | user | Data completeness, as-of dates, technical coverage — no generation. |
| `/api/v1/cron/ai-worker?limit=` | GET/POST | CRON_SECRET bearer | Worker drain (280s window) + stale sweep. |
| `/api/v1/admin/ai-ops` | GET/POST | admin | Guards status, breakers, queue/usage stats; set kill switch / spend cap. |

## 5. Worker windows (Vercel Hobby reality)

Serverless invocations cap at 60s, and `after()` shares the invocation's
window — there is no long-running worker. Budgets are therefore explicit:

- **POST inline generation:** adaptive `46s − elapsed` (always returns).
- **Health cron heartbeat** (`GET /api/v1/health`, external ~5min cron):
  `maxDuration 60`, drains up to 2 jobs with a 42s budget.
- **Manual/ops worker** (`/api/v1/cron/ai-worker`): 280s.
- Context build (~10-20s cold, ~1s cached for 5min) is cached so worker
  windows are spent on the LLM.

## 6. Cost & abuse controls

- Kill switch + daily spend cap (USD) as Setting rows
  (`ai_kill_switch`, `ai_daily_spend_cap_usd`), 30s-cached, editable from
  Admin → AI Ops; optional `AI_COST_TABLE_JSON` for token-cost estimation.
- Quotas: free 3 Smart Analyses/month (atomic), per-user burst 10/10min,
  per-provider RPM, global concurrency semaphore, DB-level claim dedup.
- Prompt-injection surface ≈ 0: the payload is numeric JSON only; company
  prose is excluded; output is schema-validated and length-bounded.
- No secrets in report rows; usage rows store provider/model/tokens only.

## 7. Data flows

- `PriceBar` ← `scripts/tv-price-history-harvest.mjs` (TradingView public
  delayed daily bars, the same authorized source as the market snapshot).
  255/276 companies imported (99,948 sessions); 21 tickers have no TV history
  and report honestly as unavailable.
- Report identity changes automatically when: a filing is added/restated
  (dataHash), a new daily bar lands (technical hash), the price date rolls, or
  the prompt/engine versions bump — so caches invalidate on real data change,
  never on page visits.

## 8. Load test results (measured 2026-11-08, production build + real DB)

Single node, pgbouncer pool of 8 (free tier), staged concurrency:

| Scenario | VUs | RPS | p50 | p95 | p99 | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| read-report | 250 | 1,048 | 209ms | 391ms | 528ms | 0 |
| read-report | 500 | 1,105 | 383ms | 489ms | 10.3s* | 1.2% |
| read-report | 1000 | 1,147 | 817ms | 1.0s | 1.6s | 0 |
| status-poll | 500 | 448 | 33ms | 19s* | 20.7s* | 4.6%* |
| generation burst ×25 (same identity) | — | — | — | — | — | 10×200 (cache) + 15×429 (rate-limit), exactly **0** duplicate jobs |

\* during cache-window revalidations competing for the 8-connection pool.
Bottlenecks measured, in order: (1) Postgres connection pool saturation —
mitigated with hot-path caches (session 5min-revalidated, premium 60s,
company 60s, report 15s, status 3s, context 5min) + one-shot pool-retry;
(2) provider latency variance — mitigated with budget shares + fallback chain.
Scaling beyond one node: raise `connection_limit`, or add a shared cache
(Redis/Upstash free tier) for the read caches.

## 9. Test inventory (all executed)

- `src/lib/technical/__tests__/indicators.test.ts` — 38 (reference values,
  insufficiency, sanitizer, determinism).
- `src/lib/financial/__tests__/report-metrics.test.ts` — 10 (zero/negative
  denominators, missing fields, sign-flip growth, provenance).
- `src/lib/ai/orchestrator/__tests__/orchestrator.test.ts` — 15 (fallback,
  breaker, RPM, semaphore, guards, adapters).
- `src/lib/ai/report/__tests__/report.test.ts` — 11 (identity sensitivity,
  section/table/stance validation, AR headings, leak checks).
- `scripts/test-ai-concurrency.mts` — live-DB integration: 5 concurrent
  enqueues → 1 job; 3 concurrent claims → 1 processor; cache-hit for all;
  real end-to-end generation (non-degraded, GLM, 526 words).
- Full suite: 173 passed (+4 pre-existing environment-dependent auth tests
  documented before this work).

## 10. Operational notes

- The old `AiAnalysis` table remains as an archive; all reads moved to
  `AiAnalysisReport`.
- Migrations: `prisma/migrations/20261108000000_ai_analysis_engine_v2`
  (additive, applied to production; reversible by dropping the five tables).
- Emergency controls: `POST /api/v1/admin/ai-ops {"killSwitch": true}` stops
  all inference instantly; queued jobs wait (retries) instead of failing.
- To add a better free/cheap provider later: three env vars
  (`AI_PROVIDER_<ID>_BASE_URL/_API_KEY/_MODELS`) — zero code changes.
