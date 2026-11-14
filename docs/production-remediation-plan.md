# EGXANO — Production Remediation Plan

**Branch:** `remediation/board-entitlements-perf` · **Baseline:** `main @ da82479` (live production `dpl_nMRSDtHkRVaL7wXHTzdzZyojDj6k`, READY 2026-11-14 02:51 UTC)
**Author:** engineering remediation session · **Date:** 2026-11-14

---

## 1. Current Architecture (verified against the live deployment, not assumptions)

| Layer | State |
|---|---|
| App | Next.js 16 App Router, standalone build, Vercel project `egxano` (`prj_cY9krexWUlK0dAB2M0aXq3u2VXEG`) |
| DB | **Hosted PostgreSQL (Neon)** via Prisma 6 (`provider = "postgresql"`, `db.ts` `SCHEMA_VERSION = "v4-postgres"`, pooled connection). The old SQLite/Turso stack is retired. |
| Entitlements | `src/lib/plans/entitlements.ts` = single source of truth for 3 plans (FREE / PRO 150 EGP / PRO_PLUS 300 EGP, first-month 40% offer), a FIXED free signal set (COMI, ETEL, TMGH, ABUK, EFID) and per-plan limits. `prisma/seed-subscription.ts` seeds plan rows from the same constant and deactivates legacy rows. |
| Session | Random UUID token, stored SHA-256-hashed, delivered to APIs via `x-session-token` / `Authorization: Bearer` headers (`src/lib/auth.ts`, `src/lib/client/api.ts`); 5-min revalidate cache, invalidation on logout. |
| Technical engine | `src/lib/technical/*`: close-based deterministic signals (`signals.ts`), canonical persisted stances (`StanceSnapshot` table, `stance-store.ts`), trade plans (`trade-plan.ts`), market board service (`signals-service.ts`, 10-min in-memory SWR cache). |
| Signals API | `GET /api/v1/technical/signals` — resolves plan, serves the cached whole-market computation; **paid → all rows**, **free/anonymous → intersected with the fixed 5-ticker set**. No query params consumed today. |
| Dashboard | `/dashboard` client imports all five view components eagerly; `DashboardView` fires 8 parallel react-query requests (`dashboard`, `summary`, `latest-results`, `valuation`, sector aggregates, breadth, ticker, watch prices/alerts). All four dashboard APIs are server-cached (60s–10min SWR). |
| Crons | `vercel.json`: daily + weekly audit only. `stance-refresh` is invoked by the GitHub candles workflow after ingestion. |
| Pricing | `/premium` derives its catalog and comparison table from the same `PLANS` constant (API `/api/v1/plans` with constant fallback). |

### Live measurements (2026-11-14, anonymous, Vercel production, 3 runs each)

| Endpoint | Cold | Warm median |
|---|---|---|
| `GET /` | 0.24s | 0.08–0.36s |
| `/api/v1/status` | 0.04s | 0.03s |
| `/api/v1/technical/signals` | **9.23s** | 0.15s |
| `/api/v1/dashboard` | 0.17s | 0.15s |
| `/api/v1/dashboard/summary` | 1.72s | 0.03s |
| `/api/v1/dashboard/latest-results` | 0.15s | 0.03s |
| `/api/v1/dashboard/valuation` | 0.15s | 0.15s |
| `/api/v1/market/breadth` | 0.82s | 0.06s |

---

## 2. Identified Problems → Root Causes

### P1 — Free user: filters appear functional but produce zero/fake results
- **User view:** every filter is visible; applying sector/tier/RSI filters shows "لا توجد نتائج مطابقة" or a 5-row slice; the platform feels broken.
- **Reproduction:** as FREE, open `/signals`, pick فلتر EGX70 → 0 results (all five free tickers are EGX30).
- **Responsible system:** signals board. The API returns ONLY the fixed 5 free rows; **all filters run client-side** over those 5 rows (`signals-view.tsx` `filtered` memo). The API consumes no filter params.
- **Root cause (proven):** the 2026-11-14 hardening (`c99e908`) moved entitlement enforcement server-side (correct) but made the free *filtering* surface dead: there is no server-side filter execution over the full universe, and locked rows carry no identity (generic skeleton placeholders instead of real matched companies).
- **Fix (implemented this cycle):** server-side filter engine over the full cached universe + per-request field gating. Free responses carry matched-company identity rows (ticker/name/sector/tier/lastClose/changePct + `locked: true`) and **never** the paid analysis fields (signal, score, dimensions, reasons, styleFits, metrics, tradePlan, invalidation). True counts and real empty states. UI renders real Locked Premium Cards.

### P2 — Premium (Pro / Pro Plus) user sees only five companies on the signals board
- **User view:** a Premium account sees the same 5 companies as free.
- **Reproduction:** sign in with the premium test account → `/signals` shows 5 rows.
- **Responsible systems (traced end-to-end):** `Session` → `getSessionUser` (header token, cached 5 min) → `Subscription` row → `Plan` row → `getActivePlanId` (name-mapping) vs `getSubscriptionSummary.isPremium` (plan-agnostic) → signals route (`isPaidPlanId(getActivePlanId)`) → in-memory cache (tier-independent by design) → UI `usePlan()` (driven by `subscription/me`).
- **Root cause(s) — two confirmed code defects, one operational condition:**
  1. **Two different definitions of "premium".** `getSubscriptionSummary.isPremium` returns true for ANY `ACTIVE` non-expired subscription row regardless of the plan row's name/price (even a literal `FREE` plan row!). The UI consumes this; the signals API consumes `getActivePlanId`, which maps by plan **name** and maps unknown names to paid **only when `price > 0`**. Any account whose DB row does not resolve to the exact names `PRO`/`PRO_PLUS` gets a premium UI with a FREE API — exactly "premium user sees 5 companies".
  2. **Fragile name matching.** Exact string equality on `plan.name`: `Pro`, `pro `, `PRO-PLUS`, legacy `PREMIUM`, `PLUS` etc. resolve to FREE (when price ≤ 0), despite the code comment claiming legacy rows map to PRO.
  3. **Operational condition (cannot be inspected from this sandbox):** the premium test account's actual DB row. Neon API egress is DNS-blocked here and `ADMIN_PASSCODE` is not available, so the row could not be read/modified directly. The authorized admin path (`/admin → الاشتراكات → تفعيل PRO`) remains the owner-side fix for a bad row; the code fix makes every plausible row shape resolve correctly.
- **Fix (implemented):** one resolution function (`resolvePlanIdFromRow`) used by BOTH `getActivePlanId` and `getSubscriptionSummary.isPremium`; name normalization + alias table (`PREMIUM`→PRO, `PROPLUS`/`PRO PLUS`→PRO_PLUS); any plan with `price > 0` counts as paid; a plan named `FREE` is never premium. `isPremiumUser` now derives from the same plan id (closes the FREE-plan-row premium leak on dashboard events). `subscription/me` returns `plan` (canonical), `planName` (raw, for owner diagnostics).

### P3 — Dashboard latency spikes / "over a minute" completions
- **Measured root causes:**
  1. **Signals board cold compute = 9.2s on every newly-scaled serverless instance** (~250 companies × 420 calendar days of PriceBar + MarketPrice egress from Neon, plus per-series indicator work). The 10-min in-memory SWR cache lives per-instance; a cold boot pays the full compute.
  2. **Dashboard summary cold = 1.7s**, breadth cold = 0.8s (window queries on Neon on cache-miss).
  3. **Initial JS bundle:** `/dashboard` eagerly imports all five views (~4.7k lines: CompaniesView, CompanyDetail 1765 lines, ScannersView, DividendsView) although the landing view needs only DashboardView.
  4. Rendering/parallelization is already healthy (8 parallel queries, skeletons present); no N+1s found in the dashboard read paths (comments + code show the egress diet rewrite already applied).
- **Fixes (implemented):** persisted board snapshot (shared read model in `Setting` table, populated on every successful compute) so a cold instance serves instantly and refreshes in the background; compute window 420→300 calendar days (still ≥3× the longest indicator window); eager→dynamic imports for non-default dashboard views; `Server-Timing` headers on dashboard + signals APIs for honest field measurement.
- **Data honesty:** the snapshot fallback is age-bounded (15 min during Cairo market hours, 24h off-hours — the engine is close-based and the price feed is disclosed as 15-min delayed); `computedAt`/`asOf` travel with the payload; no stale-served-as-fresh.

### P4 — Financial language integrity
- Verified: no `invalidation`/«إبطال التحليل» rendering anywhere in UI (dropped in `261cd06`); stop-loss wording unified («وقف الخسارة»); WAIT (`hold`) returns `tradePlan = null` and every surface renders an honest "no clear entry zone — waiting is better" instead of fabricated levels; AI-analysis and audio-briefing features were removed (`261cd06`).
- Residual fixed this cycle: landing/pricing copy sweep for leftover removed-feature claims (see §6), locked-card copy per the product's approved phrasing (no profit guarantees).

### P5 — Pricing integrity
- `/premium` already derives catalog + comparison from `PLANS` (same file the backend enforces). Verified every advertised bullet maps to an enforced limit (`signalsRows`, `portfolioHoldings`, `qaPerDay`, `alerts`, `watchlist`, `events`, `scanners`, `pdfReport`, `ads`).
- Remaining gap fixed this cycle: companies table still exposed the alphabetical sort (`الرمز (أ ب ت)`) and defaulted to it — owner decision 2026-11-14 is **market-cap only**; UI options reduced to marketCap/changePct/valuation metrics (no alphabetical), default `marketCap`.

---

## 3. Proposed Changes (implemented in this cycle)

| # | Change | Files | Risk |
|---|---|---|---|
| C1 | Single plan-resolution function + alias handling; summary/plan consistency; FREE-row leak closed | `src/lib/subscription.ts`, `api/v1/subscription/me` | Low |
| C2 | Server-side board filter engine (pure, unit-tested) + URL param parsing | `src/lib/technical/board-filters.ts` (new) | Low |
| C3 | Per-request free gating: locked rows carry identity + price only, paid analysis never crosses the wire; true matched counts | `src/app/api/v1/technical/signals/route.ts` | Medium |
| C4 | Real Locked Premium Cards (name/ticker/sector/tier/price + lock + CTA), server-filtered free mode, honest empty states, upgrade copy | `src/components/egx/signals-view.tsx` | Medium |
| C5 | Board snapshot persistence (Setting `technical-signals:board:v1`) + cold-start fallback + background refresh | `src/lib/technical/board-snapshot.ts` (new), `signals-service.ts`, route | Medium |
| C6 | Compute window 420→300 days; Server-Timing headers | `signals-service.ts`, dashboard routes | Low |
| C7 | Dashboard view code-splitting (dynamic imports) | `src/app/dashboard/client.tsx` | Low |
| C8 | Companies UI: market-cap default, alphabetical sort removed | `src/components/egx/companies-view.tsx` | Low |
| C9 | Regression tests: plan resolution matrix, filter engine, gating redaction, snapshot round-trip | `src/lib/**/__tests__` | Low |

## 4. Database Changes
- **None schema-level.** The board snapshot reuses the existing `Setting` table (`key = technical-signals:board:v1`, `type = json`) — the same pattern as `market_ticker_snapshot_v1`. No migration, no data loss path. `StanceSnapshot` continues to serve canonical stances.

## 5. Security Considerations
- Paid analysis fields are removed **server-side before serialization** for non-paid callers; gating is not CSS/browser-only. Verified by tests asserting absent keys and by network-response inspection.
- Plan resolution treats `price > 0` as paid; a `FREE`-named active row can never unlock premium surfaces.
- No secrets, tokens or credentials enter the repo; the QA account created for probing is a normal free user created through the public register API.
- Snapshot rows contain only already-public board data (no per-user data).

## 6. Copy Sweep Result (this cycle)
- Landing page, premium page, dashboard, signals, company pages: no AI-analysis or audio-briefing claims remain (removed in `261cd06`; re-grepped this session — zero hits).
- Locked-card copy uses the approved phrasing: results are real, details need Pro, no profit promises, disclaimer unchanged («لأغراض معلوماتية وليست توصية بالبيع أو الشراء»).

## 7. Performance Targets (acceptance)
- Signals board warm P95 < 1.5s (measured 0.15s warm median — met).
- Signals board cold: **no user-visible multi-second block** when a fresh snapshot exists (instant serve + background refresh); full compute remains the fallback.
- First meaningful dashboard paint: unchanged (<3s warm — the page HTML is static-shell + parallel queries).
- Dashboard JS initial bundle: reduced by removing eager heavy-view imports.
- Honest measurement via `Server-Timing` headers on `/api/v1/dashboard*` and `/api/v1/technical/signals`.

## 8. Test Strategy
- Unit (vitest): plan-resolution matrix (9 cases), filter-engine semantics, gating redaction (no paid keys), snapshot round-trip, market-cap-only UI mapping (where testable).
- Gates: `tsc --noEmit`, `eslint .`, `vitest run`, `next build` — all must pass before merge.
- Live: preview deployment probes (free + anonymous payloads, timings ×3), then production re-probe after merge (same probe suite, saved to `scripts/out/probe_results*.json`).
- Premium live verification constraint: no premium test credentials available in this environment (and DB row not inspectable) — premium path verified by (a) unit tests over the exact DB-row shapes, (b) code-path review, (c) the owner performing one premium login after deploy. Explicitly reported as **implemented, live-premium-login verification pending owner**.

## 9. Rollback Plan
- Git revert of the remediation commit(s) on `main` re-deploys automatically (Vercel git integration). Previous production `da82479` remains redeployable from Vercel's deployment history (`dpl_nMRSDtHkRVaL7wXHTzdzZyojDj6k`). No DB migrations to reverse; the `Setting` snapshot row is inert to old code (it simply stops being read).

## 10. Acceptance Criteria (mapped to the mission's checklist)
- Free filters execute on the full universe; real results; locked premium cards carry identity; paid fields never leave the server; real empty states. → C2/C3/C4 + tests.
- Pro/Pro Plus resolve to full board access for every plausible plan-row shape; no hardcoded 5-company limit on paid plans (the 5-cap exists ONLY on the fixed free set). → C1 + tests.
- Root causes of dashboard latency identified with measurements; snapshot fallback + bundle diet + instrumentation shipped; targets §7 verified on production. → C5/C6/C7 + re-probe.
- Levels unified (canonical stance), WAIT renders no plan, invalidation wording absent, no removed-feature claims. → verified + sweep.
- Pricing page and backend share `PLANS`; no unimplemented feature advertised. → verified.
- Build/lint/typecheck/tests green; preview tested; production deployed and re-probed; push confirmed; rollback reference recorded.
