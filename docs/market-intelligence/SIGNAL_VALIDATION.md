# Signal Validation & Data Limitations — EGXANO

## Part 1 — What is validated today

Every new deterministic module ships with reference-value tests on
hand-constructed fixtures where the expected outcome is known a priori
(`src/lib/technical/__tests__/intelligence.test.ts`,
`src/lib/market/intelligence/__tests__/compute.test.ts`):

- Structure: pivot detection (wing rules), same-kind collapsing, HH/HL labels
  + uptrend classification, bullish BOS with close confirmation, bullish CHoCH
  on a downtrend reversal with volume support, invalidation by close-back,
  end-to-end bilingual texts, short-series refusal, weekly resample OHLCV.
- VSA: selling climax (wide spread + 3.2× + close high in range + guardrail
  language in both languages), no-demand (up close on 0.6×), short-series
  refusal.
- Zones: consolidation-break demand zone with quality >30 and invalidation
  text; zone dropped after an invalidating close.
- Quality score: 9 dimensions, weights sum 100, bands, context raises the
  context dimension, gate-veto caps at 60, conflict flagging.
- Market intelligence: breadth counters, traded-value coverage gate,
  concentration, rotation shares + 5-session deltas, anomaly taxonomy
  (including branch-order regression), A/D line accumulation, regime table
  (incl. downgrades and weaker-evidence fallback), pulse explainability.

Full-suite status is recorded in `TEST_REPORT.md`.

## Part 2 — Historical performance validation (status: NOT YET CLAIMED)

The mission requires out-of-sample / walk-forward measurement of directional
accuracy per setup. **Status: infrastructure exists (deterministic event
records in the technical snapshot), but no historical hit-rate is advertised
anywhere.** Before any performance claim is published, the platform must:

1. Persist every BOS/CHoCH/VSA event with its date, level, and outcome window
   (point-in-time, no look-ahead).
2. Evaluate forward returns under explicit outcome definitions (MFE/MAE,
   target-vs-stop ordering, transaction costs, suspension handling).
3. Report by regime, sector, and liquidity class with sample sizes.
4. Use walk-forward splits; never optimize on the evaluation window.

Until that report exists, EGXANO makes no accuracy claim of any kind —
including any figure above 90%.

## Part 3 — Data limitations (binding)

- **All quotes are delayed ≥15 minutes** (`delayed_streaming_900`); nothing
  is presented as real-time.
- **No order book / depth / spread / tick tape** — no licensed source; the
  liquidity quality narrative is turnover-proxy based and says so.
- **No index history series** — EGX30/70/100 levels exist only per snapshot;
  index-history analysis is not offered; the platform never synthesizes an
  index curve. (A tracked-universe cap-weighted change is computed from real
  constituent prices and labeled as such.)
- **No turnover history before 2026-11-13** — accrues daily from the
  `MarketPrice.valueTraded` column; never backfilled.
- **A/D line, rotation deltas, participation pulse** — accrue from stored
  daily snapshots; the UI shows accrual notes until ≥6 sessions exist.
- **SMA200 / true 52-week breadth** — only from the daily enrichment job
  (runtime Yahoo bars, aggregates-only storage); null with a limitation until
  it runs.
- **PriceBar retention is 120 days** (storage policy) — long-window
  per-company context is restored at runtime from Yahoo (2y) in the company
  technical bundle; market-wide flags come from the enrichment job.
- **12 companies have no price data at all** (see MARKET_COVERAGE) — they
  render as unavailable, never as zeros.
- **Turnover language**: "share of traded value" / "activity rotation" only —
  never net inflow/outflow; no accumulation/distribution assertions from
  price+volume alone.
