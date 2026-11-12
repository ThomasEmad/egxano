# EGXANO — Product & Code Audit

**Date:** 2026-11-12 · **Repo:** `main` @ `60234a2` · **Stack:** Next.js 16.1.1 · React 19 · TypeScript 5 · Prisma 6.11 (PostgreSQL/Neon) · Tailwind 4 · shadcn/ui · TanStack Query · Vitest
**Scale:** 103 API route files · ~47 Prisma models · 41 user-facing pages · 19 unit-test files · 6,817 report rows / 297 companies (276 active) / 488k+ financial values (Neon migration complete)

> Every claim below was verified against the code this session. Nothing is taken from old documentation.

---

## 1. Verified strengths (keep and build on)

1. **Deterministic financial core.** `src/lib/financial/calc.ts` + `calc/advanced.ts` (~35 functions: growth, CAGR, ROIC, interest coverage, DSO…) + `calc/multi-period.ts` all return typed `MetricResult` (`OK | DATA_UNAVAILABLE | NOT_APPLICABLE | NOT_COMPUTABLE | NEEDS_REVIEW`). Losses never render "+200% growth"; missing ≠ zero; equity ≤ 0 → ROE N/A. 72-code `MetricDefinition` registry (`src/lib/financial/registry.ts`) with formula versions (`roe@1`).
2. **Data provenance at the field level.** `FinancialValue` keeps `sourceTable/Row/Col/Bbox/Page/Text`, `extractionMethod`, `confidence`, plus a manual-correction trail (`originalValue/isManuallyCorrected/correctedBy/correctionReason`). `FinancialReport` has SHA-256 file-hash dedup and restatement versioning (`version`, `isRestatement`, `supersedesId`). 7 structured disclosure models (debt instruments, segments, fair value, related parties…). A full data-quality audit engine (`DataQualityScore`, `AuditRun/AuditIssue`) runs on Vercel cron.
3. **Cache-first AI, never infer on page view.** Report identity = `sha256(companyId | financialDataHash | technicalHash | priceAsOf | prompt@5 | cfg@1 | lang)` (`src/lib/ai/report/identity.ts`) stored in `AiAnalysisReport.reportKey @unique`. Durable Postgres job queue (`enqueue.ts`/`worker.ts`, lease-based, MAX_ATTEMPTS=5, degraded-fallback artifact). Provider chain (`orchestrator/adapters.ts`) with circuit breaker, token bucket, concurrency semaphore, model self-healing discovery, kill switch + daily spend cap vs `AiProviderUsage`.
4. **Honest technical engine.** `src/lib/technical/indicators.ts` (SMA/EMA/RSI-Wilder/MACD/Bollinger/Stochastic/ATR/HV/OBV/support-resistance/trend) — every indicator returns `{value:null, reason:"need N values, have M"}` instead of fabricating. `TECHNICAL_VERSION = "technical@1"`.
5. **Grounded QA without an LLM.** `/api/v1/qa` is a deterministic intent-matching engine over verified data (tiered daily quotas).
6. **Screener persistence exists.** `ScannerRule` (JSON conditions: metric/event/dividend/sector), `ScannerRun` with rule snapshots, 9 seeded presets, saved custom rules.
7. **Security posture (custom auth) is sound:** bcrypt(cost 10), hashed session tokens (SHA-256), HttpOnly cookies, OAuth with signed state, timing-safe cron bearer checks (`secure-compare.ts`), admin session isolation, audit logs. Premium enforced server-side (`requirePremium`, 60s-cached `isPremiumUser`).
8. **Vitest unit coverage of the critical math** (indicators, calc, period-validity, rankings-order, refresh, auth/access, orchestrator validation).
9. **Bilingual by design:** flat i18n context (`src/lib/i18n.tsx`), Arabic model fields, Arabic-first AI output, RTL on `<html>`.

## 2. Verified weaknesses

1. **Two orphaned feature tabs on the company page.** `HealthTab` (0–100 health radar + valuation-vs-sector, fully built, fetches existing `/companies/[id]/scores`) is imported at `company-detail.tsx:53` but **never rendered**; `TechnicalTab` is exported and **never imported** (only a type-only dynamic import in `api.ts:474`). This is the same "feature vanishes during redesign" pattern that earlier deleted the SectorTreemap (restored in `60234a2`).
2. **Alerts are bare:** price ABOVE/BELOW only, max 20, **lazily evaluated on page read**, in-app only, no channels (page copy admits it: `/alerts`).
3. **Price ingestion is fragile:** `PriceBar` history is written only by an offline Playwright harvest script (`scripts/tv-price-history-harvest.mjs`); `vercel.json` schedules **only the 2 audit crons** — `cron/market` (live prices), `cron/recompute`, `cron/ai-worker` exist as routes but are **not scheduled**; intraday freshness relies on the opportunistic `/health` heartbeat (≥90s) and external schedulers that may not exist in production.
4. **publicationDate coverage ≈ 0%** (per `reports/data-completeness-baseline.md`) → results-calendar/predicted-earnings features have no fuel yet; 5 future-dated periods and 21 inactive companies linger.
5. **No natural-language screening, no AND/OR filter groups, no exports of screen results.**
6. **No backtesting, no 52W/volume-anomaly analytics, no F-Score/Altman** — the quant layer competitors advertise (and EGX Screener fakes) is absent.
7. **Portfolio has no analytics beyond P/L and weights** (no concentration, sector exposure, health-per-holding, no AI analysis).

## 3. Missing functionality (user-visible)

Natural-language screening · composable alert conditions with delivery channels · criterion-level quant scores (Piotroski/Altman) with evidence · 52W/volume radars · methodology pages for valuation models · screen-result exports/share links · portfolio analytics · disclosures surfaced on company pages · macro context pack · per-ticker public data changelog.

## 4. Duplicate implementations

- Two latest-price helpers: `financial/latest-price.ts` (JS-side) vs `market/latest-price.ts` (SQL window function — the documented "egress diet" path; the JS one still has callers).
- `netMargin/roe/roa/debtToEquity` exist in both `calc.ts` and `calc/advanced.ts`.
- Two AI chat UIs (`ai-qa-box.tsx`, `ai-analyst-chat.tsx`) + legacy `egx/qa-box.tsx`.
- Two price-refresh paths: public `market/sync` (throttled) vs admin `market/refresh` (script spawn).
- Three DB-mode shims (SQLite/Turso/Postgres) in `db.ts`/`instrumentation.ts`/`env.ts` although datasource is postgres; legacy `db/custom.db`, `prisma/test.db`, `.traineddata` blobs still ship in the repo.

## 5. Broken / degraded workflows

- Company page: HealthTab dead-on-arrival (import without render); TechnicalTab unreachable via UI.
- Alerts page communicates "no email or push delivery" — a promise-shaped feature that can't notify.
- `/admin/data-quality` redirect chain is indirect (next.config redirects to a redirector page).
- If no external scheduler is configured, intraday market refresh never runs (§2.3) — prices go stale until a user visit triggers the heartbeat.

## 6. Technical debt (prioritized)

1. `ignoreBuildErrors: true` in `next.config.ts` (type errors surface only via out-of-band typecheck) — caused real production incidents (undefined-variable prerender crash, 2026-11-11).
2. In-memory rate limiter and non-AI quotas are per-instance (serverless-safe only partially; AI durable quotas ARE DB-backed — QA/chat daily quotas are not).
3. `next-intl` is a declared but unused dependency; eslint `no-explicit-any`/`exhaustive-deps` disabled.
4. `CompanyConfidenceScore` keyed by `ticker` string instead of company id (fragile on ticker changes).
5. ~150 data-ops artifacts (`reports/*.md`, quarantine/rollback JSONs, harvest scripts) committed into the deploy artifact.

## 7. Performance bottlenecks & notes

- Single in-memory SWR cache (`server-cache.ts`) is per-instance (fine at current scale; needs shared cache if multi-instance grows).
- `market/treemap` (60s) computes caps per request over ~250 companies — acceptable, cached; `dashboard` and `rankings` have stale-flag + basis guards.
- AI concurrency semaphore (default 3) + model discovery add latency on cold start; acceptable.
- No load testing has been performed — **no concurrency claims are made in these docs** (per Phase 14).

## 8. Data quality problems (measured)

From the committed baseline (`reports/data-completeness-baseline.md`, 2026-11-03) + audit engine: uneven annual coverage (181 companies at FY2025, 53 at FY2024; sparse pre-2020), publicationDate 0%, consolidated-vs-standalone mix handled by `statement-pref.ts` but not surfaced to users, TradingView-dependent quotes (15-min delayed, session-gated), no adjusted-close concept (raw quoted prices — deliberate honesty, must stay labeled).

## 9. Security concerns (all minor, listed for completeness)

`market/sync` public with in-memory-only IP throttle (multi-instance bypass possible) · hardcoded WhatsApp fallback number in premium client · admin passcode model (single shared secret) acceptable for a 2-admin operation but should gain TOTP later · client-side premium gates are UX only (server enforcement verified on the sensitive routes audited) · cron secret currently missing in production env (`UNAUTHORIZED` on audit cron — must be set before scheduling matters).

## 10. Present but hard to discover

- `/undervalued` (3-method fair-value screen) — no link from the main nav story.
- Saved scanner presets (9) behind the dashboard's premium gate.
- Per-period report pages + print view (`/company/[id]/report`).
- Public `/status` trust page (uptime, delay, coverage) — the single best trust asset, buried in the footer.
- Data-quality confidence badges on company pages.
- Snowflake/`investor-signals` endpoints exist but have thin UI presence.
