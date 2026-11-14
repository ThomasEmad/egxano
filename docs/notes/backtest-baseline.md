# Backtest frozen CURRENT technical engine (tech-signals@4)

**Run**: 2026-11-14T19:57:55.161Z · commit f5e7277 · engine frozen at `.cache/engine-baseline/` · data cached under `.cache/bt/`
**Raw results**: `.cache/bt/baseline-results.json` (every number below is generated from it — no hand transcription)

## 1. Mission and method

This baseline measures the CURRENT production signal engine — a verbatim frozen copy of `src/lib/technical` (including `trade-plan.ts`, `indicators.ts`) plus `src/lib/market/corporate-actions.ts` and `egx-hours.ts` — under a reproducible, no-lookahead backtest harness. At every session t from warmup end to last-1, the engine is called on `bars[0..t]` ONLY via `computeCloseSignal(rows: CloseRow[])` (the exact input shape the production close engine consumes: `{ ts, close, volume }`), and the emitted signal/score/trade-plan is recorded. The full-snapshot engine entry (`computeStanceFromSnapshot`) needs the DB-backed TechnicalSnapshot pipeline, which is unreachable in this sandbox (Neon DB down) — disclosed as an engine-context limitation, not a deviation.

**Pipeline per ticker** (mirrors production read path `src/app/api/v1/companies/[id]/technical/route.ts` → `live-bars.ts` Yahoo 1d candles → engine):
1. Yahoo chart API 1y daily candles (`*.CA`), cached to `.cache/bt/<T>.json`, never re-fetched. Rate-limit note: Yahoo 429s every browser-style User-Agent from this sandbox; requests succeed with NO User-Agent header (verified empirically; documented deviation from production's UA).
2. Validation: dedupe dates, OHLC sanity (high ≥ max(o,c), low ≤ min(o,c), all > 0), weekday sanity (EGX sessions Sun–Thu; Fri/Sat UTC dates = violations), calendar-gap check, ≥ 150 sessions.
3. Corporate-action adjustment: engine rows use Yahoo's **adjclose** (split + cash-dividend adjusted) — the closest available equivalent of production's DB-ledger `adjustPrevClose` ex-date engine, which cannot run without the Neon DB. The frozen pure math (`adjustPrevClose`/`perShareRatio`) is still exercised: for every Yahoo split event the frozen function must reproduce its documented formula, and the implied adjclose factor must agree with the split ratio (results in §4).
4. Replay with no lookahead; walk-forward 60/20/20 chronological split with **no parameter tuning** — the test window is recorded so a future upgraded engine can be evaluated on the same untouched window.

## 2. Data coverage

- Universe: 36 candidates (12 per bucket in seed order from `src/lib/market/tiers.ts` + MAIN names from the production tier enumeration), **29 retained** after validation (≥ 10 per bucket where data allowed): EGX30, EGX30, EGX30, EGX30, EGX30, EGX30, EGX30, EGX30, EGX30, EGX30, EGX70, EGX70, EGX70, EGX70, EGX70, EGX70, EGX70, EGX70, EGX70, EGX70, MAIN, MAIN, MAIN, MAIN, MAIN, MAIN, MAIN, MAIN, MAIN.
- Sessions per ticker: 244 — every retained series has ≥ 150 valid sessions (requirement met, no series skipped for depth).
- Date range: 2025-11-12 → 2026-11-12 (~1y daily).
- Skipped candidates (with reasons): AMOC (bucket already full (10 valid names)), ABUK (bucket already full (10 valid names)), AIHC (no cached Yahoo quote (404/no chart)), ATQA (bucket already full (10 valid names)), ACAP (no cached Yahoo quote (404/no chart)), ADRI (no cached Yahoo quote (404/no chart)), ALEX (no cached Yahoo quote (404/no chart)).

## 3. Execution model (every assumption disclosed, all configurable in `BacktestConfig`)

| assumption | default | note |
|---|---|---|
| fill timing | signal on close t → entry at t+1 close | conservative daily-data assumption; no intraday fills |
| EGX daily price limit | ±20% | t+1 close outside band vs t close → limit-locked, fill skipped, counted |
| transaction costs | 0.3% per side (0.6% round trip) | ASSUMPTION — see disclosure in §6 |
| plan validity | RR ≥ 1, stop < entry-mid < target | invalid/null plan → trade skipped, counted |
| trade management | stop: close ≤ plan.stop; target: close ≥ plan.targetLow; time-stop after 20 sessions | stop takes precedence on the same close |
| MAE / MFE | close-based excursions vs entry | engine input is close-only; intraday H/L not modeled |
| overlap | one position per ticker | buy signals while a position is open are skipped and counted |
| SELL signals | exit-evidence metric only | EGX retail shorting not realistically available; fwd 5-session return from t+1 close ("what a BUY-holder would have avoided"); NO short P&L modeled |
| WAIT/hold | no trade | — |

## 4. Data quality and frozen-engine cross-check

- All 29 series: OHLC sanity passed, zero Fri/Sat sessions, no dedupe losses. adjclose available for every series.
- Split events in window: 4. Frozen `adjustPrevClose` matched its documented formula on 4/4 (mismatches: none); Yahoo adjclose factor agreed with the split ratio on 1/4 events.
- Engine context: `computeCloseSignal` close-engine replay (see §6 limitation).

## 5. Results — CURRENT engine, honest numbers

### Overall (all windows pooled, 29 tickers)

Signals: buy 1546 (32.7/100 sessions), sell 1109, hold 2072, weak 0 over 4727 replay sessions. **Plan-validity rate (BUY)**: 100.0%. Skips: limit-locked 0, plan-invalid 0, no-forward-session 0, position-busy 1295. Turnover: 5.31 trades per company per 100 sessions. Trades/year (pooled): 12.7.

| metric | value |
|---|---|
| trades (completed/open) | 251 (243/8) |
| win rate | 54.3% |
| profit factor | 1.95 |
| expectancy (net %/trade) | 2.37% |
| median return (net %) | 2.55% |
| avg return (net %) | 2.37% |
| gross wins / losses (net %) | 1183.07 / -607.90 |
| max drawdown (equity curve) | -94.1% |
| Sharpe / Sortino (per-trade, annualized) | 0.89 / 1.37 |
| exits: target / stop / time-stop | 119 / 96 / 28 |
| false-positive proxy (stop-first among stop|target) | 44.7% |
| median sessions held / time-to-target | 6 / 7 |
| MAE P50 / P90 (close-based %) | -1.74% / 0.00% |
| MFE P50 / P90 (close-based %) | 4.24% / 14.23% |

### Walk-forward windows (chronological 60/20/20, no tuning)

#### train window (2026-03-09 → 2026-08-09, 2836 replay sessions/company)

Signals: buy 1245 (44.3/100 sessions), sell 346, hold 1222, weak 0; plan-validity rate 100.0%; trades/year 16.1

| metric | value |
|---|---|
| trades (completed/open) | 183 (183/0) |
| win rate | 63.9% |
| profit factor | 3.29 |
| expectancy (net %/trade) | 3.96% |
| median return (net %) | 4.35% |
| avg return (net %) | 3.96% |
| gross wins / losses (net %) | 1042.19 / -316.61 |
| max drawdown (equity curve) | -43.3% |
| Sharpe / Sortino (per-trade, annualized) | 2.00 / 4.86 |
| exits: target / stop / time-stop | 102 / 56 / 25 |
| false-positive proxy (stop-first among stop|target) | 35.4% |
| median sessions held / time-to-target | 7 / 7 |
| MAE P50 / P90 (close-based %) | -1.45% / 0.00% |
| MFE P50 / P90 (close-based %) | 5.97% / 15.12% |

SELL exit-evidence: 346/346 evaluable; mean fwd 3.23%, median 1.79%, "SELL correct" (negative fwd) 31.5%; all-sessions baseline mean 1.20%

#### validation window (2026-08-10 → 2026-09-23, 945 replay sessions/company)

Signals: buy 231 (24.9/100 sessions), sell 159, hold 538, weak 0; plan-validity rate 100.0%; trades/year 11.5

| metric | value |
|---|---|
| trades (completed/open) | 43 (43/0) |
| win rate | 30.2% |
| profit factor | 0.55 |
| expectancy (net %/trade) | -2.37% |
| median return (net %) | -3.13% |
| avg return (net %) | -2.37% |
| gross wins / losses (net %) | 125.54 / -227.61 |
| max drawdown (equity curve) | -88.8% |
| Sharpe / Sortino (per-trade, annualized) | -0.58 / -0.64 |
| exits: target / stop / time-stop | 14 / 26 / 3 |
| false-positive proxy (stop-first among stop|target) | 65.0% |
| median sessions held / time-to-target | 6 / 4 |
| MAE P50 / P90 (close-based %) | -2.59% / 0.00% |
| MFE P50 / P90 (close-based %) | 1.25% / 10.18% |

SELL exit-evidence: 159/159 evaluable; mean fwd -3.72%, median -1.66%, "SELL correct" (negative fwd) 64.8%; all-sessions baseline mean 1.20%

#### test window (2026-09-24 → 2026-11-11, 945 replay sessions/company)

Signals: buy 70 (7.1/100 sessions), sell 604, hold 312, weak 0; plan-validity rate 100.0%; trades/year 4.3

| metric | value |
|---|---|
| trades (completed/open) | 25 (17/8) |
| win rate | 11.8% |
| profit factor | 0.24 |
| expectancy (net %/trade) | -2.84% |
| median return (net %) | -4.88% |
| avg return (net %) | -2.84% |
| gross wins / losses (net %) | 15.33 / -63.68 |
| max drawdown (equity curve) | -47.8% |
| Sharpe / Sortino (per-trade, annualized) | -1.24 / -1.25 |
| exits: target / stop / time-stop | 3 / 14 / 0 |
| false-positive proxy (stop-first among stop|target) | 82.4% |
| median sessions held / time-to-target | 3 / 3 |
| MAE P50 / P90 (close-based %) | -4.28% / 0.00% |
| MFE P50 / P90 (close-based %) | 0.00% / 5.13% |

SELL exit-evidence: 580/604 evaluable; mean fwd 0.33%, median 0.63%, "SELL correct" (negative fwd) 47.8%; all-sessions baseline mean 1.20%

### Segments (pooled trades, all windows)

### By market tier

| segment | trades | win rate | profit factor | expectancy (net %) | median (net %) |
|---|---:|---:|---:|---:|---:|
| EGX30 | 72 | 52.8% | 1.70 | 1.55% | 0.96% |
| EGX70 | 94 | 54.3% | 1.85 | 2.44% | 3.66% |
| MAIN | 77 | 55.8% | 2.30 | 3.04% | 3.19% |

### By engine score band

| segment | trades | win rate | profit factor | expectancy (net %) | median (net %) |
|---|---:|---:|---:|---:|---:|
| <70 | 156 | 52.6% | 1.90 | 2.15% | 2.16% |
| 70-79 | 86 | 58.1% | 2.05 | 2.82% | 2.72% |
| >=80 | 1 | 0.0% | 0.00 | -3.25% | -3.25% |

### By liquidity tercile (mean ADV EGP)

| segment | trades | win rate | profit factor | expectancy (net %) | median (net %) |
|---|---:|---:|---:|---:|---:|
| T1 | 82 | 61.0% | 2.86 | 4.10% | 5.37% |
| T2 | 78 | 43.6% | 1.07 | 0.24% | -0.60% |
| T3 | 83 | 57.8% | 2.34 | 2.65% | 2.06% |

### By sector

| segment | trades | win rate | profit factor | expectancy (net %) | median (net %) |
|---|---:|---:|---:|---:|---:|
| Banks | 17 | 47.1% | 1.56 | 1.06% | -0.60% |
| Basic Materials | 12 | 50.0% | 1.52 | 1.66% | 0.61% |
| Building Materials | 9 | 77.8% | 8.37 | 7.92% | 7.78% |
| Construction | 19 | 57.9% | 2.95 | 4.11% | 5.36% |
| Financial Services | 26 | 61.5% | 2.81 | 3.53% | 2.97% |
| Food | 41 | 43.9% | 0.86 | -0.62% | -0.60% |
| Healthcare | 52 | 57.7% | 3.05 | 3.75% | 5.02% |
| Industrial | 9 | 44.4% | 0.99 | -0.04% | -0.60% |
| Real Estate | 30 | 53.3% | 1.80 | 1.82% | 1.30% |
| Telecom | 19 | 52.6% | 1.68 | 1.65% | 0.93% |
| Textiles | 9 | 66.7% | 3.68 | 4.56% | 4.26% |

### Per-ticker

| ticker | tier | sector | sessions | trades | win rate | PF | expectancy % | median % |
|---|---|---|---:|---:|---:|---:|---:|---:|
| AALR | MAIN | Construction | 244 | 10 | 60.0% | 3.56 | 5.31% | 6.56% |
| ACAMD | MAIN | Real Estate | 244 | 8 | 50.0% | 0.95 | -0.10% | -0.38% |
| ACGC | MAIN | Textiles | 244 | 9 | 66.7% | 3.68 | 4.56% | 4.26% |
| ADCI | MAIN | Healthcare | 244 | 8 | 75.0% | 6.03 | 6.23% | 7.43% |
| ADPC | MAIN | Food | 244 | 9 | 55.6% | 1.33 | 1.01% | 3.64% |
| AFDI | MAIN | Financial Services | 244 | 9 | 66.7% | 3.60 | 5.41% | 8.24% |
| AFMC | MAIN | Food | 244 | 7 | 42.9% | 1.87 | 2.60% | -0.60% |
| ALUM | MAIN | Basic Materials | 244 | 12 | 50.0% | 1.52 | 1.66% | 0.61% |
| AMER | EGX70 | Real Estate | 244 | 8 | 37.5% | 1.35 | 1.22% | -1.87% |
| AMES | MAIN | Healthcare | 244 | 5 | 20.0% | 0.58 | -0.99% | -0.60% |
| BTFH | EGX30 | Financial Services | 244 | 5 | 40.0% | 0.33 | -2.12% | -3.19% |
| CCAP | EGX30 | Financial Services | 244 | 12 | 66.7% | 4.32 | 4.47% | 6.61% |
| COMI | EGX30 | Banks | 244 | 7 | 42.9% | 0.88 | -0.27% | -0.60% |
| EAST | EGX30 | Food | 244 | 6 | 33.3% | 0.61 | -0.98% | -1.92% |
| ENGC | EGX70 | Construction | 244 | 9 | 55.6% | 2.29 | 2.77% | 4.44% |
| ETEL | EGX30 | Telecom | 244 | 10 | 80.0% | 5.74 | 5.26% | 6.56% |
| FWRY | EGX30 | Telecom | 244 | 9 | 22.2% | 0.39 | -2.38% | -4.37% |
| GBCO | EGX30 | Industrial | 244 | 9 | 44.4% | 0.99 | -0.04% | -0.60% |
| HDBK | EGX70 | Banks | 244 | 10 | 50.0% | 2.20 | 1.99% | 0.29% |
| MPCI | EGX70 | Healthcare | 244 | 7 | 85.7% | 6.57 | 6.65% | 8.77% |
| MPCO | EGX70 | Food | 244 | 10 | 50.0% | 2.35 | 3.18% | 3.52% |
| NIPH | EGX70 | Healthcare | 244 | 11 | 54.5% | 3.47 | 5.14% | 3.98% |
| ORAS | EGX30 | Construction | 244 | 0 | — | 0.00 | — | — |
| ORHD | EGX30 | Real Estate | 244 | 8 | 75.0% | 4.52 | 5.35% | 7.36% |
| PHAR | EGX70 | Healthcare | 244 | 7 | 57.1% | 2.78 | 3.17% | 2.55% |
| POUL | EGX70 | Food | 244 | 9 | 33.3% | 0.19 | -8.74% | -3.32% |
| PRCL | EGX70 | Building Materials | 244 | 9 | 77.8% | 8.37 | 7.92% | 7.78% |
| SIPC | EGX70 | Healthcare | 244 | 14 | 50.0% | 1.83 | 1.77% | 1.13% |
| TMGH | EGX30 | Real Estate | 244 | 6 | 50.0% | 1.25 | 0.47% | -1.09% |

## 6. Assumptions and limitations (verbatim disclosures)

1. **SURVIVORSHIP BIAS**: SURVIVORSHIP BIAS — UNIVERSE LIMITATION: the backtest universe consists of currently LISTED companies only (per the market-tier seed lists and the production company registry). Delisted companies' history is unavailable in this sandbox, so companies that were delisted, suspended or absorbed during the backtest window are absent from the universe. Every reported result therefore carries an upward survivorship bias and must NOT be read as a market-representative expectation.
2. Engine context: The full-snapshot engine entry (computeStanceFromSnapshot) needs the DB-backed TechnicalSnapshot pipeline (Neon unreachable). The baseline replays the close-based engine entry (computeCloseSignal) — the same signal family production exposes, with the input shape it expects.
3. Corporate actions: Production adjusts ex-date previous closes from the FoudaLens ledger in the DB. The DB is unreachable, so the baseline uses Yahoo's adjclose (split + cash-dividend adjusted) — the closest available equivalent — and cross-checks the frozen corporate-actions pure math (adjustPrevClose/perShareRatio) against every Yahoo split event.
4. Costs: 0.30%/side is an ASSUMPTION (brokerage + fees + spread allowance). EGX retail brokerage is commonly quoted around 0.10-0.19% but primary sources were unreachable from this sandbox; the figure is deliberately conservative and fully configurable via BacktestConfig.costPerSidePct.
5. Price limit: The ±20% band is an ASSUMPTION (EGX main-market daily price limit); no tier-specific band differentiation is modeled.
6. Sharpe/Sortino: Sharpe/Sortino annualize per-trade net returns by sqrt(trades/year); trades/year = completed trades in the window / (window replay sessions / 248). Pooled across tickers.
7. No annualized-return claims beyond what daily data supports; no confidence scores; raw numbers only. PF is reported as null when a segment has no losing trades (not Infinity).
8. Yahoo fetch required NO User-Agent header from this sandbox (browser-style UA → persistent 429). Data vendor identical to production (Yahoo chart API) but fetched 2026-11-14.
