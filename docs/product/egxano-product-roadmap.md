# EGXANO — Product Roadmap

**Date:** 2026-11-12 · **Framework:** RICE (Reach × Impact ÷ Effort, Confidence noted) compressed into P0–P3 bands · **Constitution:** build on the existing app; preserve features/users/data; production deploys need explicit approval; specs never claim implementation.

---

## 1. Prioritization table (top items only; full long-list lives in the other seven docs)

| # | Item | Pain solved | Differentiation | Data | Effort | RICE (1–10) | Band |
|---|---|---|---|---|---|---|---|
| 1 | Render orphaned HealthTab + TechnicalTab on company page | Built value invisible | — | A | XS | 9 | **P0** |
| 2 | Criterion-level Piotroski F-Score (API + card + tests) | Real fundamental quality check | ★ high (vs opaque badges) | B | S | 8.5 | **P0** |
| 3 | Schedule `cron/market` + `cron/ai-worker` + `cron/recompute` in `vercel.json`; set `CRON_SECRET` | Prices stale intraday; AI queue drains only on visits | trust | A | XS | 8.5 | **P0** |
| 4 | Screener v2: AND/OR groups + technical conditions + multi-sort | Daily driver tool | ★ high | B | M | 8 | **P1** |
| 5 | Saved-screen permalinks + CSV export | Shareability, retention | ★ (nobody has it) | B | S | 7.5 | **P1** |
| 6 | Discovery radars (52W + RVOL first) | Discovery | ★ | B | S | 7.5 | **P1** |
| 7 | Change Intelligence on company pages (surface FinancialEvent deltas w/ citations) | Reading burden | ★ | B | S/M | 7 | **P1** |
| 8 | Methodology pages for scores/valuation models | Trust | ★ | B | S | 7 | **P1** |
| 9 | Registry additions: P/S, EV/EBITDA, P/FCF, earnings quality | Screener depth | high | B | S | 7 | **P1** |
| 10 | Data-ops: publicationDate ingestion; price-bar continuity dashboard | Calendar features fuel | trust | C | M | 6.5 | **P1** |
| 11 | Agentic AI research (tool registry → loop → UI) | Deep research | ★★ unique | B | L | 6.5 | **P2** |
| 12 | Composable alerts + Telegram/email delivery | Monitoring | high | B/C | M/L | 6 | **P2** |
| 13 | Portfolio intelligence (concentration, sector exposure, health-per-holding) | Portfolio job | high | B | M | 6 | **P2** |
| 14 | Backtesting framework (internal first; publish after review) | Honesty wedge | ★★ (vs fake constants) | B | L | 5.5 | **P2** |
| 15 | "What Changed Today" digest | Daily habit | medium | B (after #3, #10) | M | 5.5 | **P2** |
| 16 | Scenario Analysis Lab | Post-devaluation thinking | medium | B | M | 5 | **P2** |
| 17 | Sector Rotation Intelligence | Context | medium | B | M | 5 | **P2** |
| 18 | Thesis Tracker | Long-horizon investors | medium | B (needs #12) | M | 4.5 | **P3** |
| 19 | Market Intelligence Graph prototype | Exploration wow | medium | B | L | 4 | **P3** |
| 20 | Shared research workspaces | Teams | unproven | B | L | 3.5 | **P3** |

**Bands:** P0 = correctness/trust/broken-workflows · P1 = high-value differentiation with available data · P2 = expansion needing infra or review gates · P3 = experimental.

## 2. Implementation batches

### Batch 1 — "Show the truth we already have" (P0) — **status: implemented locally, awaiting deploy approval**
1. ✅ `src/lib/financial/piotroski.ts` — deterministic F-Score (`piotroski@1`), two consecutive annual consolidated periods, criterion-level results with figures/periods/statuses.
2. ✅ `GET /api/v1/companies/[id]/f-score` — public, cached (CDN s-maxage), typed response, `findCompanyByKey` id|ticker|ISIN.
3. ✅ Company page: F-Score card on the overview tab (AR/EN, loading/empty/error/insufficient-period states, criterion breakdown).
4. ✅ HealthTab rendered (existing scores radar — import + mount; zero new logic).
5. ✅ Unit tests (`__tests__/piotroski.test.ts`): pass/fail math, missing-input statuses, restated/edge handling.
6. ✅ TechnicalTab mount (existing component; renders behind data-sufficiency).
7. ⏸ **DEFERRED — blocking discovered:** `vercel.json` cron scheduling for `cron/market` + `cron/ai-worker` + `cron/recompute` is **impossible on the current Vercel Hobby plan** (limit: 2 daily crons, already used by the audit crons). Adding more would break deploys. Options: upgrade to Pro, or keep the existing `/health` heartbeat + external scheduler. Deploy prerequisite either way: `CRON_SECRET` must be set in Vercel env (currently missing → audit cron returns UNAUTHORIZED).
   - Docs (all eight `docs/product/*.md`) — committed with the batch.
   - Pre-existing test debt found during the batch's full-suite run (NOT caused by it): `src/lib/ai/report/__tests__/report.test.ts` has 2 failing cases ("accepts a complete, well-formed report", "accepts Arabic headings…") — the validator rejects the test fixture; fix in Batch 2 before touching report prompts.

### Batch 2 — "Screening that beats the market leader" (P1, next)
Screener v2 groups/operators → registry additions → permalinks + exports → radars (52W/RVOL) → methodology pages → Change Intelligence surface. Each item ships with tests + AR/EN + states.

### Batch 3 — "Agent & alerts" (P2)
Agentic registry → loop worker → trace UI → composable alerts → Telegram/email (requires approval for new provider) → portfolio intelligence.

### Batch 4 — "Provable honesty" (P2)
Backtesting framework internal → review gate → only-then any public stats; digest after cron+publicationDate fixes.

## 3. Deferred / out-of-scope register

- Real-time quotes, index licensing, forward estimates (licensing blockers — feature-gap §3).
- Shared workspaces, MI-Graph, thesis tracker (P3 pending evidence).
- Any marketing of hit-rates before §5 review gates (never).

## 4. Risk register (top 5)

| Risk | Mitigation |
|---|---|
| `ignoreBuildErrors` masks regressions | Out-of-band `typecheck` in CI discipline; batch 1 code is strictly typed |
| Price harvest single-source (TradingView) | Coverage dashboard + honest labeling; no synthesis of missing bars |
| Cron scheduling without secret set | Batch 1 docs list `CRON_SECRET` as a deploy prerequisite; routes fail safe (disabled when unset) |
| AI cost creep with agent | Budgeted inside orchestrator caps; deterministic QA answers the cheap questions |
| Feature-vanishing regressions (treemap/tabs pattern) | This roadmap + audit doc lists orphaned components; batch 1 closes the two known ones |

## 5. Completion ledger (updated per batch)

- **Implemented in Batch 1 (this commit):** roadmap rows 1 + 2 (orphaned tabs rendered; criterion-level F-Score) + the full docs suite. See commit message for the file list. Not deployed — awaiting explicit approval per project constitution.
- **Not implemented (spec-only):** everything in batches 2–4 and all [SPEC] tags across the docs suite.
