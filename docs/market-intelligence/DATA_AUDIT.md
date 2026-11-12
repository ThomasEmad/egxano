# DATA AUDIT — EGXANO Market Data Sources

> Generated 2026-11-13 (Cairo). Read alongside `MARKET_COVERAGE.md` and
> `CURRENT_ANALYSIS_AUDIT.md`. This document records **what data EGXANO
> actually has, where it comes from, what it legally permits, and where it
> must not be trusted**. It is a factual inventory, not a plan.

---

## 1. Source inventory

| # | Source | Transport | Data provided | History depth | Update cadence | Delay | Used by |
|---|--------|-----------|---------------|---------------|----------------|-------|---------|
| S1 | TradingView scanner (`scanner.tradingview.com/egypt/scan`) | Public unauthenticated POST (same endpoint as TV's own public screener) | Price, day change %, session volume, `update_mode` — plus fields proven available but not yet requested: `market_cap_basic`, `total_shares_outstanding`, `price_earnings_ttm`, `dividend_yield_recent`, `sector`, `industry` | Snapshot only (now) | On refresh (cron/visitor kick/manual sync) | `delayed_streaming_900` = **15 minutes** — never "real-time" | `src/lib/market/refresh.ts` → `Setting.market_ticker_snapshot_v1` + `MarketPrice` rows |
| S2 | TradingView websocket history (`data.tradingview.com`) | Public socket, `unauthorized_user_token`, `EGX:<TICKER>`, `adjustment: splits`, 1D bars ×400 | Daily OHLCV **with volume** | 400 sessions per symbol | On demand (script) | Same TV delay semantics | `scripts/tv-price-history-harvest.mjs` → `PriceBar` |
| S3 | Yahoo Finance chart API (`query1.finance.yahoo.com/v8/finance/chart/<T>.CA`) | Public REST | Daily OHLCV with volume; dividend events (`events=div`) | 2 years (runtime) / since 2017 (dividends, imported) | On demand, 15-min memory TTL | ~15 min | `src/lib/technical/live-bars.ts` (runtime, memory-only); dividends importer |
| S4 | FoudaLens EGX disclosures proxy | REST (requires Referer/Origin) | Official EGX corporate-action disclosures: upcoming cash dividends (announcement/eligibility/ex/distribution dates, DPS), ~6-month window + forward | Disclosures window | Irregular (EGX filings) | Same-day | Dividends import scripts (UPCOMING surface) |
| S5 | AskBorsa financial tables | REST scrape (documented in `docs/SOURCES-PLAYBOOK.md`) | Annual/quarterly financial statements | Multi-year | Quarterly (filings) | Days | Financial pipeline |
| S6 | Company PDFs (EGX filings) | Manual/upload | Statements, events | Full | On filing | — | Upload pipeline |

## 2. Licensing & redistribution reality

- **S1/S2 (TradingView):** used through the same public, keyless endpoints the
  TradingView website itself serves to anonymous visitors. Permitted for
  **internal computation and display inside EGXANO with attribution of delay**;
  NOT licensed for raw-feed redistribution or resale. All TV-derived surfaces
  must carry the 15-minute delay badge (`delayMinutes: 15` already surfaced on
  `/api/v1/market/treemap`).
- **S3 (Yahoo):** public chart endpoint; same constraints. Volume/OHLCV is
  used for deterministic computation, never resold.
- **S4 (FoudaLens):** mirrors **official EGX disclosures** — the underlying
  facts are public regulatory filings; EGXANO derives and cites the source.
- **Nothing in EGXANO may claim to be real-time.** All quote surfaces are
  delayed by ≥15 minutes and labeled as such.

## 3. What is stored, where (persisted state)

| Store | Content | Retention | Notes |
|---|---|---|---|
| `PriceBar` | Daily OHLCV, `volume Float?` | **120 days** (storage policy 2026-11-12; older bars archived to `reports/*.csv.gz`) | 244 companies, 17,851 sessions, **100% volume coverage** in retained window |
| `MarketPrice` | One row per company per refreshed day: `price` only (no volume column yet) | 400 days | 256 companies; daily series began 2026-11-09 → currently ~4 refresh days; volume/value-traded columns **planned additive migration** |
| `Setting.market_ticker_snapshot_v1` | Full latest scanner snapshot JSON (prices, changePct, volume, movers, indices) | Latest only (overwritten atomically) | Source of truth for freshness (`asOf`) |
| `CalculatedMetric` | Financial metrics incl. `dividend_yield@3` (with NEEDS_REVIEW gate) | Versioned history | Not price data |
| `Dividend` | PAID history (Yahoo) + ANNOUNCED/UPCOMING (FoudaLens) | Full | 1,160 rows / 138 companies |

## 4. What does NOT exist (must never be invented)

1. **Turnover / value-traded history** — no column anywhere; only computable
   per snapshot pull (`price × volume`) and forward from the migration.
2. **Bid/ask, order book, depth, trade-level tape** — no licensed source; all
   order-flow-style claims are forbidden (platform rule).
3. **Index history series** (EGX30/70/100 levels over time) — only the latest
   snapshot levels; the platform must not synthesize an "EGX30 history".
4. **Buyer-initiated vs seller-initiated classification** — no tick data.
5. **Intraday bars** — daily only.

## 5. Known reliability limitations

- **S1 volume coverage is partial** (~83% of rows carry volume in sampled
  snapshot; illiquid names may omit it) → any aggregate over volume MUST
  disclose coverage (pattern already used by `/api/v1/market/breadth` with
  `tradedValueCoverage`).
- **S2 harvest gaps:** 21 of 276 tickers have no TV history (delisted /
  renamed / suspended); 12 companies have no price data at all
  (see `MARKET_COVERAGE.md`).
- **S3 ticker mapping:** Yahoo uses `TICKER.CA`; a handful of EGX tickers
  differ (handled by ISIN-first mapping in importers, runtime fallback by
  ticker).
- **Scanner synthetic bars in the technical bundle** (see
  `CURRENT_ANALYSIS_AUDIT.md` §W1) previously collapsed all volume indicators
  — fixed in this release by volume-aware assembly (§ fixes).
- **MarketPrice daily series is young** (started 2026-11-09) — breadth
  metrics that need long close-series must use `PriceBar` (120d) +
  on-demand Yahoo (2y) until the series matures.

## 6. Data-quality gates already in place

- `sanitizeBars()` — drops non-positive/OHLC-inconsistent bars, nulls invalid
  volume, refuses cross-type bodies.
- Scanner validation: `price > 0`, `|changePct| ≤ 50`, non-finite dropped.
- `dividend_yield@3` — implied yield > 30% → `NEEDS_REVIEW` (never displayed).
- Snapshot `parseSnapshot` — schema-validated untrusted JSON.
- Fiscal-year floors on events; source-period provenance on every metric.
