# Technical Engine Validation — tech-signals@5

Date: 2026-11-14 · Scope: the evidence that the @5 engine does what the research doc says, and nothing it can't prove.

---

## 1. Test suite (the contract layer)

**Result: 413 passed / 0 failed / 6 skipped (intentional skips), 36 test files.** `tsc --noEmit` clean, ESLint clean on all touched modules. Every pinned score in the decision-gate tests carries its arithmetic derivation in a comment (dimensions × bands → raw % → finalize curve → score), so a future change that silently shifts a threshold breaks a *readable* contract, not a magic number.

What the mandatory layers cover (spec §14 mapping):

| Layer | Evidence |
|---|---|
| Indicator formulas | Wilder RSI hand-math pinned; EMA seeding; MACD line/signal/histogram incl. seeding boundary (slow−1) and the accelerating-series histogram-expansion contract; stochastic flat-series null; ATR incl. gap case; OBV null policy |
| Warm-up / missing data | null-before-warm-up asserted per series; flat runs → null with disclosed reason; zero-volume skips disclosed |
| S/R structure | equal-high double top → multi-touch cluster (the @5 strict-pivot fix); zones AT the close dropped (0.1% tolerance) |
| Decision gates | hot-RSI range-top → hold with `not_full_strength` (the exact chase-top the audit measured); healthy uptrend (every dimension ≥ 80%) → fresh BUY with volume 16/20 and a valid plan; thin participation on a buy-candidate score → hold with `weak_volume_no_buy` as the first rejection; distribution downtrend → SELL with no fabricated plan |
| Trade plan | structural stop + zone entry; tiny-ATR clamp to the 3.5×ATR ceiling; wide-ATR RR < 1.5 → NO plan (validated, not fudged); chase with distant support → NO plan; tick rounding (`roundToTick`) |
| Hysteresis | enter/exit bands, 2-session hold, score glide, structural bypass (versioning/staleness contracts pinned in `free-set-and-stance.test.ts`) |
| Entitlements / regression | five-free fixed set, locked premium cards, legacy plan-name access contract, EGX30/EGX70 filter separation (see §4) |

## 2. Walk-forward A/B against the frozen @4 engine

**Harness invariance:** both engines ran through the identical `src/lib/backtesting` pipeline — same cached Yahoo series (`.cache/bt/`, 29 validated tickers, 244 sessions each, 2025-11-12 → 2026-11-12), same universe, same ±20% limit-lock/0.3%-per-side-cost/next-close-fill execution model, same chronological 60/20/20 split, **zero parameter tuning on any window**. The runner is engine-injectable (`scripts/backtest/run-baseline.ts --engine=v2`); the default reproduces the frozen baseline run.

**Headline numbers (all generated mechanically from the two result JSONs — no hand transcription):**

| metric (pooled) | frozen @4 | upgraded @5 |
|---|---|---|
| trades (completed/open) | 251 (243/8) | 43 (41/2) |
| win rate | 54.3% | 58.5% |
| profit factor | 1.95 | **3.63** |
| expectancy / trade | 2.37% | **4.75%** |
| max drawdown | −94.1% | **−19.9%** |
| Sortino (per-trade ann.) | 1.37 | **2.11** |
| false-positive rate (stop-first) | 44.7% | **37.5%** |
| BUY signals / 100 sessions | 32.7 | 8.7 (−74%) |

Walk-forward windows:

- **Train (2026-03-09 → 2026-08-09):** PF 3.29 → 4.74, expectancy 3.96% → 5.31%, false-positive 35.4% → 30.8% — the upgrade pays for itself on the tuning-allowed-but-untuned window.
- **Validation (2026-08-10 → 2026-09-23):** a regime window where BOTH engines lose money (@4 PF 0.55 / −2.37% per trade; @5 PF 0.91 / −0.48%) — @5 loses **less** and trades 10× less into the deterioration.
- **Test (2026-09-24 → 2026-11-11):** @4 collapsed (win 11.8%, PF 0.24, false-positive 82.4% across 25 trades). @5 issued 6 BUY signals and 2 fills (0 completed) — **too few to evaluate; no out-of-sample improvement is claimed**. The honest reading: the @5 gates de-armed in the hostile regime instead of firing 82% false positives; that is evidence the filter *behaves*, not evidence of profit.

## 3. Statistical-honesty rules enforced

- Win rate alone never cited (drawdown/MAE/PF accompany it everywhere).
- SELL path evaluated as **exit-evidence** (5-session forward return after SELL: mean 0.57% vs 1.20% all-sessions baseline — the SELL path avoided downside), never as modeled short P&L (EGX retail shorting unavailable).
- In-sample/out-of-sample labeling on every number; nothing above 80 in the displayed score without full-strength dimensions + relVol ≥ 1.3 (`finalizeScore` display gate kept from @4).
- No probability-of-profit language; score bands are score bands.

## 4. EGX70 filter regression proof

- The restored `EGX70` filter is a separate index-membership filter from the retired "خارج المقصورة" listing-classification option; the codebase now keeps the two concepts in separate layers (`board-filters.ts` / `tiers.ts`).
- Guard tests pin: EGX30 selection, EGX70 selection, switching between them, index+technical filter combination, five-free locked-card behavior, and pagination — plus the regression guard that removing an out-of-board classification cannot remove any exchange-index filter again.
- Production tier data verified against the seeded index membership: EGX30=30, EGX70=69 seed tickers present (one EGX70 seed ticker not currently active in production — disclosed in the data audit, not silently substituted).

## 5. What remains unproven (stated plainly)

1. Multi-year robustness — the data layer carries ~190 sessions/company by design; the walk-forward is single-pass, not rolling multi-fold.
2. The snapshot engine's Stochastic/quality layers — unit-tested, not walk-forward replayed (see research doc §3.2).
3. Live-production behavior of @5 — to be confirmed by post-deployment verification (see `docs/production-remediation-results.md`).
