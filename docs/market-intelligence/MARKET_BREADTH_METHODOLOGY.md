# Market Breadth & Regime Methodology — EGXANO

> Engine: `src/lib/market/intelligence/compute.ts` (`mi@1`).
> Data: scanner snapshot (15-min delayed) + PriceBar volume baselines +
> stored daily intelligence rows + the daily enrichment job (`cron/market-enrich`).

## 1. Universe & counters

Universe = active companies matched in the scanner snapshot (`priced`).
Thresholds: advancing `changePct > +0.01`, declining `< −0.01`, else
unchanged. A/D ratio = advancing/declining (null when nothing declined).

## 2. Traded value (never called "net flow")

`tradedValueEgp = Σ price × volume` over movers with session volume —
published ONLY when ≥50% of priced movers carry volume
(`tradedValueCoverage`); otherwise withheld with a limitation. Every executed
trade has a buyer and a seller: the platform never presents turnover as
inflow/outflow.

## 3. Breadth depth

- **A/D line**: cumulative (advancers − decliners) across stored daily
  snapshots (`MarketIntelligenceDay`). Starts at deployment — no retroactive
  history is fabricated; the UI states this.
- **% above SMA20/50/200, new 52w highs/lows**: from the DAILY enrichment job
  only (runtime Yahoo 2y bars, in-memory; only aggregates stored). Before the
  first run these fields are null with an explicit limitation — the platform
  never approximates them from a 120-day window silently.

## 4. Regime classification (evidence-based, never index-only)

Inputs: cap-weighted market change (scanner `market_cap_basic`), A/D ratio,
% above SMA20/50, new highs vs lows, top-5 concentration.

| Condition | Regime |
|---|---|
| top5 ≥ 55% of traded value AND A/D ratio < 1 | `narrow_leadership` |
| market ≥ +1% AND ratio ≥ 2 | `strong_uptrend` |
| market ≥ +0.2% AND ratio ≥ 1.2 (or %aboveSMA50 ≥ 55) | `strong_uptrend` else `weak_uptrend` |
| market ≤ −1% AND ratio ≤ 0.5 | `strong_downtrend` |
| market ≤ −0.2% AND ratio ≤ 0.85 | `weak_downtrend` |
| otherwise | `sideways` |

Downgrades (breadth gate): `strong_uptrend` with %aboveSMA20 < 60 →
`weak_uptrend`; `strong_downtrend` with %aboveSMA20 > 40 → `weak_downtrend`.
Missing A/D ratio → classified from market change alone with an explicit
"weaker evidence" note. The regime object always carries its evidence strings
(actual numbers) and `changedFrom` (previous stored regime).

## 5. Market Pulse (0-100, explainable)

Five weighted dimensions, each with a reason string carrying the actual
figures: trend 30 (cap-weighted change, ±7.5/%), breadth 30 (log-scaled A/D
ratio up to 18 + %aboveSMA20 up to 12), new highs vs lows 15 (share of
highs), turnover concentration 10 (lower is healthier, reference top5=30%),
participation 15 (traded-value delta vs previous stored session; neutral
midpoint while history accrues). Bands: ≥70 قوي · 50–69 متوازن · 35–49 متوتر ·
<35 ضعيف. The score measures current market CONDITION — it is not a forecast.

## 6. Concentration

Top-5 / top-10 share of traded value + Herfindahl (Σ share² × 10,000).
Published under the same 50% coverage gate. Interpretation note is generated
with the actual figures.

## 7. Sector rotation (activity migration language)

Per sector: equal-weighted day change, cap-weighted day change (scanner caps,
`price × sharesOutstanding` fallback), adv/dec, turnover share of total
traded value, share delta vs the stored day 5 sessions back, median relative
volume. `gaining` = share delta > +1.5pp; `losing` < −1.5pp. Terminology is
"turnover-share migration / activity rotation" — never capital inflow.
Deltas require ≥6 stored daily snapshots; the UI shows the accrual note until
then.

## 8. Anomalies & radars (deterministic screens)

Relative volume = session volume / 20-session PriceBar baseline. Order of
checks (most specific first): quiet name (<5,000 sh/day baseline) with ≥3× →
`activity_after_quiet`; ≥2× with |Δ| ≤ 0.5% → `volume_without_price`; ≥2×
with a move → `volume_spike`; |Δ| ≥ 3% on ≤0.6× → `price_without_volume`.
Radars: `volume_backed_advance` (≥1.5× AND ≥ +3%), `volume_backed_decline`
(≥1.5× AND ≤ −3%). Every entry carries its explanation; they are
investigation leads, not signals.
