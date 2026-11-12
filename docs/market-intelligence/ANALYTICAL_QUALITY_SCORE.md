# Analytical Quality Score — EGXANO

> `quality@1` — `src/lib/technical/quality.ts`. Measures ANALYTICAL
> COMPLETENESS and EVIDENTIAL QUALITY. It is never a probability of a
> successful trade and is never presented as predictive accuracy.

## Dimensions (weights fixed; sum = 100)

| # | Key | Weight | Full marks when |
|---|-----|-------:|---|
| 1 | `price_data_validity` | 15 | ≥120 sessions + last session ≤5 days old; sparse series ×0.6 |
| 2 | `market_structure` | 15 | ≥4 swings + medium/short/long trend states + events present |
| 3 | `volume_liquidity` | 15 | relVol + 20-session baseline computed over a real window |
| 4 | `multi_tf` | 10 | 3/3 timeframes classified (2 → 6, 1 → 3) |
| 5 | `price_action` | 10 | ATR available (6) + VSA events with evidence (+4) |
| 6 | `market_context` | 10 | intelligence context injected and complete (partial → 6) |
| 7 | `risk` | 10 | volatility (4) + S/R levels (3) + zone invalidations (3) |
| 8 | `traceability` | 10 | share of 6 sections carrying computed evidence |
| 9 | `critical_review` | 5 | conflicts detected & flagged (5); checks ran, none found (2) |

## Bands

≥90 **high** · 80–89 **good** · 65–79 **incomplete** · <65 **weak** ·
`blocked` when the data gate veto applies.

## Gate veto (hard cap)

When critical data validation fails the score is capped at **60** and
`gateVeto` explains which gate failed:
- last session > 30 days old (freshness), or
- fewer than 35 sessions retained (insufficient history).

A high-quality label can never be issued on unvalidated data regardless of
the arithmetic. Users see WHICH dimensions earned what, with per-dimension
reason strings carrying the actual figures (`title` tooltip + row text).

## Determinism

Freshness is measured in whole UTC days (`floor(now/86400000) −
floor(asOf/86400000)`) so two builds of the same data on the same day produce
the identical snapshot hash — the score may legitimately change from one DAY
to the next (analysis ages with its data), never within a day.

## Relation to signal performance

Predictive performance is measured separately (see `SIGNAL_VALIDATION.md`).
The quality score says nothing about whether a setup will work; it says how
complete, evidenced and validated the ANALYSIS is.
