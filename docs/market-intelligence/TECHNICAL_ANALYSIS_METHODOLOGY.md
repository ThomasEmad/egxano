# Technical Analysis Methodology — EGXANO

> Engine version: `technical@2` (structure@1 · vsa@1 · zones@1 · quality@1).
> Any rule change below MUST bump the corresponding module version (the
> snapshot hash — and therefore report cache identity — changes by design).

## 1. Data basis

Daily OHLCV only. Sources merged per session day, precedence: scanner day-row
(15-min delayed, freshest) > Yahoo daily bar > stored PriceBar. Bars failing
`sanitizeBars` (non-positive OHLC, high<low, close outside range, inconsistent
body) are dropped, never repaired. Synthetic scanner bars are close-only
(O=H=L=C); range-based indicators lose the day range for those sessions and
this is disclosed in `limitations`.

Sparse series (median session gap > 7 days) suppress the oscillator family
entirely — values would be misleading, so they return null with a reason.

## 2. Market structure (`structure.ts`, rules R1–R9)

Documented in the module header and enforced by tests. Summary:

- **Swings**: fractal pivots, `wing=3` (short TF wing=2, weekly wing=4);
  same-kind consecutive pivots collapse to the extreme; swings differing
  <1.5% from the adjacent opposite pivot are noise.
- **Labels**: HH/LH/HL/LL on consecutive same-kind swings.
- **Trend per timeframe**: uptrend = last two swings give HH **and** HL;
  downtrend = LH **and** LL; otherwise range. <2 highs+2 lows → null.
- **BOS**: a session CLOSE beyond the most recent swing level in the trend
  direction (close-only — wicks never break structure).
- **CHoCH**: a close beyond the most recent opposing swing against the trend
  (uptrend: close below the last higher-low; downtrend: close above the last
  lower-high).
- **Volume context**: break-bar volume / 20-session baseline recorded; ≥1.2×
  = "supported". Never a requirement — a low-volume break is reported as
  cautionary, not hidden.
- **Retest**: within 10 sessions, within 0.75% of the level; held = closes
  stay on the post-break side. **Invalidation**: a later close back through
  the level beyond a 0.5% buffer marks the event invalidated.
- **Multi-timeframe**: short (last 60 sessions), medium (daily series), long
  (ISO-weekly resample, ≥12 weeks required). Consistency = aligned bullish /
  aligned bearish / mixed.

Point-in-time discipline: trend state for each event is computed from swings
strictly before the current pivot — no look-ahead.

## 3. Volume Spread Analysis (`vsa.ts`)

Fixed definitions (module header): baseline = mean volume of the prior 60
sessions (≥30 required); spreadPct; wide ≥1.6× / narrow ≤0.6× the 20-session
median spread; closeLoc = (close−low)/(high−low); phases from the close 10
sessions back. Events: selling/buying climax (wide + ≥2.5× + close location
against the move), stopping volume (≥2× + closeLoc ≥0.4 in a decline),
no demand (up close on ≤0.7×), no supply (narrow ≤0.7× in a decline),
effort-without-result (≥2× with a body ≤0.35× median spread). Climax events
record follow-through (did the next session recover the range?).

**Language contract**: every event text states the actual numbers and frames
the interpretation as "consistent with…", explicitly refusing to identify
who was buying/selling. VSA reads the volume-complete suffix of the series
and discloses the window.

## 4. Supply & demand zones (`zones.ts`)

Two formation rules: (F1) consolidation (5–15 sessions within a 4% band)
followed within 5 sessions by a close ≥1.5% beyond the band on ≥1.5× baseline
volume — the zone is the consolidation range; (F2) pivot clusters (≥2 fractal
pivots within 1.5%) — the zone is ±0.6% around the cluster. Zones are merged
(>1.5% overlap), invalidated by a close beyond the band ±0.5% buffer, scored
(base 40 + tests×12 capped 36 + reaction×4 capped 20 + volume (ratio−1)×15
capped 15 − age decay 2/30 days, floor −20), and at most 3 demand + 3 supply
nearest the price survive.

## 5. Momentum & trend indicators

Existing deterministic library (SMA/EMA/RSI-Wilder/MACD/Bollinger/Stochastic/
ATR/historical volatility/OBV) is unchanged; volume indicators now compute
over the longest volume-complete suffix (≥10 sessions) with the window
disclosed (`volume.volumeWindow`). Interpretation layer: RSI is reported with
trend context; correlated indicators are NOT counted as independent
confirmations (the quality score's critical-review dimension flags
trend/momentum and structure/trend conflicts instead of stacking them).

## 6. What is deliberately absent

Fibonacci anchors are not auto-drawn (false precision without a documented
swing-selection contract); volume profile/VWAP approximations from daily bars
are not shipped yet — when they ship they will be labeled approximations;
Wyckoff phase labels are not asserted — the structure + VSA sections provide
the evidence base without claiming a phase.
