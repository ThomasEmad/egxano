# Backtest UPGRADED engine + ablation evidence variant (v2+adx) (tech-signals@5+adx)

**Run**: 2026-11-14T19:58:43.030Z · commit f5e7277 · engine frozen at `.cache/engine-baseline/` · data cached under `.cache/bt/`
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

Signals: buy 416 (8.8/100 sessions), sell 1218, hold 3093, weak 0 over 4727 replay sessions. **Plan-validity rate (BUY)**: 95.0%. Skips: limit-locked 0, plan-invalid 21, no-forward-session 0, position-busy 347. Turnover: 1.02 trades per company per 100 sessions. Trades/year (pooled): 2.4.

| metric | value |
|---|---|
| trades (completed/open) | 48 (45/3) |
| win rate | 57.8% |
| profit factor | 3.46 |
| expectancy (net %/trade) | 4.43% |
| median return (net %) | 1.42% |
| avg return (net %) | 4.43% |
| gross wins / losses (net %) | 280.55 / -81.07 |
| max drawdown (equity curve) | -19.9% |
| Sharpe / Sortino (per-trade, annualized) | 0.71 / 2.10 |
| exits: target / stop / time-stop | 11 / 6 / 28 |
| false-positive proxy (stop-first among stop|target) | 35.3% |
| median sessions held / time-to-target | 20 / 10 |
| MAE P50 / P90 (close-based %) | -3.05% / 0.00% |
| MFE P50 / P90 (close-based %) | 7.13% / 21.09% |

### Walk-forward windows (chronological 60/20/20, no tuning)

#### train window (2026-03-09 → 2026-08-09, 2836 replay sessions/company)

Signals: buy 385 (13.7/100 sessions), sell 396, hold 2032, weak 0; plan-validity rate 94.8%; trades/year 3.5

| metric | value |
|---|---|
| trades (completed/open) | 40 (40/0) |
| win rate | 60.0% |
| profit factor | 4.32 |
| expectancy (net %/trade) | 4.95% |
| median return (net %) | 2.14% |
| avg return (net %) | 4.95% |
| gross wins / losses (net %) | 257.95 / -59.76 |
| max drawdown (equity curve) | -19.3% |
| Sharpe / Sortino (per-trade, annualized) | 1.00 / 3.32 |
| exits: target / stop / time-stop | 10 / 4 / 26 |
| false-positive proxy (stop-first among stop|target) | 28.6% |
| median sessions held / time-to-target | 20 / 11 |
| MAE P50 / P90 (close-based %) | -2.77% / 0.00% |
| MFE P50 / P90 (close-based %) | 7.14% / 21.74% |

SELL exit-evidence: 396/396 evaluable; mean fwd 3.08%, median 1.73%, "SELL correct" (negative fwd) 35.1%; all-sessions baseline mean 1.20%

#### validation window (2026-08-10 → 2026-09-23, 945 replay sessions/company)

Signals: buy 23 (2.5/100 sessions), sell 166, hold 739, weak 0; plan-validity rate 95.7%; trades/year 1.3

| metric | value |
|---|---|
| trades (completed/open) | 5 (5/0) |
| win rate | 40.0% |
| profit factor | 1.06 |
| expectancy (net %/trade) | 0.26% |
| median return (net %) | -4.99% |
| avg return (net %) | 0.26% |
| gross wins / losses (net %) | 22.60 / -21.31 |
| max drawdown (equity curve) | -19.9% |
| Sharpe / Sortino (per-trade, annualized) | 0.03 / 0.05 |
| exits: target / stop / time-stop | 1 / 2 / 2 |
| false-positive proxy (stop-first among stop|target) | 66.7% |
| median sessions held / time-to-target | 7 / 4 |
| MAE P50 / P90 (close-based %) | -4.39% / -0.12% |
| MFE P50 / P90 (close-based %) | 3.54% / 17.14% |

SELL exit-evidence: 166/166 evaluable; mean fwd -4.98%, median -2.40%, "SELL correct" (negative fwd) 68.7%; all-sessions baseline mean 1.20%

#### test window (2026-09-24 → 2026-11-11, 945 replay sessions/company)

Signals: buy 8 (0.8/100 sessions), sell 656, hold 322, weak 0; plan-validity rate 100.0%; trades/year 0.0

| metric | value |
|---|---|
| trades (completed/open) | 3 (0/3) |
| win rate | — |
| profit factor | 0.00 |
| expectancy (net %/trade) | — |
| median return (net %) | — |
| avg return (net %) | — |
| gross wins / losses (net %) | 0.00 / 0.00 |
| max drawdown (equity curve) | — |
| Sharpe / Sortino (per-trade, annualized) | — / — |
| exits: target / stop / time-stop | 0 / 0 / 0 |
| false-positive proxy (stop-first among stop|target) | — |
| median sessions held / time-to-target | — / — |
| MAE P50 / P90 (close-based %) | — / — |
| MFE P50 / P90 (close-based %) | — / — |

SELL exit-evidence: 620/656 evaluable; mean fwd 0.53%, median 0.99%, "SELL correct" (negative fwd) 46.3%; all-sessions baseline mean 1.20%

### Segments (pooled trades, all windows)

### By market tier

| segment | trades | win rate | profit factor | expectancy (net %) | median (net %) |
|---|---:|---:|---:|---:|---:|
| EGX30 | 21 | 42.9% | 1.29 | 0.76% | -1.42% |
| EGX70 | 12 | 83.3% | 11.62 | 6.66% | 7.43% |
| MAIN | 12 | 58.3% | 6.61 | 8.64% | 6.06% |

### By engine score band

| segment | trades | win rate | profit factor | expectancy (net %) | median (net %) |
|---|---:|---:|---:|---:|---:|
| <70 | 8 | 50.0% | 1.65 | 1.44% | 1.34% |
| 70-79 | 22 | 59.1% | 3.63 | 4.86% | 3.56% |
| >=80 | 15 | 60.0% | 4.58 | 5.40% | 1.42% |

### By liquidity tercile (mean ADV EGP)

| segment | trades | win rate | profit factor | expectancy (net %) | median (net %) |
|---|---:|---:|---:|---:|---:|
| T1 | 13 | 69.2% | 7.40 | 9.01% | 8.93% |
| T2 | 12 | 58.3% | 2.17 | 2.10% | 0.65% |
| T3 | 20 | 50.0% | 2.39 | 2.86% | 0.28% |

### By sector

| segment | trades | win rate | profit factor | expectancy (net %) | median (net %) |
|---|---:|---:|---:|---:|---:|
| Banks | 3 | 33.3% | 1.79 | 2.12% | -1.65% |
| Basic Materials | 4 | 50.0% | 5.61 | 8.85% | 9.02% |
| Construction | 4 | 75.0% | 4.64 | 7.32% | 10.71% |
| Financial Services | 4 | 50.0% | 2.48 | 2.81% | -0.25% |
| Food | 5 | 40.0% | 5.14 | 3.84% | -0.63% |
| Healthcare | 8 | 87.5% | 7.27 | 5.41% | 6.74% |
| Industrial | 3 | 33.3% | 0.49 | -2.16% | -4.37% |
| Real Estate | 6 | 50.0% | 4.09 | 4.93% | 1.34% |
| Telecom | 5 | 40.0% | 1.01 | 0.03% | -1.85% |
| Textiles | 3 | 100.0% | null | 10.51% | 8.93% |

### Per-ticker

| ticker | tier | sector | sessions | trades | win rate | PF | expectancy % | median % |
|---|---|---|---:|---:|---:|---:|---:|---:|
| AALR | MAIN | Construction | 244 | 1 | 0.0% | 0.00 | -8.04% | -8.04% |
| ACAMD | MAIN | Real Estate | 244 | 2 | 50.0% | 136.23 | 11.92% | 11.92% |
| ACGC | MAIN | Textiles | 244 | 3 | 100.0% | null | 10.51% | 8.93% |
| ADCI | MAIN | Healthcare | 244 | 0 | — | 0.00 | — | — |
| ADPC | MAIN | Food | 244 | 1 | 0.0% | 0.00 | -2.60% | -2.60% |
| AFDI | MAIN | Financial Services | 244 | 0 | — | 0.00 | — | — |
| AFMC | MAIN | Food | 244 | 1 | 100.0% | null | 23.53% | 23.53% |
| ALUM | MAIN | Basic Materials | 244 | 4 | 50.0% | 5.61 | 8.85% | 9.02% |
| AMER | EGX70 | Real Estate | 244 | 0 | — | 0.00 | — | — |
| AMES | MAIN | Healthcare | 244 | 0 | — | 0.00 | — | — |
| BTFH | EGX30 | Financial Services | 244 | 2 | 0.0% | 0.00 | -3.79% | -3.79% |
| CCAP | EGX30 | Financial Services | 244 | 2 | 100.0% | null | 9.42% | 9.42% |
| COMI | EGX30 | Banks | 244 | 3 | 33.3% | 1.79 | 2.12% | -1.65% |
| EAST | EGX30 | Food | 244 | 2 | 50.0% | 0.24 | -0.54% | -0.54% |
| ENGC | EGX70 | Construction | 244 | 3 | 100.0% | null | 12.44% | 14.13% |
| ETEL | EGX30 | Telecom | 244 | 2 | 50.0% | 0.75 | -0.96% | -0.96% |
| FWRY | EGX30 | Telecom | 244 | 3 | 33.3% | 1.25 | 0.68% | -1.85% |
| GBCO | EGX30 | Industrial | 244 | 3 | 33.3% | 0.49 | -2.16% | -4.37% |
| HDBK | EGX70 | Banks | 244 | 0 | — | 0.00 | — | — |
| MPCI | EGX70 | Healthcare | 244 | 1 | 100.0% | null | 8.41% | 8.41% |
| MPCO | EGX70 | Food | 244 | 0 | — | 0.00 | — | — |
| NIPH | EGX70 | Healthcare | 244 | 1 | 100.0% | null | 1.42% | 1.42% |
| ORAS | EGX30 | Construction | 244 | 0 | — | 0.00 | — | — |
| ORHD | EGX30 | Real Estate | 244 | 1 | 0.0% | 0.00 | -4.40% | -4.40% |
| PHAR | EGX70 | Healthcare | 244 | 4 | 100.0% | null | 8.19% | 8.98% |
| POUL | EGX70 | Food | 244 | 1 | 0.0% | 0.00 | -0.63% | -0.63% |
| PRCL | EGX70 | Building Materials | 244 | 0 | — | 0.00 | — | — |
| SIPC | EGX70 | Healthcare | 244 | 2 | 50.0% | 1.10 | 0.33% | 0.33% |
| TMGH | EGX30 | Real Estate | 244 | 3 | 66.7% | 3.03 | 3.37% | 2.86% |

## 6. Assumptions and limitations (verbatim disclosures)

1. **SURVIVORSHIP BIAS**: SURVIVORSHIP BIAS — UNIVERSE LIMITATION: the backtest universe consists of currently LISTED companies only (per the market-tier seed lists and the production company registry). Delisted companies' history is unavailable in this sandbox, so companies that were delisted, suspended or absorbed during the backtest window are absent from the universe. Every reported result therefore carries an upward survivorship bias and must NOT be read as a market-representative expectation.
2. Engine context: The full-snapshot engine entry (computeStanceFromSnapshot) needs the DB-backed TechnicalSnapshot pipeline (Neon unreachable). The baseline replays the close-based engine entry (computeCloseSignal) — the same signal family production exposes, with the input shape it expects.
3. Corporate actions: Production adjusts ex-date previous closes from the FoudaLens ledger in the DB. The DB is unreachable, so the baseline uses Yahoo's adjclose (split + cash-dividend adjusted) — the closest available equivalent — and cross-checks the frozen corporate-actions pure math (adjustPrevClose/perShareRatio) against every Yahoo split event.
4. Costs: 0.30%/side is an ASSUMPTION (brokerage + fees + spread allowance). EGX retail brokerage is commonly quoted around 0.10-0.19% but primary sources were unreachable from this sandbox; the figure is deliberately conservative and fully configurable via BacktestConfig.costPerSidePct.
5. Price limit: The ±20% band is an ASSUMPTION (EGX main-market daily price limit); no tier-specific band differentiation is modeled.
6. Sharpe/Sortino: Sharpe/Sortino annualize per-trade net returns by sqrt(trades/year); trades/year = completed trades in the window / (window replay sessions / 248). Pooled across tickers.
7. No annualized-return claims beyond what daily data supports; no confidence scores; raw numbers only. PF is reported as null when a segment has no losing trades (not Infinity).
8. Yahoo fetch required NO User-Agent header from this sandbox (browser-style UA → persistent 429). Data vendor identical to production (Yahoo chart API) but fetched 2026-11-14.
