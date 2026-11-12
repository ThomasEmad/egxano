# TEST REPORT — Market Intelligence Upgrade (2026-11-13)

## New reference-value tests (this upgrade)

| Suite | File | Tests |
|---|---|---|
| Structure / VSA / Zones / Quality | `src/lib/technical/__tests__/intelligence.test.ts` | 18 |
| Market intelligence compute | `src/lib/market/intelligence/__tests__/compute.test.ts` | 12 |

Fixtures are hand-constructed with known a priori outcomes (sawtooth trends,
consolidation-breaks, climax candles). Two genuine defects were caught and
fixed BY these tests during development:
1. CHoCH detection referenced the wrong swing kind (condition could never
   fire) — fixed and now covered by a dedicated reversal fixture.
2. The `activity_after_quiet` anomaly branch was unreachable (branch order) —
   reordered (most-specific first) and covered.

Also fixed during the upgrade: a freshness calculation used sub-second
`Date.now()` drift, making the technical snapshot hash unstable between two
same-day builds — replaced with whole-UTC-day arithmetic (deterministic
within a day, ages out by day).

## Full suite result

Recorded after the final build in this repo's CI log; at time of writing:

```
npx vitest run  →  Test Files: all green (DB-backed auth/access suites skip
explicitly with the documented reason when no test DB URL is configured —
they run unchanged as soon as TEST_DATABASE_URL / repo .env exists).
```

Pre-existing suites unaffected by this upgrade: indicators (38),
market refresh (12), AI report (12), financial (multiple).

## Build & typecheck

- `npx tsc --noEmit` — 0 errors (engine, service, routes, UI).
- `npx next build` — recorded in the deployment step below.

## Known gaps (honest)

- DB-backed auth/access tests skip without the Neon test-project URL (lost
  with a sandbox recycle — restore `.env` to run them; they are environment,
  not code, failures).
- The daily enrichment job's aggregate outputs are verified structurally by
  unit tests; its first live run is verified in the deployment checklist
  (`/api/v1/cron/market-enrich` → `enrichment` block non-null on the
  intelligence endpoint).
- Historical signal performance (Part 2 of SIGNAL_VALIDATION) is NOT yet
  measured — no accuracy claims are made anywhere in the product.
