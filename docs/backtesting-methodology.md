# Backtesting Methodology — EGXANO engine validation harness

Location: `src/lib/backtesting/` (+ runner `scripts/backtest/run-baseline.ts`, A/B comparison `scripts/backtest/compare-engines.ts`)
Frozen artifacts: `.cache/engine-baseline/` (verbatim @4 engine), `.cache/bt/` (cached market data + result JSONs), `docs/notes/backtest-baseline.md` (@4), `backtest-baseline-v2.md` (@5), `backtest-comparison.md` (A/B).

---

## 1. Design goals

1. **Reproducibility** — identical inputs ⇒ identical outputs; every number in every report is generated from a result JSON, never hand-transcribed.
2. **No lookahead** — the engine sees exactly what it would have seen at decision time.
3. **Identical A/B conditions** — old and new engines share data, universe, execution assumptions and window splits.
4. **Honest acceptance** — the harness can *disprove* an upgrade; it cannot be coaxed into approving one.

## 2. Pipeline (per ticker)

1. **Data**: Yahoo chart API 1y daily candles (`*.CA` symbols), cached to `.cache/bt/<T>.json`, never re-fetched mid-campaign. Documented deviation: Yahoo 429s every browser-style UA from this sandbox; requests succeed with no UA header.
2. **Validation** (`data-quality.ts`): date dedupe, OHLC sanity (high ≥ max(o,c), low ≤ min(o,c), all > 0), weekday sanity (EGX Sun–Thu; Fri/Sat UTC dates = violations), calendar-gap check, ≥ 150 sessions required.
3. **Corporate actions**: engine rows use Yahoo **adjclose** (split + cash-dividend adjusted) — the closest available equivalent of production's DB-ledger `adjustPrevClose` ex-date engine (Neon unreachable in the sandbox). The frozen pure math is still exercised: for every Yahoo split event, `adjustPrevClose` must reproduce its documented formula, and the implied adjclose factor must agree with the split ratio (result: 4/4 formula match; 1/4 Yahoo-factor agreement — the mismatches are disclosed, not corrected).
4. **Universe**: 12 candidates per bucket in seed order from `src/lib/market/tiers.ts` + MAIN names → 29 retained after validation (EGX30/EGX70/MAIN), liquidity terciles by mean ADV.

## 3. No-lookahead replay

At every session t from warmup end to last−1, the engine is invoked on `bars[0..t]` **only** — the slice passed to `computeCloseSignal` ends at t, so nothing after t can influence the record (`replay.ts`). The engine entry is the close+volume shape production consumes. Signal at t ⇒ execution attempted at t+1 close (next-session assumption; a strategy needing closing confirmation never fills at a price unavailable before the close).

## 4. Execution model (every assumption a named, documented constant)

| assumption | value | rationale |
|---|---|---|
| fill timing | t+1 close | conservative daily-data fills; no intraday modeling |
| EGX daily price limit | ±20% | t+1 close outside the band vs t close → limit-locked, fill skipped, counted |
| transaction costs | 0.3% per side (0.6% round trip) | ASSUMPTION, disclosed as such |
| plan tradability | RR ≥ 1.5, stop < entry-mid < target | invalid/null plan → trade skipped, counted |
| BUY management | stop: close ≤ plan.stop; target: close ≥ plan.targetLow; time-stop after 20 sessions | stop takes precedence on the same close |
| MAE/MFE | close-based excursions vs entry | engine input is close-only; intraday H/L not modeled |
| overlap | one position per ticker | busy signals skipped and counted |
| SELL signals | exit-evidence only (5-session forward return from t+1 close) | no short P&L modeled — EGX retail shorting is not realistically available |
| WAIT/hold | no trade | — |

## 5. Walk-forward protocol

- Chronological **60/20/20 split** (train / validation / test) per ticker — **never shuffled**; window dates are recorded and pinned in the result JSON.
- **No parameter tuning anywhere**: both engines ran with their production constants. The test window stayed untouched until both engine evaluations were complete.
- Comparisons use identical companies, dates, execution assumptions, data sources and cost assumptions (the runner is engine-injectable for exactly this reason).

## 6. Metrics computed

Win rate, profit factor, expectancy, average/median return, gross wins/losses, max drawdown (equity curve), Sharpe, Sortino (per-trade, annualized by trades/year — convention disclosed), turnover, false-positive rate (fraction of resolved trades that hit stop first), signal frequency per 100 sessions, plan-validity rate, time-to-target, sessions held, MAE/MFE percentiles. SELL paths report mean/median forward return and a "SELL correct" rate against the all-sessions baseline.

## 7. Segment performance

Pooled trades are segmented by strategy-relevant axes: tier, sector, liquidity tercile, score band, and (per window) by direction — reported in each result JSON and rendered into the notes docs. Any enhancement that only works in one segment must be disclosed as such rather than claimed universally.

## 8. Survivorship bias

The universe is drawn from today's active seed tickers (EGX30/EGX70/MAIN membership as of 2026-11). Historical index-membership series are not available in the project, so **delisted/suspended names cannot be included** — the survivorship limitation is quantified and disclosed here rather than silently ignored. In this window (≈1 year) the bias is bounded but real: worse historical performers are systematically under-represented.

## 9. Acceptance rules (applied to the @5 upgrade)

- The upgrade may not ship on signal count or board aesthetics.
- Out-of-sample (test-window) results gate any improvement claim. The @5 run produced too few completed test-window trades to evaluate → **no out-of-sample improvement is claimed**; the train/validation direction-of-change (PF 3.29→4.74 / 0.55→0.91; false-positive 35.4%→30.8%) and the pooled quality shift (PF 1.95→3.63, expectancy 2.37%→4.75%) are reported as in-sample evidence only, and the frozen @4 record remains the only fully out-of-sample-verified baseline.
- Fabricating or polishing any of the above numbers is a release blocker — the comparison doc is regenerated by script from the JSONs on every run.
