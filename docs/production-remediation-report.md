# EGXANO — Production Remediation Report

**Scope:** free filters with locked premium cards · premium all-company access · dashboard performance · language/copy integrity · pricing alignment
**Branch flow:** `remediation/board-entitlements-perf` (3 commits verified on Preview) → merged to `main`
**Commits on main:** `01d8860`, `8ea17f5`, `98601b7`, `865f45d` (final production deploy `dpl_9aC2v1XZWxP7iXVuGdTJvrrWGd3o`, READY 2026-11-14 07:12 UTC, commit `865f45d5b`)
**Baseline (before):** `da82479` = production `dpl_nMRSDtHkRVaL7wXHTzdzZyojDj6k`
**Rollback:** `git revert` on main (auto-redeploys), or redeploy `da82479` from Vercel deployment history. No DB migrations shipped; snapshot rows in `Setting` are inert to old code.

---

## 1. Architecture findings (verified live, not assumed)

- Stack: Next.js 16 App Router on Vercel (`egxano` project), **hosted PostgreSQL on Neon** via Prisma 6 (`db.ts` v4-postgres, pooled connection), session tokens stored hashed, entitlements in ONE file (`src/lib/plans/entitlements.ts`) consumed by both pricing UI and backend gates.
- Technical engine: deterministic close-based signals + persisted canonical `StanceSnapshot` overlay (single source of truth for levels), corporate-action-adjusted series, honest weak-data bucket.
- The signals board computation is cached per serverless **instance** (in-memory SWR, 10 min TTL / 50 min staleness bound) — every newly-scaled instance re-paid the full whole-market build.
- Prior hardening (commits `c99e908`..`da82479`, all deployed and re-verified) had: fixed free set enforced server-side, market-cap default sort on the companies API, invalidation wording removed from surfaces, AI analysis removed, WAIT → no trade plan.

## 2. Root causes (proven, each with evidence)

| # | Symptom | Root cause | Evidence |
|---|---|---|---|
| R1 | Free filters "don't work" (zero results, 5-row slice) | The API returned ONLY the 5 fixed free rows and all filters ran **client-side** over those 5 rows; locked rows carried no identity (generic placeholders) | `signals-view.tsx` filter memo + API route consuming no params (pre-change code); live probe: any tier filter → 0 results |
| R2a | Premium user sees only 5 companies | **Two different premium definitions**: `getSubscriptionSummary.isPremium` accepted ANY active subscription row (even a plan literally named FREE) while the signals API gates on `getActivePlanId`, which matched plan names by EXACT string and mapped unknown names to paid only when `price > 0` | Code diff of the two functions (pre-change); unit matrix now covers every failing shape |
| R2b | Same | Fragile name matching: `Pro`, `pro-plus`, legacy `PREMIUM`, `PLUS` etc. resolved to FREE when price ≤ 0 | Unit tests `plan-resolution.test.ts` |
| R2c | Same (operational) | The premium test account's actual DB row could not be read from this environment (Neon API DNS-blocked by sandbox egress; `ADMIN_PASSCODE` not available) — the authorized fix path is `/admin → الاشتراكات` | Owner action listed in §15 |
| R3 | Dashboard "over a minute" | Cold serverless instances re-paid heavy builds: valuation 14–29s (54s on preview branch), main dashboard read 36s, latest-results 5.8–34s, board 7–9s; plus eager import of all five dashboard views in the initial bundle | Measured (probe runs + preview logs + Server-Timing) |
| R4 | Copy contradictions | Landing FAQ still referenced **removed AI-analysis** and the retired "Premium" plan; premium gate promised "instant activation" while activation is manual; scanners gate said "Premium subscribers"; companies UI still exposed the alphabetical sort the owner removed | Greps + UI inspection (all fixed) |

## 3. Engineering plan → `docs/production-remediation-plan.md`
Root-cause driven plan written BEFORE implementation, with architecture, database changes (none schema-level), security considerations, performance targets, test strategy, rollback and acceptance criteria. Implemented in the same cycle.

## 4. Changes implemented

| Change | Files |
|---|---|
| ONE plan resolver (`resolvePlanIdFromRow`): normalization + legacy aliases (PREMIUM→PRO, PROPLUS/PLUS→PRO_PLUS) + `price>0 ⇒ paid` + FREE never premium; `isPremiumUser`, `getSubscriptionSummary` and `getActivePlanId` all derive from it | `src/lib/subscription.ts` |
| `subscription/me` exposes canonical `plan` + raw `planName` (owner diagnostics) | `api/v1/subscription/me` |
| Server-side board filter engine (same semantics as the UI, validated params, bounded free-text) | `src/lib/technical/board-filters.ts` (new) |
| Board route: server-side filtering for every tier; paid → full filtered rows; free → 5 fixed companies UNLOCKED + matched-company **identity rows** (`locked:true`); true aggregate counts (`matched`, per-tier, per-style); free slice cap 24 + `lockedRemaining`; aggregate-only info crosses the wire | `api/v1/technical/signals/route.ts` |
| Server-side redaction: locked rows carry ONLY companyId/ticker/name/sector/tier/lastClose/changePct/asOf — signal, score, metrics, dimensions, reasons, styleFits, trade plan NEVER serialize for free callers | `gateRowForFree` (unit-tested key list) |
| Real Locked Premium Cards: company identity + public price + gold lock + "Matches your filters" badge + blurred teaser (decorative only — data already redacted) + CTA; honest empty state; upgrade banner copy per approved phrasing; debounced server-filtered search for free users | `src/components/egx/signals-view.tsx` |
| Shared read-model snapshots: every successful build persists to `Setting`; cold instances serve age-bounded snapshots instantly and refresh in background (board ≤15min in-session/24h off-hours; valuation ≤30min; dashboard base ≤30min; summary ≤15min; latest-results ≤24h) | `src/lib/technical/board-snapshot.ts`, `src/lib/shared-snapshot.ts` (new), `server-cache.ts` `peekCacheAgeMs` |
| Board snapshot write awaited inside the single-flight build (fire-and-forget writes die when the function suspends right after responding) | `signals-service.ts` |
| Server-Timing instrumentation (`source=memory|stale-memory|snapshot|compute`) on all dashboard reads + board | dashboard routes, signals route |
| Dashboard initial bundle: CompaniesView/CompanyDetail/ScannersView/DividendsView now load as separate chunks | `src/app/dashboard/client.tsx` |
| Companies UI: market-cap default, alphabetical sorts removed (API keeps `sort=ticker` for CSV) | `src/components/egx/companies-view.tsx` |
| Compute window 420→300 days (≥3× the longest indicator window) | `signals-service.ts` |
| React-compiler lint violations fixed (pre-existing): no sync setState in effects, no ref reads in render | `tradingview.tsx`, `premium/client.tsx` |

## 5. Free filtering — before / after (live production)

| | Before (da82479) | After (865f45d) |
|---|---|---|
| Filter execution | client-side over 5 gated rows | **server-side over the full 246-company universe** |
| EGX70 filter | 0 results | **69 matched** (24 locked cards + "45 more" teaser) |
| buy + EGX30 | 0 results | **7 matched** locked cards |
| Search "COMI" | 1 (the only free ticker) | 1, **fully unlocked** (free-set member) |
| Zero-result filter | fake-looking empty state | honest `total: 0` empty state |
| Chip counts | 5-row subset | true market-wide/filtered counts (buy 58 / wait 160 / sell 26) |
| Locked card content | generic skeleton, no company | real company identity + public price + match badge + CTA |
| Paid data in response | n/a (no locked rows) | **zero paid fields** (verified per response, `leak=false`) |

## 6. Locked cards screenshots
Saved under `download/egxano-evidence/`:
- `signals-board-anonymous.png` — baseline board, real counts, first locked cards
- `signals-filtered-egx70-real.png` — EGX70 filter active: 69 matches, 24 locked cards with "Matches your filters" badges
- `signals-locked-cards.png` — scrolled card detail (blur teaser + CTA)
- `signals-mobile-locked.png` — mobile (iPhone 14) rendering

## 7. Pro / Pro Plus actual access results
- **Code path verified**: paid plans receive `{...full, rows: filtered}` — the full filtered universe; the 5-company cap exists ONLY on the free fixed set. `Pro` and `Pro Plus` are equal on the board by design (`signalsRows: "ALL"` for both).
- **Unit-verified**: every plausible DB row shape (legacy PREMIUM, aliases, unknown name + price>0, FREE-named row, expired, cancelled) resolves to the correct plan — the "premium gets free treatment" inconsistency is closed at the resolver level.
- **Live premium login: NOT executed in this environment** (no premium credentials available; production DB rows not inspectable — see §15). This is reported as implemented + unit-verified, pending one owner-side login check.

## 8. Dashboard performance — before / after (measured)

| Endpoint (cold instance) | Before | After (snapshot serve) |
|---|---|---|
| `/api/v1/technical/signals` | 7.0–9.8s compute | **1.9–3.2s** (memory-warm 0.14s) |
| `/api/v1/dashboard` (base counts) | 36.4s compute | **2.4–4.5s** |
| `/api/v1/dashboard/valuation` | 14–29s (54s on preview branch) | **0.9–12.3s** (memory-warm 0.72s) |
| `/api/v1/dashboard/summary` | 1.7s | **0.03–11.3s first-hit variance** (warm 0.03s) |
| `/api/v1/dashboard/latest-results` | 5.8s (34s preview branch) | **0.7–0.77s** |
| Dashboard initial JS | all 5 views eager | heavy views chunked |

Notes: cold numbers include Neon pooler + Prisma engine variance (p95 spread visible in runs); `source=snapshot` observed directly in production Server-Timing for ALL five reads on fresh instances. The worst cold read dropped from ~36s to ≤12s and typical cold from 8s to ~2–3s.

## 9. Performance measurements and logs
- Probe scripts + raw results: `scripts/probe_prod.py`, `probe_preview.py`, `probe_final.py` → `scripts/out/probe_results.json`, `preview_probe_results.json`, `final_probe_results.json` (runs, medians, sources, leak checks).
- Server-Timing headers now carry per-phase durations + serving source — field-verifiable in devtools.
- One transient **504** observed on a single heavily-concurrent cold start (5 parallel cold snapshot reads + background recompute on the same pooler); every subsequent request healthy. Not reproducible at normal concurrency; left as a watch item.

## 10. Technical-analysis consistency tests
- Canonical stance overlay unchanged: one persisted reading per company displayed identically on the board and the company technical tab.
- WAIT (`hold`) ⇒ `tradePlan: null` ⇒ every surface renders "no clear entry zone — waiting is better" (board + technical tab verified in code; unit-covered in `trade-plan.test.ts`).
- No `invalidation`/«إبطال» rendering anywhere (re-grepped post-change); stop-loss wording unified («وقف الخسارة»).
- Data-freshness honesty preserved: `pricedAsOf`/`computedAt` travel with payloads; delayed-price disclosure on every surface.

## 11. Copy consistency improvements
- Landing FAQ: removed AI-analysis reference; Free-vs-Pro answer now matches the real 3-plan entitlements (first five technical reads incl. entry/exit/stop, Pro = whole board + events + scanners + unlimited portfolio + higher smart-question limits); recommendations answer de-references AI.
- Premium gate: "instant activation" → "activation happens after the transfer is confirmed" (matches the real manual flow).
- Scanners gate: retired "Premium" plan name → "Pro / Pro Plus".
- Locked-card copy: real-results phrasing, no profit promises; disclaimer unchanged («لأغراض معلوماتية وليست توصية بالبيع أو الشراء»).
- Orphan audio-briefing comment removed; zero audio/AI claims remain in UI (greps).

## 12. Pricing strategy
- Prices kept: FREE / **PRO 150 EGP** / **PRO PLUS 300 EGP**, first month −40% (90/180) — offer-aware amount computed server-side only.
- Cost-side assumptions (stated, not invented): per-active-user marginal cost is dominated by AI smart-questions (hard-capped 20/60/120 per day), Neon storage/egress (bounded by snapshot sharing + pooled reads), PDF report generation (Pro Plus only, per-company), alert processing (5/30/100). The cap ladder keeps the paid tiers' marginal costs bounded and roughly proportional to price.
- Pro/Pro Plus differentiation is real and enforced: PDF report, 120 vs 60 QA, 100 vs 30 alerts, unlimited vs 50 watchlist. No unimplemented feature was added to the pricing page; the comparison table is derived from the SAME `PLANS` limits the backend enforces. A roadmap for deeper Pro-Plus research tools (multi-timeframe research, historical signal performance with honest failure disclosure) is documented in the plan doc — NOT advertised anywhere until implemented.

## 13. Features added / removed
- **Added:** server-side board filter engine; locked premium cards with real matched companies; shared read-model snapshots (5 reads); plan-resolution diagnostics (`planName` in `subscription/me`); Server-Timing instrumentation; dashboard view code-splitting; plan-resolution + board-filter test suites (26 new tests).
- **Removed:** generic skeleton locked placeholders; alphabetical sorts from the companies UI; retired-copy references (AI analysis, "Premium" plan, instant activation).
- **Not added (deliberately):** any pricing-page feature that is not already implemented and enforced.

## 14. Automated testing results
- `tsc --noEmit`: **clean** · `eslint .`: **0 errors** (7 pre-existing unused-directive warnings) · `vitest run`: **310 passed, 6 skipped** (DB-backed auth/access tests self-skip without a test database) — includes **26 new tests**: plan-resolution matrix (7), board filter/gating/redaction/distribution (19).
- `next build`: compiles clean locally (prerender requires a live DB by design); **full build passed on Vercel preview AND production** (READY deploys for `01d8860`, `8ea17f5`, `98601b7`, `865f45d`).
- Regression: all prior suites green; no test was deleted or weakened.

## 15. Remaining blockers / requires owner configuration
1. **Premium live-login check (owner, 2 min):** sign in with the premium test account and open `/signals`. Expected: all ~246 companies with full signal details. If it still shows five, `/admin → الاشتراكات`: re-activate the subscription on the `PRO` plan row (authorized admin path) — the resolver now also surfaces the raw `planName` in `GET /api/v1/subscription/me` to see exactly what the account resolves from.
2. **QA account on production:** two QA free accounts were created through the public register API for probing (`qa.remediation.*`, `qa.final.*` @egxano-qa.local) — delete or keep them at the owner's discretion via the admin panel.
3. **Watch item:** the single transient 504 under a 5-way concurrent cold start (§9). If it recurs in Vercel runtime logs, consider raising the Neon pooler connection limit.
4. **Neon API access from this sandbox is DNS-blocked** — the Neon token was therefore unused; no DB writes were made outside the application's own runtime paths.

## 16. Separation of claim status
- **Confirmed and verified on production:** free filter execution + real counts; locked-row redaction (zero leaks, network-level); non-free company technical 403 gate; snapshot cold-start serving (all five reads); companies market-cap sort; copy fixes shipped; build/lint/typecheck/tests green; push + deploys confirmed.
- **Implemented but not fully verified live:** premium-account end-to-end board access (unit + code verified; live login pending owner — §15.1); board snapshot serve (mechanism proven on the other four reads; board-level `source=snapshot` observed once, then served from memory).
- **Blocked:** reading/repairing the premium test account's DB row directly (no admin passcode; Neon egress blocked).
- **Not implemented (deliberately):** new Pro-Plus research features (roadmap only); any pricing change.
- **Requires owner configuration:** premium login verification; QA account cleanup; optional Neon/Vercel budget review.
