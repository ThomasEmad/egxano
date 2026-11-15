# Opportunity@1 — Historical Validation (owner directive §12)

**Date:** 2026-11-15
**Runner:** `scripts/backtest/run-opportunity-validation.ts`
**Results:** `.cache/bt/opportunity-validation-results.json`
**Engine under test:** `opportunity@1` eligibility layer (strict >5% upside gate + RR ≥ 1.5 + no-chase) on top of the **frozen v2 signal stream** (`.cache/engine-baseline/signals` — replay.ts's own default, the same engine that produced `baseline-results-v2.json`).
**Window:** 29 tickers, 244 sessions (2025-11-12 → 2026-11-12), same `universe.json` retention, same `BacktestConfig`, same 60/20/20 walk-forward split. Parity assertions pass (`frozenWindowParity` in the results JSON).
**No lookahead:** every decision at session t uses bars [0..t] only (`planRederivationMisses: 0`).
**No tuning:** nothing in the eligibility thresholds was adjusted after seeing results.

---

## 1. The funnel (frozen window)

| stage | count |
|---|---|
| decision sessions | 4,727 |
| buy signals (v2 stream) | 1,546 |
| plan-valid candidates (plan re-derived per decision point) | 1,546 |
| classified by opportunity@1 | 1,546 |
| **qualifying (state `actionable` — both gates pass)** | **397 (25.7%)** |
| `none` (honest rejection) | 1,149 |
| execution skips: limit-locked / position-busy | 0 / 281 |
| trades actually entered | 116 |

The strict 5% + RR gate admits **~1 in 4** plan-valid candidates. `conditional`/`observation`/`missed` are 0 in this replay because the runner only replays the close-path buy stream of an already-confirmed engine (watching-setups and no-chase paths exist in the module and are exercised by its unit tests, not by this replay).

## 2. Critical 5% audit — PASS

Every entered trade was re-checked at its actual eligible entry time, from the conservative fill price (entryHigh side, worst executable):

- checked **116**, violations **0**, minimum upside-from-fill **5.05%** (`fillErodedBelow5Pct: 0` — no fill eroded the remaining upside below the gate).

This is the directive's headline compliance property: **no trade was ever entered with <5% realistic upside from its executable entry.**

## 3. Trade statistics (116 trades, 113 completed, 3 open at window end)

| metric | value |
|---|---|
| T1-before-stop | **45.5%** |
| stop rate | 42.5% (48 stop exits) |
| target exits | 40 — time-stop exits 25 |
| T2-reached (of 37 trades with a T2 rung) | 18.9% |
| ambiguous outcomes (bar touched both stop and T1 → resolved stop-first) | **0** |
| false-breakout rate (close back below entryLow within K=5 sessions without a stop-close first) | **51.7%** |
| median sessions to T1 / median hold | 6.5 / 8 |
| avg MFE / avg MAE | +8.4% / −3.5% (MFE p90 +20.8%, MAE p90 0.0) |
| fills | open 115, zone_edge 1 |

## 4. Pooled result vs the v2 baseline — same frozen window

| | opportunity@1 | v2 baseline |
|---|---|---|
| trades | 116 | 43 |
| win rate | 54.9% | 58.5% |
| **Profit Factor** | **2.11** | **3.63** |
| expectancy (after costs) | +3.3% | +4.7% |
| max drawdown | **−67.2%** | −19.9% |
| Sharpe / Sortino | 0.72 / 1.72 | — |

**Honest verdict: the eligibility layer did NOT beat the v2 baseline on this frozen window.** It trades ~2.7× more often, with a lower PF, lower expectancy, and a much deeper pooled max drawdown (a portfolio-level artifact of far more concurrent positions across the 29-ticker universe, not a per-trade difference). The strict gates verify the 5% rule — they do not, by themselves, select *better* trades. Quality differentiation still comes from the ranking layers (OQS, conviction tiers, regime gate), and the honest read is that opportunity@1 as replayed here is a *frequency-wider, quality-neutral* eligibility filter.

## 5. Walk-forward windows (60/20/20)

| window | opp trades | win | PF | expectancy | maxDD | v2 trades | v2 PF |
|---|---|---|---|---|---|---|---|
| TRAIN (2026-03-09 → 08-09) | 83 | 67.5% | 3.59 | +5.3% | −32.8% | 37 | 4.74 |
| VALIDATION (08-10 → 09-28) | 20 | 25.0% | 0.98 | −0.1% | −32.9% | 4 | 0.91 |
| TEST (09-29 → 11-11) | 10 | 10.0% | 0.13 | −6.0% | −51.1% | 0 | — |

The out-of-sample read is **statistically empty** (20 and 10 trades vs the baseline's 4 and 0) — the same caveat discipline as `backtest-ablation.md`. No claim about live out-of-sample quality can be made from these cells. The TRAIN cell (83 trades) again shows the layer trading more with less quality per trade than v2.

## 6. Segments (opportunity trades)

- **By liquidity:** T1 (most liquid) 36 trades PF 2.53 — T2 41 — T3 39; liquidity still correlates with quality.
- **By tier:** EGX30 30 trades PF 2.12 — EGX70 53 — MAIN 33.
- **By score band:** score ≥70: PF 2.34 vs <70: PF 2.15 — the engine score adds little discrimination *within* the already-gated pool (the gates did that work).
- **By sector:** 11 sectors, PF range roughly 0.3–4.7 — sector dispersion is large; per-sector sample sizes are small (the JSON has the full table).

## 7. Engine-drift finding (important, recorded during validation)

The **in-tree** `signals.ts` (tech-signals@5 + the 2026-11-15 parity/rounding remediation) returns `tradePlan: null` on every buy over this frozen historical data (e.g. COMI: 44 buys, 44 null plans), while the frozen baseline engine produced valid plans for the same data (67/67 on COMI) and its pooled buy-signal count differs (511 vs 409). The remediation's stricter plan validation (RR ≥ 1.5 + conservative tick rounding) is the likely cause. **Production impact:** the actionable layer will be *sparser* in production than the replay suggests — the system will honestly show fewer/no qualifying opportunities rather than fabricate plans. This is directive-consistent ("an honest empty list is preferable") but must be monitored after deploy: if plan-validity stays near zero on live data, the actionable list will be permanently empty and the cause (plan validation strictness) is the first thing to investigate.

## 8. Methodology notes

- Entry fill model: next-session open, or zone-edge fill at entryHigh when the open gaps inside the entry zone; ±20% limit-lock skip (0 hits); one position per ticker.
- Stop-first precedence on any bar touching both stop and T1; `ambiguous` would mark cases where the resolution order is unknowable from daily OHLC — 0 occurred.
- False-breakout definition (deterministic): close back below entryLow within K=5 holding sessions without a stop-close first.
- Costs: the same `constants.ts` cost model as the v2 baseline (expectancy/PF are after costs).
- The replay exercises the same `classifyOpportunity` code the production board uses (pure module import — no fork).

## 9. Bottom line

1. The strict 5% eligibility rule is **provably enforced** (0 violations, min 5.05% at fill).
2. On the frozen window the layer is **quality-neutral vs v2 at best** (PF 2.11 vs 3.63 pooled) and trades more — the OQS ranking and regime/conviction gates, not the hard gates, are what must carry quality.
3. The out-of-sample cells are too small to conclude anything; no live-performance claims are made anywhere.
4. The in-tree engine's null-plan drift on historical data will make production actionable lists sparse — honest by design, but it needs a live watch after deploy.
