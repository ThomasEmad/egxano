# Liquidity & Volume Analysis Methodology — EGXANO

> Covers relative volume, turnover intelligence, liquidity quality, and the
> data limits that shape what liquidity claims the platform may make.

## 1. Volume data reality

| Store | Content | Window |
|---|---|---|
| TradingView scanner (per pull) | session share volume, `market_cap_basic` | latest only |
| `PriceBar.volume` | daily share volume (100% coverage in retained rows) | 120 days |
| `MarketPrice.volume / valueTraded` | daily volume + price×volume (EGP) | accrues from 2026-11-13 |
| Order book / bid-ask / tick tape | **does not exist in any licensed source** | — |

Consequences: liquidity quality scores are **historical-turnover proxies
only**; no depth/spread features are shipped or claimed; intraday relative
volume compares like-for-like session points only in future work if an
authorized intraday source appears.

## 2. Relative volume

`relVol = session volume / mean(volume of the prior 20 PriceBar sessions)`
(baselines exclude the latest stored session; ≥20 sessions required —
shorter histories return null rather than a thin-baseline ratio). A
market-relative liquidity rank (percentile among all movers carrying relVol)
is exposed per company through the context section (`relVolRankPct`).

Per-company technical bundles use the longest **volume-complete suffix**
(≥10 sessions) with the window length disclosed — synthetic scanner bars
without volume never null the block silently.

## 3. Turnover intelligence

Daily turnover per company = `price × volume` (stored in
`MarketPrice.valueTraded` from 2026-11-13 forward; never backfilled).
Aggregates (traded value, sector shares, top-5/top-10/HHI concentration)
carry the ≥50% coverage gate from the breadth methodology. Turnover-share
deltas are labeled "activity rotation / turnover-share migration".

## 4. Liquidity quality (current honest form)

Reported per company through disclosed components only: 20-session baseline
volume, relative volume percentile, value traded when volume exists, and a
flag for structurally quiet names (<5,000 shares/day). Where order-book data
would be required (spread, depth, slippage), the platform says "not
available from our sources" instead of scoring on proxies silently.

## 5. Unusual activity detector

See the breadth methodology §8 for the deterministic anomaly rules. Baseline
is rolling (20 sessions) so thin names are not flagged for absolute size —
anomaly thresholds are relative. Every anomaly states: what happened, how
unusual (×baseline), whether the price confirmed it, and the honest
boundaries (no insider/institution claims — ever).

## 6. Forbidden claims (enforced in copy and code)

- No "net inflow/outflow" (each trade has both sides).
- No accumulation/distribution assertions from price+volume alone.
- No order-book, depth, spread, or tape features without a licensed source.
- No real-time claims — all quotes are ≥15-minute delayed and labeled.
