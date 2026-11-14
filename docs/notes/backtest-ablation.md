# Backtest ablation — @5 + ADX / Divergence / Candlesticks (single-window study)

**Run date:** 2026-11-14 · **Harness:** frozen no-lookahead replay, 29 tickers, 244 sessions (2025-11-12 → 2026-11-12), walk-forward 60/20/20, identical cached data + execution model across all variants.
**Baseline reproducibility:** frozen and v2 re-runs are byte-identical to the committed result JSONs (verified by diff, excluding `generatedAt`) before any ablation edits, and re-verified after the variant plumbing landed.

## Results (OVERALL pooled + windows)

| variant | trades | win% | PF | expectancy% | maxDD% | buy signals |
|---|---|---|---|---|---|---|
| frozen (@4) | 251 | 54.3 | 1.95 | 2.37 | −94.1 | 1546 |
| v2 (@5) | 43 | 58.5 | 3.63 | 4.75 | −19.9 | 409 |
| v2+adx | 48 | 57.8 | 3.46 | 4.43 | −19.9 | 416 |
| v2+div | 45 | 59.5 | **4.02** | **5.12** | −19.9 | 412 |
| v2+candles | 45 | 58.1 | 3.58 | 4.58 | −19.9 | 413 |
| v2+all | 49 | 58.7 | 3.83 | 4.82 | −19.9 | 416 |

Per-window (train / validation / test trades · PF · expectancy):

- frozen: 183·3.29·+3.96 / 43·0.55·−2.37 / 17·0.24·−2.84
- v2: 37·4.74·+5.31 / 4·0.91·−0.48 / 0 (no trades)
- v2+adx: 40·4.32·+4.95 / 5·1.06·**+0.26** / 0
- v2+div: 38·5.34·+5.71 / 4·0.91·−0.48 / 0
- v2+candles: 39·4.61·+5.10 / 4·0.91·−0.48 / 0
- v2+all: 42·4.91·+5.33 / 4·0.91·−0.48 / 0

## Verdicts (honest, per module)

1. **Divergence — the only clear pooled improver.** PF +0.39 and expectancy +0.37pp over v2 at nearly identical trade count. Keep as an available variant; do NOT flip the default engine yet — its gain sits in the train window and the v2 out-of-sample cells are statistically empty (see caveat).
2. **ADX — dilutes.** More trades (43→48) with worse PF (3.63→3.46) and expectancy (4.75→4.43). Its validation cell is the only positive one (+0.26% on 5 trades) — a sample of 5 proves nothing. Verdict: drop from default consideration; keep runnable for future windows.
3. **Candlesticks — neutral** (PF 3.58, exp 4.58 vs 3.63/4.75). Costs nothing, adds nothing measurable in this window. Pending more data.
4. **v2+all — dragged by ADX.** Combining everything (PF 3.83, exp 4.82) underperforms v2+div because the ADX dilution contaminates the bundle. Module quality is not additive.

## Caveat (must stay attached to any reading of this table)

- ONE window of 244 sessions, one market regime mix. All v2-family validation cells contain 4–5 trades and test cells contain 0 — **out-of-sample reads are statistically empty**. Nothing here is an out-of-sample claim; pooled numbers are dominated by the train regime.
- v2's zero test-window trades are the honesty gates refusing to trade a hostile tape — behavior, not performance.
- Re-measure each variant as real future sessions accumulate (the lifecycle layer makes rolling re-evaluation mechanical). Revisit verdicts after ≥60 new out-of-sample sessions.
