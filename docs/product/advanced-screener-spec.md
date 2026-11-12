# EGXANO — Advanced Screener Specification

**Date:** 2026-11-12 · **Status:** SPECIFICATION (v1 filters + saved rules exist; everything marked ⚒ new is proposed — not implemented)
**Target:** beat EGX Screener's builder (which gates sorting, lacks quarterly support, saved screens and exports) while staying honest about data.

---

## 1. Principles

1. **Period discipline:** every condition binds to an explicit period basis (`LATEST_ANNUAL | FY{n} | TTM | Q{n}-{year}`); incompatible bases never mix in one condition; the UI shows the basis chip on every column. (Engine basis logic already exists in `scanner.ts` runs / `rankings` basis handling.)
2. **Missing data is visible:** companies failing a filter *because data is absent* are distinguished from companies failing the test; `valueStatus` (OK / DATA_UNAVAILABLE / NOT_APPLICABLE) propagates to results. No silent drops.
3. **Deterministic first:** the screener runs the existing condition engine; the NL bar *compiles to these same conditions* — never a private AI path.
4. **Free to explore:** sorting, filtering and saved screens are free (inverts EGX Screener's Pro-sorting); depth (history, alerts on screens, exports volume, AI) monetizes.

## 2. Filter library (status vs data availability)

### 2a. Fundamental (existing codes in `MetricDefinition` registry — all class-B)

| Filter | Source metric(s) | Status | Notes |
|---|---|---|---|
| P/E, P/B | snapshot price + EPS/BV CalculatedMetric | ✔ v1 | negative-earnings → explicit N/A bucket |
| Net/operating/gross margin | GROSS_PROFIT, OPERATING_INCOME, NET_PROFIT ÷ REVENUE | ✔ v1 | |
| ROE / ROA | registry | ✔ v1 | equity ≤ 0 → NOT_APPLICABLE (already spec'd in calc) |
| Revenue growth (YoY, and YoY-QoQ view) | growthYoY | ✔ v1 | |
| Net/operating profit growth | growthYoY | ✔ v1 | |
| Debt/Equity, Debt/Assets | TOTAL_LIABILITIES, LONG_TERM_DEBT | ✔ v1 | |
| Current / Quick ratio | CURRENT_ASSETS/LIABILITIES, INVENTORY | ✔ v1 | |
| Interest coverage | OPERATING_INCOME ÷ FINANCE_COST | ✔ v1 | |
| P/S | ⚒ add `p_s` to registry + UI | B | trivial from existing values |
| EV/EBITDA | ⚒ needs EV = cap + debt − cash | B | cap from snapshot; label "cash & equivalents as cash proxy" |
| P/FCF | FREE_CASH_FLOW or OCF−capex | B | FCF coverage is uneven — coverage badge per company |
| Dividend yield | Dividend + price | B | TTM cash DPS; only PAID/ANNOUNCED rows |
| EPS | registry | ✔ | |
| ROIC | calc/advanced | ✔ | |
| Earnings quality (OCF ÷ Net Profit, 2y) | ⚒ new ratio | B | flagged low-coverage |
| Sector selector | Company.sector | ✔ v1 | |

### 2b. Technical (require `PriceBar` sufficiency — the engine already refuses insufficient data)

| Filter | Status | Guard |
|---|---|---|
| RSI(14) range / thresholds | ⚒ | ≥ 20 bars |
| Price vs SMA20/50/200, EMA20/50 (above/below, % distance) | ⚒ | N bars per MA |
| MACD line vs signal / histogram sign | ⚒ | 35 bars |
| Bollinger %B position | ⚒ | 25 bars |
| Stochastic K/D | ⚒ | 20 bars |
| ATR% (volatility band) | ⚒ | 20 bars |
| 52W high/low distance + range position | ⚒ | ≥ 180 bars; else DATA_UNAVAILABLE shown |
| OBV slope (20d) | ⚒ | 40 bars |
| Volume vs 60d average (RVOL) | ⚒ | 60 bars; flag ≥2× |
| Golden/Death cross recent (K days) | ⚒ | 210 bars |
| Breakout / pullback (N-day high + volume confirm) | ⚒ | composite, defined in quant doc |

### 2c. Market activity

Daily % change, turnover, RVOL bands, market cap bucket, free float ⚒ (needs shares × price — available), listing status, EGX category (MAIN/PRIME/NILE) ✔, index membership ✖ (no licensed index constituents — excluded, stated openly).

## 3. Condition builder (⚒ v2 UI)

- **Groups:** condition | AND-group | OR-group (nesting depth ≤ 2), mapped 1:1 onto a JSON `conditions` tree (extends the existing `ScannerRule.conditions` schema — backward compatible).
- **Operators:** `>, <, >=, <=, ==, !=, between, crosses_above, crosses_below, pct_change_over` (crosses/pct require PriceBar; evaluated by the technical lib, not SQL).
- **Results table:** multi-sort (primary + secondary), column chooser, basis + coverage chips per column, sticky header, AR/EN metric labels (registry `labelAr` reused).
- **Saved screens:** existing `ScannerRule` persistence + ⚒ shareable permalink (`/screener?r=<id>` → read-only copy, private rules never leak), ⚒ CSV export (500-row cap for free, unlimited premium), ⚒ "run history" reusing `ScannerRun`.
- **Result explainability:** every row can expand "why matched" (condition-by-condition evaluated values with period keys).

## 4. Natural-language screener (⚒, Arabic-first)

Pipeline (deterministic → AI only for parse):

```
"شركات أرباحها بتنمو بأكتر من 20%، ومضاعف الربحية أقل من متوسط القطاع، والسهم فوق EMA50"
  → parse (LLM, temperature 0, schema-constrained, cached by normalized text)
      → { conditions: [net_profit_growth_yoy > 20], [p_e < sector_median(p_e)], [close > ema50] }
  → VALIDATE: every condition maps to a library filter; unknown terms → listed as "فهمت / لم أفهم" chips
  → USER EDITS: rendered as the same builder UI (nothing hidden)
  → run through the standard engine; report which phrase produced which condition
```

Rules: parse results are **suggestions**; execution only on user confirm; sector-relative comparisons use stored sector medians (`scores.ts`); the LLM never computes — it labels. Quota: parsing costs 0 units for logged-in users (cache-heavy, cheap model), abuse-limited by IP.

## 5. Discovery radars (⚒; each with fixed, published criteria + risk note)

| Radar | Criteria (transparent, stated on page) | Data |
|---|---|---|
| 52W breakout | close within 5% of 250d high AND RVOL ≥ 1.5× | PriceBar |
| 52W deep value zone | within 10% of 250d low AND F-Score ≥ 5 (optional combo) | PriceBar + Piotroski |
| Unusual volume | RVOL ≥ 2× vs 60d avg | PriceBar |
| Improving profitability | net margin ↑ 2 consecutive annuals AND revenue positive | CalculatedMetric |
| Deteriorating health | D/E ↑ 30%+ YoY OR current ratio < 1 with debt ↑ | CalculatedMetric |
| Strong cash generation | OCF/Revenue ≥ 15% AND FCF positive latest FY | FinancialValue |
| Dividend changes | DPS change vs prior year (paid rows only) | Dividend |
| Valuation outliers | P/E or P/B ± 2σ from sector median | scores.ts |

Every radar page carries: methodology box, coverage % ("N of 276 companies have enough data for this radar"), and the standing disclaimer that radar membership is not a recommendation.

## 6. Invariants & guardrails

- No mixing of consolidated/standalone (statement-basis selector carried into screener).
- No quarterly-annual comparisons inside one condition; QoQ needs ≥2 same-type quarters.
- Delayed-price labels everywhere price enters (15-min delay disclosed).
- `ignoreBuildErrors` stays but screener ships with typed condition schema + unit tests (vitest, mirrors `__tests__/` patterns).
- Empty/insufficient states are first-class UI (per Phase 17), never blank tables.

## 7. Build order

1. Registry additions (P/S, EV/EBITDA, P/FCF, earnings quality) + tests.
2. Technical conditions engine wiring (reuse indicator lib; sufficiency guards).
3. Builder UI v2 (groups, operators, multi-sort, coverage chips).
4. Saved-screen permalinks + CSV export.
5. NL bar (parse-cache → editable conditions).
6. Radars v1 (52W + RVOL first — cheapest, highest demand evidence).
