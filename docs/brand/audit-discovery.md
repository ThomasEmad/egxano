# Meza — Audit: Comparison, Discovery & Screening experience

Author: compare-discovery teammate · Date: 2026-11-09 · Phase: **audit only (no source edits)**

Scope: `/compare`, `/companies`, `/dashboard` (incl. `#/scanners`, `#/custom`, `#/companies`,
`#/dividends`), `/rankings`, `/undervalued`, `/sectors`, `/sectors/[sector]`, global search in
`TopHeader`, and the i18n keys those screens consume.

This document judges the screens against `docs/brand/BRIEF.md` and `docs/brand/strategy.md`
(principles **P1** clarity-as-brand, **P2** differentiation through experience,
**P3** institutional not personal, **P4** preparation not hype, **P5** trust is shown not claimed;
strategy §5 messaging, §6 voice, §7 trust vocabulary, §9 IA, §12 non-negotiables).

---

## 1. Scope & inspection method

**Source inspected (read-only):**

| Area | Files |
| --- | --- |
| Compare | `src/app/compare/client.tsx`, `src/app/compare/page.tsx`, `src/app/api/v1/compare/route.ts` (read-only, to learn the payload) |
| Companies | `src/app/companies/client.tsx`, `src/app/companies/page.tsx`, `src/app/companies/quick-analysis.tsx` (entry point only), `src/components/egx/companies-view.tsx` |
| Screener / dashboard | `src/app/dashboard/client.tsx`, `src/app/dashboard/page.tsx`, `src/components/egx/dashboard-view.tsx`, `src/components/egx/scanners-view.tsx`, `src/components/egx/shared.tsx` |
| Discovery | `src/app/rankings/client.tsx`, `src/app/rankings/page.tsx`, `src/app/undervalued/client.tsx`, `src/app/undervalued/page.tsx`, `src/app/sectors/page.tsx`, `src/app/sectors/sectors-shell.tsx`, `src/app/sectors/[sector]/page.tsx`, `src/app/sectors/[sector]/sector-shell.tsx`, `src/app/sectors/[sector]/period-select.tsx`, `src/components/egx/dividends-view.tsx` |
| Shell / search / nav | `src/components/layout/TopHeader.tsx`, `src/components/layout/AppSidebar.tsx`, `src/components/layout/MobileBottomNav.tsx`, `src/components/layout/LayoutShell.tsx` |
| Copy | `src/lib/i18n.tsx` (all keys used by the above), `src/lib/brand.ts` (new, in progress) |

**Live, read-only checks against production (real data, 2026-11-09):**

- `GET /api/v1/compare?ids=COMI,ADIB,ABUK` → columns came back as **Q1 2026 / H1 2026 / Q2 2026**
  on the default "Auto" basis, i.e. the flagship comparison runs on three different period kinds
  with per-row "best value" highlighting still active.
- `GET /api/v1/rankings?metric=p_e` (exactly what the client requests) → ordered **descending**:
  `#1 AMER P/E 971.2 (H1 2026)`, `#2 NCCW 957.5`, … down to COMI 5.9 / ADIB 5.2. The client never
  sends `order`, so "Company Rankings — P/E" puts the *most expensive* stock first with a crown icon.
  Row bases were mixed: `Q1/Q2/H1 2026`, `FY 2026`, `TTM ending Q2 2026`.
- `GET /api/v1/companies?pageSize=4` → 253 listed companies, `marketAsOf`, `delayMinutes: 15`,
  per-metric `periodLabel`/`status`/`fiscalYear`, and `counts {reports, events, dividends}` — the
  card UI displays almost none of that provenance.
- `GET /api/v1/sectors?year=2025` → mixed bases inside the pinned year (`FY 2025` for most sectors,
  `TTM ending Q4 2025` for Education), `medianRoe` values like 19.48, 25.76, 38.5.
- `GET /api/v1/scanners` → 10 presets, bilingual `name`/`nameAr`, **English-only `description`**.

Not verifiable without a browser: rendered RTL/LTR layout, chart/tooltip visuals, focus order,
mobile drawer behaviour. Code-level evidence is cited instead; anything requiring a screenshot is
marked "(visually verify in implementation)".

**What was not touched:** no source file was modified by this audit. `git status` shows only the
Lead's in-flight foundation work (`globals.css`, `layout.tsx`, `manifest.ts`, `seo-config.ts`,
`components/layout/*`, `components/egx/app-footer.tsx`, `src/lib/brand.ts`,
`src/components/brand/*`) plus this document.

---

## 2. What currently works and must be kept

These are genuine research-instrument behaviours and are the raw material for the brand.

1. **Period honesty in compare columns.** `compare/client.tsx:282` prints each column's
   `periodLabel` under its ticker, and `:263-268` warns when bases differ. The instinct is right —
   it just does not go far enough (see C2).
2. **One pinned period for everyone.** `compare/client.tsx:75-91` + `?year=` URL sync; API
   `compare/route.ts:115-127` only offers years where ≥2 companies have data. This is the
   like-for-like mechanism the brand pillar "قارن في نفس الظروف" needs.
3. **Rankings' basis discipline.** `rankings/client.tsx:144-167` explains, in both languages, that
   "latest" is not a shared window, that ROE/ROA use full periods, and what a pinned year means.
   `rankings/route.ts:95-117` enforces full-period ranking for flow metrics and flags `stale` rows.
   This is the most brand-aligned engineering thinking in the whole scope — keep the copy, extend it.
4. **Screener honesty inside the custom builder.** `scanners-view.tsx:592-596` ("Every result is
   built from actual stored values — missing data is never treated as zero") and
   `shared.tsx:89-144` `WhyMatchedPanel` (per-condition ✓/✗, actual value, status) are exactly
   "فلتر بمعنى — ونتيجة بتفسير". They are just not applied to preset screens (S1).
5. **Undervalued's stated criteria.** `undervalued/client.tsx:22-36` bilingual criteria dictionary,
   per-row criteria list (`:181-186`), `reviewRequired` warning (`:187-193`) and the fair-value
   disclaimer (`:110-114`). This is the best "show your working" pattern in discovery; keep the
   logic, fix the framing (U1-U3).
6. **Sectors' provenance essay.** `sectors-shell.tsx:324-334` "How sectors are assigned" (published
   EGX indices, not name heuristics, "Other" instead of forcing) — institutional, credible, keep.
7. **Never-zero empty states.** `sectors/[sector]/sector-shell.tsx:69-76` and
   `sectors-shell.tsx:120-127` explain that `—` means "no authoritative value, never treated as
   zero". Keep the meaning, localize the delivery (SD2).
8. **EGX30 panel's honest limitation** (`dashboard-view.tsx:576-580`: level from a 15-min public
   source; historical chart needs a licensed feed). This is "trust is shown, not claimed". Keep.
9. **Companies directory fundamentals**: debounced search, sector filter, A–Z/market-cap sort,
   `Suspended` badge (`client.tsx:299-303`), CSV export (`:176-184`), and — crucially — the
   **price freshness footer with the real `delayMinutes` from the API** (`client.tsx:132-138`).
   That footer is the correct pattern; every other screen should copy it.
10. **TopHeader's real session state** (no fake name/badge), ⌘K focus shortcut, and bilingual
    company/sector/page matching in search (`TopHeader.tsx:77-140`).
11. **Deep-linkable discovery intent**: `/dashboard?preset=TURNAROUND#/scanners`
    (`dashboard/client.tsx:57-62`) shows the product already wants shareable discovery entry
    points — but the URL vocabulary is opaque (see S9).
12. **`src/lib/brand.ts` exists (in progress)**: `TRUST` labels and `METRIC_GLOSSARY` are exactly
    what C4/S5/U4 need. Reuse them; do not duplicate strings.

---

## 3. Issue table

Severity: **Blocker** = materially misleads or claims a capability that does not exist;
**High** = breaks the research workflow or the trust story; **Medium** = friction/inconsistency;
**Low** = polish. Principle column maps to BRIEF §Brand principles (P1-P5); §/¶ refer to strategy.

### 3.1 `/compare` — `src/app/compare/client.tsx`

| ID | Issue | Sev | Principle | file:line | Proposed fix (presentation layer) |
| --- | --- | --- | --- | --- | --- |
| C1 | **"Best value" is declared for absolute size metrics.** `total_assets`, `total_equity`, `market_cap`, `revenue`, `net_profit`, `eps` are flagged higher-is-better, so the biggest balance sheet wins the row. Live check: COMI 1.57T total assets is "best" purely because it is a large bank. | Blocker | P5 trust; §12.3 | `client.tsx:40`, `:150-168`, `:292-308` | Two-tier treatment: (a) ratio metrics with a defensible direction get a non-superlative "stronger figure" mark; (b) scale metrics are never ranked — show them as levels plus a delta vs column A. Remove size metrics from `HIGHER_BETTER`. |
| C2 | **"Best in row" survives mismatched bases.** `basisMixed` only prints a note; the highlight (and the "Auto" default that *guarantees* mixed bases — live: Q1/H1/Q2) still claims a winner. | Blocker | P5; strategy §7 "Periods not aligned — comparison is indicative" | `client.tsx:263-269` (note), `:145-148`, `:292-308` | When bases differ: show the comparator-warning banner (TRUST vocabulary), suppress all "best" marks, and offer a one-click "align to fiscal year …" pin. Highlight only when every column shares `periodLabel`/`periodType`. |
| C3 | **Lower-is-better on P/E and P/B can highlight a loss-maker as "best".** A negative P/E (loss-making) or negative P/B (negative book value) sorts as the lowest value and gets the favoured treatment. | Blocker | P5; §12.3 | `client.tsx:41`, `:157-164` | Qualify: lower-is-better only when the value is positive and the metric is flagged "valid for ranking"; negative P/E/P/B renders as "loss-making — not comparable" (glossary: `METRIC_GLOSSARY.p_e`, `brand.ts:101-110`). |
| C4 | **Metrics arrive as a flat 12-row list in API order** — revenue before margin, EPS before P/E — with no grouping, no direction hint, no explanation. Users cannot tell profitability from scale from valuation. | High | P1 clarity | `client.tsx:289-311` (renders `metricDefs` as-is); order from `compare/route.ts:20-24` | Group into three labelled blocks: *Profitability & returns* (net_margin, roe, roa), *Valuation & leverage* (p_e, p_b, debt_to_equity), *Scale & balance sheet* (revenue, net_profit, total_assets, total_equity, eps, market_cap). Add direction label per row ("higher is better" / "lower is better, only when positive" / "size — not a quality judgement") and the one-line glossary from `brand.ts`. |
| C5 | **No "major differences" summary.** The brief asks comparison to surface the differences that matter; the table only invites row-by-row squinting. | High | P2 differentiation; strategy §5 "وشوف الفرق اللي يستاهل" | `client.tsx:270-315` | Above the table, a compact "Where they differ most" block: top 3 rows by relative gap (computed client-side from the same payload), each linking to the row; plus an explicit "where they are similar" line to stop over-reading small deltas. |
| C6 | **No sector-comparability warning.** Banks vs fertilizers is the demo case (COMI/ADIB/ABUK): banks carry structurally different leverage/margins. | High | P5 honest comparison | `client.tsx:145-148` (no sector check), `:277-285` | If `sector` values differ, show an info line: mixed sectors → structural differences; offer "compare with sector median" link to `/sectors/[sector]`. Suppress nothing, just qualify. |
| C7 | **Header copy is factually wrong about the basis.** "Compare up to 4 companies on each one's latest annual statements" — with Auto the columns are quarterly/interim (live: Q1/Q2/H1). | Blocker (copy) | P5; §12.2 | `client.tsx:194-201` | Rewrite to describe both modes honestly (copy C-CMP-1 in §5) and let the period control be always visible, not conditional on `ids.length >= 2` (`:203`). |
| C8 | **Server errors masquerade as "no data".** `queryFn` returns `null` on `!r.ok`; the UI then shows "Not enough data for these companies". | High | P5; §12.4 (never hide a state) | `client.tsx:120-128`, `:317-320` | Distinguish transport/5xx (error card + retry) from genuine insufficiency (explanation + next actions). The same anti-pattern recurs across this scope (X1). |
| C9 | **Empty state uses three hardcoded company cuids and bare tickers**, not a real suggestion; ids may drift. | Medium | P4 preparation | `client.tsx:327-331` | Replace with "start with a sector pair" suggestions built from the companies search endpoint (e.g. two banks), showing names + sector, not opaque ids. |
| C10 | **Sharing is implicit and opaque.** URL updates silently with `history.replaceState`; no copy-link, no "shared view" feedback; ids are 27-char cuids, so links are unreadable and previews are blank. | Medium | P1; strategy §5 Compare pillar | `client.tsx:60-69`, `:81-98` | Add explicit "Copy link" (with copied state) and a readable `?tickers=COMI,ABUK` alternative resolved client-side through `/api/v1/companies?search=`; keep `ids` for compatibility. Also fix column links to canonical `/company/<ticker>` (`:279`) instead of `/company/<cuid>`. |
| C11 | **Silent 4-company cap.** The 5th selection is ignored with no feedback. | Low | P1 | `client.tsx:102` | Disable add-state with an inline note ("4 maximum") and keep chips removable. |
| C12 | **"Best" is encoded by colour only, and the legend is wrong.** Cells use emerald/blue + `bg-primary/5`; the footer says "Green = best in row" although blue also means best. | Medium | P5; accessibility (BRIEF §8) | `client.tsx:297-308`, `:337-340` | Add a text/icon marker (◆ with `aria-label`/`title`), use one semantic token for "stronger figure", and make the legend describe exactly that. Contrast/focus pass in implementation. |
| C13 | **No freshness or filing provenance on the page that most needs it.** No "last updated", no filing/statement basis, no source label, despite `periodType` being available per column. | High | P5 trust is shown | `client.tsx:275-286` (header rows) | Add a provenance strip under the table: per-column period + statement basis (consolidated/standalone when available) + "data as of" from `/api/v1/companies` `marketAsOf`-style freshness; state that ratio values are calculated, not reported (TRUST.calculated). |
| C14 | `/compare` is `robots: index:false` with an English-only title. | Low (SEO/IA) | P2; strategy §9 | `compare/page.tsx:4-7` | Report to Lead (SEO config owned by Lead): decide whether the compare *tool* surface should be indexable as a research entry point, and localize the title. Do not change without Lead sign-off. |

### 3.2 `/companies` — `src/app/companies/client.tsx` + `src/components/egx/companies-view.tsx`

| ID | Issue | Sev | Principle | file:line | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| CO1 | **Cards show values with no reporting period and no status**, although the API returns `{value,status,periodLabel,fiscalYear}` per metric. A card can mix FY 2024 profit with FY 2025 assets (verified live on AALR) and looks like one consistent snapshot. | Blocker | P5; §7 trust vocabulary | `client.tsx:23-28` (type), `:274-276`, `:323-338` | Print the period under each figure (as `companies-view.tsx:225/231/237` already does) and a single card-level "as of" line; if periods differ within a card, label them per figure, not globally. |
| CO2 | **Data depth is hidden.** `counts.reports/events/dividends` are fetched and never rendered; a company with 52 filings and one with none look identical in research-depth terms. | High | P2; strategy §7 completeness | `client.tsx:38`, `:323-338` | Add a quiet coverage line: "52 filings · 9 events · no dividends recorded" linking to the company page sections. This is the cheapest trust differentiator available. |
| CO3 | **Price freshness is only in a 10px footer** (`Prices as of … · 15-min delay`), far from the price it qualifies; the API already returns `delayMinutes` — the correct pattern. | Medium | P5 | `client.tsx:132-138`, `:393-395` vs card price `:307-319` | Promote a persistent freshness bar just under the filter row ("Prices as of … · delayed 15 min · financials from published filings"), and keep the footer as provenance. |
| CO4 | **Cards are click targets with `role="link"` but no keyboard access** (`div` + `onClick`, no `tabIndex`/`onKeyDown`). | High (a11y) | BRIEF §8 | `client.tsx:278-284` | Make the whole card a real `<Link>` (or add `tabIndex=0`, `onKeyDown` Enter/Space, visible focus ring); keep the inner AI/compare buttons with `stopPropagation`. |
| CO5 | **No path from a company list into comparison** — the flagship capability has no entry point from the place where people pick companies. | High | P2; strategy §9/§10 ("next step: compare") | absent from `client.tsx:157-364` | Add a compare selection mode: checkbox on each card → sticky bar "2 selected · Compare" → `/compare?ids=…` (cap 4, disabled state at 4). |
| CO6 | "…key verified metrics" copy claims verification without displaying its evidence; suspended/other states are only partly surfaced. | Low | P5 | `client.tsx:166-173` | Reword (copy CO-1) to name what is shown and that each figure carries its period. |
| CO7 | **Duplicate company directory** at `/dashboard#/companies` (`companies-view.tsx`) with a broken table: header has 8 columns, body renders 7 cells, so **Sector values sit under the "Company" header and Actions under "Market Cap"**. "Market cap" column is hard-coded `—`. | Blocker (if reachable) | P1; P5 | `companies-view.tsx:144-193` (headers) vs `:207-246` (cells); `:191`, `:239-241` | Preferred: retire the duplicate — `/dashboard#/companies` should `router.replace("/companies")` (documented in the worklog as a deliberate consolidation). If the view is kept, fix the column map and populate market cap. |
| CO8 | Sorting in the duplicate view is **client-side over the current 25 rows only**, while the header implies a global sort; copy claims "advanced sorting and filtering". | High (if reachable) | P5; P1 | `companies-view.tsx:55-63`, `:71-73` | Either wire server `sort` (only `ticker`/`marketCap` exist today — keep those) or remove sort affordances; fix the copy to "search, filter by sector, sort A–Z or by market cap". |
| CO9 | Error vs empty conflation (`r.ok ? json : null`) → a failed request reads "No companies match your filters — try widening them." | Medium | P5; §12.4 | `client.tsx:108-111`, `:241-253` | Separate error state (retry + support note) from empty state (with "Clear all filters", which is already good at `:254-265`). |

### 3.3 `/dashboard` + screener — `src/components/egx/dashboard-view.tsx`, `scanners-view.tsx`, `src/app/dashboard/client.tsx`

| ID | Issue | Sev | Principle | file:line | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| D1 | **A dead "Ask about the market…" input plus a Send button with no handler** — an interactive control that does nothing. Direct violation of "never fabricate capabilities". | Blocker | §12.1; P5 | `dashboard-view.tsx:288-297` | Remove the fake ask bar. Replace with one honest action row: "Screen companies" (`#/scanners`), "Compare companies" (`/compare`), "Open valuation screen" (`/undervalued`) — no text field. |
| D2 | **Dead "Upgrade" button** inside the premium-locked events panel (`onClick={() => {}}`). | Blocker | §12.1; P5 | `dashboard-view.tsx:645-652` | Link to `/premium`, or state "Events are included in Premium — see what it covers" with a working link. Never render a control that cannot act. |
| D3 | **Missing price renders as a green "+0.00%"** (`priceInfo?.changePct ?? 0`), i.e. fabricated data in the watchlist panel. | Blocker | §12.1; §7 | `dashboard-view.tsx:695` | Show `—` plus "no price recorded" (the company page and cards already follow the never-zero rule). |
| D4 | **"Opportunities Under Radar / فرص تحت الرادار"**, "Discover promising companies through advanced analysis tools", "Explore Now" — promise framing on a list of companies meeting valuation criteria; no criteria shown, no method, duplicated CTA. | Blocker (copy) | P4; §6 ban list; §12.3 | `dashboard-view.tsx:724-798` (`:752`, `:757`, `:777`, `:783`, `:789`) | Reframe as "Valuation screen — latest candidates": name the criteria source, link `/undervalued`, state "not a recommendation". Remove "Explore Now" duplication. |
| D5 | **"Every figure from verified filings"** sits above a market header made of price/breadth data, not filings. | High | P5; §12.2 | `dashboard-view.tsx:185-189` | Split the claim: prices delayed 15 min (market data) · financial figures from published filings · unavailable shows «—». |
| D6 | **Hardcoded "15-min delayed" in four places** while the real `delayMinutes` is available from `/api/v1/market/*` and used correctly on `/companies`. | Medium | P5; §7 | `dashboard-view.tsx:429-431`, `:484-486`, `:534-536`, `:576-580`; also `AppSidebar.tsx:149-153`, `MobileNavDrawer.tsx:149-153` | One shared freshness component driven by `delayMinutes`/`pricesAsOf`; fall back to "delayed market data" when unknown. Prevents a lie the day the feed changes. |
| D7 | **Vanity stat tiles** ("Financial data points / نقاط بيانات مالية", "Companies tracked") sit at equal prominence with breadth; jargon count that no investor uses. | Medium | P1 clarity | `dashboard-view.tsx:222-232` | Replace with decision-useful coverage: "Prices available: N of 253" (breadth `pricedCount`), "Companies with filings this year" (from dashboard stats if present) and move raw counts to a secondary provenance line. |
| D8 | **Hash-routed duplicate app shell**: `/dashboard#/companies`, `#/dividends`, `#/scanners`, `#/custom` re-implement pages that also exist as real routes; `/dashboard` is `robots: index:false`, so the screener lives on a non-indexable, non-addressable surface. | High | P2; P1; strategy §9 | `dashboard/client.tsx:19-33`, `:87-117`; `dashboard/page.tsx:8-9` | Keep the hash routes for compatibility, but: `#/companies` → `/companies`, `#/dividends` → `/dividends` (client-side replace), `#/scanners` → keep with a visible breadcrumb/title "Screener" and a real nav entry; give scanner state a `?preset=`/`?basis=` vocabulary that is readable. |
| D9 | **Sector panel ranks by one-day price change** with an arbitrary bar scale (`Math.abs(change)*10`) and no axis; the only context is a footnote. | Low | P1 | `dashboard-view.tsx:364-431` | Keep 1D (it is honest and useful) but label the ranking ("largest 1-day moves"), cap/scale the bar consistently, and add the sector median ROE as a second, differently-coloured context? No — keep one encoding; instead link "Sector overview" to `/sectors`. |
| D10 | Unused `IndexCard`, unused `isPremium` prop in `Egx30ChartPanel`, duplicate "15m delayed" chip next to the EGX30 title. | Low | P3 | `dashboard-view.tsx:329-344`, `:494-537` | Remove dead code during implementation; keep one freshness chip per card. |
| S1 | **Preset screener results are thrown away: the page shows only a count.** `setResult({matched, total})` drops `output.results`, and the results pane has no `ResultRow` list — so clicking "Financial Turnaround" yields "12 / 253 matching companies" and **no company names**. No "why matched", no path into research. This is the single most damaging discovery defect: the instrument's output is invisible. | Blocker | P2; strategy §5 "فلتر بمعنى — ونتيجة بتفسير"; §10 next step | `scanners-view.tsx:89`, `:115-122`, `:249-280` (no list); `ResultRow` used only at `:861-870` | Keep the full `results` array in state and render the same `ResultRow` component the custom scanner already uses, with "Why matched" expansion, evaluated period, and actions (Open company / Add to compare / Star). |
| S2 | **Preset descriptions are English-only** in an otherwise bilingual product (`pick(name, nameAr)` exists for names; `description` has no Arabic). | High | P4/P1; §12.6 language parity | `scanners-view.tsx:146`, `:185-187`; live API `description` EN only | Add an inline Arabic description map keyed by `presetKey` (10 entries) in the view; do not change the DB/API. |
| S3 | **No "why this filter matters" anywhere.** Presets are opaque names + one English sentence; thresholds (ROE ≥ 15%, D/E ≤ 0.5) are asserted with no explanation of what they capture or their limits. | High | P2; P1; §6 "explain why a company matched a filter" | `scanners-view.tsx:166-204`, `:455-486` | One-line "what it tests" + "what it misses" per preset, and a help popover per threshold using `METRIC_GLOSSARY`. Same text feeds the homepage preset cards later. |
| S4 | **"High Total Assets (≥ EGP 10B)" is presented as a discovery screen** but it is a size filter — it answers "who is big", not "what changed or why it matters". | Medium | P2; §12.1 (no implied significance) | Live API preset `HIGH_ASSETS`; displayed at `scanners-view.tsx:166-204` | Keep the capability, relabel the intent ("Largest balance sheets — size, not quality") or move it out of the default preset rail. Presentation only. |
| S5 | **Basis selector with no explanation of consequences.** "Latest quarter (YoY)" claims YoY in EN while the AR label drops it; nothing says what TTM/quarterly does to ROE, margins or P/E; no coverage feedback. | High | P5; §7 | `scanners-view.tsx:60-70`, `:148-160`, `:598-608`; `i18n.tsx:62-64` | Add a one-line basis explainer under the selector and a coverage badge ("evaluated 211 of 253 — 42 lacked the metric"). Copy: SC-1…SC-3 in §5. |
| S6 | **Dead-end empty result**: "No matching companies for this period." with no recovery path. | High | P4; §10 empty states answer *why / what now* | `scanners-view.tsx:266-270`, `:855-858` | Explain why (basis/threshold/coverage) and offer: switch basis, loosen threshold (custom mode prefilled), or open run details listing companies excluded for missing data. |
| S7 | **Custom builder: sector is a free-text input** ("e.g. Banks") — Arabic names, typos or unknown sectors silently return zero matches with no validation. | High | P1; P5 | `scanners-view.tsx:703-709`, `:526-529` | Replace with a `Select` of `SECTORS` (already exported by `@/lib/sectors`) + optional "≠" toggle. Same markup as the sector filter used on `/companies`. |
| S8 | **Bilingual strings shown simultaneously** in error/validation copy ("الحد الأدنى يجب أن يكون ≤ الحد الأعلى / min must be ≤ max") and the "ConditionS" label bug (`{t("sc.condition")}s` renders "شروطs"/"ConditionS"). | Medium | P4; §12.6 | `scanners-view.tsx:516`, `:521`, `:523`, `:527`, `:804`, `:616` | Render only the active language; move the concatenation into the string ("All conditions must be true"). |
| S9 | **Scanner state is not shareable**: preset/basis/filters live in component state; only `?preset=` is read once on mount and never written back. | Medium | P2 | `dashboard/client.tsx:57-62`; `scanners-view.tsx:87-91` | Mirror `?preset=` + `?basis=` into the URL (read + write), so a screen is a link someone can send — the brand promise of a research workspace. |
| S10 | **`useEffect` auto-run deps are incomplete** (`[effectiveRuleId, basis]`), so a rule/basis switch can race and the current selection can lag; no guard against overlapping mutations. | Medium (correctness) | P5 | `scanners-view.tsx:136-139` | Depend on the resolved rule id + basis, guard with `runMutation.isPending`, and surface "last run: time · basis" in the result header. |
| S11 | **Metric picker shows raw codes' labels but no units, no typical range, no help**; the unit hint only appears next to a valid numeric input. | Medium | P1 | `scanners-view.tsx:674-702`, `:748-752` | Show unit in the select item ("ROE (%)"), and a one-line glossary under the row (from `brand.ts`). |
| S12 | **Results ordering** is by `matchedCount` only; no sort by the matched metric, no filter within results, no "add all to watchlist/compare". | Low | P2 | `scanners-view.tsx:861` | Sort by the primary metric by default (matched rows first), add a metric sort toggle and a bulk "Compare selected". |

### 3.4 `/rankings` — `src/app/rankings/client.tsx`

| ID | Issue | Sev | Principle | file:line | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| R1 | **Ranking direction is inverted for lower-is-better metrics.** The client never sends `order`, the API defaults to `DESC`, so P/E / P/B / liabilities-to-equity rank **most expensive / most leveraged first**, crowned #1. Live proof: P/E #1 = AMER 971.2. | Blocker | P5; §12.3/§12.4 | `rankings/client.tsx:78-83`; API default at `rankings/route.ts:56`, `:138-141` | Add a client-side direction map (`p_e`, `p_b`, `liabilities_to_equity`, `debt_to_equity` → `order=asc`) and pass `order` in the request. No API change needed. Also label the metric header "P/E — lower is better" and validate that negative P/E rows are flagged, not ranked as cheapest. |
| R2 | **Footer trust claim is false for two of the three bases.** "All values from verified annual filings — each company's latest year" is wrong for `basis=ttm`, for `basis=latest` (can be quarterly, as live data shows) and for a pinned year (not "each company's latest"). | Blocker (copy) | P5; §12.2 | `rankings/client.tsx:334-336` | Make the claim computed from `basis`/`year` and reuse TRUST labels: source = published filing · basis = … · period = per row · calculated values. |
| R3 | **Crown/medal/trophy framing** turns a metric sort into a contest: #1 on "Total assets" or "Revenue" is just the largest; #1 on ROE may be a one-off. | Medium | P4 preparation, not hype; P2 | `rankings/client.tsx:60-64`, `:276-291`, icon `Trophy` at `:141` | Neutral rank numerals with a muted "top quartile" accent; keep colour for the metric value only. State once: "Rank position is a sort of one figure, not an overall judgement." |
| R4 | **No sector context for the number** — users cannot tell whether ROE 15% is strong or weak for that sector, even though `/api/v1/sectors` already returns `medianRoe`/`medianPe`/`medianPb`. | High | P2; P1 | `rankings/client.tsx:264-315` | Add an optional "sector median" column for the three metrics that have medians (roe, p_e, p_b), fetched from the existing sector endpoint; hide for others. Pure presentation, no contract change. |
| R5 | **Rankings state is not shareable** (metric/sector/basis/year are local state) — inconsistent with compare/sectors which do sync `?year=`. | Medium | P2 | `rankings/client.tsx:70-77` | Sync `metric`, `sector`, `basis`, `year` to the URL (read on mount, replaceState on change) + copy link. |
| R6 | Staleness is communicated by a bare `*` with a `title` tooltip only; the premium lock hides rows 11+ with a paywall block that interrupts the trust story at the exact moment the user is evaluating. | Low | P1; P5 | `rankings/client.tsx:307-310`, `:321-332` | Use the shared "stale period" chip (text: "period 5 quarters behind market") and keep the premium note below the table, not as a competing card. |
| R7 | No path from a rank row into comparison, and no "what changed" signal on the leaderboard. | Medium | P2; strategy §5 Monitor pillar | `rankings/client.tsx:275-313` | Add row selection → "Compare selected"; add a small "changed vs prior period" column **only if** a prior-period value is derivable from the same response (it is not today — report as API-dependent, do not fake it). |

### 3.5 `/undervalued` — `src/app/undervalued/client.tsx`

| ID | Issue | Sev | Principle | file:line | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| U1 | **Page breaks the shell**: no `LayoutShell`, a custom header with only a "Dashboard" link, so global navigation disappears; the icon uses `text-violet-500`, outside the Graphite+Acid Lime palette and outside semantic tokens. | High | P3 institutional; §8 palette | `client.tsx:59-84`, `:91-102` (`:65`, `:95`) | Wrap in `LayoutShell`, delete the bespoke header, use `text-primary`/`text-warning` per token rules. Keep the page's identity in its title and criteria, not in a rogue header. |
| U2 | **"Undervalued opportunities / فرص مقومة بأقل من قيمتها"** plus "stocks detected / أسهم مكتشفة" and an "upside / أفق متوقع" column — reads as a price target and an opportunity call, which the disclaimer below contradicts. | Blocker (copy) | P4; §12.3 | `client.tsx:106-108`, `:167-172`; `dash.topUndervalued` key `i18n.tsx:300` | Reframe as a **valuation screen** ("فحص التقييم"): rows meet *stated* criteria; replace "upside" with "gap vs criteria-implied value" and add a persistent "not a price target" chip. Keep the fair-value arithmetic disclosure verbatim (it is good). |
| U3 | **Arabic UI leaks English sector names** in the filter dropdown and per row (`sectors` and `r.sector` are raw API strings). | High | §12.6 parity | `client.tsx:123-126`, `:163` | Use `SECTOR_AR`/`sectorLabel` like every other screen. |
| U4 | **Criteria are only visible after expanding**, and jargon codes (`PE_BELOW_SECTOR_0_85`) are translated but not explained ("below 85% of the sector median" — why 85%?). | Medium | P1; §6 explain at first use | `client.tsx:174-186`, `:22-36` | Show a criteria chip row collapsed ("3 of 5 criteria met"), keep details on expand, and add the threshold's meaning ("a 15% discount to the sector median P/E"). |
| U5 | **`lastUpdated` is a raw ISO slice** (`2026-11-09T20:27` → `2026-11-09 20:27`), not localized, no timezone/relative phrasing. | Low | §6 Arabic rules (numbers/dates) | `client.tsx:108` | Format with the active locale (`ar-EG`/`en-GB`), include the relative age ("قبل 3 ساعات") and the price as-of separately from the screen's last run. |
| U6 | **Tier naming drifts**: this page says "Pro" (`:206`) while the rest of the product says "Premium" (`TopHeader.tsx:470-482`, `rankings/client.tsx:325`). | Medium | P3; §10 plain premium copy | `client.tsx:206` | Standardize on "Premium" everywhere (report the copy-deck decision to the Lead if billing uses "Pro"). |
| U7 | No entry into comparison from a candidate row; whole-row expansion hides the primary research path ("View company" is two clicks in). | Medium | P2; §10 next step | `client.tsx:141-198` | Make ticker/name a link to the company page, keep the expand toggle for criteria, add "Compare with sector" → `/compare?ids=…` (needs 2 ids; offer "compare with the sector's largest peer" only if resolvable — otherwise omit rather than fake). |

### 3.6 `/sectors` + `/sectors/[sector]`

| ID | Issue | Sev | Principle | file:line | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| SE1 | **Median ROE is presented as a change.** `change` is literally `medianRoe` (`:84-89`) and is rendered with a `+` sign, an up/down arrow and "trending" colour in the map, the table and the "Top sector median ROE" panel. Live value Financial Services 19.48 → renders "+19.5%", which reads as a return/price change. Same variable drives `positive` colouring. | Blocker | P5; §7 (a level is not a change) | `sectors-shell.tsx:84-96`, `:178`, `:209-216`, `:257`, `:269-272`, `:314-316` | Rename and re-render as a **level**: "وسيط ROE 19.5%" with no sign/arrow, colour by sign only ("negative ROE" is a real state). If a change is wanted, use `dayChangePct` in a separate column explicitly labelled "1D price change". |
| SE2 | **The "size × ROE map" is ambiguous**: fixed 4-column grid, so "size" only changes cell `minHeight`; colour mixes sign (legend) with magnitude (`intensity = abs(roe)/30`, thresholds unexplained); a computed `bgColor` is dead code. | High | P1 clarity | `sectors-shell.tsx:148-226` (`:175-205`), legend `:158-172` | Either (a) a real treemap/area encoding with a stated rule, or (b) drop the map metaphor: a ranked table with a ROE bar and company count, and a legend that says exactly what shade means. Prefer (b) — less cognitive load, no arbitrary normalisation. |
| SE3 | **No period shown per sector** even though each aggregate carries `periodLabel`/`fiscalYear` (live: Education = "TTM ending Q4 2025" while others = FY 2025 — mixed inside one "pinned" year). | High | P5 | `sectors-shell.tsx:242-288` (no period column) | Add a "Period" column from `agg.periodLabel`; mark the mixed-basis sectors explicitly (same comparator-warning pattern as compare). |
| SE4 | **Totals render without a unit** ("Market Cap 873.65B", "Total Revenue 483.86B" — no EGP), via a local `formatEgp` duplicate. | Medium | §6 numbers rule | `sectors-shell.tsx:274-282`, `:340-346` | Use `formatEgp` from `@/lib/financial/units` with currency, and note "sum of reporting companies" (coverage, since not every company files). |
| SE5 | **"Top sector median ROE" ranks structurally different sectors** with no caveat (banks' leverage vs industrials). | Medium | P5 honest comparison | `sectors-shell.tsx:298-318` | Keep, but add one caveat line and link to the methodology; or fold it into the table's sort control instead of a separate "winners" panel. |
| SE6 | No path from a sector into comparison, and the sector context never says *what changed vs prior year* — the discovery story the brief asks for. | Medium | P2; strategy §5 | `sectors-shell.tsx:104-145` | Add per-sector "open in compare" (top 3 by market cap — resolvable from `/api/v1/companies?sector=`) and, where the data exists in the response, a prior-year delta column using the existing `?year=` pins (no fabrication if absent). |
| SD1 | **Sector detail title leaks the wrong language**: `h1` renders `"{sector} companies — {isAr ? ar : ar}"`, so the EN page always ends with the Arabic sector name. | High | §12.6; P1 | `sectors/[sector]/sector-shell.tsx:64-66` | EN: "{Sector} companies on the EGX". AR: "شركات قطاع {القطاع}". One language per render. |
| SD2 | **Both AR and EN paragraphs are rendered on every visit** (an EN paragraph then an AR paragraph with `dir="rtl"`), doubling the text wall and undermining "Arabic and English are equal citizens". | High | §12.6; P1 | `sectors/[sector]/sector-shell.tsx:63-76` | Render only the active language's paragraph (same content, honest provenance wording preserved). |
| SD3 | **Table headers are hard-coded English** ("Company / Ticker / Price / Revenue (FY) / Net profit (FY) / Period") in Arabic mode, and there is no EGP unit label on price/revenue/profit. | High | §12.6; §6 | `sectors/[sector]/sector-shell.tsx:94-100`, `:118-127`, `:10-17` | Localize headers, add "ج.م/EGP" units, follow the table conventions used on `/rankings`. |
| SD4 | **Mislabeled navigation**: "Compare companies across sectors / مقارنة الشركات عبر القطاعات" points to `/rankings`, which is a single-metric leaderboard, not a comparison. | Medium | P5; P1 | `sectors/[sector]/sector-shell.tsx:137-141` | Point it at `/compare` (prefilled with two companies from this sector) or relabel to "Rank companies in this sector" → `/rankings`. |
| SD5 | Sector detail has no summary context (count, median ROE, total market cap) and no "vs sector median" reference for each company — just a raw list. | Low | P2 | `sectors/[sector]/page.tsx:70-146`, `sector-shell.tsx:84-135` | Add a 3-tile summary (companies, median ROE with period, market cap) and, for ROE, a "sector median" row using `/api/v1/sectors`. |
| SD6 | `?year=` pins degrade silently to auto when the year is unavailable (`pin` null) with no explanation. | Low | P5 | `sectors/[sector]/page.tsx:97`; `period-select.tsx:22-28` | Show a one-line notice when the requested year couldn't be applied ("no filings for that year — showing latest"). |

### 3.7 `/dividends` (secondary, but in scope)

| ID | Issue | Sev | Principle | file:line | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| DV1 | **Filter chips and legend use raw enum values** (`ANNOUNCED`, `ELIGIBLE`, …) via `replaceAll("_"," ")`, untranslated in Arabic. | Medium | §12.6; P1 | `dividends-view.tsx:12`, `:108-119`, `:131-136`; `shared.tsx:62-86` | Add a status→{en,ar} map ("ANNOUNCED معلنة، UPCOMING قادمة، ELIGIBLE مستحقة، PAID مصروفة، EXPIRED منتهية، CANCELLED ملغاة") and use it in chips, legend and `StatusChip`. |
| DV2 | **Dates are always `en-GB`** (month grouping and `fmtDate`), so Arabic users see English month names. | Medium | §12.6 | `dividends-view.tsx:88`, `:268-273` | Localize with the active lang (`ar-EG`/`en-GB`). |
| DV3 | DPS is printed raw in the calendar (`:186`) but with "EGP / للسهم" in the list (`:232-235`) — inconsistent units. | Low | §6 numbers | `dividends-view.tsx:186`, `:232-235` | One formatting helper; keep the EGP label. |
| DV4 | Empty/first-run states are honest (good), but the "Next 12 months" grid has no "as of" and no per-event source/announcement date in the collapsed state. | Low | P5 | `dividends-view.tsx:122-195` | Add "as of" to the calendar header and show the announcement date in the cell tooltip. |

### 3.8 Global search — `src/components/layout/TopHeader.tsx`

| ID | Issue | Sev | Principle | file:line | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| H1 | **"Press Enter to select" is a false instruction**: there is no Enter handler, no arrow-key navigation, no `aria-activedescendant`; the input advertises `aria-autocomplete="list"` and controls a `role="listbox"` that ignores the keyboard. Results are `<Link role="option">` (invalid ARIA). | Blocker (capability claim + a11y) | §12.1; BRIEF §8 | `TopHeader.tsx:240-246`, `:260-277`, `:290-309` | Implement real combobox behaviour (arrow keys move a highlighted index, Enter opens, Escape closes, `aria-activedescendant`, `role="option"` on real options with `aria-selected`), or remove the hint and the listbox roles until it works. |
| H2 | **⌘K hint on Windows** (handler is Ctrl+K too). | Low | P1 | `TopHeader.tsx:165-169`, `:240` | Platform-aware hint ("Ctrl K" / "⌘ K") or "Ctrl/⌘ K". |
| H3 | **Search cannot find tools** (Screener, Compare, Rankings, Valuation screen) or metrics; `NAV_TABS` is a third copy of navigation (`AppSidebar.SECTIONS` and `MobileBottomNav.MOBILE_NAV` are the others). | Medium | P2; strategy §10 "reaches a company page in one action" | `TopHeader.tsx:33-41`, `:132-140`; duplicated in `AppSidebar.tsx:40-67`, `MobileBottomNav.tsx:8-14` | Single nav source of truth (export from one module), and index tool names + common terms ("P/E", "ROE", "مقارنة") as jump results. |
| H4 | Search results show ticker/name/sector but no price/period, so the "right" company among similarly named entities is hard to confirm. | Low | P1 | `TopHeader.tsx:290-309` | Add the latest price + "as of" (the companies endpoint already returns it) — one line, strong trust signal. |

### 3.9 Cross-cutting / IA

| ID | Issue | Sev | Principle | file:line | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| X1 | **"Error as empty" is a platform-wide anti-pattern** in this scope: compare, companies, rankings, sectors, dashboard render a failed request as "no data". | High | P5; §12.4 | `compare/client.tsx:124`, `companies/client.tsx:109`, `rankings/client.tsx:81`, `sectors/sectors-shell.tsx:64`, `dashboard-view.tsx:104-121` | Adopt one query helper/state component: `loading → error(retry) → empty(why) → data`. Presentation-layer; do not change fetch contracts. |
| X2 | **Discovery is orphaned from navigation.** `AppSidebar.SECTIONS` has no Screener, Rankings or Valuation-screen entries; the mobile bottom nav has no Compare. Three of the strongest research surfaces are reachable only from the homepage or a dashboard button. | High | P2; strategy §9 ("Research: Companies · Compare · Screener · Sectors") | `AppSidebar.tsx:40-67`; `MobileBottomNav.tsx:8-14`; `TopHeader.tsx:33-41` | Report to Lead (layout owner): add "Screener" under Research, and surface Rankings/Valuation inside Sectors/Companies as cross-links; ensure Compare is in the mobile bottom nav or drawer top. |
| X3 | **Freshness vocabulary is inconsistent**: real `delayMinutes` (companies), hardcoded "15-min delayed" (dashboard/sidebar), `marketAsOf` strings, none on compare/rankings/screener. | High | P5; §7 "show, don't claim" | see D6, C13, SE3; `companies/client.tsx:132-138` (correct pattern) | One `<DataFreshness>` component (`pricesAsOf`, `delayMinutes`, `financialsAsOf`, `periodLabel`) used everywhere; a single source means the claim can never drift from the feed. |
| X4 | **Semantic colours are hardcoded** (`emerald`, `blue`, `violet`, `amber`, `slate`, `teal`) alongside `--positive/--negative/--warning/--info`; compare uses blue specifically to mean "lower is better", which is not a semantic meaning. | Medium | §8 "semantic financial colours are independent of the brand" | `compare/client.tsx:299-300`; `undervalued/client.tsx:65,95,168`; `shared.tsx:49-51`; `sectors-shell.tsx:180-203` | Replace with tokens (Lead is defining them in `globals.css`); "stronger figure" gets the brand accent, not a market colour. |
| X5 | **"Best/worst" moralising on absolute metrics** recurs (compare rows, rankings crowns, dashboard "opportunities"). | High (systemic copy) | P4; §6 ban list | C1, R3, D4 | Adopt one house rule: *rank ratios, describe levels, never crown size*. Encode it in the shared row/metric components so it cannot regress. |
| X6 | **No shared component layer yet** for these screens: 4 different implementations of "metric cell", 3 of "empty state", 3 of "freshness line", 2 of "company row". This is why defects repeat. | Medium (enabler) | P3 institutional consistency | `companies/client.tsx`, `companies-view.tsx`, `rankings/client.tsx`, `scanners-view.tsx`, `undervalued/client.tsx` | After the Lead publishes `src/components/brand/*`, contribute: `MetricCell`, `CompanyRow`, `EvidencePanel` (from `WhyMatchedPanel`), `DataFreshness`, `CompareRow`, `EmptyState`. Keep them presentational. |

**Issue count:** 14 compare · 9 companies · 22 dashboard/screener · 7 rankings · 7 valuation · 12 sectors/sector-detail · 4 dividends · 4 search · 6 cross-cutting = **85 findings** (16 Blocker, 28 High, 27 Medium, 14 Low).

---

## 4. Recommended hierarchy & flow

### 4.1 `/compare` — "the honest comparison bench"

The page should read as an instrument, not a scoreboard. Order of decisions the user makes:
*who → on what period → what differs → is it comparable → next step.*

```
┌ Header ───────────────────────────────────────────────────────────────┐
│ Compare companies · one line: same period, same ratios, stated gaps   │
│ [Period basis: Auto | Fiscal year ▾]  [Copy link]  [Compare ▸]       │
├ Comparability banner (only when needed) ──────────────────────────────┤
│ ⚠ Periods not aligned — comparison is indicative.  [Align to FY 2025]│
│ ⓘ Mixed sectors — banks vs industrials differ structurally.          │
├ Selection strip ──────────────────────────────────────────────────────┤
│ [COMI × Commercial International Bank · Banks] [ADIB × …] [+ Add]     │
│ "Pick at least two. Same-sector pairs are the fairest start."        │
├ "Where they differ most" (3 rows, relative gap) ─────────────────────┤
│ margin · ROE · P/E → jump links                                       │
├ Comparison table, grouped ───────────────────────────────────────────┤
│ PROFITABILITY & RETURNS   (higher better, ratios)                     │
│   net margin  ◆ 57.1%  |  53.1%  |  26.6%      [why?]                 │
│   ROE           8.2%   |   8.9%  |  12.6%      ← quarterly basis!     │
│ VALUATION & LEVERAGE      (lower better only when positive)           │
│   P/E          23.7×   |  18.6×  |  25.2×      [why?]                 │
│ SCALE & BALANCE SHEET     (size — not a quality judgement)            │
│   Revenue      EGP 31.2B | 7.3B | 14.0B   Δ vs COMI −77% / −55%       │
├ Provenance strip ─────────────────────────────────────────────────────┤
│ Each value: calculated from the published filing · period per column  │
│ · financial data as of … · prices delayed 15 min · not investment advice│
└───────────────────────────────────────────────────────────────────────┘
```

Rules:
1. The period control is **always visible** and explained, and the aligned mode is the recommended default for a first-time user ("Auto is faster; a pinned year is fairer").
2. **No mark of superiority** unless (a) every column shares the same `periodLabel`, (b) the metric is a ratio with a valid direction, (c) the value is not a degenerate negative, and (d) direction is stated in the row. Otherwise the row is descriptive.
3. Scale metrics show a **delta vs the first column**, not a winner.
4. Every mark has a text/icon equivalent (accessibility) and a glossary tooltip on the metric name.
5. Column headers link to the canonical `/company/<ticker>` and carry period + sector.
6. Empty/insufficient states do three things: say what is missing, offer the specific next action (align period / change companies / open a company page), and never disguise a server error as "no data".

### 4.2 Screener (`/dashboard#/scanners`, surface name "Screener / الفلتر")

The screener must answer, in this order: *what does this screen test → which companies matched → why → what do I do next.*

```
┌ Header ───────────────────────────────────────────────────────────────┐
│ Screener · "فلتر بمعنى — ونتيجة بتفسير"                              │
│ Basis: [Latest annual ▾]  ℹ what the basis does to each metric        │
├ Left rail (presets) ─────────┬ Right pane (results) ──────────────────┤
│ Financial Turnaround         │ 12 matched · 211 of 253 evaluated      │
│  loss → profit, same period  │ basis FY 2025 · ran 2 h ago            │
│  ran 2h ago · 12 matches     │ ┌ COMI · Commercial Intl Bank · Banks ┐│
│ Strong Profitability (ROE≥15)│ │ ROE 23.4% · FY 2025     [Why?] ▸   ││
│  tests: return on equity…    │ │ → Open company · + Compare · ★     ││
│  misses: one-off gains…      │ └────────────────────────────────────┘│
│ Debt Reduction ≥5%           │ ┌ ABUK …                              ││
│ Below Book Value (P/B≤0.7)   │ │ P/B 0.61 · TTM                     ││
│ …                            │ │ coverage note: 42 lacked the metric ││
│ [Custom screener →]          │ └────────────────────────────────────┘│
│                              │ Empty: "No company met this on FY2025. │
│                              │  Try TTM · loosen threshold · see      │
│                              │  which companies lacked data →"        │
├ Run history (collapsed) ─────┴────────────────────────────────────────┤
│ last runs with basis + coverage, click to restore that result        │
└───────────────────────────────────────────────────────────────────────┘
```

Rules:
1. A preset is a **question with a stated meaning and limit**, never a slogan. Each shows: what it tests (one sentence), what it can miss (one clause), threshold rationale on demand.
2. Results are **company rows**, never just counts. Each row: identity, sector, the triggering metric + value, evaluated period, coverage, and actions (Open company / Add to compare / Star / Why matched).
3. **Coverage is first-class**: "211 of 253 companies had the data to be assessed — 42 lacked the metric". This is the honest denominator and a brand differentiator; the API already returns enough to compute it.
4. The custom builder keeps its AND logic, gains a **sector select** (taxonomy), unit labels, per-condition help, and shares the exact same result row/evidence panel.
5. Screens are shareable: `?preset=`, `?basis=`, and (custom) the serialized conditions, with a readable copy-link.
6. Custom rules remain saved/run exactly as today — no logic, API or engine changes.

### 4.3 `/companies` — directory that feeds research

```
Search · Sector ▾ · Sort (A–Z | market cap) · [Export CSV]   [☐ Compare mode]
Freshness bar: Prices as of … · delayed 15 min · financials from published filings
Grid of cards:
  TICKER · Name · Sector                 Price · Δ%  · as of
  Revenue EGP xx (FY 2025) · Net profit (FY 2025) · ROE xx% (FY 2025)
  coverage: 52 filings · 9 events · no dividends        [☆] [+ Compare] [Open →]
```
Rules: every figure carries its period; coverage visible; card is keyboard-operable; compare mode builds a 2–4 selection and hands off to `/compare?ids=`.

### 4.4 `/rankings` — "leaderboard with a direction"

```
Rank companies by [ROE ▾ (higher better)] · [Basis: latest | TTM | latest annual] · [Year ▾]
"Rank is a sort of one figure — not an overall judgement." 
Table: # | Company | Sector | Metric (direction stated) | Sector median | Period (stale chip)
Row select → [Compare selected]
Footer (computed copy): source = published filings · basis = … · calculated values · as of …
```

### 4.5 `/undervalued` → "Valuation screen / فحص التقييم"

```
LayoutShell (global nav restored)
Title: Valuation screen — companies meeting stated criteria
Sub: "المعايير معروضة لكل شركة. الفجوة ليست سعراً مستهدفاً ولا توصية."
Filters: Sector ▾ (localized) · Minimum gap % · Reset
Row: # | TICKER Name · sector · price (as of) · FY | criteria chips (3/5) | Gap % → expand
Expanded: fair value method · criteria list with thresholds explained · review flag
Actions: Open company · Compare with a peer
Tier note: Premium (consistent naming)
```

### 4.6 `/sectors` and `/sectors/[sector]`

- `/sectors`: table-first (Sector · Companies · Median ROE *level* with period · Market cap EGP · Revenue EGP · Net profit EGP), colour = ROE sign only, one legend sentence. The "map" either becomes a real, labelled area encoding or is dropped. Add "What changed vs prior year" only where the pinned-year data supports it. Sector rows link to the sector page and to "compare its largest companies".
- `/sectors/[sector]`: localized title/headers/units, one language at a time, summary tiles (companies · median ROE + period · market cap), a "sector median" reference column for ROE, per-company price with its date, and a working "Compare companies in this sector" action.

### 4.7 Global search & IA (report to Lead where layout-owned)

- Nav: Research = Companies · **Compare** · **Screener** · Sectors; Monitor = Watchlist · Portfolio · Dividends; Plans = Premium. So the screener needs a real nav entry and `/dashboard` stops being the only door.
- Search: real combobox semantics, tool/metric entries, one nav source of truth (currently three copies).
- Mobile: Compare and Screener must be one tap away (bottom nav or drawer top), not buried.

---

## 5. Copy changes (EN + AR, before → after)

Arabic follows strategy §6: Egyptian financial register in narrative copy, neutral MSA inside tables, no marketing adjectives, no exclamation marks.

| # | Where | Before (EN) | After (EN) | Before (AR) | After (AR) |
| --- | --- | --- | --- | --- | --- |
| C-CMP-1 | compare header `client.tsx:194-201` | "Compare up to 4 companies on each one's latest annual statements — the URL updates for sharing." | "Compare up to four companies side by side. Pin one fiscal year for a like-for-like reading, or leave it on auto to see each company's latest period." | "قارن حتى 4 شركات على أحدث قوائم سنوية متاحة لكل شركة — الرابط يتحدث تلقائيًا للمشاركة." | "قارن حتى أربع شركات جنبًا إلى جنب. ثبّت سنة مالية واحدة لمقارنة متكافئة، أو اتركها تلقائيًا لتظهر أحدث فترة لكل شركة." |
| C-CMP-2 | mixed-basis note `client.tsx:263-269` | "Note: companies are compared on different periods — each column shows its exact basis (FY / 9M / H1 / quarter)." | "Periods not aligned — comparison is indicative. Each column states its basis (FY, 9M, H1 or quarter). Stronger-figure marks are hidden until all columns share one period." | "ملاحظة: الشركات مقارنة على فترات مختلفة — كل عمود يعرض الفترة الموضحة تحته (سنوي / 9 أشهر / نصف سنوي / ربع سنوي)." | "الفترات غير متطابقة — المقارنة إرشادية. كل عمود يوضح أساسه (سنوي، 9 أشهر، نصف سنوي، ربع). تُخفى علامات «القيمة الأقوى» حتى تتوحد الفترة في كل الأعمدة." |
| C-CMP-3 | legend `client.tsx:337-340` | "Green = best in row — every value from each company's latest verified annual filing" | "◆ marks the stronger figure — only for ratios with a clear direction. Scale figures (revenue, assets) are shown for size, not ranked." | "الأخضر = الأفضل في الصف — كل قيمة من أحدث قوائم سنوية متحقق منها لكل شركة" | "علامة ◆ تشير إلى القيمة الأقوى — للمؤشرات النسبية ذات الاتجاه الواضح فقط. أرقام الحجم (الإيرادات، الأصول) معروضة للمقارنة بالحجم وليست ترتيبًا." |
| C-CMP-4 | insufficient data `client.tsx:317-320` | "Not enough data for these companies" | "These companies have no shared period with enough verified values. Try Auto, or pin a fiscal year above — each column shows what it has." | "لا توجد بيانات كافية لهذه الشركات" | "لا تتوفر فترة مشتركة بقيم موثقة كافية لهذه الشركات. جرّب «تلقائي» أو ثبّت سنة مالية — وكل عمود يوضح ما هو متاح له." |
| C-CMP-5 | empty state `client.tsx:325` | "Pick at least two companies from the search above" | "Pick at least two companies to compare. Two from the same sector give the fairest first reading." | "اختر شركتين على الأقل من البحث فوق" | "اختر شركتين على الأقل للمقارنة. شركتان من القطاع نفسه تعطيان أدق قراءة أولى." |
| C-CMP-6 | scale-row direction label (new) | — | "Size — not a quality judgement" | — | "الحجم — ليس حكمًا على الجودة" |
| CO-1 | companies sub-header `client.tsx:166-173` | "…253 companies listed on the Egyptian Exchange — search, filter by sector, and open any company for the full breakdown." | "253 companies listed on the Egyptian Exchange — search, filter by sector, and open any company. Each figure is labelled with the period it comes from." | "…شركة مدرجة في البورصة المصرية — ابحث، فلتر بالقطاع، وادخل صفحة أي شركة للتفاصيل الكاملة." | "٢٥٣ شركة مدرجة في البورصة المصرية — ابحث، فلتر بالقطاع، وادخل صفحة أي شركة. كل رقم موضح بالفترة التي يخصها." |
| CO-2 | duplicate directory sub-header `companies-view.tsx:71-73` | "Financial directory of EGX-listed companies with advanced sorting and filtering" | "EGX company directory — search, filter by sector, sort A–Z or by market cap." | "دليل مالي للشركات المدرجة في البورصة المصرية مع جدولة وفرز متقدم" | "دليل شركات البورصة المصرية — ابحث، فلتر بالقطاع، ورتّب أبجديًا أو بالقيمة السوقية." |
| CO-3 | freshness bar (new) | — | "Prices as of … · delayed 15 min · financial figures from published filings" | — | "الأسعار بتاريخ … · متأخرة 15 دقيقة · الأرقام المالية من الإفصاحات المنشورة" |
| D-1 | dashboard sub-header `dashboard-view.tsx:185-189` | "Every figure from verified filings — screen opportunities, follow sectors and valuations." | "Market prices are delayed 15 minutes. Financial figures come from published filings — unavailable values show «—»." | "كل رقم من إفصاحات موثقة — اكتشف الفرص بالماسحات أو تابع القطاعات والقيم." | "أسعار السوق متأخرة 15 دقيقة، والأرقام المالية من الإفصاحات المنشورة — والقيم غير المتاحة تظهر «—»." |
| D-2 | valuation panel `dashboard-view.tsx:752,757,777,783` | "Opportunities Under Radar" / "Companies meeting valuation criteria — tap for details" / "Explore Now" / "Discover promising companies through advanced analysis tools and custom scanners." | "Valuation screen — latest candidates" / "Companies whose figures met the stated valuation criteria. Method and criteria are shown on the screen — not a recommendation." / "Open valuation screen" / (remove the empty-state promise; show the criteria list link) | "فرص تحت الرادار" / "شركات تفي بمعايير التقييم — اضغط للتفاصيل" / "استكشف الآن" / "اكتشف شركات واعدة من خلال أدوات التحليل المتقدمة والماسحات المخصصة." | "فحص التقييم — أحدث النتائج" / "شركات تحققت فيها معايير التقييم المعلنة. المعايير والطريقة معروضة في الصفحة — وليست توصية." / "افتح فحص التقييم" / "المعايير المستخدمة معروضة بالكامل في صفحة فحص التقييم." |
| D-3 | stat tiles `dashboard-view.tsx:222-232` | "Financial data points" / "from published filings" | "Prices available" / "of listed companies with a recorded price today" (uses `breadth.pricedCount`) | "نقاط بيانات مالية" / "من القوائم المنشورة" | "أسعار متاحة" / "من الشركات المدرجة لديها سعر مسجل اليوم" |
| D-4 | events locked `dashboard-view.tsx:648-651` | "Events available for Premium subscribers only" + dead "Upgrade" | "Financial events are part of Premium. See what Premium covers." + working link | "الأحداث متاحة لمشتركي بريميوم فقط" | "الأحداث المالية ضمن خطة بريميوم. اعرف ما تشمله الخطة." |
| SC-1 | basis labels `i18n.tsx:62-64` | "Latest annual (FY vs FY)" / "Latest quarter (YoY)" / "Trailing 12 months (TTM)" | "Latest annual statements" / "Latest quarter" / "Trailing twelve months" + helper: "A quarter's ROE, margin or P/E is not annualised unless stated; TTM is the fairer like-for-like basis for these ratios." | "أحدث سنة مالية" / "أحدث ربع سنوي" / "آخر 12 شهراً (متداول)" | "أحدث قوائم سنوية" / "أحدث ربع سنوي" / "آخر 12 شهرًا" + "ROE والهامش ومضاعف الربحية في الربع الواحد ليست سنوية ما لم يُذكر ذلك؛ وفترة الـ 12 شهرًا هي الأساس الأقرب للتكافؤ." |
| SC-2 | results header `scanners-view.tsx:258-264` | "{matched} / {total} Matching companies" | "{matched} matched · {evaluated} of {total} companies had the data to be assessed" | "{matched} / {total} الشركات المطابقة" | "{matched} مطابقة · توفّرت البيانات لتقييم {evaluated} من {total} شركة" |
| SC-3 | empty result `scanners-view.tsx:266-270` | "No matching companies for this period." | "No company met this condition on this basis. Try trailing twelve months, or see which companies lacked the data." | "لا شركات مطابقة في هذه الفترة." | "لا توجد شركة حققت هذا الشرط على هذا الأساس. جرّب فترة 12 شهرًا، أو اعرف الشركات التي تفتقد البيانات." |
| SC-4 | builder heading `scanners-view.tsx:616` | "Conditions (AND)" (renders "ConditionS") | "All of these must be true" | "شروط (AND)" (renders "شروطs") | "يجب تحقق كل هذه الشروط" |
| SC-5 | preset sub-line (new) | — | "Tests: … · Can miss: …" | — | "يختبر: … · قد يغفل: …" |
| SC-6 | custom-empty / threshold errors `scanners-view.tsx:516,806` | "min must be ≤ max" shown beside Arabic | "Minimum must be less than or equal to maximum." | "الحد الأدنى يجب أن يكون ≤ الحد الأعلى / min must be ≤ max" | "الحد الأدنى يجب أن يكون أصغر من أو يساوي الحد الأعلى." |
| R-1 | rankings footer `rankings/client.tsx:334-336` | "All values from verified annual filings — each company's latest year" | Dynamic: "Values calculated from published filings · basis: {Latest available \| TTM \| latest annual} · {shared fiscal year YYYY if pinned}" | "كل القيم من قوائم سنوية متحقق منها — أحدث سنة لكل شركة" | "قيم محسوبة من الإفصاحات المنشورة · الأساس: {أحدث بيانات متاحة \| 12 شهرًا \| أحدث سنة سنوية} · {سنة مالية مشتركة عند التثبيت}" |
| R-2 | rankings header `rankings/client.tsx:140-160` | "Company Rankings" | "Rank companies by one metric" + line "Rank position is a sort of one figure, not an overall judgement." | "ترتيب الشركات" | "ترتيب الشركات حسب مؤشر واحد" + "الترتيب هو فرز لقيمة مؤشر واحد، وليس حكمًا عامًا على الشركة." |
| R-3 | metric direction (new) | — | "Higher is better" / "Lower is better" / "Higher = larger; not a quality signal" | — | "الأعلى أفضل" / "الأقل أفضل" / "الأعلى يعني حجمًا أكبر — ليس إشارة جودة" |
| U-1 | undervalued title `client.tsx:106` + header `:96` | "Undervalued opportunities" / "Undervalued" | "Valuation screen — criteria met" / "Valuation screen" | "الفرص المقومة بأقل من قيمتها" / "فرص التقييم" | "فحص التقييم — المعايير المتحققة" / "فحص التقييم" |
| U-2 | detected line `client.tsx:108` | "{n} stocks detected — last updated …" | "{n} companies currently meet at least one stated criterion · last run …" | "{n} سهم مكتشف — آخر تحديث …" | "{n} شركة تحقق حاليًا معيارًا معلنًا على الأقل · آخر تشغيل …" |
| U-3 | upside column `client.tsx:167-172`, filter `:127` | "upside" / "Min upside %" | "gap vs criteria-implied value" / "Minimum gap %" | "أفق متوقع" / "أقل عائد %" | "الفجوة مقابل القيمة المستنتجة من المعايير" / "أقل فجوة %" |
| U-4 | fair-value note `client.tsx:110-114` (keep meaning, tighten) | "Fair value is arithmetic from the stated criteria — not a price target or investment advice…" | "Fair value is arithmetic from the stated criteria — not a price target, not a recommendation. Rows marked «review» show an extreme gap that needs a unit or period check." | "القيمة العادلة نتيجة حسابية من المعايير المذكورة، وليست سعراً مستهدفاً أو نصيحة استثمارية…" | "القيمة العادلة نتيجة حسابية من المعايير المعلنة — ليست سعرًا مستهدفًا وليست توصية. الصفوف الموسومة «مراجعة» تعرض فجوة متطرفة تحتاج التحقق من وحدة أو فترة البيانات." |
| U-5 | tier note `client.tsx:206` | "{n} more opportunities on Pro" | "{n} more results with Premium" | "{n} فرصة إضافية متاحة لمشتركي Pro" | "{n} نتيجة إضافية مع بريميوم" |
| SE-1 | sectors map title/legend `sectors-shell.tsx:153,162-170` | "Sector map by size and median ROE" / "Positive ROE" / "Negative ROE" / "No data" | "Sectors by median ROE" / "Positive return on equity" / "Negative return on equity" / "No published figures" + "Shade shows the level of median ROE — it is not a price change. Cell size reflects company count." | "خريطة القطاعات حسب الحجم ووسيط ROE" / "ROE إيجابي" / "ROE سلبي" / "لا توجد بيانات" | "القطاعات حسب وسيط العائد على حقوق الملكية" / "عائد على حقوق الملكية موجب" / "عائد على حقوق الملكية سالب" / "لا توجد قوائم منشورة" + "تدرّج اللون يعبّر عن مستوى الوسيط — وليس تغيرًا في السعر. حجم الخلية يعبّر عن عدد الشركات." |
| SE-2 | sectors table header `sectors-shell.tsx:249` | "Median ROE" with signed value "+19.5%" | "Median ROE (FY 2025)" with unsigned value "19.5%" | "وسيط ROE" مع "+19.5%" | "وسيط ROE (سنة 2025)" بالقيمة "19.5%" |
| SE-3 | sectors totals columns `sectors-shell.tsx:250-252` | "Market Cap" / "Total Revenue" / "Total Net Profit" | "Market cap (EGP)" / "Revenue (EGP, reporting companies)" / "Net profit (EGP, reporting companies)" | "القيمة السوقية" / "إجمالي الإيرادات" / "إجمالي صافي الربح" | "القيمة السوقية (ج.م)" / "الإيرادات (ج.م، للشركات المفصحة)" / "صافي الربح (ج.م، للشركات المفصحة)" |
| SD-1 | sector detail title `sector-shell.tsx:64-66` | "{Sector} companies — {Arabic name}" in both languages | EN: "{Sector} companies on the EGX" · AR: "شركات قطاع {القطاع}" | "{Sector} companies — {اسم عربي}" | "شركات قطاع {القطاع} في البورصة المصرية" |
| SD-2 | sector detail table headers `sector-shell.tsx:95-100` | Hard-coded "Company / Ticker / Price / Revenue (FY) / Net profit (FY) / Period" | Localized in the active language, with EGP units | — | "الشركة / الرمز / السعر (ج.م) / الإيرادات (سنوي، ج.م) / صافي الربح (سنوي، ج.م) / الفترة" |
| SD-3 | sector detail link `sector-shell.tsx:140` | "Compare companies across sectors" → `/rankings` | "Compare two companies from this sector" → `/compare` | "مقارنة الشركات عبر القطاعات" → `/rankings` | "قارن شركتين من هذا القطاع" → `/compare` |
| DV-1 | dividend statuses `dividends-view.tsx:116,131-136` | Raw "ANNOUNCED / ELIGIBLE / PAID / CANCELLED" | "Announced / Eligible / Paid / Cancelled" (localized labels, not enum codes) | (raw English) | "معلنة / مستحقة / مصروفة / ملغاة" |
| H-1 | search hint `TopHeader.tsx:274-276` | "Press Enter to select" | "Use ↑ ↓ then Enter" (only once implemented) — otherwise remove | "اضغط Enter للاختيار" | "استخدم ↑ ↓ ثم Enter" (بعد التنفيذ) أو تُحذف |
| X-1 | shared trust line (use `BRAND.trustLine*` from `src/lib/brand.ts`) | fragmented in 6 places | "Data from published filings · unavailable values show «—» · prices delayed 15 min · not investment advice" | fragmented | "بيانات من الإفصاحات المنشورة · القيم غير المتاحة تظهر «—» · أسعار متأخرة 15 دقيقة · ليست نصيحة استثمارية" |

Dictionary keys needing Lead changes (I must not edit `i18n.tsx`): `sc.basisQuarterly` (EN/AR parity), `dash.validatedValues` ("Financial data points"), `dash.topUndervalued`, `dash.title` (EN "Meza" vs AR "ماسح البيانات المالية للبورصة المصرية" — inconsistent meaning), `common.demoData` ("UNVERIFIED"), `ft.demoNotice` (hardcoded 15-min). Until then I will use inline `ar ? … : …` per BRIEF §Execution model.

---

## 6. Prioritized implementation plan (presentation layer only)

**Constraints honoured:** no edits to `src/lib/financial/**`, `src/lib/technical/**`, `src/lib/ai/**`, Prisma schema, API routes, or auth/routing logic. No new dependencies. No fabricated data. `/api/v1/*` contracts untouched (only existing query params and payload fields are consumed). `i18n.tsx` untouched (inline copy; key requests go to the Lead). New shared components are presentational and live under `src/components/brand/*` once the Lead publishes the foundation.

### Phase 0 — foundation status (verified in the working tree during this audit)

The Lead's foundation is landing in parallel. At audit time the following existed and **must be
reused rather than re-implemented** (they are untracked/WIP — I will re-read before editing):

| Shared piece | Covers which findings |
| --- | --- |
| `src/components/brand/data-trust.tsx` → `DataStateBadge`, `SourceLine`, `FreshnessBadge`, `UnavailableValue`, `UnavailableNote`, `CalculationNote` | C13 (compare provenance strip), CO1/CO3 (period + freshness per figure), D6/X3 (one freshness vocabulary), SE3 (period column), U5 (localized as-of) |
| `src/components/brand/metric-tip.tsx` → `MetricTip` (+ `METRIC_GLOSSARY` in `src/lib/brand.ts`) | C4 (direction + explanation per row), S3/S11 (screener thresholds), R3 (metric context) |
| `src/components/brand/empty-state.tsx` → `EmptyState` | C9, CO9, S6, R7 (why-empty + next action) |
| `src/components/brand/section-heading.tsx` → `SectionHeading`, `Stat` | page hierarchy for compare/screener/sectors; D7 stat tiles |
| `src/components/brand/company-search.tsx` → `CompanySearch` | keyboard/listbox pattern for H1; selection UX for C10/C11 and CO5 (adapt, do not fork the a11y) |
| `globals.css` tokens (`--positive`, `--negative`, `--success`, `--warning`, `--info`, `--brand-lime`, `--brand-ink`, `--primary` split light/dark) | X4 (remove hardcoded emerald/blue/violet), U1 (undervalued palette) |

**Still missing (I will build, presentational, in my scope):** `MetricCell` (value + period +
direction + evidence marker), `CompanyRow` (used by screener results and compare picker),
`EvidencePanel` (generalization of `WhyMatchedPanel` from `egx/shared.tsx`), `CopyLinkButton`
(compare/rankings share state). If the Lead prefers these under `src/components/brand/*`, I'll add
them there and announce the API before use.

**Two decisions needed from the Lead:** (a) can `/compare` become indexable, (b) "Premium" is the
only tier name in UI copy. **One extension request:** `FreshnessBadge` currently takes only `asOf`;
C13/D6 need a market variant (`delayMinutes`) beside a financial variant — extend its props
(`kind?: "prices" | "financials"`, `delayMinutes?: number | null`) rather than forking it.

### Phase 1 — truth fixes (highest brand risk, low effort, no design dependency)
| # | Work | Files | Effort | Risk | Validation |
| --- | --- | --- | --- | --- | --- |
| 1.1 | Screener presets render the real matched companies (`ResultRow`, Why-matched, actions) and show coverage | `scanners-view.tsx` | M | Low — no API change; `output.results` already returned | manual: 10 presets × 3 bases; empty case; AR/EN |
| 1.2 | Comparison validity: remove scale metrics from "best", qualify negative P/E & P/B, suppress marks on mixed bases, add comparability banner | `compare/client.tsx` | M | Low — client-only | live: COMI/ADIB/ABUK (mixed), pinned FY, 2 banks, 4 companies |
| 1.3 | Rankings direction fix (`order=asc` for lower-better metrics) + honest footer claim + direction labels | `rankings/client.tsx` | S | Low — existing API param | live P/E, P/B, liabilities/equity, ROE; pin year; TTM |
| 1.4 | Kill fabricated capabilities: fake ask bar, dead Upgrade button, `changePct ?? 0` zero | `dashboard-view.tsx` | S | Low | visual + keyboard; watchlist with no price |
| 1.5 | Undervalued reframe + shell/layout + palette token + tier naming | `undervalued/client.tsx` | M | Low | AR/EN, free/premium, expand states |
| 1.6 | Sectors: stop presenting median ROE as a change; period column; EGP units; localized sector-detail headers/title/single-language copy | `sectors-shell.tsx`, `sector-shell.tsx` | M | Low | AR/EN, pinned/auto year, no-data sector |
| 1.7 | Companies cards: period per figure, coverage line, per-card freshness, keyboard-operable card; error≠empty | `companies/client.tsx` | M | Low | AR/EN, empty, error (offline), suspended company |
| 1.8 | Dividends: localized statuses and dates | `dividends-view.tsx`, `shared.tsx` (StatusChip) | S | Low | AR/EN |
| 1.9 | Global search: remove false "Press Enter" claim or implement real combobox; ⌘K platform hint | `TopHeader.tsx` | S/M | Low | keyboard-only run; screen reader labels |

### Phase 2 — instrument quality (with shared components)
| # | Work | Files | Effort |
| --- | --- | --- | --- |
| 2.1 | Compare: grouped metric blocks, "Where they differ most", deltas for scale metrics, glossary tooltips, provenance strip, canonical column links, copy-link + `?tickers=` | `compare/client.tsx` | L |
| 2.2 | Screener: preset "tests / can miss" copy (AR via presetKey map), basis explainer + coverage, sector `Select` in builder, shareable `?preset=&basis=`, result sorting/actions | `scanners-view.tsx` | L |
| 2.3 | Rankings: sector-median column (existing endpoint), URL state + copy link, neutral rank styling, compare selection | `rankings/client.tsx` | M/L |
| 2.4 | Companies + compare selection mode handoff (`/compare?ids=`), shared `CompanyRow` | `companies/client.tsx` | M |
| 2.5 | Sectors: table-first hierarchy, real/removed map encoding, "compare sector companies" action, sector-detail summary tiles + sector-median reference | `sectors-shell.tsx`, `sector-shell.tsx` | M/L |
| 2.6 | Shared `DataFreshness` sweep across compare/rankings/screener/companies/sectors (replaces hardcoded 15-min claims) | cross-cutting | M |

### Phase 3 — consolidation & verification
| # | Work | Files | Effort |
| --- | --- | --- | --- |
| 3.1 | Retire duplicate directory: `/dashboard#/companies` → `/companies`, `#/dividends` → `/dividends` (documented, no feature loss) | `dashboard/client.tsx` | S |
| 3.2 | Screener entry in navigation (report to Lead if layout is not yet frozen; otherwise apply in `AppSidebar`/`MobileBottomNav` only with Lead approval) | `AppSidebar.tsx`, `MobileBottomNav.tsx`, `TopHeader.tsx` | S/M |
| 3.3 | Empty/loading/error sweep with one shared component; remove dead code (`IndexCard`, unused props, `bgColor`) | cross-cutting | M |
| 3.4 | Accessibility pass: sortable headers (aria-sort, keyboard), status conveyed by text+icon not colour, focus rings, table scopes, RTL check of logical properties | cross-cutting | M |
| 3.5 | Validation: `npx tsc --noEmit`; `npx eslint <changed>`; `npx vitest run` (baseline 185 passed / 4 pre-existing auth-env failures); `npm run build` (Lead); visual desktop+mobile, AR RTL + EN LTR, light+dark, tables/charts, empty/error/loading | all | M |

**Sequencing rationale:** Phase 1 removes statements the product cannot support (brand risk is asymmetric: one false claim costs more than ten missing features). Phase 2 makes the two flagship experiences instruments. Phase 3 removes duplication so the same defects cannot return.

**Out of scope — reported, not fixed (needs engine/API/Lead decisions):**
- Mixed-period bases in the "Auto" compare basis and in rankings `latest` come from the API's basis-selection rules (`compare/route.ts:129-149`, `rankings/route.ts:95-137`). I can only qualify/suppress the UI marks; making Auto default to a shared period requires an API-policy change.
- Market ratios ranked on non-full periods (P/E from H1/Q1 EPS) — `fullPeriodCodes` excludes `p_e`/`p_b`. Live values like AMER P/E 971 need a correctness review by the calc-engine owner; the UI can label the basis but must not silently "fix" the number.
- Sector aggregate means (`avgNetMargin` 250%, −602%) are noisy; the UI correctly uses medians — no change requested.
- `/compare` indexability and tier naming ("Premium" vs "Pro") are Lead/SEO decisions.
- Navigation changes are layout-owned (Lead).

---

## 7. Open questions for the Lead

1. **`/compare` indexability**: comparison is a differentiator, but the page is `noindex` with an English-only title. Make it a crawlable tool landing (static explanation + interactive bench) or keep it app-only?
2. **Tier name**: UI currently mixes "Premium" and "Pro". Which is canonical for copy?
3. **Auto vs aligned basis**: should the first-run default for compare/rankings be "aligned to the latest shared fiscal year" (fairer, sometimes fewer companies) or "auto latest" (fuller, mixed periods)? This is a product-policy decision; the UI can recommend one with one sentence.
4. **Duplicate surfaces**: is it acceptable to redirect `/dashboard#/companies` and `/dashboard#/dividends` to the canonical routes (documented as consolidation), or must those hash views be preserved?
5. **Shared components**: I see `data-trust.tsx`, `metric-tip.tsx`, `empty-state.tsx`, `section-heading.tsx`, `company-search.tsx` — confirm the reuse map in §6 Phase 0. Do you want `MetricCell`, `CompanyRow`, `EvidencePanel` and `CopyLinkButton` under `src/components/brand/*` (shared) or local to my scope, and may I extend `FreshnessBadge` with `delayMinutes` / `kind` for the market-data variant?
6. **Screener surface name**: the strategy calls it "Screener (`/dashboard`)"; the UI says "Scanners / الماسحات". Which is canonical — "Screener / الفلتر" (paired with «فلتر بمعنى — ونتيجة بتفسير») or keep "Scanners"? This affects nav, page titles and every result label.
