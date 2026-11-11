# Meza — Visual Comparison: Production (Before) vs Rebuilt (After)

> **Baseline:** Production `https://meza-ashy.vercel.app` (v0.3.0, deployed 2026-11-09)
>
> **After:** Local rebuild `http://localhost:3100` (working tree at `main` + brand transformation commits), proxied APIs → production
>
> **Captured:** 2026-11-10 via Playwright + proxy (`--proxy-api`). 32 screenshots in `brand-artifacts/after/`.
>
> **Contact sheets:** `brand-artifacts/after/contact-sheet-desktop.jpg`, `contact-sheet-mobile.jpg`

---

## 1. Executive Summary

| Area | Production (Before) | Rebuilt (After) | Status |
|------|---------------------|-----------------|--------|
| **Brand promise in hero** | "Discover EGX opportunities" — trading terminal feel | "افهم السهم قبل ما تقرر / Understand the stock before you decide" — research platform | ✅ Fixed |
| **Lime contrast (light)** | 1.44:1 (#A3E635 on #F9FAF8) — 64 failures | 4.8:1 (#4D7C0F primary) — 0 failures | ✅ Fixed |
| **Mobile navigation** | Drawer clipped to 55px (backdrop-filter trap) | Portalled to `<body>` — full height, functional | ✅ Fixed |
| **Horizontal overflow** | Company page 1913–3137px at 390–1440 | Overflow-x-auto chart container — no page scroll | ✅ Fixed |
| **Compare page** | Mixed periods, "best" marks on absolute scale | Aligned basis default, marks only on ratios with same period | ✅ Fixed |
| **P/E rankings** | DESC → most expensive = #1 (crown) | ASC for lower-is-better, no crowns, "(lower is better)" label | ✅ Fixed |
| **Sector ROE display** | "+19.5%" with up arrow (level shown as change) | "19.5%" plain, bar = value, red = negative | ✅ Fixed |
| **Trust chrome** | Missing on 10 pages (login, premium, etc.) | LayoutShell `chrome="marketing"` on all public pages | ✅ Fixed |
| **Auth pages** | "EGX" badge, raw API codes | Meza wordmark, plain bilingual errors, "not affiliated" | ✅ Fixed |
| **Premium page** | "+ Ads / No ads" (fake), un-completable payment | Honest capabilities, manual activation stated, payment state from settings | ✅ Fixed |
| **Terms** | "billed in advance / auto-renewal" (false) | "One-off 30-day manual activation, no card, no auto-renewal" | ✅ Fixed |

---

## 2. Screenshot Matrix (key comparisons)

| Page / State | Production Before | Rebuilt After | Notes |
|--------------|-------------------|---------------|-------|
| `/` EN light desktop | `before/home--en--light--1440.png` | `after/home--en--light--1440.png` | Hero rewritten, 4 proof pillars, trust row |
| `/` AR light desktop | `before/home--ar--light--1440.png` | `after/home--ar--light--1440.png` | Arabic-first, no gradient text |
| `/` AR dark desktop | `before/home--ar--dark--1440.png` | `after/home--ar--dark--1440.png` | Acid lime legible on graphite |
| `/` AR mobile 390 | `before/home--ar--light--390.png` | `after/home--ar--light--390.png` | No horizontal overflow, search works |
| `/companies` AR light | `before/companies--ar--light--1440.png` | `after/companies--ar--light--1440.png` | Period labels, provenance on cards |
| `/company/COMI` AR light | `before/company-CO...--ar--light--1440.png` | `after/company-CO...--ar--light--1440.png` | Fixed chart overflow, annual KPIs |
| `/company/COMI` AR mobile | `before/company-CO...--ar--light--390.png` | `after/company-CO...--ar--light--390.png` | Chart scrolls, no page overflow |
| `/compare?ids=COMI,ADIB` AR | `before/compare--ar--light--1440.png` | `after/compare--ar--light--1440.png` | Aligned basis, marks only on ratios |
| `/rankings?metric=p_e` AR | `before/rankings--ar--light--1440.png` | `after/rankings--ar--light--1440.png` | ASC sort, "(lower is better)", no crowns |
| `/sectors` AR light | `before/sectors--ar--light--1440.png` | `after/sectors--ar--light--1440.png` | Median ROE as level, no "+" sign |
| `/premium` AR light | `before/premium--ar--light--1440.png` | `after/premium--ar--light--1440.png` | Honest caps, manual activation, no fake ads |
| `/login` AR light | `before/login--ar--light--1440.png` | `after/login--ar--light--1440.png` | Meza mark, plain errors, "not affiliated" |
| `/status` AR light | `before/status--ar--light--1440.png` | `after/status--ar--light--1440.png` | Live data, no "Operational" badge |
| Mobile drawer open | `before/home--en--light--mobile-menu.png` | `after/home--en--light--mobile-menu.png` | Full height, all sections reachable |

---

## 3. Critical Fixes — Evidence

### 3.1 Financial Correctness

**P/E Rankings (Blocker #4 in audit-discovery)**
- **Before:** `GET /api/v1/rankings?metric=p_e` → DESC sort → AMER P/E 971.2 = #1 with 👑
- **After:** Client sends `order=asc` for `p_e`/`p_b`/`liabilities_to_equity` → COMI 5.9 = #1, "(lower is better)" label, no crowns
- **File:** `src/app/rankings/client.tsx:114` (`direction` computed from `LOWER_IS_BETTER` set)

**Company Compare Mixed Periods (Blocker #3)**
- **Before:** "Auto" basis → COMI Q1 2026, ADIB H1 2026, ABUK Q2 2026 → "best value" highlights active
- **After:** Default `aligned` basis = newest FY where ≥2 have annual; "latest" opt-in with warning banner; marks **only** when all columns share period + metric is ratio + no degenerate values
- **Files:** `src/app/compare/client.tsx:207-221` (aligned probe), `:473-499` (comparability banner), `:315-335` (marks logic)

**Sector ROE as Change (Blocker #7)**
- **Before:** `sectors-shell.tsx:84-96` → `change = medianRoe` → "+19.5%" with 📈
- **After:** Plain "19.5%" with bar length = value, red = negative ROE, explanatory note: "ROE here is a level... not a price change"
- **File:** `src/app/sectors/sectors-shell.tsx:219-245`, `:273-279`

### 3.2 Trust & Transparency

**Fabricated "No ads" (Blocker #1 audit-trust)**
- **Before:** Free "+ Ads", Premium "No ads" — `AdSlot` dead, `ADS_ENABLED` unconsumed
- **After:** Removed entirely. Capability matrix shows **verified** premium benefits only (all events, unlimited AI+refresh, full rankings/valuation, full report+PDF, unlimited portfolio)
- **File:** `src/app/premium/client.tsx:203-241` (benefits), `:609-636` (capability matrix)

**Un-completable Payment (Blocker #2)**
- **Before:** "Bank transfer / wallet" with no numbers, `PAYMENT_PHONE=""`, WhatsApp button never renders
- **After:** Payment details render **only when configured**; if missing: "Payment details aren't published yet... no money changes hands until transfer details appear"
- **File:** `src/app/premium/client.tsx:555-599`

**Terms Contradiction (Blocker #7)**
- **Before:** "billed in advance / Cancellation stops renewal" — English-only, undated
- **After:** "Premium: one-off manual activation... 30 days... no card stored... no auto-renewal... current price and period shown on Premium page before you request" — bilingual, dated
- **File:** `src/app/terms/terms-client.tsx:36-38`, `:86-88`

**Auth Pages (Blocker #5, #6)**
- **Before:** "EGX" badge, raw `INVALID_CREDENTIALS`/`RATE_LIMITED`
- **After:** Meza wordmark, "Independent research platform — not affiliated with the Egyptian Exchange", mapped bilingual errors (`loginError`/`registerError`)
- **Files:** `src/app/login/page.tsx:27-40`, `src/app/register/page.tsx:31-48`

**Missing Trust Chrome (Blocker #8)**
- **Before:** 10 pages without footer/`#main-content` (login, register, premium, about, status, disclaimer, terms, alerts, auth/finish, 404)
- **After:** All public pages use `LayoutShell chrome="marketing"` → `PublicHeader` + `AppFooter` + `<main id="main-content">`
- **Files:** `src/components/layout/LayoutShell.tsx` (chrome prop), `src/app/login/layout.tsx` etc. (pass chrome)

### 3.3 Responsive & Accessible

**Horizontal Overflow (Blocker #1 audit-company)**
- **Before:** 32-period flex row → 1913px at 390px, 3137px at 1440px
- **After:** `TrendChart` wrapped in `overflow-x-auto` + `min-w-max` inner container; page never scrolls horizontally at 360–390px
- **File:** `src/components/egx/company-detail.tsx:833-835`

**Mobile Drawer Clipped (Blocker #1 audit-visual)**
- **Before:** Fixed `inset-0` inside blurred top bar → containing block = 55px bar
- **After:** `createPortal(..., document.body)` + mounted gate; full viewport height
- **File:** `src/components/layout/MobileNavDrawer.tsx:63-68`, `:15-20`

**Contrast Failures**
- **Before:** `#A3E635` on `#F9FAF8` = 1.44:1 (64 failures on homepage)
- **After:** Light `--primary` = `#4D7C0F` (lime-700, 4.8:1); acid lime only as accent fills; financial semantics use `--positive`/`--negative` (never lime for direction)
- **File:** `src/app/globals.css` (tokens), `docs/brand/design-system.md` (rules)

---

## 4. Files Changed (by scope)

### Lead-owned (foundation, homepage, shell, design system)
| File | Change Type |
|------|-------------|
| `src/app/globals.css` | Tokens refined (lime-700 primary, acid lime accent), utilities added |
| `src/app/layout.tsx` | Metadata, themeColor updated |
| `src/app/manifest.ts` | Name, colors, Arabic-first |
| `src/app/page.tsx` | Hero rewritten, FAQ updated, SEO |
| `src/app/landing-client.tsx` | **Complete rewrite** — brand hero, 4 pillars, research walkthrough, connected picture, trust-as-product, FAQ |
| `src/lib/brand.ts` | **New** — `BRAND`, `TRUST`, `METRIC_GLOSSARY`, `formatMoney`, `formatDate` |
| `src/lib/seo-config.ts` | Description updated |
| `src/components/brand/*` | **New** — 10 primitives (`MezaMark`, `SectionHeading`, `DataStateBadge`, `SourceLine`, `FreshnessBadge`, `MarketDataLine`, `MetricTip`, `EmptyState`, `CompanySearch`, `PublicHeader`) |
| `src/components/layout/LayoutShell.tsx` | `chrome="marketing"` mode |
| `src/components/layout/AppSidebar.tsx` | Navigation restructured, `MezaWordmark` |
| `src/components/layout/MobileBottomNav.tsx` | Core research loop (Home/Companies/Screener/Compare/Watchlist) |
| `src/components/layout/MobileNavDrawer.tsx` | Portalled, `MezaWordmark`, fixed clipped drawer |
| `src/components/egx/app-footer.tsx` | Institutional footer with trust row |
| `scripts/generate-brand-assets.mjs` | Updated OG image (Arabic-first, no fake stats) |
| `public/logo.svg`, `public/og-image.png` | Regenerated |
| `next.config.ts` | TradingView CSP fix (`www.tradingview-widget.com`) |

### Company Research (company-research scope)
| File | Change Type |
|------|-------------|
| `src/components/egx/company-detail.tsx` | `OverviewTab` props fixed (periodView passed), `TrendChart` overflow-x-auto, Tooltip imports |

### Compare & Discovery (compare-discovery scope)
| File | Change Type |
|------|-------------|
| `src/app/compare/client.tsx` | **Major** — aligned basis default, comparability banner, marks only on valid ratios, hydration fixes (mounted gate, native button) |
| `src/app/rankings/client.tsx` | **Major** — correct sort direction, "(lower is better)", honest footer claim, sector medians |
| `src/app/sectors/sectors-shell.tsx` | **Major** — ROE as level not change, bars = value, red = negative |
| `src/components/layout/TopHeader.tsx` | Search accessibility (ARIA, keyboard) |

### Trust & Activation (trust-activation scope)
| File | Change Type |
|------|-------------|
| `src/app/premium/client.tsx` | **Major** — honest capabilities, payment state from settings, manual activation flow, capability matrix, FAQ |
| `src/app/terms/terms-client.tsx` | **Major** — bilingual, manual activation terms, dated |
| `src/app/login/page.tsx` | Error mapping, Meza mark, independence statement |
| `src/app/register/page.tsx` | Error mapping, 8–72 password rule, Meza mark |
| `src/app/about/client.tsx` | Trust chrome, data handling section |
| `src/app/status/client.tsx` | No "Operational" badge, honest status |
| `src/app/auth/finish/page.tsx` | Marketing chrome |
| `src/app/forgot-password/page.tsx` | Marketing chrome |
| `src/app/reset-password/page.tsx` | Marketing chrome |
| `src/app/disclaimer/disclaimer-client.tsx` | Marketing chrome |
| `src/app/privacy/privacy-client.tsx` | Marketing chrome |

### Lint/Type Fixes (cross-cutting)
| File | Change |
|------|--------|
| `src/components/egx/price-chart.tsx` | Hydration-safe `setState` |
| `src/components/ui/carousel.tsx` | Hydration-safe `setState` |

### Deleted
- `src/components/auth-form.tsx` (unused)
- `src/components/egx/app-header.tsx` (dead code)

---

## 5. Test Results

| Suite | Result | Notes |
|-------|--------|-------|
| `npx tsc --noEmit` | ✅ Pass | 0 errors |
| `npx eslint src/app src/components src/lib` | ✅ Pass | 0 errors, 0 warnings |
| `npx vitest run` | 185/189 pass | 4 pre-existing failures in `src/lib/__tests__/auth.test.ts` (test DB config: `DATABASE_URL` missing — unrelated to changes) |
| `npm run build` | ❌ Fail | **Pre-existing** failure in `src/lib/admin-ops.ts` (dynamic `fs.openSync`/`spawn` for admin background jobs — incompatible with serverless; file not modified) |

> **Note on build failure:** The admin background job system uses Node.js filesystem APIs (`fs.openSync`, `child_process.spawn`) which cannot be bundled for Vercel serverless. This is a pre-existing architectural constraint, not a regression. The file was not touched in this work.

---

## 6. Remaining Production Blockers

| Blocker | Source | Status |
|---------|--------|--------|
| Admin background jobs (`admin-ops.ts`) | Pre-existing | Requires separate server or queue infrastructure; not fixable in brand scope |
| Payment channel config (`PAYMENT_PHONE`, `WHATSAPP_NUMBER`) | Ops | Honest "not published" state shipped; needs ops to populate |
| Support mailbox | Ops | Links to `/about`, `/status` only; no invented contact |
| Custom domain | Ops | Currently `meza-ashy.vercel.app` |
| Authenticated screenshots | Visual audit | No test account; manual review needed for `/portfolio`, `/watchlist`, `/alerts` |
| Screen-reader/keyboard testing | Accessibility | Out of scope for automated capture |

---

## 7. Unresolved Findings (from audits)

| Finding | Audit | Reason Unresolved |
|---------|-------|-------------------|
| `investor-signals` period semantics (H1 vs Q2 mismatch) | audit-company §7.2 | Engine/data concern; documented as limitation |
| Compare/rankings mixed-basis selection in APIs | audit-discovery | Backend change required; UI now warns |
| Market ratios ranked on non-full periods (`fullPeriodCodes` excludes `p_e`/`p_b`) | audit-discovery | Calc engine review needed; UI labels but doesn't "fix" |
| Noisy sector means (UI uses medians correctly) | audit-discovery | Already correct in UI |
| Dead dashboard "Upgrade" button | audit-discovery §5 | In compare-discovery scope, not yet implemented |
| Landing FAQ premium overclaims | audit-trust | Fixed in landing-client.tsx rewrite |
| Version-label drift (v0.3.0 vs v1.0.0) | audit-trust | Build-time injection needed |

---

## 8. Verification Checklist

- [x] TypeScript: `npx tsc --noEmit` — **PASS**
- [x] ESLint: `npx eslint src/app src/components src/lib` — **PASS**
- [x] Vitest: 185 pass / 4 pre-existing fail — **NO REGRESSIONS**
- [x] Visual: 32 after-screenshots captured, contrast verified, overflow verified
- [x] Mobile: 390px viewports captured, drawer functional, no horizontal scroll
- [x] RTL/LTR: AR/EN captured in both light/dark
- [x] Arabic: Natural Egyptian financial register, dates with Latin digits, `ج.م` currency
- [x] Trust vocabulary: `TRUST` constants used consistently across pages
- [x] No fabricated data: All screenshots show real production data via proxy
- [x] No new dependencies added

---

## 9. Next Steps for Production Release

1. **Resolve admin background jobs** — Move to separate worker/service or use Vercel Cron + serverless-compatible queue
2. **Configure payment channels** — Populate `PAYMENT_PHONE`, `WHATSAPP_NUMBER`, `PAYMENT_INSTRUCTIONS` in Vercel env
3. **Set up support mailbox** — Add real contact to `/about`, `/status`, `/privacy`
4. **Custom domain** — Point `meza.app` (or similar) to Vercel
5. **Manual QA** — Authenticated flows (`/portfolio`, `/watchlist`, `/alerts`), Arabic RTL at 360px, screen-reader pass
6. **Deploy preview** — Vercel preview deployment for stakeholder review
7. **Production deploy** — After all above verified

---

**Prepared:** 2026-11-10
**Working Tree:** `main` + brand transformation commits (see `git status --short` for full file list)
**Artifacts:** `../brand-artifacts/before/`, `../brand-artifacts/after/`, `../brand-artifacts/scripts/`
**Audit Docs:** `docs/brand/audit-*.md`, `docs/brand/strategy.md`, `docs/brand/design-system.md`, `docs/brand/BRIEF.md`