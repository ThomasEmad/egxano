# Production Remediation Results — EGXANO (2026-11-14)

Scope: tech-signals@5 engine upgrade + Transactional Outbox notifications + EGX70 filter regression fix + backtesting validation + deployment. Companion docs: `technical-engine-research.md`, `technical-engine-validation.md`, `backtesting-methodology.md`, `notification-architecture.md` (this file is the rollout + verification record).

---

## 1. What shipped (implemented → verified)

| workstream | status | evidence |
|---|---|---|
| Engine tech-signals@5 (de-duplicated dims, decision gates, hysteresis, structure veto, trade-plan honesty) | **implemented + verified** | 413/419 tests green; `tsc --noEmit` clean; production board rows serve `tech-signals@5` (ETEL hold 71, EFID hold 70, TMGH hold 59); company detail serves stance `tech-signals@5` / `technical@5` / `zones@2` / `structure@1` |
| Transactional Outbox notifications (claim + publish in one transaction, lease-based drain, retry → DEAD, multi-device fan-out) | **implemented + unit-verified** | `alert-logic.test.ts` + `outbox-dispatch.test.ts` green (race, crash windows, retries, dead-letter, 404/410 removal); production endpoints verified: VAPID key served, `/api/v1/alerts` 401 unauth, cron 401 unauth, `/sw.js` 200 |
| Walk-forward A/B (@4 frozen vs @5) | **implemented + verified (in-sample)** | mechanically generated comparison (`docs/notes/backtest-comparison.md`): pooled PF 1.95 → 3.63, expectancy 2.37% → 4.75%/trade, false-positive 44.7% → 37.5%, max drawdown −94.1% → −19.9%, at −74% signal frequency; **no out-of-sample improvement claimed** (test window: @4 collapsed PF 0.24/FP 82.4%; @5 de-armed with 6 BUY signals — too few to evaluate) |
| EGX70 index filter restored; "خارج المقصورة" stays retired | **implemented + verified** | production `?tier=EGX70` returns 24 free-view rows all tiered EGX70 (69 seed members active); retired `?tier=OTC` falls back gracefully; regression guard tests pin index vs listing-classification separation |
| Backtesting framework in-repo (`src/lib/backtesting`) | **implemented + verified** | engine-injectable replay (no-lookahead), execution model with named constants, walk-forward split, segments; `--engine=v2` reproduces the harness for A/B |

**Partially verified / blocked (disclosed):**
- Out-of-sample performance claim for @5 — evidence-blocked (short test window; @5 printed no completed trades there).
- Snapshot-engine entry (`computeStanceFromSnapshot`) — unit-tested, not walk-forward replayed (DB-backed pipeline unreachable in sandbox); shares the @5 scoring/gating core.
- Push delivery to a real device end-to-end (provider → OS display) — not simulators' scope; server-side acceptance path verified in tests; OS display is never server-guaranteeable by protocol.
- Multi-year robustness / rolling multi-fold walk-forward — data layer holds ~190 sessions/company by design; single-pass only.

## 2. Test totals

- **419 tests: 413 passed / 0 failed / 6 skipped** (intentional skips, pre-existing) across 36 files.
- `tsc --noEmit`: clean (0 errors). `next build`: ✓ compiled, 123/123 pages generated.
- No existing test was removed or weakened to obtain the green report; 5 stale-spec tests were re-anchored to their documented intent (each edit preserves the test's stated contract — the calibration is recorded in the test comments).

## 3. GitHub commits (all pushed to `main`)

| commit | content |
|---|---|
| `f5e7277` | EGX70 index-filter restoration (index-membership vs listing-classification separation) + regression guard tests + Wave-1 investigation notes (engine / notification / data audits) |
| `6f3914d` | checkpoint save: engine-v2 WIP, Transactional Outbox, backtesting framework + frozen @4 baseline, EGX70 verification lists, prod-ops toolkit |
| `8fbafe1` | @5 decision-gate test calibration (fresh-buy excellence, weak-volume gate on a true candidate, MACD seeding boundary, RR rejection under @5 zone geometry) + backtesting module path fixes |
| `a89e6d6` | engine-injectable replay + `--engine=v2` A/B run + mechanically generated comparison |
| `34a6351` | the four methodology documents |

Repository note: GitHub redirected `ThomasEmad/EGX-Scanner` → `https://github.com/ThomasEmad/egxano.git` (rename) — pushes follow the redirect and land on `main`.

## 4. Deployment record

| item | value |
|---|---|
| Deployed production commit | **34a63515** (the four-docs commit; contains all engine + outbox + EGX70 work) |
| Production deployment | dpl_Bj1asMXEoMR7aiq9FQNStwrfy362 (READY) — **note**: Vercel's Git integration auto-promoted this commit to production while the preview build was still running; the explicit cancel was too late. Preview (dpl_CczN2zPtJ77WgcVZpwaLBJALJURS, READY) was verified against the identical battery afterwards — both serve the same verified build. Previous production (a89e6d63, dpl_ANoB3bZgYbdcXqkm8sDndXMQW6NJ) remains available for instant rollback. |
| Preview URL | https://egxano-4azfhni2s-thomasemads-projects.vercel.app (READY, health 200, stance tech-signals@5) |
| Production URL | https://egxano.vercel.app |
| Rollback capability | yes — prior READY production deployment one API call away; DB changes are additive only (`NotificationOutbox` via `CREATE TABLE IF NOT EXISTS` bootstrap; no destructive migration) |

## 5. Post-deployment verification (production, 2026-11-14 ~17:50 UTC)

| check | result |
|---|---|
| `GET /api/v1/health` | 200 — `database: connected`, 267 companies, dbLatency 557 ms (cold) |
| Engine version on board rows | `tech-signals@5` ✓ |
| Engine version on company detail (COMI) | stance `tech-signals@5`, snapshot `technical@5`, `zones@2`, `structure@1`, snapshot `hash` present ✓ |
| `?tier=EGX70` board | 24 free-view rows, all `EGX70` ✓ |
| `?tier=OTC` (retired) | graceful fallback to the allowed set ✓ |
| `GET /sw.js` | 200 ✓ |
| `GET /api/v1/push/public-key` | 200, VAPID public key served ✓ |
| `GET /api/v1/alerts` (unauth) | 401 ✓ |
| `GET /api/v1/cron/alerts-push` (unauth) | 401 ✓ (CRON_SECRET enforced) |
| `GET /api/v1/companies` | 200 — 246 active, market data as-of 2026-11-14T15:54Z ✓ |

## 6. Performance measurements (production, post-deploy)

| path | cold / first | warm |
|---|---|---|
| `/api/v1/health` | 0.88 s | ~0.8 s |
| `/api/v1/technical/signals?limit=50` (board) | 3.5 s | — |
| `/api/v1/companies/[id]/technical` (COMI, 55 reports) | **17.1 s** (one-time snapshot build + persist) | **0.82–0.89 s** |
| `/api/v1/companies?limit=9` | 3.2 s | — |

The cold→warm drop confirms the canonical-snapshot design: heavy computation happens once per (company, dataHash), then reads serve the stored snapshot. Engine decision work itself is sub-second; the 17 s cold cost is the deep-history snapshot assembly on a cold serverless instance and only recurs when the data hash changes.

## 7. Remaining issues (honest list)

1. **Out-of-sample proof for @5** — the current ~9-month data depth cannot produce it; recommend re-running the A/B after each month of accumulated data (the harness is one command: `tsx scripts/backtest/run-baseline.ts --engine=v2` then `tsx scripts/backtest/compare-engines.ts`).
2. **Public `/history` series unadjusted** (bonus/split drops visible) — documented in the data audit; the engine consumes the adjusted path, but any client-side chart rebuild from `/history` will show the raw series.
3. **One EGX70 seed ticker not currently active in production** (69/70) — disclosed in the data audit; the filter maps to real tier data, no manufactured constituents.
4. **Guaranteed retry floor is daily** (Vercel Hobby cron); sub-hour delivery guarantees need a paid scheduler — deliberately not introduced without measured need.
5. Known cosmetic notes from the pre-existing review (REVENUE "—" on quarter-only companies such as AALR; admin entry direction) remain logged in the worklog, unchanged by this workstream.
6. Deployment order deviation (auto-production won the race over the explicit preview) — disclosed above; mitigations (identical verification battery + instant rollback) were in place before any verification was attempted.
