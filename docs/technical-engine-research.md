# Technical Engine Research — EGXANO (tech-signals@5)

Date: 2026-11-14 · Author: Quantitative research workstream (Phase 1 investigation + Phase 2 upgrade)
Status: **implemented and validated in-tree** (`src/lib/technical`), walk-forward A/B in `docs/notes/backtest-comparison.md`

---

## 1. The starting point (what the audit found)

The pre-upgrade engine was frozen verbatim at `.cache/engine-baseline/` (commit f5e7277, `tech-signals@4`) and audited end-to-end — every indicator formula, every scoring band, every decision threshold, plus an empirical replay of real production tickers (`scripts/invest/sample-engine.ts`, raw cache in `.cache/history/`). Full evidence: `docs/notes/engine-audit.md`. Five root causes were identified, ranked by impact:

1. **The BUY decision could fire without volume confirmation and at the top of the range.** The @4 "excellence gate" (`finalizeScore`) only clamped the *displayed* score above 80; the BUY threshold (62 compressed ≈ raw 71) sat below it. Verified live: the production engine printed `buy` with `relVol 0.39` and `rangePos60 100.0` (score 63).
2. **Triple-counted trend evidence.** Trend (35%), momentum (30%) and risk (15%) all scored the same underlying fact family (price above rising averages). One uptrend phenomenon earned ≈3 of 4 dimensions at once — the "confluence score" was largely one signal counted three times.
3. **The rich layers were decorative.** Structure (BOS/CHoCH), supply/demand zones, VSA and the analytical-quality score were computed but never read by the scorer; zones never touched the stance.
4. **The trade plan was mostly mechanical percentages.** In the "chasing" branch (the majority of BUY cases after a run): stop = flat −4.5%, entry = ±0.4% band, target = 2R. ATR only kicked in above 4% extension; EGX tick size was respected nowhere.
5. **Redundancy and micro-defects:** RSI/Stochastic/MACD all counted as independent momentum confirmation; equal-high double tops were invisible to S/R (strict `>=` pivot rejection killed both pivots on a second equal touch); zones 0.004% below the close survived as "support"; Stochastic's flat-window skip made %D span non-consecutive sessions; OBV's all-or-nothing null on any missing volume date.

## 2. The upgrade methodology (what changed and why)

The @4 architecture (four scored dimensions feeding a final score) was **kept** — the audit confirmed the math was clean and the failure was calibration and gating, not the skeleton. The changes, each tied to the root cause it addresses:

### 2.1 De-duplicated dimensions (root causes 2 & 3)

- Weights rebalanced from 35/30/20/15 to **trend 30 / momentum 25 / volume 25 / risk 20** — participation (volume) is now the co-equal buy confirmation the audit showed was missing.
- One trend-state input on a fixed 0–30 scale (price vs EMA20/EMA50, EMA20>EMA50, slope streak — all four facts must hold for the full 30).
- **Momentum is an oscillator GROUP with an 80% corroboration cap** (`MOMENTUM_GROUP_STRONG_SHARE = 0.8`): RSI(14) + MACD(12/26/9) + rangePos60 can never contribute more than 80% of their present maximum — the same price move can no longer be counted three times to manufacture confluence.
- Risk scores only risk facts (two-sided extension, volatility level, volatility expansion) — trend agreement removed from risk entirely (the @4 extension credit *rewarded* chase).

### 2.2 Decision-level gates (root cause 1)

`decideSignal()` now requires, for a BUY: score ≥ 62 **AND** trendShare ≥ 0.55 **AND** volume agreement (relVol ≥ 1 OR OBV slope agrees) **AND** decision-level excellence (every present dimension ≥ 80% of its own max) **AND** RSI ≤ 78 **AND** no structure veto. Rejections carry explicit bilingual reasons (`weak_volume_no_buy`, `not_full_strength`, `near_resistance_veto`) — the board tells the user *why* it refused, not just "WAIT".

- **Structure veto (audit C):** a multi-touch S/R cluster within ±2% of the close vetoes the directional read unless a breakout is confirmed (prior close beyond the zone AND relVol ≥ 1.5) or a documented retest-hold is in place.
- **Distribution SELL path (audit D):** OBV falling + momentum breakdown + lower-highs-or-below-long-MA prints SELL without the @4 3-condition conjunction — deliberately *without* the excellence gate, because requiring full-strength bearish evidence on every dimension recreated the measured "unreachable SELL" failure (467 straight holds on ORAS).
- **Hysteresis (audit E):** asymmetric enter/exit bands (BUY enters ≥62 / exits <55; SELL enters <35 / exits >42), a 2-session minimum state hold, a ±25-point per-session score glide limit, and a ±3% structural-move bypass — no more one-session −61 score jumps.

### 2.3 Indicator-layer fixes (root cause 5)

- **Equal-high fix:** strict pivot comparisons — an equal high is a TOUCH, not a rejection; multi-touch clusters now form exactly where they matter most (regression-pinned).
- **Zone-drop tolerance:** zones within 0.1% of the close are dropped (was exact-equality on a 2-dp rounded price).
- **Stochastic overbought context veto** aligned with RSI (k ≥ 80 in a trend no longer earns full momentum credit while RSI > 72 earns 2).
- **MACD series API** (`macdSeries`) with the seeding boundary pinned by test (both EMAs exist from index slow−1); histogram contract validated on accelerating vs linear series.
- **Rounding moved out of the decision path** — presentation-only (`roundReplacer` at the JSON boundary); comparisons run at full precision.

### 2.4 Trade-plan honesty (root cause 4)

The plan builder was rebuilt around structure (`trade-plan.ts` header documents every constant):

- **Entry zone** from the nearest structural support/pullback structure, not a fixed band around the close.
- **Stop** = structural anchor expanded by **1.5×ATR**, clamped into a **[0.5×ATR, 3.5×ATR]** sanity band of the entry mid (never inside normal noise, never absurdly far); when no volatility input exists a disclosed 2–8% band applies and the close-only board path uses a disclosed **ATR proxy = 1.5 × daily σ**.
- **Target** = measured-move projection of the 40-session range (structural), not a blind 2R multiplier.
- **RR is validated, never fudged:** a plan paying **< 1.5R is rejected outright** (null) — WAIT means NO plan; no invented levels.
- **All prices pass through `roundToTick()`** (EGX tick discipline).
- **Style honesty:** the "day" style is disabled on daily closes (no intraday claims); `swing`/`trend`/`reversal` labels are checked against the same facts.

### 2.5 What was deliberately NOT added

ADX, VSA re-scoring, volume profile, and multi-timeframe re-introduction were evaluated and **not shipped in this pass**: they either duplicate existing evidence (ADX vs the trend-state facts), need intraday data the public path does not carry (VSA), or their historical validation window is too short to justify the added parameters. The spec's rule — "only implement additions supported by historical validation" — was applied; the backtest window (~1 year, 29 tickers) cannot support tuning 10 new parameters honestly.

## 3. Known limitations (disclosed)

1. **No out-of-sample improvement claim.** The untouched test window (2026-09-24 → 2026-11-11) saw @4 collapse (PF 0.24, false-positive 82.4%) while @5 de-armed (6 BUY signals vs @4's 70) — too few trades to evaluate. See `docs/notes/backtest-comparison.md`.
2. **Snapshot-engine parity:** the walk-forward replays the close-engine entry (`computeCloseSignal`); the DB-backed `computeStanceFromSnapshot` pipeline could not be replayed in the sandbox (Neon unreachable) — it shares the same scoring/gating core, but its Stochastic component and volume-complete-suffix behavior were validated by unit tests only.
3. **~190-session history depth** per company (data-layer audit) bounds what any engine can verify; SMA200-class checks remain marginal.
4. Corporate-action adjustment uses the DB ledger where available; the public `/history` series remains unadjusted (documented separately in the data audit).
