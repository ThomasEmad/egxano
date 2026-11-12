# EGXANO — Quantitative Research Methodology

**Date:** 2026-11-12 · **Status:** methodology charter + P0 implementation notes. Deterministic code computes; AI only narrates. Nothing publishes performance claims until independently reproducible (Phase 8/15).

---

## 1. Governance rules (non-negotiable)

1. **Deterministic-only math.** Every score, ratio, and signal is pure TypeScript over stored `FinancialValue`/`CalculatedMetric`/`PriceBar` rows with a `formulaVersion` string (pattern: `piotroski@1`, `altman@1`). The same inputs must always produce the same outputs.
2. **Disclosed inputs.** Every score renders its input table (metric, raw value, period key, source report) next to the result. No black-box numbers — this is the deliberate counter-position to every competitor's opaque badge.
3. **Status discipline.** Missing/insufficient inputs → `DATA_UNAVAILABLE` with a reason, never zero, never a guessed value. Scores with incomplete inputs are shown as partial with the completed fraction (e.g. "6 of 9 criteria evaluated").
4. **Sector applicability.** Models declare `appliesTo` sectors; banks/insurance get financial-sector treatment (no standard Altman Z — documented), real estate flagged for asset-heavy caveats.
5. **No performance claims.** Backtest statistics require the §5 framework + out-of-sample validation + a review sign-off before any public display. Until then the product shows *no* hit-rates — an explicit non-feature versus competitors' fabricated numbers.
6. **Versioned restatements respected:** score history recomputes against `isRestatement`-aware value sets; a score's inputs snapshot the exact `reportId`s used.

## 2. Piotroski F-Score (implemented in this batch — `piotroski@1`)

Nine binary criteria computed on two consecutive **annual** consolidated periods (as-reported EGP, normalized units):

| # | Criterion | Inputs (registry codes) | Edge handling |
|---|---|---|---|
| 1 | ROA > 0 | NET_PROFIT, TOTAL_ASSETS (prior-year avg assets when both periods present; period-end otherwise, disclosed) | equity/assets ≤ 0 → unevaluable |
| 2 | OCF > 0 | OPERATING_CASH_FLOW | |
| 3 | ΔROA > 0 | as #1 across years | |
| 4 | OCF > Net Profit (accruals check) | OCF, NET_PROFIT | |
| 5 | ΔLeverage < 0 | LONG_TERM_DEBT ÷ TOTAL_ASSETS | falls back to TOTAL_LIABILITIES when LTD missing — fallback is labeled on the criterion |
| 6 | ΔCurrent ratio > 0 | CURRENT_ASSETS ÷ CURRENT_LIABILITIES | |
| 7 | No new shares (ΔShares ≤ 0) | SHARES_OUTSTANDING | dilution < 1% treated as flat, labeled |
| 8 | ΔGross margin > 0 | GROSS_PROFIT ÷ REVENUE | |
| 9 | ΔAsset turnover > 0 | REVENUE ÷ TOTAL_ASSETS | |

UI contract: score X/9 + criterion-by-criterion pass/fail with the **actual figures and period labels** — the exact disclosure EGX Screener lacks (bare "X/9" badge). Requires both periods annual + consolidated; otherwise the card shows "needs two consecutive annual periods" with coverage status.

## 3. Planned model suite (spec'd, not implemented — each gets its own disclosure page)

| Model | Inputs | Sector notes | Disclosure requirements |
|---|---|---|---|
| Altman Z (original/private-firm variants) | Working capital, retained earnings, EBIT, sales, market cap, total liabilities | NOT for banks/insurers (declare on page) | weights, applicability, limitation text |
| Earnings quality (2y) | OCF ÷ NP, DSO/DIO trends, accrual ratio | — | input table + "not a fraud detector" language |
| Financial deterioration flags | D/E slope, current-ratio trend, margin trend, OCF sign flips | — | rule list versioned (`deterioration@1`) — reuses `FinancialEvent` engine |
| Sector-relative valuation bands | P/E, P/B vs sector median + IQR | banks P/B-heavy; real estate P/NAV narrative | median window + company count disclosed |
| Graham number | BVPS × EPS × 22.5 | excludes negatives; "one input, no growth assumption" stated | formula + inputs shown |
| EPV | normalized EBIT × (1/RF-adjusted multiple), maintenance capex proxy | only where D&A/capex fields present | normalization method explicit |
| DCF (editable assumptions) | FCF base, g, WACC, years | no auto-growth invention: defaults from disclosed historical CAGR with cap; every input editable + sensitivity table | assumptions table + "hypothetical" labeling |
| DDM | DPS history, required return | only dividend payers with ≥3 paid years | payout sustainability note |

**Universal model footer:** inputs · assumptions · limitations · sensitivity · data coverage % · as-of date. Hypothetical values (user-edited) render visually distinct.

## 4. Signal taxonomy (future, spec-level)

Trend (SMA/EMA alignment + slope), momentum (RSI/MACD regime), volume (RVOL bands), 52W position, volatility regime (ATR percentile). Each signal: definition formula, data-sufficiency threshold, and **no** directional advice — signals are *conditions*, combined only in user-owned screens/alerts. Signals never carry entry/stop/target — that is ZBorsa's product; EGXANO's contract is evidence, not trading instruction.

## 5. Backtesting framework (P2 — build only after screener v2; publish only after review)

- **Data:** `PriceBar` daily OHLCV; universe membership as-of each date (listingStatus history via MarketPrice existence + listingStatus timeline — current limitation: survivorship handling is bounded by when data collection started; the report must state the collection start).
- **No look-ahead:** signals computed on data available at decision timestamp; execution at next bar open; costs: fixed bps + slippage parameter (disclosed).
- **Corporate actions:** raw quoted prices (deliberate); dividend-adjustment option must subtract `Dividend` rows with ex-dates; splits currently absent from data → **stated limitation**, splits handled when EGX corporate-action source lands.
- **Metrics:** CAGR, max drawdown, win rate, profit factor, sample size, turnover, benchmark = equal-weight active universe (NOT EGX30 — index history not licensed; stated).
- **Integrity:** every backtest run persisted (params, universe hash, code version `backtest@n`); deterministic replay required; out-of-sample holdout mandatory before any claim; results reviewed by a human before display.

## 6. Testing standard for quant code (Phase 17)

Every quant module ships with: pure-function unit tests (edge cases: zero/negative denominators, missing periods, restated values, single-period companies), a golden-file test against a small fixture dataset with hand-computed expected outputs, and the formula version bump rule (change output → bump version → invalidate caches).
