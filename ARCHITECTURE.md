# Architecture — egxano

> TL;DR (بالعربية): المشروع بيتبنى على 4 طبقات بقاعدة اعتمادية واحدة — **الاعتماديات بتبص لجوه بس**:
> `domain` (نقي، صفر I/O) ← `application` (استخدامات الأعمال) ← `infrastructure` (محولات Prisma/Yahoo/TradingView) ← `presentation` (routes/components).
> الحارس الآلي `scripts/check-architecture.mts` (ومُدمج في vitest) بيمنع أي مخالفة جديدة — القديم مسجل في
> `scripts/architecture-baseline.json` (ratchet: ينقص، ما يزيدش).

## Layers

| Layer | Path | May import | Must NEVER import | Content |
| --- | --- | --- | --- | --- |
| **domain** | `src/domain/**` | `@/domain/**`, node builtins, npm pkgs, `import type` from anywhere (compile-time contract, erased at runtime) | `@/lib/**`, `@/application/**`, `@/infrastructure/**`, `@/app/**`, `@/components/**` — **no I/O of any kind** | Pure business rules: candle quality, EGX session/hours, corporate-action math, indicators, technical snapshot, signals engine |
| **application** | `src/application/**` | `@/domain/**`, `@/infrastructure/**` (adapters), `@/lib/**` shared utils | `@/app/**`, `@/components/**` | Use-cases/orchestration: unified candle reader, daily candle refresh, board/review builders |
| **infrastructure** | `src/infrastructure/**` | `@/domain/**`, `@/lib/**` shared utils | `@/app/**`, `@/components/**` | Adapters: Prisma client, Yahoo/TradingView fetchers, DB-backed stores (price overrides, corporate-action ledger, symbol resolution) |
| **presentation** | `src/app/**`, `src/components/**` | everything | — | Next.js routes/pages/components. Routes stay thin: validate → call application/lib service → shape response |

`src/lib/**` remains as the legacy home + true cross-cutting utilities (`server-cache`, `secure-compare`,
`admin-auth`, `client/*`…). It migrates slice by slice; the boundary checker ratchets its violations.

## Dependency rules (enforced)

- **R1 `domain-purity`**: `src/domain/**` imports nothing layered outward. This is the guarantee that every
  business rule is testable without a DB or network, and that the SAME rules run in ingestion, analysis and tests.
- **R2 `no-upward-deps`**: nothing outside `src/app/**`/`src/components/**`/`src/hooks/**` may import
  presentation code. Two deliberate carve-outs, both compile-time/verification concerns, never runtime deps:
  - `import type` from anywhere is allowed in every layer (erased at runtime — a type contract, not a dependency);
  - test files (`*.test.ts`, `__tests__/`) may import what they exercise (a session-live test imports the route
    it verifies). R1 has no test carve-out: domain tests import domain.
- **Ratchet**: legacy violations live in `scripts/architecture-baseline.json` — per-rule counts may SHRINK
  (migration progress) and never grow; no new file may join. Baseline after the 2026-11-21 migration: **0 / 0**.

Run locally: `bun scripts/check-architecture.mts` — the vitest suite runs the same check
(`src/lib/architecture/__tests__/boundaries.test.ts`), so a violating PR fails CI.

## Migration protocol (how the next slice moves)

1. `git mv` the module to its layer (keep the feature folder: `src/domain/market/…`, `src/infrastructure/market/…`).
2. Leave a one-line **re-export shim** at the old path (`export * from "@/domain/…"`) so consumers/tests keep
   working; delete shims opportunistically when consumers are updated.
3. Fix the moved file's outward relative imports to absolute (`@/…`) or to the new layer path.
4. `bun scripts/check-architecture.mts` must pass with the baseline unchanged (or smaller).
5. Full suite + `tsc --noEmit` green before commit.

## Current map (2026-11-21, after the first migration wave)

- **domain** (`src/domain/`): `market/` — candle quality rules, EGX session anchoring, market hours,
  corporate-action adjustment math + ledger row contracts (split OUT of the old mixed file); `technical/` —
  indicators, structure, ADX, divergence, candlestick patterns, trade plans, VSA, zones, quality scoring, the
  technical snapshot builder, stance, board gates/filters, intraday context, opportunity modules, resistance map;
  `signals/` — the opportunity engine (patterns, levels, metrics, plans, score, types). All pure, zero I/O.
- **application** (`src/application/`): `market/` — the unified candle reader (`loadUnifiedHistory` — THE one
  history every analysis reads) and the daily candle-refresh use-case.
- **infrastructure** (`src/infrastructure/`): `db.ts` (Prisma/Neon client), `market/` — candle-source
  (Yahoo full-history + TradingView scanner adapters), corporate-actions-store (ledger loaders + the Yahoo
  prev-close fetch), price-override-store.
- **presentation**: Next.js App Router (`src/app`), UI (`src/components`), client hooks (`src/hooks`).
- Legacy `src/lib/**` paths re-export their moved modules (one-line shims) — consumers and tests keep working;
  new code imports from the layer paths.

## Debt register (documented, ratcheted)

- `src/lib/**` still hosts ~100 server modules that import `db` directly (124 files at the 2026-11-21 count) —
  they are application/infrastructure by behavior; they migrate per feature slice with shims (protocol above).
- God files: `technical/signals.ts` (2.6k LOC), `financial/extract.ts` (1.2k), `position/review.ts` (1.2k),
  `technical/signals-service.ts` (1.1k) — split before/with their slice migration.
- `financial/**` (17.6k LOC) is the next big slice: extraction/parse logic → domain; loaders → infrastructure.
- `scripts/**` is the ops workbench (migration/backfill/diagnosis scripts) — intentionally outside `src/`, not layered.
