# CURRENT ANALYSIS AUDIT — EGXANO Analytical Engine (pre-upgrade baseline)

> Audit date: 2026-11-13. Scope: everything the platform computes from prices
> and volume, and everything it presents as "analysis". Companion docs:
> `DATA_AUDIT.md`, `MARKET_COVERAGE.md`.

## What exists and is sound

- `src/lib/technical/indicators.ts` — 18 pure, deterministic indicators
  (SMA/EMA/RSI-Wilder/MACD/Bollinger/Stochastic/ATR/historical volatility/
  OBV/volume stats/fractal S-R pivots/trend alignment/50-200 cross age/perf),
  38 reference-value tests, explicit data gates that suppress rather than
  fabricate.
- `src/lib/technical/analyze.ts` — `buildTechnicalBundle`: 400-bar merge of
  PriceBar + scanner day-rows + runtime Yahoo bars; deterministic hash
  (`technical@1`) consumed by the technical route and the AI report builder.
- `src/lib/market/refresh.ts` + `snapshot.ts` — atomic snapshot writes,
  freshness TTLs, opportunistic kicks, cron chain; scanner validation gates.
- Breadth counts (advancers/decliners/unchanged) with traded-value coverage
  disclosure; finviz-style sector treemap (cap area, day-change color).
- Financial pipeline provenance (`formulaVersion` on every metric,
  `dividend_yield@3` NEEDS_REVIEW gate) — a model the price side should match.

## The five most serious weaknesses (ranked)

### W1 — The volume block collapses in production (CRITICAL, fixed in this release)
`buildTechnicalBundle` merges the freshest scanner day as a synthetic bar
(`O=H=L=C, volume: null`). `onBalanceVolume`/`volumeStats` required **every**
bar in the series to carry volume, so the presence of a single synthetic bar
nulled the entire `volume{}` section (OBV, OBV slope, 20-day volume MA,
relative volume) — exactly the block the liquidity analysis needs most.
**Fix:** volume-aware assembly — volume indicators now compute over the
longest volume-complete suffix window and disclose the window; synthetic
scanner bars inherit the snapshot's real session volume when present.

### W2 — No durable volume/turnover history (CRITICAL for liquidity intelligence)
`MarketPrice` stores price only; volume existed only inside the ephemeral
snapshot JSON. There is no value-traded column anywhere, so relative-volume
percentiles, turnover concentration, liquidity quality, and sector rotation
by activity share were impossible beyond the current pull. **Fix:** additive
migration (`MarketPrice.volume`, `MarketPrice.valueTraded`) + scanner columns
extended (`market_cap_basic`, `total_shares_outstanding`) + refresh writes
them; forward history accrues daily. Historical turnover remains unavailable
and is never backfilled synthetically.

### W3 — Breadth is three counters; no market condition model (CRITICAL for P2)
The platform could say "185↑ / 37↓" but had no A/D line, no %-above-SMA
breadth, no new-52w-highs/lows, no regime classification, no concentration or
leadership measurement, and "regime" appeared nowhere in `src/`. The mission's
core promise — "the user should immediately understand the market's condition"
— was structurally impossible. **Fix:** market-intelligence engine
(`src/lib/market/intelligence/`) — breadth engine (from PriceBar closes +
daily Yahoo enrichment), regime classification with evidence, concentration,
leadership, pulse score — all with explicit coverage disclosure.

### W4 — No market-structure analysis (CRITICAL for P1)
Price analysis stopped at indicator values + rule-based signal strings. No
swing-based trend structure (HH/HL/LH/LL), no BOS/CHoCH events, no
multi-timeframe consistency check, no supply/demand zones with test/quality
tracking, no VSA events, no scenario framework. The "analysis" named
indicators rather than interpreting market behavior. **Fix:**
`src/lib/technical/structure.ts` (documented swing rules → structure map →
BOS/CHoCH with close/volume/retest/invalidation), `zones.ts`
(consolidation-before-move + volume concentration, quality-scored, ≤6 zones),
`vsa.ts` (spread/volume/close-location events with the actual candle evidence
stated in text), `quality.ts` (explainable 0-100 analytical quality score with
the mission's 9 weighted dimensions + data-gate veto).

### W5 — Sector/market context absent from per-stock analysis (HIGH)
The technical bundle and the AI prompt contained zero sector or market
context — no sector relative strength, no sector rotation state, no market
regime, no peer activity comparison. A stock "breaking out" in a collapsing
sector read exactly like one in a leading sector. **Fix:** the technical
snapshot now carries a `context{}` section (sector day change + breadth,
sector relative strength vs universe, market regime + pulse, relative volume
rank) served from the intelligence snapshot, and the AI prompt payload gains
it as structured data (AI still may not invent numbers).

## Secondary findings (fixed or scheduled within this work)

- `dashboard/summary` and `market/breadth` computed advance/decline
  independently with different thresholds → unified on the intelligence
  snapshot.
- Index surfaces had no methodology separation note (price- vs cap- vs
  equal-weighted) → methodology labels added.
- Scanner payload fields proven available (`market_cap_basic`,
  `total_shares_outstanding`) but not requested → requested now; treemap caps
  become real scanner caps with `price × shares` fallback.
- Treemap/heat-map sector labels could occlude small tiles → label
  suppression below a minimum tile size (UI rule).

## Honest statement of what this upgrade does NOT add

- No intraday tape, order-book, or tick-level features (no licensed source).
- No "net inflow/outflow" claims — turnover-share migration language only.
- No institutional accumulation/distribution assertions from price+volume.
- No retroactive turnover/A-D history — those series start at deployment and
  the UI says so.
- No scenario probabilities — scenarios are conditional with explicit
  confirmation/invalidation levels.
