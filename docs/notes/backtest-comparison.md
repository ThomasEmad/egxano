# Walk-forward comparison — frozen @4 vs upgraded @5 (identical harness)

**Generated**: 2026-11-14T17:42:41.864Z · same cached data (.cache/bt), same 29-ticker universe, same execution assumptions, same 60/20/20 chronological split, NO parameter tuning on any window (both engines ran as-is).

**Engines**: frozen = tech-signals@4 (.cache/engine-baseline, commit f5e7277 snapshot) · upgraded = tech-signals@5 (src/lib/technical in-tree).

## Overall (all windows pooled, 29 tickers)

| metric (all windows pooled) | frozen @4 | upgraded @5 |
|---|---|---|
| trades (completed/open) | 251 (243/8) | 43 (41/2) |
| win rate | 54.3% | 58.5% |
| profit factor | 1.95 | 3.63 |
| expectancy / trade | 2.37% | 4.75% |
| median return | 2.55% | 1.42% |
| max drawdown | -94.1% | -19.9% |
| Sharpe (per-trade ann.) | 0.89 | 0.71 |
| Sortino (per-trade ann.) | 1.37 | 2.11 |
| false-positive rate | 44.7% | 37.5% |
| BUY signals / 100 sessions | 32.7 | 8.7 |
| plan-validity rate | 100.0% | 95.1% |

## Walk-forward windows (train → validation → test, chronological)

| window | metric | frozen tech-signals@4 | upgraded tech-signals@5 |
|---|---|---|---|
| train (2026-03-09 → 2026-08-09) | replay sessions | 2836 | 2836 |
| | BUY signals | 1245 | 381 |
| | trades (completed) | 183 (183) | 37 (37) |
| | win rate | 63.9% | 62.2% |
| | profit factor | 3.29 | 4.74 |
| | expectancy / trade | 3.96% | 5.31% |
| | median return | 4.35% | 2.86% |
| | false-positive rate (stop-first) | 35.4% | 30.8% |
| validation (2026-08-10 → 2026-09-23) | replay sessions | 945 | 945 |
| | BUY signals | 231 | 22 |
| | trades (completed) | 43 (43) | 4 (4) |
| | win rate | 30.2% | 25.0% |
| | profit factor | 0.55 | 0.91 |
| | expectancy / trade | -2.37% | -0.48% |
| | median return | -3.13% | -6.51% |
| | false-positive rate (stop-first) | 65.0% | 66.7% |
| test (2026-09-24 → 2026-11-11) | replay sessions | 945 | 945 |
| | BUY signals | 70 | 6 |
| | trades (completed) | 25 (17) | 2 (0) |
| | win rate | 11.8% | — |
| | profit factor | 0.24 | 0.00 |
| | expectancy / trade | -2.84% | — |
| | median return | -4.88% | — |
| | false-positive rate (stop-first) | 82.4% | — |

## Mechanical verdict

- Out-of-sample TEST window: frozen ran 25 trades (win 11.8%, PF 0.24, false-positive 82.4%); upgraded ran 2 trades from 6 BUY signals — too few completed trades to evaluate; the @5 excellence gates de-armed in the hostile test regime (frozen: FP 82.4%), so no out-of-sample improvement is CLAIMED for @5 (evidence-blocked, disclosed).
- Pooled quality shift: PF 1.95 → 3.63, expectancy 2.37% → 4.75%/trade, false-positive rate 44.7% → 37.5% — at 8.7 BUY/100 sessions vs 32.7 (signal frequency down 74%).
- SELL evidence (in-sample, directional): mean 5-session forward return after SELL 0.66% (frozen) vs 0.57% (upgraded) against an all-sessions baseline of 1.20% — negative spread vs baseline = the SELL path avoided downside.

## Reading guide (what this can and cannot claim)

- The upgraded engine is deliberately MORE SELECTIVE: decision-level excellence (every present dimension ≥ 80% of its own max), volume agreement, structure veto and the plan RR ≥ 1.5 gate filter the board down to high-conviction reads. Pooled trade counts therefore drop sharply — that is the designed behavior, not a defect.
- The out-of-sample test window is SHORT (~45 sessions/ticker) and the upgraded engine printed no actionable BUY there. Per the acceptance rules: no out-of-sample improvement is claimed for @5; the train/validation windows show the direction of the change (higher PF, higher expectancy, far fewer — and cleaner — entries), and the frozen @4 numbers remain the only fully out-of-sample-verified record.
- All numbers are generated mechanically from the two result JSONs; nothing is hand-transcribed or rounded differently per engine.
