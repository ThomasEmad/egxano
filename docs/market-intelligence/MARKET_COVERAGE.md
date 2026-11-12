# MARKET COVERAGE — EGXANO (generated 2026-11-13)

> Machine-generated per-symbol report lives at `reports/market-coverage.json`
> (+ `.md`). This document summarizes it and states the analytical
> consequences. Regenerate with:
> `DATABASE_URL=… node scripts/coverage-report.mjs`

## Universe summary (production DB)

| Metric | Value |
|---|---|
| Companies in universe | 269 (all `LISTED`) |
| Companies with `PriceBar` daily OHLCV (120-day retention) | **244** |
| Retained candle sessions | 17,851 |
| Sessions with volume | 17,851 (**100%**) |
| Retained window start | 2026-07-16 |
| Companies with `MarketPrice` rows | 256 |
| `MarketPrice` rows | 2,844 (daily refresh series began 2026-11-09) |
| Newest market price | 2026-11-12 12:55 UTC (15-min delayed scanner) |
| Companies with **no price data at all** | **12** |

## Symbols with no price data (must never be shown with fake data)

```
AIHC AMPH CPC EFOOD MESF MNHD NAPR PHAE QNBA RMDT RPCO VODE
```

Handling rule (existing): these render as "no available price data" with an
explicit limitation, never as zeros.

## Coverage consequences for each analytical layer

| Layer | Feasible today? | Basis | Limitation to disclose |
|---|---|---|---|
| Trend SMA20/50 | ✅ | PriceBar 120d (73 sessions/company) | SMA50 needs ≥51 sessions — a minority of thin names below threshold get `null` + reason |
| Trend SMA200 / golden-death cross | ⚠️ partial | Retained window is ~73 sessions → SMA200 generally **unavailable** from PriceBar; available only via runtime Yahoo 2y merge in the company technical bundle | Market-wide SMA200 breadth is computed by the daily enrichment job (Yahoo, in-memory) — not from stored bars |
| 52-week high/low | ⚠️ partial | 120-day window underestimates true 52w | Company page: Yahoo runtime merge supplies true 52w; market-wide "new 52w highs" from the daily job uses the same merge |
| RSI/MACD/Stoch/Bollinger/ATR | ✅ | 35+ sessions gate (existing `MIN_OSCILLATOR_BARS`) | Sparse-series suppression already in place |
| OBV / relative volume | ✅ (fixed) | PriceBar volume 100% + snapshot volume | Scanner synthetic bars previously nulled the block — fixed (volume-aware assembly) |
| Turnover / value traded | ✅ forward-only | Snapshot `price × volume` per pull; persisted per day after the `MarketPrice.volume/valueTraded` migration | No history before 2026-11-13; concentration metrics disclose coverage |
| Market cap (tiles, cap-weighting) | ✅ | Scanner `market_cap_basic` / `price × sharesOutstanding` fallback | Missing shares → tile falls back to stored metric or is size-normalized |
| Advance/Decline, A/D line | ✅ (A/D line accrues) | Snapshot changePct signs per day; cumulative line stored per day | A/D line history starts at deployment; no retroactive claim |
| % above SMA20/50, new 52w highs/lows | ✅ via daily enrichment | Daily job computes flags from in-memory Yahoo 2y bars (storage policy respected — only flags stored) | Flags refresh daily, not intraday — labeled as such |
| Sector turnover share & rotation | ✅ forward-only | Aggregates over snapshot volume per sector; 5-day deltas from stored daily aggregates | Needs ≥5 accumulated days before deltas display — UI shows "accumulating" state |
| Market regime classification | ✅ | Breadth + proxy universe trend (cap-weighted from tracked closes, labeled proxy) + volatility | EGX30 has no stored history — the platform never claims index-history analysis; the proxy is explicitly "EGXANO tracked-universe index" |
| Volume Profile / VWAP | ⚠️ approximations only | Daily OHLCV → typical-price×volume distribution labeled **approximation**; session VWAP impossible without intraday | Always labeled "estimated from daily bars, not exchange data" |
| Wyckoff phase context | ✅ qualitative | Structure + VSA events over ≥60 sessions | Phase labels are hypotheses with confirmation/invalidation conditions, never verdicts |
| Intraday tape / order flow | ❌ | No licensed source | Documented as blocked; no feature ships on absent data |

## Refresh cadence reality

- Scanner snapshot: cron/visitor-kick/manual sync → typically every
  10–30 minutes during the Cairo session (Sun–Thu 10:00–14:30 local).
- Daily enrichment job (breadth flags, 52w, relVol baselines): once daily,
  chained to the existing audit cron (~06:00 UTC) + first-visitor kick.
- Financials/dividends: per filing/import runs (see DATA_AUDIT §1).
