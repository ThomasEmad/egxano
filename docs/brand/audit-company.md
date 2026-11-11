# Meza — Company Research Page Audit (Phase 1)

Scope owner: `company-research` teammate. Audit phase — **read-only for source** (this file is the
only artifact written; no source, API, DB or engine change was made).

The company page is where the brand promise is either proven or broken. `/companies` brings a
visitor in; `/company/[id]` is the research session itself. Today the page contains almost all of
the raw material the brief asks for — statements, calculated ratios, peer comparison, detected
events, an Expert-level AI note engine, filings — but it presents it **in the wrong order, with
unexplained numbers, several broken states, and a trust layer that mostly does not render**. The
information exists; the *research experience* does not.

---

## 0. Executive summary — the eight things that break the page

1. **The Overview tab is horizontally broken.** The 32-period revenue/profit bar row
   (`company-detail.tsx:771-804`) has no overflow container and non-shrinking `flex-1` children.
   Measured live: page `scrollWidth` = **1913 px at a 390 px viewport**, and the 1440 px full-page
   capture is **3137 px wide** (same bar column is the widest element).
   On mobile the whole page becomes a ~165 px strip inside a five-screen-wide horizontal scroll.
   This is the single most damaging presentation defect on the page.
2. **The first thing a visitor sees is a chart, then a blank box.** The Overview opens with the
   TradingView chart, then a "Technical Summary" card whose widget is CSP-blocked / fails to
   initialise and reserves 420 px of empty space (`company-detail.tsx:373-381`,
   `tradingview.tsx:86-104`). In **Arabic** the primary price chart itself renders empty
   (`EGX:COMI · 1D 0○ H○ L○ C○ 0 (0%)`) — verified on the live site.
3. **The research order is inverted and incomplete.** Required order is: what the company does →
   how performance changed → is profitability improving/deteriorating → financial position →
   valuation → technical → risks → what to examine next. The page starts at *technical*, has **no
   "what changed"**, **no profitability verdict**, **no financial-position block in the
   overview**, **no valuation context** (P/E and P/B are naked numbers), **risks are
   premium-walled with no teaser**, and **"what to examine next" does not exist**.
4. **Headline KPIs are quarterly/annual mixed and ignore the Period view control.** `OverviewTab`
   never receives `periodView` (`company-detail.tsx:382`, `552-555`), so the cards stay interim
   while the page-level Annual/Quarterly control appears to change them. Live COMI: cards show
   **ROE 9.0 %, P/E 19.66×, EPS 6.51 (Q2 2026)** while the same company's annual figures are **ROE
   26.6 %, P/E 7.02×, EPS 18.25 (FY 2025)** — a 3× valuation difference with no "not annualised"
   warning anywhere on the tab.
5. **The trust layer is claimed, not shown.** The header badge says "Traceable data"
   (`234-243`) with a tooltip about *AI grounding*; the public `ConfidenceBadge` is dead code and
   its API route is admin-only by design (`confidence/route.ts:6-9,26-28`). The price source the
   API already returns (`marketPrice.sourceName = "market-ticker (15-min delayed)"`,
   `api.ts:119`, `/api/v1/companies/[id]/route.ts:44`) **is never displayed**; the 15-minute delay
   is invisible on the page. "Data as of Q2 2026" is the only provenance on the whole tab.
6. **Errors masquerade as absence.** Filings, Dividends and Health show "no documents / no
   dividend records / skeleton" when the request actually failed
   (`1625-1638`, `1565-1573`, `health-tab.tsx:40-46`). The brief's rule is the opposite: a missing
   value must say it is missing, and a failed request must say it failed.
7. **The AI note is the differentiating asset and the worst-presented one.** Its engine prompt
   (prompt v4, `src/lib/ai/report/prompt.ts:47-65`) already enforces thesis → key numbers →
   financial → technical → combined view → **key risks** → invalidation → monitoring → stance,
   with conflicts and risks-first. The UI reduces that to a markdown blob behind the 9th tab —
   which **does not fit on a desktop English screen** (measured at 1440 px: tab-list content
   1194 px vs 1072 px available → "AI analysis" drawn at x≈1502, clipped by the 1384 px container;
   with the 8 tabs at HEAD it still overflows at 1084 px > 1072 px, and at 1280 px two tabs are
   clipped. Arabic fits because labels are shorter — feature discovery depends on UI language).
   Anonymous users get "No AI analysis yet" + a Generate button that will 401.
8. **Arabic is a second-class citizen on this page.** Sector/industry/listing status render as
   English enums (`Banks`, `Banking`, `LISTED`), the company profile falls back to English
   silently (`descriptionAr` is `null` for COMI), dates are `en-GB`, `co.asOf` Arabic is "كـ"
   ("Price 128.05 EGP كـ 9 Nov 2026"), and the print report is Arabic-only while served from
   `<html lang="en" dir="ltr">`.

**What is genuinely good and must survive the redesign:** the period-labelled peer comparison,
honest `—` + tooltip for unavailable values, the strict "not enough peers" and "stale peer"
handling, the statement basis/period controls, the AI engine's grounding contract, the
"reporting period" line in the header, and the print report's source-date line.

---

## 1. Scope & inspection method

### 1.1 Source files read line-by-line

| File | Lines | Notes |
| --- | --- | --- |
| `src/components/egx/company-detail.tsx` | 2093 | all tabs, header, AI panel, chat |
| `src/app/company/[id]/page.tsx` | 160 | SEO, JSON-LD, company resolution |
| `src/app/company/[id]/client.tsx` | 28 | shell + composition |
| `src/app/company/[id]/report/page.tsx` | 242 | print report (premium/free) |
| `src/components/egx/qa-box.tsx` | 156 | grounded Q&A box on Overview |
| `src/components/egx/health-tab.tsx` | 198 | score, components, radar, valuation |
| `src/components/egx/confidence-badge.tsx` | 105 | dead component (never imported) |
| `src/components/egx/price-chart.tsx` | 185 | TradingView/snapshot chart |
| `src/components/egx/tradingview.tsx` | 104 | chart + technical gauge embeds |
| `src/components/egx/shared.tsx` | 151 | StarButton, DemoBadge, EventBadge, StatusChip |
| `src/components/egx/premium-gate.tsx` | 61 | events/report gating |
| `src/lib/client/api.ts` | 603 | all company payload types |
| API routes read | — | `companies/[id]/route.ts`, `financials`, `metrics`, `peers`, `scores`, `events`, `documents`, `dividends`, `ai-analysis*`, `confidence`, `coverage`, `investor-signals`, `research-profile`, `snowflake` |
| Engines read for context only | — | `src/lib/ai/report/prompt.ts`, `src/lib/ai/analysis-snapshot.ts`, `src/lib/financial/analysis/investor-signals.ts` (no edits) |
| Brand foundation (Lead-owned, read for integration) | — | `docs/brand/BRIEF.md`, `docs/brand/strategy.md`, `src/lib/brand.ts`, `src/components/brand/{data-trust,metric-tip,section-heading,empty-state}.tsx` |

### 1.2 Live evidence collected (production, read-only)

- `/company/COMI` and `/company/COMI/report` plus `/api/v1/companies/COMI*` — real EGX data
  (COMI: 55 filings, 960 verified values, 40 detected events, price 128.05 EGP as of 2026‑11‑09).
- **Playwright/Chromium (already a devDependency) at 1440×900, 1440×1000, 390×844, EN + AR, light
  mode**, capturing: Overview (viewport + full page), Statements, Health & Scoring, Peers, Events,
  Filings, AI analysis, the report page, and a loading-timing probe.
- **Layout measurements:** `document.documentElement.scrollWidth` = 1913 px (390 viewport) on the
  Overview tab; widest element = the trend-chart bar column (`flex flex-1 ... group`) at 1913 px.
  After switching to a non-overview tab the same page reports scrollWidth = clientWidth (1440) —
  i.e. the overflow is created only by the trend chart on the Overview tab.
- **Console evidence:** repeated `Framing 'https://www.tradingview-widget.com/' violates ...
  frame-src` (the gauge never renders); `HTTP 401 /api/v1/companies/{id}/ai-analysis?lang=en`
  for anonymous users.
- **Tab timing:** after clicking Statements, the active panel is empty at 0.6 s / 1.4 s / 2.6 s and
  only fills at ~5 s (a skeleton is present but the panel reads as empty), i.e. a multi-second
  blank transition on first visit to each tab.
- **Report page:** `/company/COMI/report` (ticker URL, the one the canonical page uses) returns
  **"الشركة غير موجودة."**; `/company/<cuid>/report` renders the Arabic-only summary with
  `<html lang="en" dir="ltr">`.

Reproducible measurement script: Appendix A.

### 1.3 Method limits (important)

1. **The production deployment is ahead of this repo.** It exposes a **"Technical" tab** that does
   not exist in `src/components/egx/company-detail.tsx` at HEAD (8 tabs). All `file:line`
   references below are against the working tree; where production already differs this is noted.
   Some ordering fixes may therefore already exist in an unreleased branch — confirm before
   implementing.
2. Screenshots were captured headless; fonts/iframes can differ marginally from a real browser,
   but the overflow measurement and CSP/401 console errors are DOM/network facts, not visual
   judgement.
3. Engagement with Premium-only states was not possible (no production account). Free/anonymous
   behaviour was exercised directly; premium internals were audited from source.
4. A period-semantics anomaly was found in the (currently unused) investor-signals endpoint —
   see §7.2. I did **not** use it as a recommendation until it is verified; this is an engine/data
   question outside my write scope.

---

## 2. What works and must be kept

| # | Keep | Why it matters to the brand | Location |
| --- | --- | --- | --- |
| K1 | **Reporting-period line in the header** ("Data as of Q2 2026", with amber warning when >15 months old) | The only place the page currently tells the truth about freshness | `company-detail.tsx:286-302` |
| K2 | **`—` + tooltip for unavailable values, never 0** | The brief's core honesty rule, implemented correctly for KPI + market cards | `592-621`, `702-728`, `co.notAvailable` |
| K3 | **Period-labelled peer comparison** — each bar carries its own period label, basis toggle (Latest/Annual/TTM), median marker, stale-peer exclusion and "* four quarters behind" note | "Fair comparison" is the differentiator; this is the best-built surface on the page | `1356-1539` |
| K4 | **Honest peer insufficiency** — "<3 listed companies in sector → no comparison" instead of a fake one | Prevents a false impression | `1369-1378` |
| K5 | **Statement basis + period view controls** (Consolidated/Standalone, Annual/Quarterly) | Period discipline is an experienced-investor requirement | `348-357`, `419-507` |
| K6 | **AI grounding contract** — verified-snapshot-only prompt, "unavailable ≠ zero", conflicts, risks-first, invalidation, no advice, no invented probabilities | This is the product's strongest differentiator; the UI must not weaken it | `src/lib/ai/report/prompt.ts:35-65` |
| K7 | **AI provenance badges** — price as-of, financials as-of, financial/technical coverage %, limitations list, language-mismatch notice, degraded-mode notice | Already the right vocabulary; needs to become visible and consistent | `1851-1935` |
| K8 | **Print report honesty** — "أحدث قوائم سنوية متحقق منها (FY2025)" + report date + "free summary of the full report" + explicit disclaimer | The report does not pretend to be something it is not | `report/page.tsx:120-122, 156-162, 235-239` |
| K9 | **Demo-data badge, listing status, share count, sector/industry in header** | Institutional identity, and honest "this is demo" marking | `232-285` |
| K10 | **Grounded Q&A box** that prints the figures used in each answer | "Answers from verified data — no advice" is on-brand; keep, reposition | `qa-box.tsx` |
| K11 | **Error-state component with retry** (exists but is applied inconsistently) | Keep and apply everywhere | `509-523` |
| K12 | **Star / Compare / Share / Report actions in the header** | Research workflow shortcuts, in one place | `244-276` |

---

## 3. Issue register

Severity: **P0** = breaks the page or the trust contract; **P1** = missing/ordered wrong, beginner
and professional both under-served; **P2** = parity, polish, consistency.
Brand principle: B1 clarity · B2 differentiation through experience · B4 preparation, not hype ·
B5 trust is shown, not claimed · V voice · P-parity (AR = EN).

### 3.1 P0 — broken or untruthful

| ID | Issue | Severity | Principle | File:line | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| C1 | **Overview overflows horizontally; page unusable on mobile.** 32-period bar row uses `flex-1` children with no scroll container; measured 1913 px page width at a 390 px viewport and a 3137 px full-page capture at 1440 px. | P0 | B1, institutional quality | `company-detail.tsx:627-642` (card), `734-807` (row at `771`) | Replace the hand-rolled bar row with a Recharts `BarChart` inside `ResponsiveContainer` (dep already used site-wide) with a fixed `height`; or wrap in `overflow-x-auto` + `min-w-[56px]` per period and cap default periods to the last 8 with an explicit "show all" control. Verify `scrollWidth === clientWidth` at 360/390/768/1024/1440 in EN and AR. |
| C2 | **Empty 420 px "Technical Summary" card on the first screen.** TradingView gauge iframe is CSP-blocked (`frame-src` violation logged) and the card reserves fixed height regardless (`tradingview.tsx:102`). | P0 | B5, B1 | `company-detail.tsx:373-381`, `tradingview.tsx:86-104` | Do not render a fixed-height frame until the widget actually mounts. Either (a) move technical to its own tab (as production already does) and keep only a compact "Technical position" row in Overview, or (b) render the widget inside a container that collapses on failure and shows a fallback: "Chart unavailable in this browser — open on TradingView" + the price-snapshot chart. Always caption: "Third-party chart · delayed 15 min · display only". |
| C3 | **Arabic users get a blank price chart.** With UI language `ar`, the TradingView widget for `EGX:COMI` renders an empty canvas ("0○ H○ L○ C○ 0 (0%)"); the widget chrome stays English. | P0 | P-parity | `price-chart.tsx:71-92`, `tradingview.tsx:62-80` | Do not let the *widget* locale follow the UI language (keep `locale: "en"` for the chart, or force the "Our snapshots" view when `lang === "ar"` and the widget reports no data). Add a data-availability check before showing the TV tab. |
| C4 | **"Traceable data" badge is an unsupported claim**, tooltip is the *AI grounding* text, and the real confidence component is dead code whose route is admin-only. | P0 | B5 ("trust is shown, not claimed") | `company-detail.tsx:234-243`; `confidence-badge.tsx:62`; `confidence/route.ts:6-9,26-28` | Delete the badge. Replace with a real provenance strip built from Lead components: `SourceLine` (source = published filing, period = `dataAsOf.periodLabel`, as-of = `dataAsOf.periodEnd`) + filings/values counts ("55 filings · 960 verified values") + `DataStateBadge state="delayed"` next to the price. Delete `confidence-badge.tsx` or explicitly mark it admin-only (do not wire an admin-only API into a public page). |
| C5 | **Request failures are rendered as "no data".** Filings ignores `isError` → "No source documents uploaded"; Dividends → "No dividend records"; Health → infinite skeleton. | P0 | B5, V (factual) | `company-detail.tsx:1625-1638`, `1565-1573`; `health-tab.tsx:40-46` | Use the existing `ErrorState` (`company-detail.tsx:511-523`) with "Could not load … — retry", never an empty state, and never a skeleton as an error. |
| C6 | **Headline KPIs mix quarterly with annual and ignore the Period view control.** `OverviewTab` receives `basis` but not `periodView`; metrics default to interim. Live COMI cards: ROE 9.0 %, P/E 19.66×, EPS 6.51 (Q2 2026) beside annual ROE 26.6 %, P/E 7.02×, EPS 18.25 (FY 2025). No "not annualised" notice. | P0 | B5, B1 | `company-detail.tsx:348-357` (control), `382` (wiring), `550-568` (query/cards), `617` (period label) | Pass `periodView` into `OverviewTab` and into the `metrics` query. Default the headline cards to **annual when available**, with the period type printed ("FY 2025 · annual"). When interim is shown: badge "interim — not annualised" + tooltip explanation. Add the period type to the card footer, not just the label. |
| C7 | **The page starts with technical/price, not with the company and its numbers.** Order is: price chart → empty technical card → 6 KPI cards → market snapshot → trend chart → Q&A. No "what the company does", no "what changed", no financial position, no valuation context, no risks, no next step. | P0 | B1, B2, B4 | `company-detail.tsx:371-406` | Implement the anchored research order in §4. |

### 3.2 P1 — missing research content / wrong hierarchy

| ID | Issue | Severity | Principle | File:line | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| C8 | **No "how financial performance changed" section.** Statement deltas compare *sequential* periods only (`1235-1264`) and exist only inside the Statements tab; the Overview shows absolute bars with no YoY, no margin trend statement. | P1 | B4 ("what changed and why it matters") | `627-642`, `734-807` | Add a "What changed" block: YoY deltas computed in the presentation layer from the **same financials series already loaded** (never from a second engine), e.g. COMI revenue Q2 2026 36.17B vs Q2 2025 27.90B (+29.6 %), net profit 21.49B vs 14.88B (+44.4 %), net margin 59.4 % vs 53.3 %. Show the reporting period + "calculated" badge. See §7.2 for why *not* to wire `investor-signals` yet. |
| C9 | **No "is profitability improving or deteriorating" verdict surface.** ROE/ROA/margins exist but there is no trend reading; the only summary is a "Financial Health Score" inside a tab named "Health & Scoring". | P1 | B1, B2 | `550-621`, `health-tab.tsx` | Section "Profitability": ROE/ROA/net margin with prior-period comparison, MetricTip explanations, and the health score with an explicit completeness line ("2 of 3 components available"). No advice, no verdict words. |
| C10 | **Financial position is absent from the overview** (only "Total assets" one-liner). No equity, debt, cash-flow quality, liquidity. | P1 | B1 | `570-577`, `649-732` | Section "Financial position": assets / equity / total debt / D/E (or "not applicable — bank: use capital adequacy" when `DATA_UNAVAILABLE`), operating cash flow vs net profit, and a "what's missing" line where data is unavailable. Use statement rows already in the financials payload. |
| C11 | **Valuation is a naked number set.** P/E, P/B, market cap, yield with no sector context, no period, no definition; the only sector verdict exists in the Health tab and is Pro-gated, and it is shown as a red "Above sector valuation" pill **without the two multiples**. | P1 | B5, V ("no naked numbers") | `649-732` (cards `663-668`); `health-tab.tsx:88-92, 135-152` | Build a "Valuation" section: P/E, P/B vs **sector median** (from `/peers` `medians`, already fetched in the Peers tab; or `scores.valuation`), yield, market cap — each with `MetricTip` (glossary exists in `src/lib/brand.ts:101-110`), period label, and "requires positive earnings / price point" note. Move the sector-valuation verdict out of the Health tab and show it **with** its numbers, free. |
| C12 | **"Click any value for details" is a dead promise** — statement cells have no handler. | P1 | B5 (never promise what does not happen) | `company-detail.tsx:1042-1044`; cells `1242-1264` | Either remove the line, or implement the detail panel with what the payload actually contains (the financials route deliberately does **not** return `reportId`/source page — `financials/route.ts:142-157,165-166`): show the period, statement basis, "value as reported", and a link to the matching document in Sources & filings. Do not claim a per-value source page the API does not expose. Also fix the drifted client type `reportId`/`identityFailed` (`api.ts:201`). |
| C13 | **AI tab is undiscoverable and language-dependent.** Non-wrapping tab strip: production (9 tabs) content 1194 px vs 1072 px available at 1440 → "AI analysis" clipped; at HEAD (8 tabs) 1084 px vs 1072 px → still clipped; at 1280 two tabs clipped. Arabic fits (shorter labels) — same product, different discoverability. | P1 | B1, B2, parity | `company-detail.tsx:359-369` | Reduce to 4 tool tabs + anchored Overview (§4.2). At minimum: allow wrap/overflow affordance, keep tab count ≤ 5, and never let language change feature visibility. |
| C14 | **Anonymous AI state lies.** 401 → "No AI analysis yet. Generate…" and a Generate button that will 401; the usage badge renders as "Smart Analyses: " (empty). | P1 | B5, V | `company-detail.tsx:1742-1745`, `1843-1849`, `1850-1861`, `1949-1961` | Distinguish states: 401 → "Sign in to read the analyst note"; has-analysis-but-anonymous must still be readable if the API allows it (audit the route's auth policy — do not change the contract, only the UI copy/state). Hide the usage badge when unknown. |
| C15 | **AI note is not visually separated from calculated values** and leaks internals: model name + truncated data hash in the title, no "interpretation" banner, `Key Numbers` table duplicates the page's calculated metrics with no label. | P1 | B5 ("never an AI reading as a fact") | `company-detail.tsx:1885-1946` (`1892-1896`, `1936-1938`), `1940-1945` | Put a persistent header on the note: `DataStateBadge state="ai"` + "Interpretation — written from the verified figures on this page. Not advice." Move `model`/`reportKey` into a "Details" disclosure. Cross-link the note's sections to the page's own sections. Keep the grounding footer but shorten it. |
| C16 | **"Bullish / Bearish" stance pill reads as a recommendation** on a page that says it gives none. | P1 | B4, V | `company-detail.tsx:132-171`, `1899` | Relabel: "Analyst stance: cautiously positive — interpretation, not advice" (both languages), and place it inside the note header next to the AI badge, not as a headline badge. Consider neutral wording ("the note reads cautiously positive"). |
| C17 | **Key risks and detected events are premium-walled with zero teaser**, although "what changed" is the brand's differentiator. | P1 | B2, B4 | `company-detail.tsx:1541-1561`; `premium-gate.tsx:16-24` | Show: count ("40 detected events for COMI"), one teaser item (period + label, numbers hidden), one line explaining what an event is, and an honest CTA. Coordinate the gate copy with the trust-audit owner (`audit-trust.md` P14) — they own `premium-gate.tsx` copy. |
| C18 | **No "what to examine next" block.** Nothing tells the user what to read next (next reporting period, the latest filing, a peer, the analyst note). | P1 | B4, B1 | — (absent) | Add a closing section: next expected period (from latest `periodType`/fiscal year), "Read the latest filing" (Sources tab, latest doc), "Compare with sector peers" (Peers/Compare), "Ask about this company" (Q&A), "Analyst note". Pure presentation over existing payloads. |

### 3.3 P2 — parity, copy, accessibility, hygiene

| ID | Issue | Severity | Principle | File:line | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| C19 | **Arabic data labels untranslated:** sector `Banks`, industry `Banking`, status `LISTED`, and the AR profile is English because `descriptionAr` is null (verified live). | P2 | P-parity | `company-detail.tsx:280-306`, `shared.tsx:62-85` | Use the existing `sectorLabel()` / `SECTOR_AR` (`src/lib/sectors.ts:36-64`) and add a small AR map for listing status. Where `descriptionAr` is null, show the English text with a visible "الوصف متاح بالإنجليزية فقط" marker — never machine-invent Arabic. |
| C20 | **Arabic copy and date formatting defects:** `co.asOf` AR = "كـ" → "السعر 128.05 EGP كـ 9 Nov 2026"; all dates via `toLocaleDateString("en-GB")` (`689`, `1614-1621`); "3.30B"/"422B" abbreviations in AR. | P2 | V, P-parity | `i18n.tsx:127`, `company-detail.tsx:284, 689, 1614-1621` | "بتاريخ"/"آخر تحديث" wording; use `Intl.DateTimeFormat("ar-EG-u-nu-latn")` (the Lead's `formatAsOf` in `data-trust.tsx:71-80` already does this); localise the scale words or use full EGP with tabular digits. |
| C21 | **"Key metrics" tab is really the Overview**, and one function has three names: "AI analysis" (tab), "Smart Analyses" (quota), "Ask the analyst" (chat). "Health & Scoring" mixes health with a valuation verdict. | P2 | V (one name per thing) | `company-detail.tsx:361-368`; `i18n.tsx:120, 135, 294-296` | Rename per §5 copy deck: Overview / Price & technical / Financial strength / Analyst note. |
| C22 | **Upsell competes with the identity header**: "7 scanner matches — Premium only" is the top-right focal point of the first screen. | P2 | B2, B4 | `company-detail.tsx:309-344` | Demote to a compact chip/rail below the fundamentals ("Also matches 7 saved screens — Premium") or into the closing "next steps" block. Keep the honest count. |
| C23 | **Hover-only tooltips and hover-only chart detail** (unavailable-value tooltips sit on a non-focusable `<p>`; period detail is mouse-only). | P2 | Accessibility | `company-detail.tsx:599-611`, `709-721`, `774-777` | Make triggers focusable buttons (`MetricTip` from `src/components/brand/metric-tip.tsx` already is), add tap/click support and a static summary line for touch. |
| C24 | **Price chart defaults to TradingView** so the platform's own snapshot series (the one with real provenance) is hidden behind a toggle; there is no "last price / delayed / source" caption under the primary chart. | P2 | B5 | `price-chart.tsx:45-46, 71-92, 179-181` | Default to snapshots when a TV widget is unavailable or when AR; caption both modes with `MarketDataLine` (as-of + delay + source). |
| C25 | **Technical widget claims and third-party framing are contradictory**: footer in the chart card reads "chart + RSI/MACD studies — 15-min delayed data" while the source file says TV is display-only and engine numbers come from Meza (`tradingview.tsx:3-5`). | P2 | B5 | `price-chart.tsx:86` | Caption: "Third-party display · delayed 15 min · not used for the calculated figures". |
| C26 | **Health score precision without completeness.** Score 82 shown while 2 of 3 components are unavailable; component inputs have no period labels or definitions; "Cash quality — data unavailable" still prints "Net profit: 71B"; the valuation verdict is evidence-free for free users. | P2 | B5, V | `health-tab.tsx:48-52`, `66-92`, `98-119`, `141-152` | Show "components available: 1 of 3 — the score uses what is published, not a rating"; label each input with its period; use `MetricTip` for ROE/net margin/ROA; move the valuation verdict to the valuation section with numbers. |
| C27 | **No loading explanation on tab switch** (3–5 s of empty panel on first visit to each tab). | P2 | B1 | `974-975`, `1359-1365`, `1627-1629`; measured §1.2 | Skeleton with a line of text ("Loading the published statements — Q1 2021 → Q2 2026") and keep queries warm (`staleTime`) so revisits are instant. |
| C28 | **Report page: canonical ticker URL fails**, accepts only the CUID (`findUnique({ where: { id } })`), so `/company/COMI/report` says "الشركة غير موجودة."; content is Arabic-only while the document root is `lang="en" dir="ltr"`; no source/basis/completeness line; no risks/next-steps. | P2 | B1, B5, P-parity | `report/page.tsx:12-15, 27-37, 108, 120-122, 235-239` | Resolve with the existing `findCompanyByKey` (`src/lib/company-lookup.ts`); add `dir`/`lang` on the report `<main>`; add a trust header (source/period/basis/"as of"/values count); add the detected-events section for premium and a "what to examine next" line; provide EN output (lang param or `Accept-Language`) using the same data. Keep the premium gate and the disclaimer. |
| C29 | **`anomalyCount` exists but is unused; making it visible naively would alarm** (COMI: 189 flagged cells from >50 % YoY moves). | P2 | B5, B1 | `financials/route.ts:160-185,195`; `api.ts:199` | If surfaced, phrase as "unusual year-over-year changes detected in the statements (189 cells) — review in Statements", with a filter; never as a red alert. Optional. |
| C30 | **Hygiene:** unused `TEMP_EDIT_MODE` import; a pre-launch "Temporary edit mode" admin surface remains in the public research page; leftover empty JSX lines. | P2 | Institutional quality | `company-detail.tsx:55`, `820-1092`, `1005-1007` | Remove the unused import; keep the admin editor but gate it entirely behind the admin session without a visible "pre-launch" banner in production (documented in the final report, not silently removed). |

### 3.4 AI report / analyst panel — direct answers to the audit questions

| Question | Verdict | Evidence |
| --- | --- | --- |
| Is AI positioned as a **research assistant with evidence**? | **Engine: yes. UI: partially.** The prompt demands mechanism + numbers + invalidation + conflicts and forbids advice; the UI calls it "AI analysis" / "Smart Analyses" and hides it behind the 9th tab. | `prompt.ts:18-45,47-65`; `company-detail.tsx:368, 1885-1961` |
| Does it show **strengths, risks, conflicting signals**? | Generated but **not surfaced as UI structure** — they are headings inside one markdown blob, below the fold, with no summary, TOC, or risk callout. | `prompt.ts:56-63`; `company-detail.tsx:1936-1938` |
| Is it **clearly separated from calculated values**? | **No.** Same page, same typography, no interpretation banner; the note's "Key Numbers" table repeats calculated metrics with no "AI-generated" marker. | `company-detail.tsx:1899, 1913-1945` |
| Is there a visible **data as of / reporting period / source trust layer**? | **Weak and inconsistent.** Three small badges in the AI tab (price as-of, financials as-of, coverage %) are better than the rest of the page but invisible before opening the tab and absent from the print report. The page header has only "Data as of <period>". Price delay/source never shown anywhere. | `1859-1883`; `286-302`; `api.ts:119`; `price-chart.tsx` |
| Recommendation | Treat the AI note as **"the analyst's read"** surfaced inside the Overview sequence (after valuation/technical, before risks?) — actually **after risks**, as the synthesis; with (1) persistent interpretation banner + `DataStateBadge state="ai"`, (2) a compact "what the note says" summary of thesis + stance + invalidation, (3) Key Risks & What Would Invalidate extracted into distinct callouts, (4) every figure in the note labelled as verified-and-dated, (5) model/hash in a Details disclosure. | — |

---

## 4. Recommended information hierarchy & navigation

Reference message from `strategy.md:84`: **«الشركة في صورة واحدة — ثم التفاصيل اللي تهم.»**
("The company in one picture — then the details that matter.")

### 4.1 Target company-page order (single reading sequence)

| # | Section | Content (all from existing payloads) | Trust line on the section |
| --- | --- | --- | --- |
| 0 | **Identity & provenance header** | ticker + AR/EN name, sector (localised) + industry, status, shares outstanding, one-line business profile, actions (watch/compare/share/report) | `SourceLine` = published filing · reporting period · last updated (or "unavailable"); `MarketDataLine` = price as-of · 15-min delay · source; "55 filings · 960 verified values"; legend "calculated vs as reported" |
| 1 | **What the company does** | profile description, sector, listing status, ISIN, filing count; "profile not available in Arabic" marker when applicable | counts + sector + "from the company's disclosures" |
| 2 | **How performance changed** | revenue / net profit / margins, latest annual (primary) with YoY vs same period prior year; interim toggle; trend chart with period + source caption; short factual "what changed" bullets computed from the same series | period label, `DataStateBadge state="calculated"`, `CalculationNote` |
| 3 | **Is profitability improving or deteriorating** | ROE / ROA / net & operating margin with prior-period comparison; health score **with completeness** ("1 of 3 components available"); sector-relative profitability | period per figure, completeness note, metric tips |
| 4 | **Financial position** | total assets, equity, total debt, D/E (or "not applicable — bank"), OCF vs net profit, capex/FCF if available; explicit "not reported" notes | `UnavailableNote` where values are missing; statement basis |
| 5 | **Valuation** | P/E, P/B, dividend yield, market cap vs **sector median**, with the "requires positive earnings/price" conditions; valuation verdict only with the numbers visible (free) | period, median source, "calculated from price as of …" |
| 6 | **Technical position** | clearly separated third-party block: chart + gauge, or snapshot chart + external link; RSI/MACD context labelled as third-party; never presented as Meza-calculated | "Third-party display · delayed 15 min · not used in Meza's calculated figures"; widget-failure fallback |
| 7 | **Key risks & red flags** | detected events (count + teaser + premium gate explanation), unavailable-metric risks, unusual YoY changes (optional, cautiously worded), "what would invalidate the picture" from the note | event rule version + period, "flags for investigation — not conclusions" |
| 8 | **What to examine next** | next expected reporting period, latest filing to read, peer comparison, analyst note, ask-about-this-company | links carry their own periods; no promises |
| 9 | **Analyst note (AI-assisted)** | summary card (thesis, stance, invalidation) + full markdown; grounded Q&A below it | `DataStateBadge state="ai"` + "Interpretation — not advice" + data as-of/coverage/limitations |

Beginner path: 0 → 2 → 3 (plain-language explanations at first use via `MetricTip`).
Experienced path: 0 → 2 → 4 → 5 → 7 → Statements tab (period discipline preserved).

### 4.2 Navigation decision: anchors inside Overview + 4 tool tabs (not 9 tabs)

**Recommendation: one anchored research page + four depth tabs.**

Why not 9 tabs:
- Tabs **hide the required order**. A tab strip communicates "parallel features", while research is
  sequential: a beginner cannot tell that valuation comes after position, or that risks follow.
- **They already break**: production's 9 tabs need 1194 px in a 1072 px strip at 1440 px (AI tab
  clipped), and the 8 tabs at HEAD still overflow (1084 px); Arabic fits — the same product is
  easier to discover in Arabic. Tabs that don't fit teach users that parts of the research are
  missing.
- Research depth (statements, filings) genuinely benefits from isolation: different controls
  (basis/period/CSV), heavy tables, long dwell time.

Proposed top navigation:

```
Overview            ← anchored research page (sections 1–8 above), sticky section rail
Statements          ← existing StatementsTab (basis + period + CSV), unchanged functionality
Peers & comparison  ← existing PeersTab + link to /compare
Analyst note        ← AI note + grounded Q&A (with the new interpretation/trest framing)
Sources & filings   ← existing DocumentsTable + dividend history block
```

Merging map (nothing removed, functionality preserved):
- `health` → sections 3 + 4 (score card moves into profitability with completeness; radar/valuation
  detail move to Premium per current gate rules — see §7.4).
- `events` → section 7 (risk/change cards, premium gate preserved, now with a teaser).
- `dividends` → "Sources & filings" (or a compact block in section 5 "Valuation" for yield +
  dates — recommend keeping the full list in Sources & filings).
- `documents` → "Sources & filings".
- `ai` → "Analyst note".
- `technical` (production already has it) → anchored section 6.

Anchor/deep-link contract: `#performance`, `#profitability`, `#position`, `#valuation`,
`#technical`, `#risks`, `#next`, `#analyst`. Sticky rail on desktop (right side in LTR / left in
RTL, following the existing shell), horizontal chip scroller under the header on mobile; the rail
highlights the section in view and never covers content (no sticky over data tables).

### 4.3 Mobile

- Order identical, one column. Section rail = horizontally scrollable chips (44 px targets) that
  stay under the identity header.
- Every chart gets its own `overflow-x-auto` wrapper and a fixed height — the **page** must never
  scroll horizontally (acceptance: `scrollWidth === clientWidth` at 360/390).
- KPI tiles: 2 columns max, value + period + delta stacked; metric tips as bottom sheets, not
  hover.
- The identity header collapses to: ticker + name + period/trust line + actions row (watch,
  compare, report).

### 4.4 State matrix (must be designed, not implied)

| State | Behaviour |
| --- | --- |
| No verified filings | Header keeps identity; Overview shows the existing `NoFinancialsEmpty` copy (good), sections 2–5 collapse into one honest block, filings/AI sections explain what will appear when data arrives |
| Stale data (>3 filings old / >15 months) | amber freshness badge in header (`FreshnessBadge` exists in Lead's `data-trust.tsx:154-192`), one-line reason in section 2 |
| No price point | valuation section says "no price point recorded — P/E, P/B and yield unavailable" (never `—` alone), price section hidden or shows the last snapshot + as-of |
| Interim-only company | headlines show interim with "not annualised" badge; annual toggle disabled with reason |
| API error | `ErrorState` with retry **per section**, never an empty state |
| Loading | skeleton + one line naming what is loading |
| Bank vs non-bank | D/E unavailable → explanation "for banks, capital adequacy is the relevant lens; D/E is not the primary measure" (honest, no invention) |
| AI: anonymous | "Sign in to read the analyst note" |
| AI: no note | "No note yet for this company — generate one from the verified figures (interpretation, not advice)" |
| AI: generating / failed / degraded | keep existing states, relabel per copy deck |
| Demo data | keep `DemoBadge`, extend to a page-level note in the header |

### 4.5 Trust layer specification (uses the Lead's existing brand components)

| Surface | Component | Data source (already available) |
| --- | --- | --- |
| Header provenance strip | `SourceLine` + `DataStateBadge` + `MarketDataLine` | `dataAsOf.periodLabel/periodEnd`, `marketPrice.asOf/sourceName`, `counts.reports/values`, statement basis from `/financials` |
| Each KPI | `MetricTip` + period chip + `DataStateBadge state="calculated"` | `metrics` rows + `src/lib/brand.ts` glossary |
| Each chart | `CalculationNote` + period/source caption | `metrics`/`financials` periods |
| Unavailable values | `UnavailableValue` + `UnavailableNote` (always focusable) | metric `cell.detail` when present, else a per-code reason |
| Statements | statement basis + period + "as reported" legend + CSV | `/financials` (`statementType`, `periods`, `cells.label`) |
| Filings | source = document file name/period; download or "file not attached — recorded values available" | `/documents` (`fileName`, `hasFile`, `valueCount`) |
| AI note | `DataStateBadge state="ai"` + `SourceLine(price/financials as-of)` + coverage/limitations + Details disclosure for model/hash | `/ai-analysis` `priceAsOf`, `financialAsOf`, `completeness`, `model`, `reportKey` |
| Report page | same trust header in print typography | `gatherCompanyAnalytics`, `dataAsOf`, counts |

Rule: if a value is calculated, say "calculated"; if reported, "as reported"; if absent, "not
reported — not estimated"; if from the market feed, "delayed 15 min". No other adjectives.

---

## 5. Copy changes — EN + AR before → after

Voice per `strategy.md` §6 (Egyptian financial register in human moments, precise MSA in data
labels; explain a term at first use; no hype, no advice).

### 5.1 Navigation & section names

| Key / location | Before (EN) | After (EN) | Before (AR) | After (AR) |
| --- | --- | --- | --- | --- |
| Overview tab (`co.keyMetrics`, `company-detail.tsx:361`) | Key metrics | Overview | المؤشرات الرئيسية | نظرة عامة |
| Technical tab/section | Technical | Price & technical | فني | السعر والتحليل الفني |
| Health tab (`co.health`, `i18n.tsx:294`) | Health & Scoring | Financial strength | الصحة والتقييم | المتانة المالية |
| Events tab (`co.events`) | Events (40) | What changed (40) | الأحداث (40) | اللي اتغيّر (40) · alt. ما تغيّر |
| Peers tab | Peers | Peers & comparison | المقارنة بالأقران | الأقران والمقارنة |
| Filings tab (`co.filings`) | Filings & Documents (55) | Sources & filings (55) | الإفصاحات والمستندات (55) | المصادر والإفصاحات (55) |
| AI tab (`co.aiAnalysis`) | AI analysis | Analyst note | تحليل ذكي | قراءة المحلل |
| Q&A box title (`qa-box.tsx:88`) | Ask the market — answers from verified data | Ask about COMI — answers from the verified figures | اسأل عن السوق — إجابات من بيانات متحقق منها | اسأل عن COMI — إجابات من الأرقام الموثقة |
| Q&A subtitle | Accurate answers from verified data — no advice | Figures are shown with every answer · not advice | إجابات دقيقة من بيانات موثقة — بدون توصيات | كل إجابة بأرقامها من الإفصاح المنشور · ليست توصية |

### 5.2 Header, period & trust

| Location | Before | After EN | After AR |
| --- | --- | --- | --- |
| Header badge (`234-243`) | Traceable data (tooltip: AI grounding text) | *Remove* → trust strip below header: `Source: published filing · Reporting period: Q2 2026 · Last updated: unavailable · 55 filings · 960 verified values` | المصدر: الإفصاح المالي المنشور · الفترة المالية: Q2 2026 · آخر تحديث: غير متاح · 55 إفصاحًا · 960 قيمة موثقة |
| Data-as-of line (`296`) | Data as of Q2 2026 | Reporting period: Q2 2026 (interim) | الفترة المالية: Q2 2026 (ربعي) |
| Stale marker (`295-298`) | "⚠" | "Filing older than 15 months — treat comparisons with care" | إفصاح أقدم من 15 شهرًا — خُذ المقارنات بحذر |
| Price (`679-699`) | Price 128.05 EGP as of 9 Nov 2026 | 128.05 EGP · market snapshot 9 Nov 2026 · delayed 15 min · market-ticker | 128.05 ج.م · لقطة سوق 9 نوفمبر 2026 · متأخر 15 دقيقة · market-ticker |
| `co.asOf` AR (`i18n.tsx:127`) | كـ | — | بتاريخ |
| Sector / industry / status | Banks · Banking · LISTED | Banks · Banking · Listed (unchanged EN) | البنوك · الخدمات المصرفية · مدرجة (via `SECTOR_AR`, new status map) |
| Profile when AR missing (`304-306`) | (English text, silently) | (English text) + "Profile available in English only" | (English text) + «الوصف متاح بالإنجليزية فقط» |
| "Scanner matches" teaser (`309-344`) | Scanner matches · 7 scanner matches — Premium only | "Also matches 7 saved screens" (moved below fundamentals) | كذلك يطابق 7 ماسحات محفوظة |
| Report action (`275`) | Report | Printable report | تقرير للطباعة |

### 5.3 KPI & performance

| Location | Before | After EN | After AR |
| --- | --- | --- | --- |
| KPI group | (no heading) | Performance — FY 2025 · annual | الأداء — سنة 2025 · سنوي |
| Interim state | (nothing) | Q2 2026 · interim — not annualised | الربع الثاني 2026 · ربعي — غير مُحوّل لسنوي |
| Metric label | Revenue | Revenue ⓘ (MetricTip: "Total revenue reported in the income statement for the period.") | الإيرادات ⓘ (إجمالي الإيرادات المعلنة في قائمة الدخل عن الفترة.) |
| Trend card title (`627-637`) | Revenue & net profit trend (quarterly, EGP) | Revenue & net profit — Q2 2026 vs Q2 2025 (interim, EGP) · calculated from published statements | الإيرادات وصافي الربح — الربع الثاني 2026 مقابل الربع الثاني 2025 (ربعي، ج.م) · محسوبة من القوائم المنشورة |
| Chart hint (`765-768`) | Hover columns for breakdown | Tap or focus a period for its figures | اضغط على أي فترة لعرض أرقامها |
| "What changed" block | (absent) | What changed since Q2 2025: revenue +29.6 % · net profit +44.4 % · net margin 53.3 % → 59.4 % | اللي اتغيّر من الربع الثاني 2025: الإيرادات +29.6٪ · صافي الربح +44.4٪ · هامش صافي الربح 53.3٪ ← 59.4٪ |
| Position section | (absent) | Financial position — FY 2025: assets, equity, debt, cash flow | المركز المالي — سنة 2025: الأصول، حقوق الملكية، الدين، التدفقات |
| Bank D/E explanation | "—" + "Not available" | "Debt / equity is not the primary measure for banks — see financial strength" | «الدين إلى حقوق الملكية ليس المقياس الأساسي للبنوك — راجع المتانة المالية» |

### 5.4 Health, valuation, events

| Location | Before | After EN | After AR |
| --- | --- | --- | --- |
| Health score blurb (`health-tab.tsx:83-87`) | "A 0-100 score from verified financial metrics (profitability, leverage, cash quality). Unavailable components are never estimated." | "A 0–100 reading of the components available for this company: profitability, leverage and cash quality. **1 of 3 components is available**, so the score reflects what is published — not a rating of the company." | «قراءة من 0 إلى 100 للمكوّنات المتاحة لهذه الشركة: الربحية، الرفع المالي، جودة النقد. متاح مكوّن واحد من ثلاثة، فالدرجة تعكس ما نُشر فقط — وليست تقييمًا للشركة.» |
| Valuation card (`663-668`) | Market snapshot: Market cap, P/B, P/E, Div. yield | Valuation — FY 2025 earnings · P/E 7.02× vs Banks median 8.4× · P/B 1.87× vs 1.6× · yield not reported | التقييم — أرباح سنة 2025 · مضاعف الربحية 7.02× مقابل وسيط قطاع البنوك 8.4× · مضاعف القيمة الدفترية 1.87× مقابل 1.6× · العائد غير مُعلن |
| Valuation verdict (`health-tab.tsx:88-92`) | "Sector valuation: Above sector valuation" (red, no numbers) | "P/E 7.0× vs sector median 8.4× — below the sector median; P/B 1.87× vs 1.6× — above" | «مضاعف الربحية 7.0× مقابل وسيط القطاع 8.4× — أقل من الوسيط؛ مضاعف الدفترية 1.87× مقابل 1.6× — أعلى» |
| Events gate (`premium-gate.tsx` default, used at `1556`) | Premium feature / Upgrade to Premium to unlock this feature. | "40 detected changes for COMI — what moved, with the figures behind it. Included in Premium." + one teaser line + "See what Premium includes" | «40 تغيّرًا مكتشفًا في COMI — إيه اللي اتحرك، وبالأرقام اللي وراه. متاح في Premium.» + سطر واحد كعيّنة + «اعرف إيه اللي في Premium» |
| Events section subtitle | (none) | "Flags for investigation — not conclusions" | «مؤشرات للفحص — ليست أحكامًا» |
| Next steps | (absent) | What to examine next: latest filing → next reporting period → sector comparison → analyst note | اللي تفحصه بعد كده: آخر إفصاح ← الفترة القادمة ← المقارنة بالقطاع ← قراءة المحلل |

### 5.5 AI note

| Location | Before | After EN | After AR |
| --- | --- | --- | --- |
| Tab | AI analysis | Analyst note | قراءة المحلل |
| Panel header (`1885-1897`) | AI analysis · model badge · date · hash | Analyst note — AI-assisted interpretation, not advice · written from the verified figures above | قراءة المحلل — تفسير بمساعدة الذكاء الاصطناعي، ليس توصية · مكتوبة من الأرقام الموثقة أعلاه |
| Stance badge (`132-171`) | Bullish | Analyst stance: cautiously positive (interpretation) | موقف المحلل: إيجابي بحذر (تفسير) |
| Anonymous empty (`1950-1961`) | No AI analysis yet. Generate a grounded analysis from the company's verified financial data. / button "Generate AI analysis" | Sign in to read the analyst note. It is written only from this company's verified figures — interpretation, not advice. | سجّل الدخول لقراءة قراءة المحلل. مكتوبة من أرقام الشركة الموثقة فقط — تفسير، ليس توصية. |
| No note (signed in) | (same as above) | No note has been written for COMI yet. Generate one from the verified figures (interpretation, not advice). | لسه ما فيهاش قراءة محلل. ولّد واحدة من الأرقام الموثقة (تفسير، ليس توصية). |
| Usage badge (`1851-1858`) | "Smart Analyses: " (empty) | "Analyst notes this month: 2 of 3 (free)" | «قراءات المحلل هذا الشهر: 2 من 3 (مجاني)» |
| Grounding footer (`1940-1945`, `co.aiGrounded`) | "Generated exclusively from verified database values. Unavailable figures are reported as such — never invented. Cached until underlying data changes." | Short: "Written only from figures verified in Meza's database. Nothing is estimated. Not advice." | «مكتوبة من أرقام موثقة في قاعدة بيانات Meza فقط. لا تقديرات. ليست توصية.» |
| Details | (model + hash always visible) | Details (collapsed): model · data fingerprint · generated date | التفاصيل (مطوية): النموذج · بصمة البيانات · تاريخ الإنشاء |
| Risks in note | (markdown heading only) | Extract "Key Risks & Red Flags" and "What Would Invalidate This Analysis" into labelled callouts under the summary | إبراز «المخاطر الجوهرية» و«ما يُبطل التحليل» كصناديق واضحة تحت الملخص |

---

## 6. Prioritized implementation plan (presentation layer only)

Constraints honoured: no new dependencies, no changes to `src/lib/financial/**`,
`src/lib/technical/**`, `src/lib/ai/**`, DB/schema, API contracts, auth/business logic, or
`src/lib/i18n.tsx` (keys requested from the Lead). `docs/brand/strategy.md` §12 applies.

### Phase 0 — truth & layout fixes (highest risk removed first; ~2–3 days)

| # | Work | Files | Acceptance |
| --- | --- | --- | --- |
| 0.1 | Kill the Overview overflow: rebuild trend chart on existing Recharts (or scroll container + period cap); remove hover-only instruction | `company-detail.tsx:627-807` | `scrollWidth === clientWidth` at 360/390/768/1024/1440 EN+AR; bars readable; keyboard/tap detail |
| 0.2 | Technical block: no fixed-height empty frame; collapse on widget failure; caption third-party/delay; Arabic-safe chart (C2, C3, C24, C25) | `company-detail.tsx:373-381`; `price-chart.tsx`; `tradingview.tsx` | No blank >80 px card anywhere; fallback link present; AR shows a chart |
| 0.3 | Real trust strip in the header using Lead components; delete fake badge + dead ConfidenceBadge wiring; localise sector/status (C4, C19) | `company-detail.tsx:221-346`; `shared.tsx:62-85`; `src/lib/sectors.ts` import | Every first-screen number has source/period/state; no untranslated enum in AR except industry (marked) |
| 0.4 | Errors ≠ empty: apply `ErrorState` to Filings, Dividends, Health (C5) | `company-detail.tsx:1565-1573,1625-1638`; `health-tab.tsx:40-46` | Simulated network failure shows retry, never "no data" |
| 0.5 | KPI correctness: pass `periodView`, annual-first, period-type badge, "not annualised", YoY deltas from same series, `MetricTip` + calculated badge (C6, C8 partial) | `company-detail.tsx:348-357,382,550-621` | Toggle changes the cards; annual/interim clearly labelled; deltas match Statements data |
| 0.6 | AI panel truth boundary: interpretation banner, stance relabel, Details disclosure, sign-in state, usage badge when known (C14, C15, C16) | `company-detail.tsx:1704-1965` | Anonymous sees sign-in state; every AI figure context is labelled interpretation; no model/hash in the headline |

### Phase 1 — the research order (the substance of the brief; ~4–5 days)

| # | Work | Files | Acceptance |
| --- | --- | --- | --- |
| 1.1 | Overview becomes the anchored research page: sections 1–8 with `SectionHeading` + sticky rail; tabs reduced to Statements / Peers & comparison / Analyst note / Sources & filings (moves Health, Events, Dividends content into sections) | `company-detail.tsx:359-406` (+ new section components in `src/components/egx/company/*` if useful) | Reading order matches §4.1; deep links `#valuation` etc. work; no content lost |
| 1.2 | "What changed" block from the already-loaded financials series (YoY, margins) — **not** `investor-signals` until §7.2 is verified | `company-detail.tsx` (new section, reuses `["financials", ...]` query) | Figures match the statement cells; period + calculated badge shown |
| 1.3 | "Financial position" + "Profitability" sections with completeness-aware health score and metric tips | `company-detail.tsx`; `health-tab.tsx` (presentation only) | Score shows components available; missing values explained |
| 1.4 | "Valuation" section: P/E, P/B vs sector median (from `/peers` medians or `/scores` valuation), yield, market cap, period + conditions; remove naked verdict (C11) | `company-detail.tsx`; `health-tab.tsx:88-92,135-152`; `src/lib/brand.ts` glossary | Median comparison visible free; no verdict without numbers |
| 1.5 | "Key risks" section with events teaser + gate; "What to examine next" block (C17, C18) | `company-detail.tsx`; coordinate `premium-gate.tsx` copy with trust-audit owner | Count + teaser visible free; next steps link to real destinations |
| 1.6 | Statements: remove dead "click for details" promise or implement period/basis provenance info; surface `anomalyCount` cautiously; propose source line | `company-detail.tsx:1035-1277` | Copy matches behaviour; no false affordance |

### Phase 2 — parity, report page, polish (~3–4 days)

| # | Work | Files | Acceptance |
| --- | --- | --- | --- |
| 2.1 | Print report: ticker/ISIN resolution via `findCompanyByKey`, `dir`/`lang`, EN+AR, trust header, risks/next steps, keep premium gate | `src/app/company/[id]/report/page.tsx` | `/company/COMI/report` renders; both languages correct in print preview |
| 2.2 | AR/EN parity sweep: dates, number scale, enums, EN-only markers, `co.asOf` copy (C19, C20) | `company-detail.tsx`, `price-chart.tsx`, `health-tab.tsx`, requested i18n keys | AR page contains no unintended English except identifiers/industry, each marked |
| 2.3 | Accessibility: focusable tooltips, keyboard chart detail, tap targets, contrast (with Lead's tokens) | company-detail + brand components usage | Keyboard-only pass; axe check; `MetricTip` everywhere a ratio appears |
| 2.4 | Loading states with named skeletons; staleTime for tab queries (C27) | `company-detail.tsx`, `health-tab.tsx` | No blank panel > 1 s without a label |
| 2.5 | Copy deck application + i18n key requests (§7.1); QaBox company-scoped copy; remove `TEMP_EDIT_MODE` unused import (C30) | company-detail, qa-box, i18n (request) | Copy matches §5 exactly |

### Validation (after each phase)

- `npx tsc --noEmit`
- `npx eslint src/components/egx/company-detail.tsx src/components/egx/health-tab.tsx src/components/egx/price-chart.tsx src/components/egx/tradingview.tsx src/components/egx/qa-box.tsx src/app/company/\[id\]/report/page.tsx`
- `npx vitest run` (baseline 185 passed / 4 pre-existing auth-env failures — report honestly if
  the count changes; **note: there are currently no tests covering `company-detail.tsx`**)
- Playwright matrix (dependency already present): EN/AR × light/dark × 390/768/1440 × states
  (data / no filings / stale / no price / error / AI anonymous / AI ready). Acceptance set
  includes `scrollWidth === clientWidth` and no CSP/401 console errors on the page.
- `npm run build` — Lead runs final build.

---

## 7. Dependencies, asks, and boundaries

### 7.1 Copy/i18n keys I need from the Lead (`src/lib/i18n.tsx` is Lead-owned)

Requested as new keys (or approve inline `ar ? … : …` in my scope):
`co.overview`, `co.technical`, `co.financialStrength`, `co.whatChanged`, `co.peersCompare`,
`co.sourcesFilings`, `co.analystNote`, `co.periodInterimNotAnnualised`, `co.reportingPeriod`,
`co.lastUpdated`, `co.traceableLine`, `co.calculatedLine`, `co.notReportedValue`,
`co.bankLeverageNote`, `co.valuedVsSector`, `co.riskFlagsAreNotConclusions`,
`co.nextSteps`, `co.nextStepFilings`, `co.nextStepPeriod`, `co.nextStepCompare`,
`co.nextStepAnalyst`, `co.signInToRead`, `co.aiInterpretationBanner`, `co.aiStanceLabel`,
`co.aiDetails`, `co.profileEnglishOnly`, `co.eventsTeaserCta`, `co.askAboutCompany`,
plus Arabic signal-direction labels (`improving/deteriorating/watch`) for **Phase 1** if we ever
surface signals. Until then, "What changed" text is composed from existing i18n keys + numeric
values only.

### 7.2 Blocking question — `investor-signals` period semantics (do not ship until answered)

`GET /api/v1/companies/COMI/investor-signals` (unused by any UI, free/public) returns
`anchorPeriodKey = SEMIANNUAL:2026:H1` with:
- `REVENUE` H1 2026 = 36,172,233,000 and H1 2025 = 114,237,106,000,
- `NET_PROFIT` H1 2025 = 31,512,075,000,
while the statement series for the same company shows **standalone quarters**: Q2 2026 revenue
36.17B, Q1 2026 31.2B, Q2 2025 27.9B, and FY 2025 revenue 117B. The H1 2025 value (114.2B) cannot
be a half-year on the same footing as the quarterly series; the two period systems do not
reconcile. It looks like a report/period-key mismatch in the signals/engine path (outside my write
scope: `src/lib/financial/analysis/**`). Consequences: one of the engine's own interpretations
reads "Net margin expanded 31.8 % (27.6 % → 59.4 %)", and "Revenue grew −68.3 % vs opex −56.3 % —
negative operating leverage" — plausible only if the period keys are wrong (it would contradict
the standalone-quarter series where revenue grew +29.6 % YoY).

**Action:** ask the data/engine owner to verify period-key construction before any UI surfaces
these signals. My plan therefore computes "what changed" from the statement series the page
already displays, which is self-consistent (Q2 2026 vs Q2 2025) and does not depend on the signals
engine. I recommend not enabling `investor-signals` in Phase 1.

### 7.3 Lead decisions needed

1. **Approve the navigation change** (anchored Overview + 4 tabs) — it changes the tab contract
   that any deep link or nav entry may rely on; anchors are additive, tab removal is not.
2. **Premium-gate teaser policy**: may the Events section show a count + one teaser item free?
   (Business decision; trust-audit owner owns the generic gate copy.)
3. **Health tab split**: prefer moving score into the anchored sections and keeping radar/valuation
   detail Pro-gated as today, or keep Health as a standalone depth tab? (My recommendation:
   anchored, with the Pro-gated radar living under "Financial strength" details.)
4. **Report page EN output**: language by `?lang=` param or by `Accept-Language`? (Recommend
   `?lang=` with a visible switch, defaulting to AR as today to avoid changing behaviour.)
5. **Number formatting helper**: do you want a shared `formatEgp`/`formatPercent` AR variant
   (Latin digits, `ج.م`, tabular) in `src/lib/brand.ts`, or keep `src/lib/financial/units.ts`
   as-is and format in my components? (I must not edit the financial lib.)

### 7.4 What I will NOT change

Financial calculation engines (`src/lib/financial/**`, `src/lib/technical/**`, audit engines), AI
providers/orchestrator (`src/lib/ai/**`), Prisma schema/migrations, API routes/contracts, auth or
routing logic, `src/lib/i18n.tsx` (request keys), shell/nav/homepage (Lead-owned), premium-gate
component copy (trust-audit owner). No fabrication: every proposed figure above comes from live
API payloads and is labelled as such.

---

## Appendix A — measurement & reproduction

```js
// node_modules/.cache/audit/overflow.mjs (Playwright is already a devDependency)
// 1. open https://meza-ashy.vercel.app/company/COMI
// 2. wait ~6s, then:
const doc = document.documentElement
const maxRight = [...document.querySelectorAll("body *")]
  .reduce((m, el) => Math.max(m, el.getBoundingClientRect().right), 0)
return { scrollW: doc.scrollWidth, clientW: doc.clientWidth, maxRight }
// 390px viewport → { scrollW: 1913, clientW: 390, maxRight: 1913, widest: "flex flex-1 ... group" }
```

```js
// tab content timing: click Statements, then read the active panel every ~600ms
// 600ms/1400ms/2600ms → { len: 0, skeleton: 1 }; 5000ms → { len: 5759 }
```

Tab-strip overflow (production, 9 tabs; measured `role="tablist"`):

| viewport | tablist clientWidth | tablist scrollWidth | last fully visible tab |
| --- | --- | --- | --- |
| 1440 | 1072 | 1194 | Filings & Documents (55) — "AI analysis" at x≈1502, clipped |
| 1280 | 912 | 1194 | Dividends — Filings and AI clipped |

One tab ≈ 110 px, so removing the production-only "Technical" tab (HEAD state) leaves
1084 px > 1072 px at 1440 — still clipped. AR labels are shorter and fit at 1440.
Reproduction: read `tablist.scrollWidth` vs `clientWidth`, and each `role="tab"` right edge vs the
list's right edge.

## Appendix B — live payload facts used in this audit (COMI, 2026-11-09)

| Fact | Value |
| --- | --- |
| Identity | COMI · Commercial International Bank (Egypt) · البنك التجاري الدولي (إيجيبت) · Banks/Banking · LISTED |
| Counts | 55 reports · 40 events · 0 dividends · 960 verified values |
| `dataAsOf` | Q2 2026 (`2026-06-30`), `latestPeriods.annual = ANNUAL:2025`, `ttm = TTM:2026:Q2` |
| Market price | 128.05 EGP · asOf 2026-11-09T20:27:49Z · source `market-ticker (15-min delayed)` · not demo |
| FY 2025 metrics | revenue 117.0B · net profit 61.63B · ROE 26.6 % · ROA 4.3 % · D/E 0.16 · EPS 18.25 · P/E 7.02× · P/B 1.87× · market cap 432.5B · dividend yield `DATA_UNAVAILABLE` |
| Interim (default) metrics | Q2 2026: revenue 36.17B · net profit 21.49B · ROE 9.0 % · total assets 1690.0B · D/E `DATA_UNAVAILABLE` · EPS 6.51 · P/E 19.66× · P/B 1.77× |
| Standalone quarters (statements) | Revenue Q1 2026 31.2B · Q2 2026 36.17B · Q2 2025 27.90B; net profit Q1 2026 17.82B · Q2 2026 21.49B · Q2 2025 14.88B |
| Derived YoY (presentation math) | revenue +29.6 % · net profit +44.4 % · net margin 53.3 % → 59.4 % |
| Flags | `/financials` `anomalyCount` = 189 flagged cells |
| AI analysis (anonymous) | `GET /ai-analysis` → 401; panel renders the empty state |
| Report routes | `/company/COMI/report` → "الشركة غير موجودة."; `/company/<cuid>/report` → renders |

## Appendix C — line-reference index (most-cited)

```
company-detail.tsx
  55            unused TEMP_EDIT_MODE import
  132-171       extractStance + StanceBadge (AI stance pill)
  221-346       identity header (badge 234-243, data-as-of 286-302, description 304-306,
                scanner upsell 309-344)
  348-357       statement-basis + period-view controls (above tabs)
  359-406       tabs + tab content (overview order 371-384)
  509-523       ErrorState
  527-546       NoFinancialsEmpty
  550-646       OverviewTab (cards 570-621, MarketSnapshot 624, trend card 627-642)
  649-732       MarketSnapshot (valuation cards 663-668, price badge 679-699)
  734-807       TrendChart (bars row 771-804)
  811-1279      StatementsTab (dead promise 1042-1044, cells 1242-1264, edit mode 820-1092)
  1311-1352     EventsList
  1356-1539     PeersTab
  1541-1561     EventsTab + premium gate
  1565-1612     CompanyDividendsTab (no isError)
  1625-1700     DocumentsTable (no isError)
  1704-1965     AI panel (empty 1949-1961, trust badges 1851-1883, card 1885-1946)
health-tab.tsx   40-46 error→skeleton; 48-92 score/verdict; 98-119 inputs; 121-152 Pro blocks
price-chart.tsx  45-46/71-92 TradingView default; 179-181 snapshot count line
tradingview.tsx  86-104 gauge (fixed 420 height); 62-80 chart config (locale follows UI)
confidence-badge.tsx 62 (exported, never imported)
report/page.tsx  12-15 metadata; 27-37 CUID-only resolution; 92-105 hardcoded AR labels;
                 108 dir/lang; 141-153 health w/o completeness; 235-239 disclaimer
api.ts           100-120 CompanyDetail (sourceName not surfaced); 199-202 FinancialsData drift
```

---

*End of audit. Awaiting the Lead's brand components/tokens and the §7 decisions to begin
implementation in this scope.*
