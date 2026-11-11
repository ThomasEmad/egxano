# Meza — Visual & UI Audit (production baseline)

Status: audit of the **deployed production site** `https://meza-ashy.vercel.app`
(v0.3.0), captured 2026-11-09. It is the "before" half of the brand
transformation; the "after" half is compared in `docs/brand/visual-comparison.md`
once the rebuilt working tree is final.

> **Baseline note.** Production lags `main`: the deployed shell is the old
> "platform" sidebar (Dashboard / Scans / Rankings / Companies / Sectors /
> Compare / Portfolio / Dividends / Watchlist / Premium) with the old
> `EGX market intelligence` identity. The working tree already contains newer
> brand components and navigation. Everything below is what a real visitor sees
> *today*, and that is the correct baseline for a before/after comparison.

**Evidence root:** `../../../brand-artifacts/before/` (outside the repo so it
never pollutes the diff). Machine-readable logs: `capture-log.json` (console /
network per screen), `metrics.json` (overflow, contrast, touch targets),
`verification.json` (non-blank pixel checks), `manifest.json` (inventory).
Contact sheets: `contact-sheet-desktop.jpg`, `contact-sheet-mobile.jpg`.

Screenshot naming: `<page>--<lang>--<theme>--<viewport>.png`; first-viewport
crops live in `fold/`; edge states append `--<state>`. `mobile-menu` means a
390×844 viewport with the hamburger drawer open.

---

## 1. Method & evidence

- **Tooling:** `brand-artifacts/scripts/capture.mjs` (Playwright 1.57 /
  Chromium 1200), plus `verify-shots.py` (Pillow) for blank/truncation checks
  and `probe-menu.mjs` / `probe-overflow.mjs` for DOM forensics. Re-run with
  `node brand-artifacts/scripts/capture.mjs --label before`; phase 2 uses
  `--base http://localhost:3100 --label after --proxy-api`, which intercepts
  `/api/v1/**` and serves it from production so the local build shows real EGX
  data.
- **Matrix:** 7 routes × desktop 1440×900 and mobile 390×844; homepage and
  company page additionally AR-RTL, dark, light, and mobile-drawer-open; plus
  parity passes on the table-heavy pages (`companies`, `compare`, `dashboard`,
  `premium`, `login`) and `/status` + `/about` for trust-signal evidence.
- **Edge states:** loading (API held), API error (requests aborted), empty
  search, empty login submit, 404 route, bad company id.
- **52 screenshots total:** 37 full-page, 4 drawer-open viewport shots, 11 edge
  states. Pixel verification: **52/52 non-trivial (0 blank / 0 truncated)**.
- **Automated in-page metrics** on every screen: horizontal overflow,
  WCAG contrast for every visible text node (ancestor background compositing),
  font sizes, touch-target sizes, landmark/heading structure.
- **Limitations:** animations are disabled for determinism (the header marquee
  is frozen mid-scroll); service workers and analytics are blocked; fixed
  elements appear once in full-page shots; contrast is not computed over
  background *images* (marked "unverified"); authenticated screens were not
  captured (no test account); screen-reader/keyboard testing is out of scope.
  One AR desktop capture hit a slow stats request (see §10); the ticker/iframe
  internals are third-party and only observable as rendered.

---

## 2. First impression: does a stranger understand what Meza is?

**Partially — they learn "EGX data + scanner", not "research platform".**

The hero (`home--en--light--desktop.png`) reads *"Discover EGX opportunities
built on real published financials"* over a 3-line paragraph that starts
*"Institutional-grade pattern scanner: loss-to-profit turnarounds, revenue
acceleration, deleveraging…"*. A newcomer learns: Egyptian market, scanner,
published data. They do **not** learn the brand promise from `BRIEF.md`
("understand the stock before you decide"), nor that Meza is a research
workbench for companies/comparisons/technicals — the words "research",
"compare", "understand" are absent from the hero.

The immediate surroundings reinforce a *trading terminal*, not an institution:
left sidebar of 11 product sections (`home--en--light--desktop.png`), an
animated market ticker in the header, and three competing CTAs ("Open Financial
Terminal", "Build Custom Scanner", "Premium") in orange. The eyebrow badge —
`Independent Financial Intelligence Platform · Egyptian Exchange` — is the most
brand-useful line on the screen, but it is set in small acid-lime type at 1.44:1
contrast (see §4), so it is also the least legible thing in the hero.

Arabic first impression (`home--ar--light--desktop.png`): the message survives
translation but the same problems apply, plus the hero headline's gradient makes
the Arabic look decorative rather than authoritative (§5, §12).

The header makes the identity ambiguous before the hero is read: the wordmark
appears **twice side by side** — once in the sidebar (`Meza / EGX market
intelligence`, x≈12–230) and again in the top bar (`Meza`, x≈288) —
`home--en--light--desktop.png`, `companies--en--light--desktop.png`.

---

## 3. Homepage visual hierarchy

Observed order in `home--en--light--desktop.png` (full page is 5251 px tall on
desktop, 8654 px on mobile — `home--en--light--mobile.png`):

1. Hero + right-rail "Largest listed companies" card.
2. Four KPI tiles (`253`, `11,724`, `147,083`, `5,364`).
3. "From idea to decision in three steps" — three cards.
4. "Featured Egyptian Exchange Companies" — 8 ticker cards.
5. "Engineered for Serious Financial Research" — four pillar cards.
6. "Popular Pre-Built Scanner Strategies" — three scanner cards.
7. FAQ.
8. Final CTA panel + footer.

What works: the page has one H1 and a predictable H2-per-section rhythm
(heading outline captured in `metrics.json`), the sections are separated by
generous space, and the FAQ answers are plain-language and honest.

What is weak:

- **One primary action is missing.** The hero offers three competing actions
  (solid lime "Open Financial Terminal", outline "Build Custom Scanner", amber
  "Premium") and the sidebar offers 11 more links above the fold. There is no
  "start with a company" path, which is the product's actual first move.
- **KPI row is visually random.** The four numbers use four different colors —
  acid lime, ink, emerald, teal (`home--en--light--desktop.png`) — so no
  hierarchy is communicated; only the first one is branded. In AR light the
  strip rendered bare em-dashes in those four colors when the stats request did
  not return in time (`home--ar--light--desktop.png`) — the tallest numbers on
  the page became colored bars.
- **"Featured companies" is a repackaged table.** Eight near-identical cards at
  8-bit grey labels (Market cap / Revenue / Net profit / ROE) create a grid of
  micro-type rather than a narrative; three of the eight names are truncated
  ("Commercial Internat…", "Talaat Moustafa Grou…", "Egypt Aluminum (Eg…").
- **The proof section comes after the feature section.** "Engineered for Serious
  Financial Research" (the trust story) sits *below* a screen of marketing
  cards; trust should be adjacent to the numbers it qualifies.
- **Section eyebrows** ("HOW IT WORKS", "INSTITUTIONAL INTEGRITY", "FREQUENTLY
  ASKED QUESTIONS") are lime-on-cream at 1.44:1 — effectively decorative noise
  (§4).

Mobile (`home--en--light--mobile.png`) is the same page stacked: the hero
headline alone is four lines, the eyebrow pill wraps onto two lines, and the
first screen ends mid-KPI row above a fixed bottom bar; the "first screen" tells
a phone visitor almost nothing about what they can *do*.

---

## 4. Typography & contrast (measured)

WCAG contrast, computed in-page over composited backgrounds (all text nodes,
worst offenders recorded per screen; `metrics.json`):

| Screen | Text nodes sampled | Failures (<4.5 normal / <3 large) | Worst ratio |
|---|---|---|---|
| `home--en--light--desktop.png` | 312 | **64** | 1.44 (`#A3E635` on `#F9FAF8`) |
| `home--en--light--mobile.png` | 192 | **33** | 1.44 |
| `companies--en--light--desktop.png` | 285 | **57** | 1.51 (`#A3E635` on `#FFFFFF`) |
| `company--en--light--desktop.png` | 194 | 27 | 1.51 |
| `compare--en--light--desktop.png` | 147 | 26 | 1.05 (white on transparent!) |
| `dashboard--en--light--desktop.png` | 178 | 33 | 1.51 |
| `home--en--dark--desktop.png` | 311 | **0** | — |
| all dark-mode captures | — | **0** | — |

**Diagnosis by foreground color** (worst-12 samples across all light screens):
164 × `#A3E635`, 77 × `#16A34A`, 3 × `#FFFFFF`.

- **Acid lime as text on light is the single largest visual defect.** Ratio
  **1.44:1 on the page background, 1.51:1 on white** (13.34:1 on dark — which is
  why dark mode passes everywhere). It is used for hero gradient words, the
  eyebrow chips, "View all" links, KPI `253`, ticker badges (`COMI`, `SWDY`…),
  section eyebrows, FAQ numbers, tab badges, the "TradingView" pill, "Quick AI"
  labels (10–12 px!), and `Compare` chips. Fix direction is already in the
  strategy doc: `#4D7C0F` = 4.77:1 on `#F9FAF8`, `#3F6212` = 6.76:1; keep
  `#A3E635` for fills/accent only, and **never white text on acid lime**
  (1.51:1).
- **Semantic green is too light for small text.** `#16A34A` positive changes
  (11 px) measure **3.15:1** on the light background — e.g. the compare page
  price-change cells, `.text-positive` values in tables. Use `#15803D`
  (4.79:1) for text; keep `#16A34A`/`#22C55E` for chart strokes and fills.
- **The compare legend is invisible.** "Green = best in row — every value…"
  renders `#FFFFFF` on a transparent background (ratio **1.05**) — see the
  rounded empty pill under the table in `compare--en--light--desktop.png` /
  `compare--ar--light--desktop.png` and the crop
  `../../../brand-artifacts/probe/crops/crop-compare-bottom.png`. The
  row-highlight colours are therefore unexplained for anyone who cannot read
  that text.
- **Micro-typography is endemic.** Text nodes under 12 px: **238** on the
  homepage desktop, **240** on `/companies`, **205** on the company page, **161**
  on `/dashboard`, **138** on `/compare`; minimum font size **8 px** ("15m
  delayed" chip) and 10 px is used for the data disclaimers, ticker values,
  company names under tickers, and the footer legal line. On `390 px` mobile the
  same labels stay 9–11 px (`companies--en--light--mobile.png`).
- **Coherent parts:** body/heading scale and the muted grey `#5A6B5F` (5.42:1)
  are fine; dark mode is genuinely legible.

---

## 5. Graphite + Acid Lime execution

The identity is recognisable — graphite ink, lime brand mark, white cards. The
problems are about *roles*, not the palette:

- **Lime is used as a text colour** (§4) instead of as an accent. On light
  screens it reads as a highlighter that failed to render; on dark it is strong.
- **A second, unapproved hue enters the hero.** The H1 gradient is
  `from-primary to-teal-500 bg-clip-text` (`landing-client.tsx`, hero) →
  lime→teal gradient on EN and AR (`home--en--light--desktop.png`,
  `home--ar--dark--desktop.png`). Teal appears nowhere else in the system, and
  the gradient text adds two colours where the message needs one. It also breaks
  the "no gradient text" rule the strategy doc already states (§8).
- **Lime collides with financial up/down semantics.** The palette now contains
  three greens: acid lime `#A3E635` (brand + `chart-1`), success `#22C55E`
  (`--positive` / `chart-2`) and emerald `#10B981` (`chart-3`). Consequences in
  the product: (a) the company trend chart plots *Revenue* in lime and *Net
  profit* in success green — two bars that read as the same colour
  (`company--en--light--desktop.png`, "Revenue & net profit trend"); (b) the
  compare table highlights "best in row" cells with a lime tint while up/down
  changes are green/red — three meanings for green in one table
  (`compare--en--light--desktop.png`); (c) the homepage KPI row alternates lime,
  emerald and teal with no semantics at all.
- **Amber competes with lime** on every CTA group: "Premium" is amber in the
  hero and header (`home--en--light--desktop.png`), while "Upgrade" is a bordered
  pill and the primary action is lime — three accent colours in one action row.
- **Where lime works:** the dark theme (13.34:1), the solid lime buttons with
  graphite text (`#0A0F0B` on `#A3E635` ≈ 11.9:1), the active sidebar item, and
  the brand mark. Those are the patterns to keep.

---

## 6. Cards, radius and spacing

- **Radius is not one system.** In one viewport you see `rounded-lg` (8 px)
  inputs, `rounded-xl` (12 px) cards, `rounded-2xl` (16 px) hero/right-rail
  cards, `rounded-3xl` (24 px) final CTA and login card, plus `rounded-full`
  chips (`home--en--light--desktop.png`, `premium--en--light--desktop.png`,
  `login--en--light--desktop.png`). The login card and the final CTA feel like a
  different product from the dashboard cards.
- **Card treatment drifts.** Marketing cards are flat with 1 px borders; product
  cards add `shadow-lg` + hover lift (`card-hover` in `globals.css`), e.g.
  `dashboard--en--light--desktop.png` vs the homepage steps. The hero itself has
  a lime→transparent gradient wash and a 600 px blurred lime glow
  (`home--en--light--desktop.png`) — effects the strategy doc explicitly rules
  out for an institutional feel.
- **Spacing is inconsistent between pages.** The dashboard packs cards 16–24 px
  apart (`dashboard--en--light--desktop.png`); the homepage uses 96–160 px
  section gaps; `/premium` uses 24 px but a centred 760 px column
  (`premium--en--light--desktop.png`); `/login` is a 380 px card floating in an
  otherwise empty 1440×900 canvas (`login--en--light--desktop.png`).
- **Density vs. air:** `/companies` shows 3 columns × 3 cards above the fold on
  desktop with 10–12 px labels (`companies--en--light--desktop.png`), while the
  homepage hero devotes ~60 % of the first screen to headline + paragraph. Two
  different products.

---

## 7. Tables & chart readability

**`/compare`** (`compare--en--light--desktop.png`, `compare--ar--light--desktop.png`)

- Good: honest amber banner "companies are compared on different periods — each
  column shows its exact basis (FY / 9M / H1 / quarter)" when COMI is Q1 2026
  and SWDY Q2 2026; period label under each company; 2–4 company chips; URL
  state. This is exactly the kind of transparency the brand needs.
- Bad: subtitle says *"each one's latest annual statements"* while the table
  actually shows quarters — copy contradicts the data on the same screen.
- Bad: company headers repeat name + ticker + period, and long names truncate to
  "Commercial International Ban…" (`compare--en--light-desktop`); `METRIC`
  column is 55 % of the table width while numbers are squeezed to the right.
- Bad: the "best in row" highlight has no readable legend (§4), and the values
  mix three colors (green = highlight, lime/green = up, blue = P/E)
  with no visible key. 138 sub-12 px text nodes.
- Mobile (`compare--en--light--mobile.png`): table collapses to 2 columns +
  metric label but keeps 12 px type; the amber warning sits above the fold.

**Company page chart** (`company--en--light--desktop.png`)

- The TradingView chart renders and fits its card, with a tiny disclosure in the
  tab strip: *"chart + RSI/MACD studies — 15-min delayed data"*.
- **The "Technical Summary" card below the chart is completely empty** — a
  ~250 px blank white panel with only its title. It is the TradingView
  technical-analysis widget (`console`: *Framing
  `https://www.tradingview-widget.com/` violates CSP `frame-src`*, and the
  `s.tradingview.com/embed-widget/technical-analysis` request is aborted).
  `next.config.ts` allows `https://tradingview-widget.com` but not
  `https://www.tradingview-widget.com` (line 25) — a one-line CSP fix or the
  card should be removed rather than shipped empty.
- **The "Revenue & net profit trend (quarterly, EGP)" chart breaks the page
  width.** One column per quarter (Q3 2018 → Q2 2026, ~33 columns) in a
  non-wrapping flex row: the EN document becomes **3137 px wide at a 1440 px
  viewport** (`company--en--light--desktop.png`, `manifest.json` overflow=1697)
  and **1913 px wide at 390 px mobile** (`company--en--light--mobile.png`).
  Consequences: desktop users get a horizontal scrollbar (page background
  stretches 1.7 k px), and on mobile the page lays out at 5× the device width —
  the stylesheet viewport expands and everything renders miniaturised.
  In AR (`company--ar--light--desktop.png`) there is no scrollbar because the
  overflow runs off the RTL start edge — so **the newest quarters (2022–2026)
  are simply unreachable/clipped** (see
  `../../../brand-artifacts/probe/crops/crop-ar-trend3.png`).
  The chart also has no y-axis labels (magnitudes only via hover) and its two
  series are lime vs green (§5).
- `/companies` cards (`companies--en--light--desktop.png`) are readable as a
  grid but not as a table: no sortable columns beyond the 3 chips, 4 metrics
  only, ticker badge + name + price + change + ROE packed into ~330×245 px with
  10 px labels, and every card carries an identical "Quick AI" lime label.

---

## 8. Navigation clarity

- **Duplicate brand mark** in the desktop header (sidebar wordmark +
  header wordmark) — `home--en--light--desktop.png`, all app pages; see
  `../../../brand-artifacts/probe/crops/crop-header.png`.
- **The ticker strip is clipped by design at 1440 px.** The header shows
  `EGX 15m delayed`, `EGX30 51,414.9 ▲1.19%`, `EGX70 EWI 1…` and then the search
  box cuts it (`home--en--light--desktop.png`); the marquee is 5802 px long and
  the visible window is 300–440 px, so index values are rarely fully readable.
  With reduced motion the strip is static mid-number — and it reads as broken.
- **Search placeholder truncates to "Search comp…"** at 1440 px
  (`home--en--light--desktop.png`, `companies--en--light--desktop.png`) because
  the ticker + search + account block compete for the same row.
- **The sidebar's active state is wrong on the homepage**: `Dashboard` is
  highlighted while the visitor is on `/` (`home--en--light--desktop.png`;
  `AppSidebar` maps `/` → dashboard). The homepage is not the dashboard.
- **Navigation models coexist without a shared contract**: the app sidebar
  (11 product sections), the mobile bottom bar (5 items), and — on `/premium`,
  `/login`, `/status`, `/about` and 404 — *no chrome at all*
  (`premium--en--light--desktop.png`, `login--en--light--desktop.png`,
  `status--en--light--desktop.png`, `about--en--light--desktop.png`,
  `notfound--en--light--desktop--not-found.png`): no header, no sidebar, no
  footer, so the only way back is the browser.
- The nav labels are feature names (`Scans`, `Rankings`, `Portfolio`), not the
  four brand verbs (Understand / Compare / Monitor / Verify) the strategy doc
  prescribes.

---

## 9. Mobile navigation & layout gaps

1. **The hamburger drawer is unusable (highest severity).**
   `home--en--light--mobile-menu.png` shows only the drawer's brand header and
   close X in a ~55 px band; the nav list is not visible and the page shows
   through underneath. Verified via DOM probe
   (`brand-artifacts/probe/menu-2500ms.png`, `probe-menu.mjs`): the drawer root
   is `position: fixed; inset: 0; z-index: 60` but measures **390 × 55**, because
   it is rendered inside the mobile top bar, whose `backdrop-blur` creates the
   containing block for fixed descendants. Body scroll is locked, so tapping the
   menu traps the user on a page they cannot navigate.
2. **Consequently, most of the product is unreachable on a phone.** The bottom
   bar exposes only Home / Companies / Sectors / Dividends / Watchlist
   (`home--en--light--mobile.png`); Dashboard, Compare, Portfolio, Premium,
   Alerts and About live only in the broken drawer.
3. **No language switch or theme switch on mobile.** The mobile top bar is just
   hamburger + "Meza" (`home--en--light--mobile.png`,
   `home--ar--light--mobile.png`). The only toggles are desktop-only header
   buttons; on mobile they are inside the (broken) drawer.
4. **Company page lays out at 1913 px on a 390 px device** (§7) — full-width
   horizontal scroll and miniaturised text; `company--en--light--mobile.png`.
5. **Touch targets below 44 px:** 32/115 on the homepage, 35/93 on `/companies`,
   40/98 on the company page, 24/87 on the dashboard. Concrete examples from
   `home--en--light--mobile.png`: hamburger 36×36, ticker chips 44×22,
   "Run scan" 93×28, header brand link 278×20.
6. **Fixed bottom bar and safe areas.** The bar overlays the KPI row at the fold
   in `home--en--light--mobile.png`; vertical clearance is a hard-coded `pb-20`
   (`LayoutShell.tsx`) and neither the bar nor the layout uses
   `env(safe-area-inset-bottom)`, so on iPhones with a home indicator the last
   row of targets can sit under the system gesture area.
7. `/premium` on mobile (`premium--en--light--mobile.png`) is a single 390 px
   column with no navigation at all — an upgrade page a phone user cannot leave
   except with the back gesture.

---

## 10. Empty / loading / error states

- **Loading is invisible.** With `/api/v1/**` held,
  `companies--en--light--desktop--loading.png` shows the page title, search and
  filters over a **completely blank** content area — no skeleton, no spinner, no
  "loading" text. `home--en--light--desktop--loading.png` keeps the hero but the
  KPI/right rail stay empty shells. On a slow connection the page looks finished
  and broken at the same time.
- **Error states are honest but destructive.**
  `companies--en--light--desktop--api-error.png` shows a red "Failed to load
  companies — please check your connection" banner + Reload — good copy — but it
  **replaces the whole page body**: the `Companies` H1, search box, sector filter
  and sort chips disappear (h1 count = 0 in `metrics.json`). Users lose their
  context and any filters they had set. Same pattern on
  `compare--en--light--desktop--api-error.png`.
- **Homepage mixed degradation.** `home--en--light--desktop--api-error.png`:
  "Featured Egyptian Exchange Companies" degrades well with an explicit
  *"Live company data is temporarily unavailable. Browse the full list."*, but
  the hero KPI strip silently shows four coloured em-dashes and the "Largest
  listed companies" card renders as an empty card with only its disclaimer; the
  scanner-strategy cards are empty outlines with no explanation. The same
  coloured-dash state was captured on a normal page load in
  `home--ar--light--desktop.png` (stats request slower than the capture window;
  see `../../../brand-artifacts/probe/crops/crop-ar-kpi.png`).
- **Empty search:** the global header search has a proper empty panel
  ("NO MATCHING RESULTS" + keyboard hint, `companies--en--light--desktop--empty-search.png`).
  The page-level filtered-empty state was not reliably captured in this run
  (the harness hit the header search first); the state is scheduled for the
  phase-2 matrix.
- **Native validation bubble** leaks browser English onto the bilingual login
  form and covers the "Password" label / "نسيت كلمة المرور؟" link
  (`login--en--light--desktop--empty-submit.png`).
- **404** (`notfound--en--light--desktop--not-found.png`): honest message but
  no site chrome, both languages at once, and the big "404" numeral is lime on
  cream (~1.3:1). **Bad company id**
  (`company--en--light--desktop--bad-id.png`) shows a generic not-found state
  with an empty chart card and "—" metrics, no explanation of which ticker failed.

---

## 11. Trust signals (data source, freshness, delayed prices)

Present, but almost all of it is micro-type in corners:

- `EGX 15m delayed` chip in the header (10 px), `Prices delayed 15 min — not
  investment advice` in the sidebar footer (10 px) and app footer (10 px),
  `Latest recorded price · 15-min delayed · not investment advice` under the
  hero rail (9 px), `15m delayed` on the dashboard index card, `Price delay
  shown 15 min` on `/status`. The **disclosure exists everywhere the price
  appears — good** — but at 8–10 px and muted grey it is below the contrast and
  type-size the brand needs, and it is never adjacent to the big numbers it
  qualifies (hero KPI, company price).
- `/status` (`status--en--light--desktop.png`) is the best trust artifact:
  coverage `253 / 274`, 11,741 statements, 12,902 recorded price points, latest
  market price timestamp, latest statement imported timestamp, and an explicit
  "missing data shows as unavailable". Problems: it renders *both* languages
  simultaneously, mixes Arabic-Indic and Latin numerals in the same date
  (`٩ م ٢٧، ٢٠٢٦/١١/٠٩ Nov 2026, 20:27`), has no shell/nav/footer, and the
  numbers are 22 px muted — a page this important is visually the least branded
  on the site.
- Company page: "Data as of Q2 2026", `LISTED`, a `Traceable data` pill
  (lime, 10 px, 1.51:1), and scanner-match premium note. No per-figure source
  link or reporting-period chip near the metric cards.
- The footer disclaimer is the strongest statement on the page — *"Reports
  factual financial conditions with explanations. Not investment advice — no
  BUY/SELL recommendations are generated… unavailable values are shown as
  missing — never as zero or estimates. Prices are delayed 15 minutes."* — and
  it sits at the very bottom in 10 px grey.
- **What to keep:** the honest `—` for missing data (visible in
  `companies--en--light--desktop.png`: AALR/ACAMD revenue `—`), period labels
  beside values, the compare mis-matched-period warning, and the `/status`
  freshness table.

---

## 12. RTL / LTR parity

Macro layout mirrors correctly: sidebar to the right, hero rail to the left,
tables mirrored, header actions reversed (`home--ar--light--desktop.png`,
`compare--ar--light--desktop.png`, `dashboard--ar--light--desktop.png`).
`rtl-flip` correctly mirrors directional icons (`globals.css`).

Where parity breaks:

1. **Company trend chart:** EN overflows into a 3137 px-wide page (horizontal
   scroll); AR clips the overflow at the RTL start edge so the **newest quarters
   are unreachable** (`company--ar--light--desktop.png`,
   `../../../brand-artifacts/probe/crops/crop-ar-trend3.png`). Same component, worse outcome
   in Arabic.
2. **Bilingual-on-screen pages.** `/login` renders "تسجيل الدخول · Sign in",
   "تذكرني على هذا الجهاز · Remember me", Arabic *and* English subtitles
   (`login--en--light--desktop.png`, `login--ar--light--desktop.png` — identical
   because the page hardcodes both); `/status` does the same for every label
   (`status--en--light--desktop.png`); 404 and the app error screen also show
   both languages (`notfound--en--light--desktop--not-found.png`). The chosen
   language is ignored on these routes.
3. **Old identity still live:** the login page badge reads **"EGX"** in a lime
   circle (`login--en--light--desktop.png`) — pre-rebrand mark, on the page where
   users create accounts.
4. **Untranslated data in AR:** the company summary line stays English
   (*"Egypt's largest private-sector bank, listed on EGX (and formerly MSCI EM
   index heavyweight)"*), as do `Banks · Banking` and `LISTED`
   (`company--ar--light--desktop.png`).
5. **Numeral systems mixed:** AR dates render Arabic-Indic digits
   (`٠٩/١١/٢٠٢٦`, `٤:٠٦ ص`) while every price/metric uses Latin digits
   (`dashboard--ar--light--desktop.png`, `status--en--light--desktop.png`).
   `BRIEF.md` requires Latin digits + tabular numerals for numbers.
6. **Chart legends/axis labels stay English** inside third-party widgets
   (TradingView, `company--ar--light--desktop.png`) — acceptable for a licensed
   widget, but the surrounding captions must explain it.
7. Arabic hero headline (`home--ar--light--desktop.png`) breaks across three
   lines with a single orphaned word on the last line, because the EN layout was
   sized first; Arabic needs its own line breaks and tracking.

---

## 13. What currently works — keep

- **Honesty mechanics:** `—` instead of zeros, "unavailable" explanations,
  period labels next to values, period-mismatch warnings in compare, delayed
  price disclosures present on price surfaces, `/status` freshness data.
- **Dark theme:** 0 contrast failures in every dark capture; graphite + lime
  finally look intentional.
- **Information architecture bones:** one H1 per page, H2-per-section on the
  landing page, landmarks (`header/nav/main/footer`) present on every app page,
  0 unnamed interactive elements on most pages.
- **Card grid legibility at 1440 px:** `/companies` and `/premium` cards scan
  quickly; `/premium` had 0 contrast failures and clear Free/Premium columns.
- **RTL macro mirroring** and the bilingual copy model (`t()` + `ar ? … : …`).
- **Company page hierarchy:** identity → period view → tabs → chart → metrics →
  snapshot → trend; a researcher knows where to look.

---

## 14. Top 12 visual fixes (ranked)

| # | Fix | Evidence | Why it matters (brand) |
|---|---|---|---|
| 1 | **Render the mobile drawer through a portal** (or move it outside the blurred mobile bar) so `fixed inset-0` resolves to the viewport | `home--en--light--mobile-menu.png`, `probe/menu-2500ms.png` (drawer 390×55) | Phones are currently a dead end — no Dashboard/Compare/Portfolio/Premium. *Prep through understanding* cannot happen if navigation does not open. **Already fixed in the working tree; must be re-verified in phase 2.** |
| 2 | **Stop using acid lime as light-mode text.** `--primary` → deep lime (`#4D7C0F`, 4.77:1; `#3F6212` on tints) for links/eyebrows/badges; acid lime only for fills/marks; dark mode keeps `#A3E635` | metrics: 1.44:1 #A3E635 on #F9FAF8; 64 failures on homepage, 57 on `/companies` | Legibility is the brand's first promise. Half the accent surfaces on light are unreadable. |
| 3 | **Remove gradient text and the teal hue** from the H1 (flat ink + one lime accent word); give AR its own line breaks | `home--en--light--desktop.png`, `home--ar--light--desktop.png`, `home--ar--dark--desktop.png` | Gradient headlines = generic AI-startup; teal is outside the palette; Arabic line-breaking is an afterthought. |
| 4 | **Fix the company trend chart width**: horizontal-scroll container with fixed column width (or aggregate to ≤12 periods); never let it set page width | `company--en--light--desktop.png` (3137 px), `company--en--light--mobile.png` (1913 px), `company--ar--light--desktop.png` (newest quarters clipped) | A research platform whose chart breaks the layout — and hides recent quarters in Arabic — loses trust in one screen. |
| 5 | **Allow `https://www.tradingview-widget.com` in CSP `frame-src`** (or remove the empty card) | `company--en--light--desktop.png` (empty "Technical Summary"), console/network log | An empty white panel under "Technical Summary" reads as a broken product. |
| 6 | **Localise auth/status/404/error routes**: one language per request, Meza wordmark instead of "EGX", shared shell/header/footer | `login--en--light--desktop.png`, `status--en--light--desktop.png`, `notfound--en--light--desktop--not-found.png` | Arabic/English are equal citizens; showing both at once contradicts the brief and looks unfinished. |
| 7 | **Add real loading skeletons and keep page context on errors** (retain H1, search/filters; retry inline) | `companies--en--light--desktop--loading.png` (blank), `companies--en--light--desktop--api-error.png` (title/filters gone), `home--en--light--desktop--api-error.png` | States are the brand's honesty surface; today the loading state shows nothing and the error state deletes the page. |
| 8 | **Give every empty region a reason + next step** (hero KPI dashes, hero rail card, scanner cards, sector performance, bad ticker) | `home--ar--light--desktop.png` (coloured dashes), `home--en--light--desktop--api-error.png`, `dashboard--ar--light--desktop.png` (empty sector card) | "Missing data shows as unavailable" must be *explained*, not just rendered. |
| 9 | **Separate chart semantics from brand colour**: one lime series + ink + neutral grid; up/down = semantic green/red only; make the compare legend readable (it is currently 1.05:1) | `compare--en--light--desktop.png` (invisible legend pill), `company--en--light--desktop.png` (lime vs green series) | In finance, colour is data. Three greens = no data language. |
| 10 | **Clean the header**: remove the duplicate wordmark, stop clipping the ticker mid-number (show 2 indices fully or give the strip its own row), fix the truncated search placeholder, fix `Dashboard` being active on `/` | `home--en--light--desktop.png`, `companies--en--light--desktop.png` | The header is the brand's handwriting — right now it is crowded and self-contradictory. |
| 11 | **Raise the type floor to 12 px** for labels and disclaimers (currently 8–10 px; 238 nodes on the homepage), keep tabular numerals for figures | `home--en--light--desktop.png`, `companies--en--light--desktop.png`, `dashboard--en--light--desktop.png` | Micro-type hides the disclosures the brand is proud of; it also fails low-vision users. |
| 12 | **Mobile touch/overflow pass**: ≥44 px targets (32/115 on home), safe-area padding for the bottom bar, fix the company-page mobile width and the missing language/theme access | `home--en--light--mobile.png`, `companies--en--light--mobile.png`, `company--en--light--mobile.png` | A research brand is used one-handed on a phone before the market opens. |

*(Rank 1 is already fixed in the working tree per Lead; ranks 2–12 are the visual
items to verify in the phase-2 after/before pass. Item 5 may be owned by the
company-page owner; item 4 by the company-page/TradeView owner.)*

---

## 15. Appendix — inventory, console/network log, limitations

**Inventory (52):** see `manifest.json` for exact files, bytes and statuses.
Per page: `home` (11), `companies` (9), `company` (10, incl. bad-id), `compare`
(5), `dashboard` (4), `premium` (3), `login` (5), `status` (2), `about` (2),
`notfound` (1).
Contact sheets: `contact-sheet-desktop.jpg` (33 tiles),
`contact-sheet-mobile.jpg` (19 tiles).
Full-page heights ranged 5251 px (home desktop) to 8654 px (home mobile);
the company page is the only one that exceeded its viewport width (3137 / 1913 px).

**Console / network problems observed (full log in `capture-log.json`):**

| Screen group | Observation | Assessment |
|---|---|---|
| all company pages | `Framing 'https://www.tradingview-widget.com/' violates CSP frame-src` (×2 per load) | real defect → empty Technical Summary card (§7) |
| all company pages | `s.tradingview.com/embed-widget/technical-analysis…` + `widget-sheriff…` requests aborted | same cause; the chart itself renders |
| `home--en--light--desktop--api-error`, `companies--…--api-error`, `compare--…--api-error` | `net::ERR_FAILED` on `/api/v1/*` (expected: harness aborts them) | used deliberately to capture error UI |
| `notfound--…`, `company--…--bad-id` | HTTP 404 document + four `/api/v1/companies/does-not-exist-qa*` 404s | expected for the invalid route/id; the UI feedback is the finding (§10) |
| Next.js `<Link>` prefetches | `net::ERR_ABORTED` on `?_rsc=` requests | benign, filtered out of the log summary |
| service worker | `Service Worker registration blocked by Playwright` warning | harness artifact, not a site defect |

**Could not verify (report honestly):** authenticated dashboard/watchlist/
portfolio/alerts/admin screens; live checkout/premium purchase flow; chart
hover/tooltips; motion/interaction feel (animations intentionally disabled);
real server-side 500s (simulated with API aborts); screen-reader behaviour.
These belong in phase 2 after the local build is final, together with the
before/after comparison in `docs/brand/visual-comparison.md`.
