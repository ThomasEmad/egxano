# Implementation Log — Market Intelligence Upgrade

## 2026-11-13 — P0 audit + P1 engine + P2 whole-market intelligence

### P0 — Audit (before implementation)
- `scripts/coverage-report.mjs` — symbol-by-symbol coverage from the
  production DB (269 companies; PriceBar 244/17,851 sessions/100% volume;
  MarketPrice 256/2,844 rows; 12 companies with no price data). Output:
  `reports/market-coverage.{json,md}`.
- `docs/market-intelligence/` — `DATA_AUDIT.md` (six sources with licensing
  reality), `MARKET_COVERAGE.md` (per-layer feasibility), and
  `CURRENT_ANALYSIS_AUDIT.md` identifying the five most serious weaknesses
  (W1 volume-block collapse, W2 no durable volume/turnover history, W3
  counters-only breadth, W4 no market-structure analysis, W5 no sector/market
  context in per-stock analysis).

### P1 — Professional analysis engine (deterministic, tested)
- `src/lib/technical/structure.ts` (`structure@1`) — documented rules R1–R9:
  fractal swings (wing=3, 1.5% noise floor), HH/HL/LH/LL labels, per-TF trend
  states, BOS/CHoCH (close-confirmed, volume context, retest, invalidation),
  short/medium/long timeframes incl. ISO-weekly resample. Point-in-time safe.
- `src/lib/technical/vsa.ts` (`vsa@1`) — six VSA event profiles with explicit
  candle evidence and the "consistent with / does not establish identity"
  language contract; volume-complete suffix reading.
- `src/lib/technical/zones.ts` (`zones@1`) — supply/demand zones from
  consolidation-before-volume-break + pivot clusters; quality-scored,
  self-invalidating, ≤6 zones.
- `src/lib/technical/quality.ts` (`quality@1`) — 9-dimension 0-100 score with
  gate veto (cap 60) and explicit conflict detection; UTC-day deterministic
  freshness so the snapshot hash is stable within a day.
- `src/lib/technical/analyze.ts` → `technical@2`: volume-aware assembly
  (FIXES W1 — volume indicators compute over the volume-complete suffix and
  disclose it; scanner synthetic bars carry real session volume
  post-migration), new sections structure/vsa/zones/context/quality.
- Context injection: `src/lib/market/intelligence/context.ts` builds the
  per-company market/sector section; wired into the technical API route and
  the AI report builder (prompt payload gains structure + context data).

### P2 — Whole-market intelligence
- Migration `20261113000000_market_intelligence` (additive):
  `MarketPrice.volume/valueTraded` + `MarketIntelligenceDay` (daily durable
  snapshot for A/D line, regime transitions, rotation deltas).
- `src/lib/market/intelligence/compute.ts` (`mi@1`) — breadth, traded value
  (coverage-gated), concentration (top5/top10/HHI), sector rotation with
  turnover-share deltas, anomaly taxonomy, A/D line, evidence-based regime
  classification with downgrades, explainable 0-100 pulse, opportunity/risk
  radars. `relVolByTicker` for per-company liquidity rank.
- `src/lib/market/intelligence/service.ts` — rebuild + validated read +
  chunked daily enrichment (SMA20/50/200 flags, true 52w highs/lows from
  runtime Yahoo bars; aggregates-only storage, respects the price-storage
  policy).
- `refresh.ts` — scanner columns extended (`market_cap_basic`,
  `total_shares_outstanding`), rows now carry volume + valueTraded,
  intelligence rebuild chained best-effort after every market refresh.
- Routes: `GET /api/v1/market/intelligence` (60s cache + CDN),
  `GET /api/v1/cron/market-enrich` (chunked, self-chaining via after(),
  CRON_SECRET).
- UI: `technical-tab.tsx` renders context strip, structure (3 TFs + events +
  key levels), zones, VSA, quality score; new `market-intelligence-panel.tsx`
  on the dashboard (regime + pulse + breadth + A/D sparkline + rotation
  matrix + anomalies + radars + "ماذا تغيّر منذ آخر زيارة؟" via localStorage).
- Tests: `intelligence.test.ts` (technical, 18 fixtures) +
  `compute.test.ts` (12) — all green; full suite reported in TEST_REPORT.md.

### Deliberately not built (data honesty)
No intraday tape, no order-book features, no index-history analysis, no
retroactive turnover/A-D history, no Wyckoff phase assertions, no scenario
probabilities. See DATA_LIMITATIONS section in SIGNAL_VALIDATION.md.
