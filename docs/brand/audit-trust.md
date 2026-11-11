# Meza — Trust & Activation Audit (Phase 1)

Status: audit only. **No source files were modified for this document.**
Scope owner: `trust-activation` teammate.
Read alongside: `docs/brand/BRIEF.md`, `docs/brand/strategy.md` (§6 voice, §7 trust vocabulary, §10 conversion, §12 non-negotiables).

| Field | Value |
| --- | --- |
| Repo revision inspected | `main` @ `6ccf1ba` plus the Lead's in-progress working-tree changes (`globals.css`, `layout.tsx`, `app-footer.tsx`, sidebar/shell, new `src/components/brand/*`, `src/lib/brand.ts`) |
| Production probe time | 2026-11-09, ≈21:37 UTC / 23:37 Cairo |
| Pages probed live | `/premium`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/about`, `/status`, `/disclaimer`, `/terms`, `/privacy`, `/watchlist`, `/portfolio`, `/alerts`, `/auth/finish`, a 404 URL |
| Public APIs probed | `/api/v1/settings/public`, `/api/v1/status` |
| Edits made | none (read-only audit phase) |
| Screenshots | not produced here — `qa-visual` owns visual evidence; this audit is source + served-DOM/text + live-API based |

> Note on drift: the live deployment reports `Meza v0.3.0` in the sidebar while the current repo `Sidebar.tsx:531` says `Meza v1.0.0` and `MobileNavDrawer.tsx:148` says `v0.3.0`. Production may lag `main`; findings below are verified against the repo source and the live DOM where they agree. Line numbers for Lead-owned foundation files (`app-footer.tsx`, `LayoutShell.tsx`, `TopHeader.tsx`, `Sidebar.tsx`, `i18n.tsx`, `src/components/brand/*`) are advisory because the Lead is editing them concurrently.

---

## 0. Executive summary — the seven things that break trust today

1. **A paid benefit that does not exist:** Free plans are sold as `+ Ads` and Premium as `No ads` (`premium/client.tsx:183,201`) but **no ad is rendered anywhere in the product** (`AdSlot` is defined in `lib/client/subscription.ts:25` and never imported; `ADS_ENABLED` is returned by the public settings API and never consumed). This is the single clearest "fabricated capability" in scope.
2. **The paid path cannot actually be completed:** production settings return `PAYMENT_PHONE: ""`, `WHATSAPP_NUMBER: ""` while `PAYMENT_INSTRUCTIONS` says *"Please transfer the amount and send proof to WhatsApp."* The page shows "Bank transfer / wallet" with no account number and a "Contact via WhatsApp" button that never renders. A user who wants to pay has nowhere to send money.
3. **"Alerts" overclaim notifications:** onboarding copy promises *"تصلك تنبيهات الأسعار" / "get notified when a stock reaches your target price"*, but alerts are lazily evaluated only when the signed-in user opens `/alerts` (or polls it). No email or push delivery exists anywhere in the codebase.
4. **Raw machine codes as user-facing errors:** `INVALID_CREDENTIALS`, `RATE_LIMITED`, `EMAIL_ALREADY_EXISTS`, `VALIDATION` are printed verbatim (`login/page.tsx:62,68`; `register/page.tsx:76`). The client also validates a 6-character password while the server requires 8 (`register/page.tsx:57,145` vs `api/v1/auth/register/route.ts:15`).
5. **Auth pages wear an "EGX" badge, not Meza** (`login/page.tsx:78-83`, `register/page.tsx:99-106`) — at the moment a user is asked to trust the platform, the logo implies exchange affiliation, contradicting the independence claim used in metadata (`about/page.tsx:8`).
6. **The trust statements are missing from the pages where they matter:** the footer/disclaimer is rendered only on pages using `LayoutShell`; live probes confirm no footer and no `#main-content` landmark on `/premium`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/about`, `/status`, `/disclaimer`, `/terms`, `/alerts`, `/auth/finish`, and the 404 page. Only `/watchlist` and `/privacy` (and partially `/about`) have a main landmark, so the global skip link targets nothing on most pages.
7. **Terms contradict the billing model:** `/terms` is English-only, undated, and says *"billed in advance … Cancellation stops renewal"* — there is no subscription billing or auto-renewal in this product; Premium is a one-off 30-day manual activation (`api/v1/admin/payment-requests/[id]/verify/route.ts:15,22`).

Everything else in this document is a consequence of those seven, or a lower-severity clarity/consistency issue.

---

## 1. Scope & inspection method

### 1.1 Files read line-by-line

Pricing / conversion
- `src/app/premium/page.tsx`, `src/app/premium/client.tsx`
- `src/app/api/v1/settings/public/route.ts`, `src/app/api/v1/subscription/request/route.ts`, `src/lib/client/subscription.ts`, `src/lib/client/subscription-gate.ts`, `prisma/seed-subscription.ts`
- `src/components/egx/premium-gate.tsx`; premium gating call-sites `src/components/egx/health-tab.tsx`, `src/components/egx/company-detail.tsx` (events/AI/report), `src/app/rankings/client.tsx`, `src/app/undervalued/client.tsx`, `src/app/api/v1/alerts/route.ts` (not gated — relevant to claim accuracy)

Auth / onboarding
- `src/app/login/page.tsx`, `src/app/register/page.tsx`, `src/components/auth-form.tsx`, `src/components/auth/oauth-buttons.tsx`, `src/app/auth/finish/page.tsx`, `src/app/forgot-password/page.tsx`, `src/app/reset-password/page.tsx`, their `layout.tsx` metadata files
- `src/app/api/v1/auth/{login,register,forgot-password,reset-password,change-password}/route.ts`, `src/lib/client/watchlist.ts`

Retention
- `src/app/watchlist/{page,client}.tsx`, `src/app/portfolio/{page,client}.tsx`, `src/app/alerts/{page,layout}.tsx`, `src/components/user-menu.tsx`, `src/components/egx/app-header.tsx`, `src/components/layout/{LayoutShell,TopHeader,Sidebar}.tsx`

Institutional / legal
- `src/app/about/{page,client}.tsx`, `src/app/disclaimer/{page,disclaimer-client}.tsx`, `src/app/terms/{page,terms-client}.tsx`, `src/app/privacy/{page,privacy-client}.tsx`, `src/app/status/page.tsx`, `src/components/egx/app-footer.tsx`, `src/lib/i18n.tsx` (footer strings, metrics labels)
- `src/app/api/v1/status/route.ts`

Global states
- `src/app/loading.tsx`, `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/not-found.tsx`, root `src/app/layout.tsx` (skip link / landmarks)

Shared foundation already produced by the Lead (reused in the plan, not duplicated)
- `src/lib/brand.ts` (`BRAND`, `TRUST`), `src/components/brand/{brand-mark,data-trust,empty-state,public-header,section-heading,metric-tip}.tsx`, `LayoutShell chrome="marketing"`

### 1.2 Live evidence collected

Shell/landmark matrix (served HTML, HTTP 200 unless noted):

| Page | `#main-content` | Footer trust block | Product nav |
| --- | --- | --- | --- |
| `/premium` | ✗ | ✗ | ✗ |
| `/login` | ✗ | ✗ | ✗ |
| `/register` | ✗ | ✗ | ✗ |
| `/forgot-password` | ✗ | ✗ | ✗ |
| `/reset-password` | ✗ | ✗ | ✗ |
| `/about` | ✓ (bespoke header) | ✗ | partial ("Dashboard") |
| `/status` | ✗ | ✗ | ✗ |
| `/disclaimer` | ✗ | ✗ | ✗ |
| `/terms` | ✗ | ✗ | ✗ |
| `/alerts` | ✗ | ✗ | ✗ |
| `/auth/finish` | ✗ | ✗ | ✗ |
| `/watchlist` | ✓ | ✓ | ✓ |
| `/privacy` | ✓ | ✓ | ✓ |
| `/portfolio` | ✓ | ✓ | ✓ |
| 404 | ✗ | ✗ | ✗ |

`GET /api/v1/settings/public` (live):
```json
{"PREMIUM_ENABLED":true,"ADS_ENABLED":true,"PREMIUM_PRICE":99,"PREMIUM_CURRENCY":"EGP",
 "PREMIUM_DURATION_DAYS":30,"PAYMENT_PHONE":"","WHATSAPP_NUMBER":"",
 "PAYMENT_INSTRUCTIONS":"Please transfer the amount and send proof to WhatsApp."}
```

`GET /api/v1/status` (live):
```json
{"status":"ok","time":"2026-11-09T21:37:26.363Z",
 "market":{"pricesAsOf":"2026-11-09T20:27:49.792Z","delayMinutes":15,"trackedPrices":266},
 "data":{"companiesTotal":274,"companiesActive":253,"financialReports":11741,
         "marketPricePoints":12902,"aiAnalyses":108,"latestReportImportedAt":"2026-11-07T23:14:17.802Z"},
 "usage":{"activePriceAlerts":1}}
```

Visible `/premium` text (served HTML, before hydration of the settings query) matches `client.tsx`: `Upgrade to Premium`, `30-day subscription — 99 EGP`, the six-item feature grid, `Free` / `Premium` + **`Recommended`**, `+ Ads` / `No ads`, `Request Premium Subscription`, `Payment methods`, `Bank transfer / wallet`. No header, no footer, no back link.

Visible `/register` text includes the standalone `EGX` badge, five required inputs, a consent checkbox with no link, and an English-only primary button (`Create account`).

### 1.3 Method limits
- No browser/screenshot tool in this subagent: layout/contrast judgements that need pixels are deferred to `qa-visual`; every claim here is grounded in source lines, served DOM text, or public API output.
- Read-only phase: no runtime experimentation with authenticated states (pending/rejected/active premium, signed-in alerts). Those states were reasoned from source and API contracts; they must be visually tested with `qa-visual` after implementation.
- Production appears to lag `main` (`v0.3.0` vs `v1.0.0`), so live findings are corroboration, not the only source of truth.
- Line numbers can shift while the Lead edits foundation files; the implementation plan re-verifies before touching.

---

## 2. What works and must be kept

Keep these — they already express the brand correctly and should not be "simplified away" during the redesign.

1. **Price/plan data comes from public settings, not hardcoded config** (`premium/client.tsx:22-25,57-64`) — the mechanism is right; only the fallback is wrong (P2).
2. **No fake urgency, no trial, no countdown, no "limited seats", no profit claims** anywhere in scope (grepped for `trial|تجريب|خصم|guarantee|مضمون|ضمان|countdown`). The pricing voice is already calm — protect it.
3. **Manual activation is disclosed, not hidden** (`premium/client.tsx:160-164,226-230`; seed comments `prisma/seed-subscription.ts`) — the honesty instinct is right; it just needs to be moved *above* the price and CTA.
4. **Explicit "no card is stored" promise in Premium metadata** (`premium/page.tsx:8`), matching the real manual-transfer model (privacy policy corroborates: no card data, §2).
5. **The signed-out alert gate is a clean, single-purpose wall** (`alerts/page.tsx:71-89`) with both sign-in and sign-up paths — the right pattern, currently let down by the "notified" promise (R2) and missing chrome (R1).
6. **Honest "no email service" disclosure on forgot-password** (`forgot-password/page.tsx:11-14,47-53`). This is exactly the tone the whole brand should use for limitations; keep the wording, add a real contact path (A9/T6).
7. **OAuth error catalogue is bilingual, specific and reassuring** (`auth/finish/page.tsx:22-37`) — the best error copy in the codebase; reuse its style for auth and payment errors.
8. **Portfolio never estimates:** "Positions valued at recorded prices — never estimates" and a per-holding `no recorded price — shown at cost` fallback (`portfolio/client.tsx:89-91,196-198,238-242`). This is the "show limitations" principle in action.
9. **Premium gating is honest where it exists:** company events tab (`company-detail.tsx:1555-1557`), scanner-match teaser (`company-detail.tsx:309-325`), health radar body, full report page, `undervalued` top-3 preview, `rankings` top-10 preview. Keep every one of these gates — they are the product-true source for the pricing matrix.
10. **Status page exposes real counts and freshness** (`status/page.tsx:99-140`) including the 15-minute delay and "nothing is invented — missing data shows as unavailable". Keep the data, fix the always-green badge (T5).
11. **About page's "never estimated" paragraph and the "— means unavailable, not zero" note** (`about/client.tsx:59-68,89-93`). Keep verbatim; extend with identity/contact (T4).
12. **Privacy policy is genuinely institutional**: bilingual, dated, 12 substantive sections, lawful basis, retention, rights (`privacy-client.tsx`). It is the template for what `/terms` should become.
13. **Watchlist empty state tells the user how to fix it** ("tap the star on any company", `watchlist/client.tsx:102-111`) and the watchlist copy already mentions device storage. Right idea, fix route/label and sync truth (R4/R5).
14. **Account gating for portfolio resolves after mount** (hydration-safe) and anonymous users never hit protected endpoints (`portfolio/client.tsx:57-70`) — keep this pattern when adding copy.
15. **The shared brand foundation already exists and is used correctly:** `MezaWordmark`, `DataStateBadge`, `SourceLine`, `FreshnessBadge`, `UnavailableValue/Note`, `EmptyState`, `PublicHeader`, and `LayoutShell chrome="marketing"` (`src/components/brand/*`, `src/lib/brand.ts`). My implementation will consume these rather than add parallel components.

---

## 3. Issue register

Severity: **S1** trust-breaking (false claim, dead-end in a critical flow, legal/identity contradiction) · **S2** brand risk (materially weakens trust/conversion) · **S3** inconsistency/clarity · **S4** polish.
"Principle" refers to `docs/brand/strategy.md` (§ numbers) and `BRIEF.md` brand principles (1–5).

### 3.1 Pricing & conversion

| # | Issue | Sev | Principle | file:line | Proposed fix (presentation/copy/UX only) |
| --- | --- | --- | --- | --- | --- |
| P1 | **"No ads" / "+ Ads" is a fabricated capability.** No ad component is mounted anywhere; `AdSlot` is dead code; `ADS_ENABLED` is served but never read. Also appears in the (unmounted) legacy premium modal. | S1 | Never fabricate capabilities (BRIEF §5; strategy §12.1) | `premium/client.tsx:183,201`; `lib/client/subscription.ts:25-35`; `api/v1/settings/public/route.ts:7`; `egx/app-header.tsx:575` | Delete the `+ Ads` and `No ads` rows. Replace with real benefits: free "Browse companies, statements, ratios — no account needed"; premium "Full multi-year report + print/PDF" (both verified in code). If ads ever ship, render them from `ADS_ENABLED` + a real `AdSlot` and only then re-add the claim. |
| P2 | **Hardcoded price fallback can display a fabricated price.** `99 / EGP / 30 days` are defaults when settings are not loaded; a changed admin price flashes wrongly, and if settings fail the page sells at a stale number. | S2 | Honesty (evidence, not defaults) | `premium/client.tsx:59-64` | Render a price skeleton/"checking current plan settings…" until `settingsData` resolves. On failure show "Current price unavailable — try again" and disable the request CTA; never render a default price. |
| P3 | **Manual activation reality is buried below the price and CTA.** Price is the first thing on the page (`30-day subscription — 99 EGP`), the CTA looks like a normal self-serve upgrade, and "admin review" appears only after the button. | S2 | Preparation not hype; transparency | `premium/client.tsx:119-131,154-170,206-232` | Reorder to: what Premium adds → **how activation works (3 steps)** → price → CTA → payment details → comparison → legal. Rename CTA to a request, not an upgrade. |
| P4 | **Anonymous "Submit Subscription Request" fails silently.** The mutation has no `onError`; the API returns 401 `UNAUTHENTICATED` (`subscription/request/route.ts:17-20`); the visitor sees nothing happen. | S1 | Conversion integrity; factual errors | `premium/client.tsx:42-55,165-168` | Session-aware CTA: signed-out → `Sign in to request Premium` linking `/login?next=/premium`; signed-in → request. Add inline error region + retry for failures. |
| P5 | **Payment path is a dead end in production.** `PAYMENT_PHONE`/`WHATSAPP_NUMBER` are empty, so the "Bank transfer / wallet" card shows no transfer target and the WhatsApp button never renders — yet seeded instructions still say "send proof to WhatsApp". | S1 | Institutional trust; never fabricate a process | `premium/client.tsx:206-232`; `prisma/seed-subscription.ts:48-50`; live settings | Show payment details **only** when a channel is configured. If none: honest state — "Payment details aren't published yet. You can submit a request; no money changes hands until transfer details appear here and you confirm a payment." (Requests *are* recorded, so this is true.) Ops must configure the numbers/instructions (DB settings — Lead/ops decision, not a source edit). |
| P6 | **The premium feature grid presents free or partially free capabilities as Premium-exclusive:** Health Score (overall score is free; only the visual is gated), AI thesis (3/month free), latest results (public API), statements/quarters (public), sector screen (top-3 free). | S2 | Truthfulness of pricing; "state exactly what is free" (strategy §10) | `premium/client.tsx:133-150` | Replace the grid with an explicit "What Premium adds **on top of Free**" list containing only exclusive items (all events, unlimited analyses + instant refresh, full rankings/valuation lists past the previews, full multi-year report + print/PDF, portfolio without the 2-position cap) and quantify each cap. |
| P7 | **Time-bound claim** "Verified 2026 quarters" will silently become false in 2027 and overstates completeness of the current year. | S3 | Honesty; no promises beyond data | `premium/client.tsx:140` | Drop the year: "Quarterly statements with full time series where filed". If a year is shown, derive it from data and state "as filed". |
| P8 | **"Recommended" badge has no basis** — there is exactly one paid plan; "recommended" implies an external authority/choice. | S3 | No fake authority/superlatives | `premium/client.tsx:186-194` | Replace with a factual label: "One plan · manual activation" / "باقة واحدة · تفعيل يدوي". |
| P9 | **Free vs Premium comparison is asymmetric and omits the strongest real benefits** while using vague "Advanced financial analysis"; free column spends its space on the fake ad penalty. | S2 | Clarity; explain data, don't sell fluff | `premium/client.tsx:173-204` | Publish a complete capability matrix (Free | Premium) with exact caps: 3 Smart Analyses/mo · 2 portfolio positions · top-10 rankings · top-3 valuation rows · 1-page overview report → unlimited / full lists / full report + PDF / events / instant refresh. Add a separate "Always free, no account: browsing, statements, ratios, rankings preview". |
| P10 | **Page metadata overclaims scope:** "full EGX data, rankings and reports" implies dataset access; rankings/reports are partially public. | S3 | Honesty in SEO copy | `premium/page.tsx:6-8` | Retitle: "Premium — full reports, company events and unlimited analysis" (matching the real benefit list). |
| P11 | **No terms/refund/activation-policy link at the point of purchase**, and nothing says "no auto-renewal, no card, one-time 30 days". `/terms` is linked nowhere in the flow. | S2 | Transparency; preparation | `premium/client.tsx` (whole page); `terms` page | Add a legal/activation row under the price: "One-time 30-day activation · no card stored · no auto-renewal · Terms · Risk notice". Link to `/terms`, `/disclaimer`, `/privacy`. |
| P12 | **`PREMIUM_ENABLED` is ignored.** If subscriptions are paused server-side, the page still sells and accepts requests. | S2 | Truthful availability | `premium/client.tsx:22-25`; `api/v1/settings/public/route.ts:6` | If `PREMIUM_ENABLED === false`, render a factual "Subscriptions are paused right now" state and hide the request CTA (presentation-only read of an already-public flag). |
| P13 | **Active premium members still see the sales comparison and Payment methods blocks**; no renewal/manage guidance (renewal is a new manual request, not auto-renew). | S3 | Clarity; retention | `premium/client.tsx:173-232` vs `83-93` | For `isPremium && ACTIVE`: show membership card (plan, start, expiry) + "what happens at expiry" + how to renew (new request) + support, and hide the purchase comparison/payment blocks. |
| P14 | **Premium gating copy is generic at the exact moment of intent:** "Premium feature / Upgrade to Premium to unlock this feature", used bare by the company Events tab; no mention of what's included, what stays free, or manual activation. | S2 | Clarity; preparation | `premium-gate.tsx:16-24,52-58`; used at `company-detail.tsx:1556` | Default copy: name the section, one line on what Premium adds, one line that free accounts keep statements/ratios/3 analyses, CTA "See what Premium includes" → `/premium`. Keep `compact` variant for inline teasers. |
| P15 | **Terminology drift: "Pro" vs "Premium"** for the same plan. | S3 | One institution, one language | `health-tab.tsx:126,163,165` vs `premium-gate.tsx:46-48`, `TopHeader.tsx:422` | Use "Premium" everywhere (AR "بريميوم"). |
| P16 | **Arabic price/currency formatting is not localised** ("99 EGP" instead of "99 ج.م"), and the price line lacks a period unit. | S4 | Voice §6 (numbers with Latin digits + ج.م) | `premium/client.tsx:128-130` | "99 ج.م · 30 يوماً" in AR, "EGP 99 · 30 days" in EN; use `.tabular`. |

### 3.2 Auth & onboarding

| # | Issue | Sev | Principle | file:line | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| A1 | **Login/register display a standalone `EGX` badge as the brand.** At the trust moment, the logo reads as the exchange, not Meza; it contradicts "independent, not affiliated with the EGX". | S1 | Institutional identity; independence (strategy §3) | `login/page.tsx:78-83`; `register/page.tsx:99-106` | Replace with `<MezaWordmark lang={lang} size={40} />` + one-line independence statement ("Independent research platform — not affiliated with the Egyptian Exchange"). Keep the card compact. |
| A2 | **Raw API error codes are rendered as messages** (`INVALID_CREDENTIALS`, `RATE_LIMITED`, `EMAIL_ALREADY_EXISTS`, `VALIDATION`, `INTERNAL_ERROR`). | S1 | Reassuring, factual error messages (BRIEF §5; strategy §6) | `login/page.tsx:62,68`; `register/page.tsx:76`; `auth-form.tsx:33` | Map codes to bilingual human copy (see copy deck C18). Never print a code; keep an optional "Reference" only for 5xx, not for auth failures (avoids enumeration cues). |
| A3 | **Password policy mismatch:** client validates 6 chars and says "6 أحرف على الأقل", server requires 8–72; users get an opaque rejection after submit. Reset page enforces 8–72, adding a third rule. | S2 | Clarity; respect the user | `register/page.tsx:57,61,145`; `api/v1/auth/register/route.ts:15`; `reset-password/page.tsx:30-33` | Single rule: 8–72. Show the requirement *before* typing (helper text) and validate inline; align `minLength`. |
| A4 | **Consent checkbox links nowhere.** "أوافق على شروط الاستخدام" is plain text; there is no link to `/terms` or `/privacy`, though the policy is collected at signup. | S2 | Legal/trust; transparency | `register/page.tsx:165-176` | Make "Terms of Service" and "Privacy Policy" real links (open in new tab), and state in one line what consent means. |
| A5 | **`?next=` is ignored on registration.** `/alerts` sends users to `/register?next=/alerts` (`alerts/page.tsx:85`), but register always redirects to `/` (`register/page.tsx:81`) and passes `next="/"` to OAuth (`:194`). The activation intent is lost. | S2 | Activation continuity | `register/page.tsx:7-9,81,194`; `alerts/page.tsx:85` | Read `next` via `useSearchParams`, validate it is a same-site path, redirect there after signup and pass it to OAuthButtons. **Touches redirect behaviour — implement only with Lead sign-off** (no API change). |
| A6 | **Auth pages are orphaned:** no header, no logo-home link, no footer, no legal links, no `main` landmark. A visitor on `/register` cannot navigate anywhere except the form. | S2 | One institution; trust evidence at consent | `login/layout.tsx`, `register/layout.tsx`, `forgot-password/layout.tsx`, `reset-password/layout.tsx`; live probe | Wrap in `LayoutShell chrome="marketing"` (already built by Lead) or a focused auth shell that still renders `PublicHeader` + `AppFooter`. Ensure `<main id="main-content">`. |
| A7 | **Five inputs before any value or evidence.** Name, email, password, confirm password, consent — with no statement of what an account gives you, no trust row, no "no card" reassurance. | S2 | Prove value before asking (strategy §10) | `register/page.tsx:109-195` | Trim to email + password + optional name (API already treats `name` as optional), drop "confirm password" in favour of a show-password toggle, and add: 3 short benefit lines + trust row (`Data from published filings · prices delayed 15 min · not investment advice`) + "Free account. No card." |
| A8 | **No first-run/activation experience after signup.** Success drops the user on the landing page with no next step, no acknowledgment, no checklist, no return-to-intent. | S2 | Onboarding/activation | `register/page.tsx:77-85` | Return to `next` when present; otherwise show a dismissible 3-step "Start here" checklist (① follow a company ② set a price target ③ read a company's financial picture), each step deep-linked. Mount in `watchlist`/`alerts`/`portfolio` empty states now; request Lead mounts it on the landing/dashboard. |
| A9 | **Password recovery dead-ends with no support contact.** Forgot says "contact the platform administrator"; reset says "paste the reset code you received from support" — no address, link, or SLA anywhere. | S2 | Reassuring, actionable errors | `forgot-password/page.tsx:47-57,83-87`; `reset-password/page.tsx:88-92` | Keep the honest "no email service" explanation; add a real support contact (blocked on a monitored mailbox, T6). Explain the 30-minute single-use code validity (true) and what to do if it expires. |
| A10 | **Bilingual parity broken on auth actions:** error strings, labels and buttons are English-only; most prose is hardcoded AR+EN in one paragraph, so one language is always second-class; headings render both languages joined by "·". | S3 | EN/AR equal citizens (strategy §12.6; BRIEF voice) | `login/page.tsx:85-92,112,126,161`; `register/page.tsx:105,186`; `auth-form.tsx`; `forgot-password/page.tsx:46-53`; `reset-password/page.tsx:63-66` | Render **one** language from `useI18n()` per view (no dual blocks), with natural Arabic written first-class. Keep the existing `auth/finish` bilingual-error pattern only for unrecoverable error pages. |
| A11 | **No show-password control**; `showPassword` state in login is never toggled (dead UI), register/reset inconsistency. | S3 | Accessibility/usability | `login/page.tsx:23,131-140`; `register/page.tsx:137-150`; `reset-password/page.tsx:139-142` | Add a labelled eye toggle (EN/AR) to password inputs; keep `autoComplete` attributes; announce state via `aria-pressed`. |
| A12 | **Dead legacy `AuthForm`** with English-only placeholder-only fields, no labels, no autocomplete, generic "Failed" errors — still shipped in the bundle. | S4 | Brand consistency | `auth-form.tsx:45-67` (no imports found) | Delete the component (documented as dead code) or archive outside `src`. No behaviour change. |
| A13 | **OAuth section has no data-sharing note** and no error affordance for provider-unavailable (buttons simply never appear). | S4 | Transparency | `oauth-buttons.tsx:34-52` | Optional one-liner under the divider: "We receive your name and email from the provider." No layout change when providers are unconfigured. |

### 3.3 Retention surfaces

| # | Issue | Sev | Principle | file:line | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| R1 | **`/alerts` is an orphan page:** no shell, no nav, no footer, no `main` landmark — even for signed-in users; every other "My space" page uses `LayoutShell`. | S2 | One institution | `alerts/page.tsx:91-147`; `alerts/layout.tsx:9-11`; live probe | Wrap both signed-out gate and signed-in view in `LayoutShell` (app chrome for signed-in; marketing/app chrome for the gate — Lead's call). |
| R2 | **Alerts promise delivery that doesn't exist.** Gate copy "so notifications reach you / get notified"; the only mechanism is lazy evaluation when the page is opened or polled. | S1 | Show, don't claim (BRIEF §5; strategy §7) | `alerts/page.tsx:78-83`; `api/v1/alerts/route.ts:9-20,37-88` | Honest model: "We compare your targets with the latest recorded price (15-minute delayed) and show any hit here, in the app. We don't send email or push." Never use "notify" until a delivery channel exists. |
| R3 | **API failure is displayed as an empty state.** Non-OK responses are mapped to `{ alerts: [] }`, so an outage looks like "no alerts". | S2 | Factual error states | `alerts/page.tsx:55-60,112-145` | Add explicit error branch: "Couldn't load your alerts — no changes were made. Try again." + retry button; keep empty state only for a successful empty response. |
| R4 | **"Saved on this device" is incomplete:** when signed in, the watchlist is merged to and synced from the account (`watchlist.ts:21-24,37-43,47-74`). | S3 | Accuracy | `watchlist/client.tsx:95-99`; `lib/client/watchlist.ts` | "Saved on this device; synced to your account when you sign in." (AR in copy deck C12). |
| R5 | **Empty-state CTA label/destination mismatch:** "Explore companies" navigates to `/dashboard`. | S4 | Clarity | `watchlist/client.tsx:107-109` | Point to `/companies` (the company directory) and keep the star instruction. |
| R6 | **Developer jargon leaks in a trust-critical state:** "`N` watched id(s) not found in the current database". | S3 | Reassuring, factual voice | `watchlist/client.tsx:193-197` | "`N` company in your list isn't covered yet — it will appear as soon as financial data is available." Use `UnavailableNote` if suitable. |
| R7 | **Watchlist table has per-row dates but no provenance/freshness line**; users cannot see the source/period basis for the whole table in one place (strategy pillar: Verify). | S3 | Trust shown not claimed | `watchlist/client.tsx:119-190` | Add a `SourceLine`-style line above the table: source = published filings; period = latest reported; prices delayed 15 min; missing values show "—". |
| R8 | **Any portfolio error is presented as "sign in"**, including server/network failures — the UI misdiagnoses the cause. | S2 | Factual, reassuring errors | `portfolio/client.tsx:96-102` | Branch on `error.message === "AUTH"`: signed-out → existing sign-in card; other → "Couldn't load your portfolio — no data was changed. Try again." + retry. |
| R9 | **Portfolio limit upsell omits manual activation**, so the limit feels like an instant upgrade that then isn't instant. | S3 | Honest pricing | `portfolio/client.tsx:304-308,345` | "Free plan: 2 positions. Premium removes the limit — activation is manual after payment review." Link to `/premium#how-activation-works`. |
| R10 | **Portfolio inputs are self-reported but not stated;** there is also no global freshness line for prices. | S3 | Transparency | `portfolio/client.tsx:89-91,152-157,238-242` | Add one line: "Values use the quantities and average costs you enter, priced from recorded market snapshots (15-minute delayed)." |
| R11 | **The account menu is effectively missing.** `UserMenu` is rendered only by the unmounted legacy `AppHeader`; the live header dropdown has only *Subscription* + *Sign out* — no name/plan/expiry, no links to watchlist/portfolio/alerts, no password change. | S2 | Retention; institutional product | `user-menu.tsx:46-78`; `egx/app-header.tsx:343` (dead); `TopHeader.tsx:429-465` | Consolidate into one `AccountMenu` component in my scope: identity (name/email), plan + end date, links (watchlist, portfolio, alerts, premium), "Change password" (modal using the existing API — see R12), sign out with confirmation. **Mounting is in `TopHeader.tsx`, a Lead-owned file — needs coordination.** |
| R12 | **No change-password UI** although `POST /api/v1/auth/change-password` exists and is rate-limited. Users cannot rotate credentials. | S3 | Trust/recovery | `api/v1/auth/change-password/route.ts`; grep: no page/modal | Add a modal from `AccountMenu` (no new route, no API change) with code-mapped errors. |
| R13 | **The premium upsell copy in the sidebar is inaccurate/vague:** "Advanced analysis, instant comparisons, custom scanner" — comparisons are free and "instant" is a speed claim; only scanner *runs* are premium. | S3 | Truthfulness | `Sidebar.tsx:513-517` (Lead-owned) | Replace with three real benefits: "All company events · full reports · unlimited analyses". |
| R14 | **Version strings are user-facing and contradictory:** sidebar `Meza v1.0.0`, mobile drawer `Meza v0.3.0`, production `v0.3.0`. | S3 | Institutional, not dev-build | `Sidebar.tsx:531`; `MobileNavDrawer.tsx:148` | Remove version labels from user-facing chrome (or keep one internal build note in `/status`). Lead-owned. |
| R15 | **The top-header account area says "For full access" to signed-out users** — implies reading is gated, which contradicts the free-browsing promise. | S3 | Clarity | `TopHeader.tsx:420-424` | "Free account — save your research" / "حساب مجاني — احفظ بحثك". Lead-owned. |
| R16 | **Legacy `app-header.tsx` (587 lines) is unmounted dead chrome** that duplicates navigation and contains the fake "No ads" premium modal. It is a future brand-drift risk. | S3 | One institution | `egx/app-header.tsx:184-587`; grep: no imports | Delete after R11 moves `UserMenu` into the live header (document in the worklog). Lead-owned file. |

### 3.4 Institutional, legal & trust communication

| # | Issue | Sev | Principle | file:line | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| T1 | **Trust footer/disclaimer missing from the highest-trust pages:** `/premium`, auth pages, `/about`, `/status`, `/disclaimer`, `/terms`, `/alerts`, `/auth/finish`, 404 — verified live. | S1 | Show, don't claim; one institution | `LayoutShell.tsx` (app pages only); live probe | Wrap every page in scope in `LayoutShell chrome="marketing"` (or `app` where appropriate); ensure `<main id="main-content">` so the global skip link works (`layout.tsx:117-122`). |
| T2 | **Terms of Service is English-only, undated, and contradicts the billing reality:** "billed in advance", "Cancellation stops renewal; you retain access until the end of the paid period" imply recurring billing; there is no auto-renewal (`verify/route.ts:15,22` = one-off 30-day activation). No price/duration/currency, no manual-verification description, no contact. | S1 | Legal accuracy; transparency | `terms/terms-client.tsx:1-30`; `api/v1/admin/payment-requests/[id]/verify/route.ts:15,22` | Full bilingual rewrite: manual 30-day activation, no card stored, nothing auto-charged, no auto-renewal, what happens at expiry, how to renew (new request), refund/cancellation policy, limitation of liability, contact, "Last updated" date. Add link from `/premium`. |
| T3 | **Disclaimer omits the disclosures the brand promises:** no AI-interpretation statement, no 15-minute delayed-price statement, no source naming, no calculated-vs-reported distinction, no last-updated date; Arabic has errors (`المسول`), mixed English inside Arabic (`العائد على Equity`). | S2 | Trust vocabulary §7; voice §6 | `disclaimer/disclaimer-client.tsx:17-43` | Add sections: sources (published filings + delayed public market feed), price delay, AI interpretation is not advice/prediction, calculated vs reported, missing data shown "—", limitations, last updated. Copy-edit Arabic. |
| T4 | **About never states independence or affiliation in visible copy** (only in `<metadata>`), has a placeholder subtitle ("Meza platform" / "منصة ماسح البيانات المالية"), no operator identity, no contact, and the platform numbers have no "as of" or error/retry state (on API failure they show "—" indefinitely). | S2 | Institutional, not personal (principle 3); evidence | `about/client.tsx:50-55,57-94`; `about/page.tsx:8` | Add an independence block ("Independent research platform, not affiliated with the EGX, any broker or issuer…"), operator identity + contact, source/limitation statements, and timestamp + retry for the stats. |
| T5 | **`/status` always claims "Operational".** Badge is static (`تعمل الآن · Operational`) even if the status API fails and every number is "—"; the status API itself hardcodes `status:"ok"`; the page publishes "Active price alerts: 1" (traction vanity metric, not reliability) and has no "what we monitor"/"last checked". | S1 | Honest evidence; never a trust slogan | `status/page.tsx:94-96,36-38,55-80`; `api/v1/status/route.ts:26` | Derive the state from the fetch: loaded → "Status data current · checked HH:MM"; failed → amber "Status data unavailable — we couldn't read the status feed; this is not a statement that everything is fine." Remove the active-alerts card; replace with "Coverage: 253 of 274 companies have current data; 21 show as unavailable" (derived from the same payload) and a "What this page checks" block. Keep API/CSV links. |
| T6 | **No contact/support surface anywhere on the site** (grep: no `support@`, `contact@`, contact section, or channel in footer/about/status) — yet password reset, payment verification and rejected requests all depend on reaching an operator. | S1 | Institutional trust; recovery | whole site; `forgot-password/page.tsx:47-57`; `premium/client.tsx:206-232` | Add one truthful contact block (footer + about + forgot-password + premium payment step) once the Lead/ops confirms a monitored mailbox and WhatsApp number. **Blocked on real contact details — do not fabricate an address.** |
| T7 | **Privacy contact is a deployment hostname** (`privacy@meza-ashy.vercel.app`), which is almost certainly not a mailbox; the product's only legal contact route may fail silently. | S2 | Institutional/legal | `privacy-client.tsx:15,39,65,89` | Replace with the real monitored address in all four places; keep the rest of the policy (it is the best legal page). Blocked on T6. |
| T8 | **The public site runs on `meza-ashy.vercel.app`**, and legal text points at it. For an institutional financial product this reads as a prototype host. | S2 | Institutional trust | `seo-config.ts:5`; privacy/about metadata | Custom domain decision is outside source (ops/Lead). Presentation mitigation until then: avoid printing the host in visible copy; keep canonical URLs consistent. Flag only — cannot be fixed in this task. |
| T9 | **Footer trust block is still generic and duplicates one sentence:** `ft.disclaimer` ("Educational / informational tool…") + `ft.demoNotice` (same facts re-stated); no independence/affiliation line, no AI label, no source naming, no contact. Arabic link label bug from the old footer was fixed by the Lead's rewrite, but the i18n strings behind it did not change. | S2 | Trust vocabulary §7 | `app-footer.tsx:68-87`; `i18n.tsx:286-293` (Lead-owned) | Replace the two keys with one institutional trust block (EN+AR, copy deck C23): independent/not affiliated · sources · 15-min delay · missing = "—" · AI = interpretation not advice · contact. Keep it 3 short lines. |
| T10 | **Legal/about/status pages are not part of the research flow:** `/about` invents its own mini-header (only "Dashboard"), `/status` and legal pages end with "Back to home" but no nav/footer. | S2 | One institution | `about/client.tsx:32-47`; `status/page.tsx:83-148`; legal clients | Use the shared marketing chrome; end every legal page with research links (Companies / Compare / Status) rather than only "Back to home". |
| T11 | **No site-wide provenance statement that names the sources** (published filings + a public delayed market feed). Status says "market data provider", about says "published statements", footer says neither. | S2 | Verify pillar; show source | `status/page.tsx:133-139`; `about/client.tsx:64-68`; footer | One consistent sentence reused everywhere (copy deck C23/C24); name the delayed public feed generically, not a licensed vendor that doesn't exist. |
| T12 | **Legal metadata inconsistencies:** `/terms` and `/disclaimer` have no "last updated"; `/terms` metadata lacks OG/alternates while sibling pages have them. | S4 | Consistency | `terms/page.tsx`; `disclaimer/page.tsx` | Add `lastUpdated` to content and align metadata shape with `/privacy`. |

### 3.5 Empty / loading / error & global states (G1–G6)

| # | Issue | Sev | Principle | file:line | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| G1 | **404 page is bare and its CTA label doesn't match its destination:** "Back to dashboard" links to `/` (the landing page); no nav/footer; dual-language prose joined by "·". | S3 | Factual, useful errors | `not-found.tsx:5-23`; live 404 | Single-language copy from `useI18n()` (client boundary is fine), correct label ("Back to home"/"العودة للرئيسية"), add secondary links (Companies, Premium) and a footer/shell. |
| G2 | **Global error boundary bypasses the design system:** hardcoded hex palette, inline styles, `dir="ltr"` only, no brand mark; the route-level `error.tsx` is much better. | S3 | Accessibility/brand consistency | `global-error.tsx:6-55` | Keep dependency-free markup (it replaces the root layout) but use neutral graphite/lime constants matching `--brand-*`, support RTL by rendering both languages in fixed order, add an `aria-live` role. |
| G3 | **Route error copy shows Arabic first even in an English session** and exposes a `Reference:` digest only sometimes; wording "No data was modified" is good and should stay. | S3 | Voice parity | `error.tsx:21-48` | Use `useI18n()` (error boundary is inside `Providers`): one language, keep "no data was modified" reassurance, keep digest as "Reference" in muted text. |
| G4 | **Route loading skeleton is generic (8 table rows) on every page**, including pages with no table; no route-specific message. | S4 | Calm loading | `loading.tsx:4-17` | Keep the skeleton but add a neutral label and reduce to blocks that match the typical page frame; per-page loading files only where a route's shape differs materially. |
| G5 | **Empty/error state patterns are inconsistent across my pages** (watchlist/portfolio/alerts each hand-roll theirs); the new `EmptyState` component is not yet adopted. | S2 | Consistency; explain why + next step | `watchlist/client.tsx:102-117`; `portfolio/client.tsx:96-116`; `alerts/page.tsx:128-143`; `brand/empty-state.tsx` | Adopt `EmptyState` for all three, with a shared structure: why it's empty · what it means · one next action · honest limitation line. Share error treatment via a small local `ErrorState` block (no new dependency). |
| G6 | **Skip link targets a non-existent `#main-content` on all bare pages** (verified live). Keyboard users land nowhere; screen readers get no main landmark. | S2 | Accessibility is not sacrificed (BRIEF hard constraint 8) | `layout.tsx:117-122`; pages in §1.2 | Every page in scope gets a `<main id="main-content">` via the shell — this single change fixes the skip link, the landmark, and the missing footer at once. |

### 3.6 Cross-cutting (not in my write scope — report to Lead/teammates)

| # | Issue | Sev | Owner | file:line | Proposed fix |
| --- | --- | --- | --- | --- | --- |
| X1 | **Dashboard "Upgrade" button is a no-op** (`onClick={() => {}}`) inside the premium events lock — a dead conversion path exactly at the gate. | S2 | dashboard owner (`compare-discovery`) | `egx/dashboard-view.tsx:645-652` | Link to `/premium`. |
| X2 | **Landing FAQ overclaims Premium:** "custom scanners, alerts on detected events, and data export" — CSV export is public (`/api/v1/companies/export`, linked from `/status`) and price alerts are free for signed-in users; only scanner *runs* and company *events* are Premium. | S2 | Lead (landing) | `landing-client.tsx:99-102` | Align with the verified premium matrix (P9). |
| X3 | **Premium modal in dead `app-header.tsx` claims "Instant cross-company comparisons" as Premium** — compare is public. | S3 | Lead | `egx/app-header.tsx:570-576` | Moot once the dead header is removed (R16); otherwise fix. |
| X4 | **Sidebar premium card + "Upgrade" CTA language** ("Join Premium"/"Upgrade") is self-serve phrasing for a manual-approval product. | S3 | Lead | `Sidebar.tsx:513-525`; `TopHeader.tsx:475-481` | Use "Request Premium"/"طلب Premium" consistently (copy deck C3). |
| X5 | **No email verification on signup** — accounts are active immediately. This is a product/security decision, not a copy fix; flag only (no auth-logic changes per hard rule 6). | — | Lead/product | `api/v1/auth/register/route.ts:49-58` | Out of scope for presentation; note for the roadmap. |

---

## 4. Recommended onboarding & activation flow

### 4.1 Activation principles (from strategy §10, made concrete)

1. **Value precedes account.** The primary first-session path is research: search → company → compare. Sign-up is only asked when the user wants to *save* something (watchlist sync, portfolio, price targets) — and the ask names the saved outcome.
2. **Never lose intent.** Every auth entry points carries `?next=`; every success returns there. This is currently broken on register (A5).
3. **One ask at a time.** Registration = email + password + optional name, one screen, no confirm field (show-password toggle instead), consent with real links.
4. **Activation is a sequence, not a wall.** After account creation the user gets three concrete, completable steps with real destinations, plus a persistent but dismissible checklist until done.
5. **Premium is a request, not an upgrade.** The flow must say *how* activation works before it shows a price or asks for a click, and it must never imply instant access or auto-renewal.
6. **Every state explains itself.** Empty, pending, rejected, expired, unavailable: what happened · why · what to do · what won't happen (no charge, no data change).

### 4.2 Target flow — guest → activated → returning

| Step | Trigger | Current behaviour | Target behaviour (presentation only) | Files |
| --- | --- | --- | --- | --- |
| 1 | Guest lands, searches, opens a company | Works; free browsing is real | Keep. Add one restrained inline prompt after the user stars a company: "Saved on this device. Sign in to sync it and set price targets." → `/login?next=<current path>` | company page (other owner), prompt copy reused in shell |
| 2 | Guest clicks save/portfolio/alerts or hits a free cap | `/alerts` gate exists; portfolio gates; alert gate copy overclaims | Gate explains the *saved outcome* in one line + how alerts actually evaluate (R2), then Sign in / Create free account, with `next` preserved | `alerts/page.tsx`, `portfolio/client.tsx` |
| 3 | Sign in | Login works; error codes raw; no chrome | Marketing shell (logo home, footer legal), MezaWordmark (no EGX badge), single-language copy, mapped errors, show-password, "You already have a session" banner kept | `login/page.tsx` |
| 4 | Create account | 5 inputs, no value, no links, ignores `next` | 3 inputs (name optional), inline password rule (8–72), show toggle, linked Terms/Privacy, 3 benefit lines, trust row, create → return to `next` | `register/page.tsx` |
| 5 | First run (no `next`) | Drops on `/` with nothing | Compact "Start here" checklist: ① Follow a company ② Set a price target ③ Read a company's financial picture — each with a one-line why; dismissible; reappears as empty-state guidance until done | checklist component (my scope) mounted in watchlist/alerts/portfolio empty states; Lead asked to mount on landing/dashboard |
| 6 | Free user hits a premium feature | Generic "Premium feature / Upgrade" gate | Gate names the section, what Premium adds, what stays free, and that activation is manual; CTA "See what Premium includes" | `premium-gate.tsx` |
| 7 | User opens `/premium` | Price first, features ambiguous, dead payment, anonymous silent failure | Hierarchy in §5, session-aware CTA, capability matrix with caps, honest payment state, legal/activation row | `premium/page.tsx`, `premium/client.tsx` |
| 8 | Request submitted | "pending approval by admin" — no next step | "Request received — awaiting payment verification"; what happens next; what is *not* happening (no charge, no card); where to see the status; contact path | `premium/client.tsx`, terms |
| 9 | Activated | Status card with expiry only | Membership card: plan, start, expiry, "renewal is manual — request again before expiry" + how; hide sales comparison | `premium/client.tsx` |
| 10 | Returning user | TopHeader dropdown: Subscription, Sign out | Account menu: identity, plan + expiry, links (watchlist, portfolio, alerts), change password, sign out with confirmation | `user-menu.tsx` (new `AccountMenu`), mount coordination with Lead |
| 11 | Returning user checks "what changed" | Alerts page honest-but-orphaned; watchlist no freshness | Both pages in app shell, with honest alert model + provenance/freshness lines | `alerts/page.tsx`, `watchlist/client.tsx` |

### 4.3 Per-page information hierarchy (target)

| Page | Order top → bottom |
| --- | --- |
| `/login` | Brand + independence line → "Sign in to sync…" one-liner → email/password → show toggle → remember me → primary Sign in → forgot link → OAuth (if configured) → create account link → (footer trust row from shell) |
| `/register` | Brand + independence line → value/trust row (3 bullets + "Free · no card") → optional name → email → password (inline rule + toggle) → consent with real Terms/Privacy links → primary Create free account → OAuth → sign-in link |
| `/premium` | Promise + what Premium adds → **How activation works (3 steps: request → transfer → manual verification)** → price + period + "no card / no auto-renew" → session-aware CTA/status → capability matrix (Free vs Premium with caps) → always-free strip → payment details (only when configured) → legal/trust row → FAQ |
| `/alerts` | Title → "How alerts work" (in-app, evaluated on open, 15-min delayed) → new target form → Triggered → Active (+ honest empty state) → error state with retry |
| `/watchlist` | Title → provenance/freshness line → table (missing values "—") → gap note → empty state (why + star instruction + go to companies) |
| `/portfolio` | Title → "values use your inputs + recorded prices" line → totals → holdings ("no recorded price — shown at cost") → sector exposure → free-cap/upgrade note → sign-in vs load-error states |
| `/about` | One-sentence identity → independence/affiliation → sources & verification method → limitations ("—", never estimated, AI interpretation) → platform numbers **with as-of + retry** → contact → explore links |
| `/status` | State badge derived from real fetch → what this page checks → coverage (253/274 + why 21 missing) → data freshness table (prices, delay, last statement, last check) → sources & limits → API/CSV → research links |
| `/disclaimer` | Purpose → sources → delayed prices → calculated vs reported → AI interpretation → missing data → no advice/risk → liability → last updated |
| `/terms` | Version/date → service description → accounts → data & privacy link → **Premium: manual activation, no auto-renew, refunds** → acceptable use → disclaimer/link → termination → governing law → contact → last updated |
| 404 | Brand mark → "This page doesn't exist" → why (moved/typo) → one action (Search/Companies) + secondary (Home, Premium) → footer |

---

## 5. Pricing page hierarchy (detailed spec)

Recommended order, with the truth each block must carry. Everything here is presentation/copy; the only data reads are the already-public `PREMIUM_ENABLED`, `PREMIUM_PRICE`, `PREMIUM_CURRENCY`, `PREMIUM_DURATION_DAYS`, `PAYMENT_PHONE`, `WHATSAPP_NUMBER`, `PAYMENT_INSTRUCTIONS` and `/api/v1/subscription/me`.

1. **Eyebrow + headline (no price yet)**
   `Premium` · *"Full reports, all company events, unlimited analysis."* / *«التقارير الكاملة، كل أحداث الشركات، وتحليلات بلا حد شهري.»*
   Sub-line: *"One plan. 30 days. Activation is manual after payment verification."*

2. **What Premium adds** (only exclusive, verified items, each with the cap it removes)
   - Unlimited Smart Analyses (free: 3/month) + instant refresh
   - Company events & detected changes (free: hidden)
   - Full rankings & valuation lists past the free previews (free: top 10 / top 3)
   - Full multi-year company report + print/PDF (free: one-page overview)
   - Portfolio positions without the 2-position cap
   No "no ads", no vague "advanced analysis", no "2026".

3. **How activation works — 3 steps, always visible**
   `1 Request → 2 Transfer by bank transfer or wallet → 3 We verify the transfer and record 30 days of Premium. No card is stored. Nothing renews automatically.`
   If `PREMIUM_ENABLED` is false: replace this block with *"Subscriptions are paused right now."*

4. **Plan line + CTA (session-aware)**
   - Loading settings → skeleton; never a default price.
   - `99 ج.م · 30 يوماً` / `EGP 99 · 30 days` + `one-time · no auto-renewal`
   - Signed out → **Sign in to request Premium** (`/login?next=/premium`)
   - Signed in, none → **Request Premium — 30 days** (+ inline error region)
   - Pending → *"Request received — awaiting payment verification"*, what is not happening, contact path
   - Rejected → *"We couldn't verify a payment"* + resubmit (no exposed internal reason)
   - Active → membership card + start/expiry + renewal-by-request guidance; hide 3–7

5. **Capability matrix** — Free vs Premium columns, real caps on both sides, plus a full-width row *"Always free, no account: browsing, statements, ratios, rankings preview"*.

6. **Payment details** — rendered only if a phone/WhatsApp/instructions channel is configured; instructions **before** the request button; never a "send proof to WhatsApp" line without a number. Otherwise an honest "Payment details aren't published yet — submit a request and nothing is charged until they appear."

7. **Legal & trust row** — `One-time 30-day activation · no card stored · no automatic renewal · not investment advice` + links `/terms`, `/disclaimer`, `/privacy`, `/status`; independence line from the shared footer.

8. **FAQ (5 real questions only)** — *Do I get access immediately?* (No — manual verification.) *Does it renew automatically?* (No.) *What if I can't pay by transfer?* (Only the published channels are supported today.) *What happens to my data if Premium expires?* (Account and saved lists stay; gated features lock.) *Is the AI analysis advice?* (No — interpretation.)

Rules: no countdown, no "limited", no discount, no "Recommended", no testimonials, no logos of partners that don't exist.

---

## 6. Copy deck — EN + AR before → after

Priority order; each item is presentation-only.

**C1 — Premium headline/price** (`premium/client.tsx:119-131`)
- Before EN: `Upgrade to Premium` / `30-day subscription — 99 EGP`
  Before AR: `ترقّي إلى Premium` / `اشتراك 30 يومًا بسعر 99 EGP`
- After EN: `Premium` · `Full reports, all company events, unlimited analysis.` · `EGP 99 · 30 days · one-time activation, no auto-renewal`
- After AR: `Premium` · `التقارير الكاملة، كل أحداث الشركات، وتحليلات بلا حد شهري.` · `99 ج.م · 30 يوماً · تفعيل لمرة واحدة، بدون تجديد تلقائي`

**C2 — How activation works (new block)** (`premium/client.tsx`, after headline)
- After EN: `How activation works: 1) Submit a request. 2) Transfer the amount by bank transfer or wallet. 3) We verify the transfer and record 30 days of Premium. No card is stored and nothing renews automatically.`
- After AR: `إزاي بيتم التفعيل: 1) ابعت طلب الاشتراك. 2) حوّل المبلغ بتحويل بنكي أو محفظة. 3) نتحقق من التحويل ونسجّل 30 يوماً من Premium. مفيش بطاقة بتتخزن، ومفيش تجديد تلقائي.`

**C3 — CTA** (`premium/client.tsx:165-168`, `premium-gate.tsx:54-57`)
- Before EN/AR: `Submit Subscription Request` / `إرسال طلب الاشتراك`
- After signed-in EN: `Request Premium — 30 days` · AR: `اطلب Premium — 30 يوماً`
- After signed-out EN: `Sign in to request Premium` · AR: `سجّل الدخول لطلب Premium`
- Everywhere else replace `Upgrade to Premium` with `Request Premium` / `طلب Premium`; keep `Upgrade` only where access is truly instant (nowhere today).

**C4 — Pending state** (`premium/client.tsx:94-104`)
- Before EN: `Your request is pending approval` / `Your subscription will be activated once approved by an admin.`
- After EN: `Request received — awaiting payment verification` / `We verify transfers manually. Your 30 days start when the activation is recorded; this card will show the end date. Nothing has been charged automatically.`
- After AR: `تم استلام طلبك — في انتظار مراجعة الدفع` / `بنتحقق من التحويلات يدوياً. الـ 30 يوماً بتبدأ من تسجيل التفعيل، والبطاقة دي هتظهر تاريخ الانتهاء. مفيش أي مبلغ بتّحصّل تلقائياً.`

**C5 — Rejected state** (`premium/client.tsx:105-115`)
- Before EN: `Your request was rejected` + `Try again`
- After EN: `We couldn't verify a payment` / `No charge was recorded as confirmed. If you did transfer, submit the request again — the team will re-check.` + `Resubmit request`
- After AR: `تعذّر التحقق من الدفع` / `مفيش مبلغ اتأكد. لو حوّلت بالفعل، ابعت الطلب تاني وفريقنا هيراجعه.` + `إعادة إرسال الطلب`

**C6 — Ads claims → remove** (`premium/client.tsx:183,201`)
- Before: `+ Ads` (free) / `No ads` (premium)
- After: delete both rows. Free row replacement: `Browse companies, statements and ratios — no account needed` / `تصفح الشركات والقوائم والنسب — بدون حساب`. Premium row replacement: `Full multi-year report + print/PDF` / `تقرير كامل متعدد السنوات + طباعة/PDF`.

**C7 — "Recommended"** (`premium/client.tsx:186-194`)
- Before EN: `Recommended` / AR: `موصى به`
- After EN: `One plan · manual activation` / AR: `باقة واحدة · تفعيل يدوي`

**C8 — Feature grid → "what Premium adds"** (`premium/client.tsx:133-150`)
- After EN heading: `What Premium adds — on top of Free` with items: `Unlimited Smart Analyses + instant refresh (free: 3/month)`, `Company events & detected changes`, `Full rankings and valuation lists (free: preview)`, `Full multi-year report + print/PDF`, `Portfolio without the 2-position cap`
- After AR heading: `اللي بيضيفه Premium — فوق الخطة المجانية` with: `تحليلات ذكية بلا حد + تحديث فوري (المجاني: 3 شهرياً)`, `أحداث الشركات والتغيرات المكتشفة`, `الترتيب الكامل وقوائم التقييم (المجاني: معاينة)`, `تقرير كامل متعدد السنوات + طباعة/PDF`, `محفظة بدون حد المركزين`

**C9 — Payment unavailable (honest state)** (`premium/client.tsx:206-232`)
- Before (live instructions): `Please transfer the amount and send proof to WhatsApp.` with no number shown
- After (no channel configured) EN: `Payment details aren't published yet. You can still submit a request — no money changes hands until transfer details appear here and you confirm a payment.`
- After AR: `بيانات الدفع لسه مش منشورة. تقدر تبعت الطلب — مفيش أي مبلغ بيتحصّل قبل ما تظهر بيانات التحويل هنا وتأكد الدفع بنفسك.`
- When configured: show `Payment number:` + WhatsApp (only if number present) + instructions **above** the request CTA.

**C10 — Alerts gate** (`alerts/page.tsx:78-86`)
- Before EN: `Create a free account to get notified when a stock reaches your target price.`
  Before AR: `أنشئ حساباً مجانياً لتصلك تنبيهات الأسعار عند وصول السهم لسعرك المستهدف.`
- After EN: `Create a free account to save target prices. We compare them with the latest recorded price (15-minute delayed) and show any hit here, in the app.`
- After AR: `أنشئ حساباً مجانياً لحفظ أسعارك المستهدفة. بنقارنها بآخر سعر مسجّل (متأخر 15 دقيقة) وبنعرض أي تنبيه هنا داخل المنصة.`

**C11 — How alerts work** (`alerts/page.tsx:99-103`)
- Before EN: `Evaluated on recorded prices (same 15-minute delay shown site-wide).`
- After EN: `How alerts work: we check your targets against the latest recorded price (15-minute delayed) when you open this page. Alerts appear here — we don't send email or push notifications.`
- After AR: `طريقة عمل التنبيهات: بنقارن سعرك المستهدف بآخر سعر مسجّل (متأخر 15 دقيقة) عند فتح الصفحة. التنبيهات بتظهر هنا — مفيش إيميل ولا إشعارات على الموبايل.`

**C12 — Watchlist subtitle** (`watchlist/client.tsx:95-99`)
- Before EN: `Your starred companies with a quick data snapshot — saved on this device.`
- After EN: `Companies you follow, with their latest recorded figures. Saved on this device and synced to your account when you sign in.`
- After AR: `الشركات اللي بتتابعها مع أحدث أرقام مسجّلة. محفوظة على الجهاز وبتتزامن مع حسابك لما تسجّل الدخول.`

**C13 — Watchlist gap note** (`watchlist/client.tsx:193-197`)
- Before: `${n} watched id(s) not found in the current database`
- After EN: `${n} company in your list isn't covered yet — it will appear as soon as financial data is available.`
- After AR: `${n} شركة في قائمتك لسه مش مغطاة — هتظهر أول ما تتوفر بياناتها المالية.`

**C14 — Portfolio load error vs sign-in** (`portfolio/client.tsx:96-102`)
- Before: `Sign in to view your portfolio — sign in` for any failure
- After (non-auth) EN: `Couldn't load your portfolio — no data was changed.` + `Try again`
- After AR: `تعذّر تحميل المحفظة — مفيش بيانات اتغيرت.` + `جرّب تاني`

**C15 — Portfolio limit + inputs note** (`portfolio/client.tsx:304-308,345,89-91`)
- Before EN: `Free plan limit reached (2 positions)` / `Upgrade to Premium — unlimited →`
- After EN: `Free plan: 2 positions.` / `Premium removes the limit — activation is manual after payment review.`
- After AR: `الخطة المجانية: مركزين.` / `Premium بيرفع الحد — التفعيل يدوي بعد مراجعة الدفع.`
- New note EN: `Values use the quantities and average costs you enter, priced from recorded market snapshots (15-minute delayed).` AR: `القيم مبنية على الكميات ومتوسطات التكلفة اللي بتدخلها، ومقيّمة بأسعار مسجّلة (متأخرة 15 دقيقة).`

**C16 — Premium gate default copy** (`premium-gate.tsx:20-23,52-58`)
- Before EN: `Premium feature` / `Upgrade to Premium to unlock this feature.`
- After EN: `Part of Premium` / `This section is part of Premium. Free accounts keep browsing, statements, ratios and 3 Smart Analyses a month. Activation is manual after payment review.` CTA: `See what Premium includes`
- After AR: `جزء من Premium` / `القسم ده جزء من Premium. الحساب المجاني بيفضل فيه التصفح والقوائم والنسب و3 تحليلات ذكية شهرياً. التفعيل يدوي بعد مراجعة الدفع.` CTA: `اعرف اللي في Premium`
- Call sites should pass a feature name (e.g. `Events`) where possible.

**C17 — Login header** (`login/page.tsx:84-93,112-126,161`)
- Before (mixed): `تسجيل الدخول · Sign in` + dual subtitle + `Email`/`Password`/`Sign in`
- After EN: title `Sign in`; sub `Sign in to sync your watchlist, portfolio and alerts. Browsing stays free.`; labels `Email`, `Password`; button `Sign in`; below: `Independent research platform — not affiliated with the Egyptian Exchange.`
- After AR: title `تسجيل الدخول`; sub `سجّل الدخول لمزامنة قائمة المتابعة والمحفظة والتنبيهات. التصفح مجاني وبدون حساب.`; labels `البريد الإلكتروني`, `كلمة المرور`; button `تسجيل الدخول`; note `منصة أبحاث مستقلة — غير تابعة للبورصة المصرية.`

**C18 — Auth error mapping** (`login/page.tsx:62,68`; `register/page.tsx:76`)
- `INVALID_CREDENTIALS` → EN `Email or password is incorrect.` / AR `البريد أو كلمة المرور غير صحيحة.`
- `RATE_LIMITED` → EN `Too many attempts — try again in a few minutes.` / AR `محاولات كتير — جرّب تاني بعد كام دقيقة.`
- `EMAIL_ALREADY_EXISTS` → EN `This email already has an account. Sign in instead.` (link) / AR `البريد ده عنده حساب بالفعل. سجّل الدخول بدلاً من كده.`
- `VALIDATION` (password) → EN `Password must be 8–72 characters.` / AR `كلمة المرور لازم تكون من 8 لـ 72 حرفاً.`
- Network/5xx → EN `We couldn't reach the server. Check your connection and try again.` / AR `تعذّر الوصول للسيرفر. اتأكد من الاتصال وجرّب تاني.`

**C19 — Register intro + trust** (`register/page.tsx:98-109`)
- After EN: `Create a free account` / `Save your watchlist, portfolio and price targets. Free — no card required.` + trust row `Data from published filings · Prices delayed 15 min · Not investment advice`
- After AR: `إنشاء حساب مجاني` / `احفظ قائمة المتابعة والمحفظة والأسعار المستهدفة. مجاني — بدون بطاقة.` + `بيانات من الإفصاحات المنشورة · أسعار متأخرة 15 دقيقة · ليست نصيحة استثمارية`
- Replace `EGX` badge with `<MezaWordmark />`; add `Independent research platform — not affiliated with the Egyptian Exchange.` / `منصة أبحاث مستقلة — غير تابعة للبورصة المصرية.`

**C20 — Consent line with real links** (`register/page.tsx:165-176`)
- Before (plain text): `أوافق على شروط الاستخدام وأفهم أن التطبيق أداة معلوماتية وليست توصية استثمارية — I agree to the terms; this is an informational tool, not investment advice.`
- After EN: `I agree to the [Terms of Service] and confirm I've read the [Privacy Policy]. Meza is a research tool — not investment advice.`
- After AR: `أوافق على [شروط الاستخدام] وأكدت إنّي قرأت [سياسة الخصوصية]. Meza أداة بحث — مش توصية استثمارية.`
- Also add the password helper: EN `8–72 characters.` / AR `من 8 لـ 72 حرفاً.`

**C21 — About identity** (`about/client.tsx:50-55`)
- Before EN: `About` / `Meza platform`; AR: `من نحن` / `منصة ماسح البيانات المالية للبورصة المصرية`
- After EN: `About` / `An independent Egyptian Exchange research platform — financial statements, ratios and technical context, with a source for every figure.`
- After AR: `من نحن` / `منصة أبحاث مستقلة للبورصة المصرية — قوائم مالية ونسب وسياق فني، مع مصدر لكل رقم.`
- New independence paragraph EN: `Meza is independent. We are not affiliated with the Egyptian Exchange, any broker or any issuer. We publish data from official company disclosures and a delayed public market feed, and we do not give buy or sell recommendations.`
- AR: `Meza منصة مستقلة. مش تابعة للبورصة المصرية ولا لأي وسيط أو شركة مُصدِرة. بننشر بيانات من الإفصاحات الرسمية للشركات ومن مصدر أسعار عام متأخر، ومش بنقدّم توصيات شراء أو بيع.`

**C22 — Status state + coverage** (`status/page.tsx:94-96,76-80`)
- Before: static `تعمل الآن · Operational`; card `Active price alerts: 1`
- After (data loaded) EN: `Status data current · checked 21:37` / AR `حالة البيانات محدّثة · آخر فحص 21:37`
- After (fetch failed) EN: `Status data unavailable — we couldn't read the status feed. This is not a statement that everything is fine.` / AR `بيانات الحالة غير متاحة — تعذّر قراءة تغذية الحالة. ده مش معناه إن كل حاجة شغالة.`
- Replace the alerts card with EN `Coverage: 253 of 274 companies have current data; the other 21 show as unavailable.` / AR `التغطية: 253 من 274 شركة ليها بيانات حالية؛ الـ21 الباقية بتظهر كغير متاحة.`
- Add block EN `What this page checks: statement coverage, last imported filing, latest recorded market price and its 15-minute delay.` / AR `الصفحة دي بتتحقق من: تغطية القوائم، آخر إفصاح مستورد، آخر سعر سوق مسجّل وتأخيره 15 دقيقة.`

**C23 — Footer trust block** (`app-footer.tsx:68-70`; `i18n.tsx:286-293` — Lead-owned)
- Before EN: `Educational / informational tool. Reports factual financial conditions with explanations. Not investment advice — no BUY/SELL recommendations are generated.` + `Figures come from published financial statements; unavailable values are shown as missing — never as zero or estimates. Prices are delayed 15 minutes. Figures are not investment advice.`
- After EN (3 lines): `Meza — Egyptian stock market research. Independent; not affiliated with the Egyptian Exchange or any broker.` · `Data: published company disclosures; market prices delayed 15 minutes. Missing values show as “—” and are never estimated.` · `AI-assisted analysis is interpretation, not advice — we don't issue buy or sell recommendations.` + contact line (T6).
- After AR: `Meza — أبحاث البورصة المصرية. منصة مستقلة، غير تابعة للبورصة المصرية أو أي وسيط.` · `البيانات: الإفصاحات المنشورة للشركات؛ أسعار السوق متأخرة 15 دقيقة. القيم غير المتاحة تظهر «—» ولا تُقدَّر.` · `التحليل بالذكاء الاصطناعي تفسير مساعد وليس توصية — مش بنصدر توصيات شراء أو بيع.`

**C24 — Disclaimer additions** (`disclaimer-client.tsx:17-42`)
- Add EN: `Sources: company financial statements as published, plus a public market feed delayed by 15 minutes. Prices here are not live quotes.` / AR: `المصادر: القوائم المالية للشركات كما نُشرت، مع مصدر أسعار عام متأخر 15 دقيقة. الأسعار هنا مش أسعار لحظية.`
- Add EN: `AI-assisted analysis: some pages include AI-generated commentary. It interprets the published figures shown and is not advice, a prediction, or a recommendation.` / AR: `التحليل بالذكاء الاصطناعي: بعض الصفحات فيها تعليق مُولَّد بالذكاء الاصطناعي. بيفسّر الأرقام المنشورة المعروضة، وهو مش نصيحة ولا تنبؤ ولا توصية.`
- Add EN: `Missing values are shown as “—” — not as zero, and never estimated.` / AR: `القيم غير المتاحة تظهر «—» — مش صفر، ومش تقدير.`
- Fix Arabic: `المسول` → `المسؤول`; `العائد على Equity` → `العائد على حقوق الملكية (ROE)`.
- Add `Last updated: 9 November 2026` / `آخر تحديث: 9 نوفمبر 2026`.

**C25 — Terms: manual billing paragraph** (`terms-client.tsx`, new section 5)
- After EN: `Premium access is a one-time 30-day activation, recorded after we verify a bank transfer or wallet payment. We do not store card details and nothing is charged automatically. There is no auto-renewal: when the period ends, your account returns to the free plan unless you submit a new request. The current price and period are shown on the Premium page before you request. If a payment cannot be verified, your request is marked as such and you may resubmit with proof of the transfer.`
- After AR: `تفعيل Premium بيتم مرة واحدة لمدة 30 يوماً، بعد التحقق من تحويل بنكي أو دفع من محفظة. مفيش بيانات بطاقات بتتخزن ومفيش أي مبلغ بيتحصّل تلقائياً. مفيش تجديد تلقائي: لما المدة تخلص، الحساب بيرجع للخطة المجانية إلا لو بعتت طلب جديد. السعر والمدة الحاليين معروضين في صفحة Premium قبل ما تبعت الطلب. لو تعذّر التحقق من التحويل، بيتم تسجيل ده على طلبك وتقدر تعيد الإرسال مع إثبات التحويل.`
- Add `Last updated` and contact.

**C26 — 404** (`not-found.tsx:9-20`)
- Before: `العودة للوحة البداية — Back to dashboard` → links `/`
- After EN: `This page doesn't exist` / `The link may be outdated, or the page moved.` / `Back to home` + `Browse companies`
- After AR: `الصفحة غير موجودة` / `يمكن الرابط قديم أو الصفحة اتغير مكانها.` / `العودة للرئيسية` + `تصفح الشركات`

**C27 — Support/recovery copy (blocked on T6 contact)** (`forgot-password/page.tsx:47-53`; `reset-password/page.tsx:88-92`)
- After EN: `If that email is registered, the team can issue a single-use reset code valid for 30 minutes. Email resets aren't automatic in this environment — contact <support channel> to complete it.`
- After AR: `لو البريد مسجّل، الفريق يقدر يصدر رمز استعادة لمرة واحدة صالح 30 دقيقة. إعادة التعيين مش تلقائية في البيئة الحالية — تواصل مع <قناة الدعم> لإكمالها.`

---

## 7. Prioritized implementation plan (presentation / copy / UX only)

Constraints honoured: no auth/business logic or API-contract changes; no new dependencies; no deploys/commits; no schema/prod-data edits. Two items are flagged as requiring explicit Lead sign-off because they touch redirect behaviour or a Lead-owned file (A5, R11 mount, A8 mount, T1 shell adoption).

### Phase 1 — Truth fixes (highest trust impact, lowest structural risk)

| Order | Work | Files | Effort | Depends on |
| --- | --- | --- | --- | --- |
| 1 | Remove fabricated ad claims; replace grid with verified "what Premium adds" (P1, P6, C6, C8) | `premium/client.tsx` | S | — |
| 2 | Remove hardcoded price fallback → loading/unavailable states (P2) | `premium/client.tsx` | S | — |
| 3 | Session-aware CTA + inline errors + resubmit/pending/active copy (P3, P4, P13, C3–C5) | `premium/client.tsx` | M | — |
| 4 | Honest payment state, only render configured channels, instructions above CTA (P5, C9) | `premium/client.tsx` | M | ops config decision (T6/P5) |
| 5 | Respect `PREMIUM_ENABLED`; retitle metadata (P12, P10) | `premium/client.tsx`, `premium/page.tsx` | S | — |
| 6 | Alerts truth model + error state + shell (R1–R3, C10–C11) | `alerts/page.tsx` | M | Lead shell (`chrome`) already built |
| 7 | Auth error mapping + password rule + terms links + badge→wordmark (A1–A4, A10, C17–C20) | `login/page.tsx`, `register/page.tsx`, `reset-password/page.tsx` | M | — |
| 8 | Terms rewrite (bilingual, dated, manual billing) (T2, C25) | `terms/terms-client.tsx`, `terms/page.tsx` | M | — |
| 9 | Disclaimer additions + Arabic fixes + date (T3, C24) | `disclaimer/disclaimer-client.tsx` | M | — |
| 10 | Status badge derived from fetch, remove vanity metric, coverage explanation (T5, C22) | `status/page.tsx` | M | — |
| 11 | About identity/independence/contact/stat freshness (T4, C21) | `about/client.tsx` | M | T6 for contact only |
| 12 | Footer trust block copy (Lead executes) (T9, C23) | `app-footer.tsx`, `i18n.tsx` | S | Lead owns files; I supply copy |

### Phase 2 — Onboarding, shells, activation

| Order | Work | Files | Effort | Depends on |
| --- | --- | --- | --- | --- |
| 13 | Adopt `LayoutShell chrome="marketing"` on all in-scope bare pages; guarantee `<main id="main-content">` (T1, A6, S6) | login/register/forgot/reset/premium/about/status/disclaimer/terms/alerts + 404 | M | Lead confirms chrome API (built) |
| 14 | Register simplification (optional name, drop confirm → show toggle, benefit+trust row) (A7, A11, C19) | `register/page.tsx` | M | — |
| 15 | Honor `next` on register + OAuth (A5) | `register/page.tsx` | S | **Lead sign-off** (redirect behaviour) |
| 16 | First-run activation checklist component + empty-state integration (A8) | new component in my scope; `watchlist/client.tsx`, `alerts/page.tsx`, `portfolio/client.tsx` | M | Lead mounts on landing/dashboard |
| 17 | Premium gate contextual copy (R14, C16) | `premium-gate.tsx`; call sites pass titles | S | — |
| 18 | Watchlist copy/provenance/empty CTA (R4–R7, C12–C13) | `watchlist/client.tsx`, `watchlist/page.tsx` | S | — |
| 19 | Portfolio error split, limit/upsell copy, inputs note, empty state (R8–R10, C14–C15) | `portfolio/client.tsx` | S | — |
| 20 | Account menu component (identity, plan/expiry, links, change password modal, sign-out confirm) (R11–R12) | `user-menu.tsx` (rework into `AccountMenu`), mount in `TopHeader.tsx` | M | Lead owns `TopHeader` mount |
| 21 | Auth pages copy/parity pass; show-password; delete dead `AuthForm` (A10–A12) | auth files, `auth-form.tsx` | S | — |

### Phase 3 — Global states & polish

| Order | Work | Files | Effort |
| --- | --- | --- | --- |
| 22 | 404 restyle/copy/shell (G1, C26) | `not-found.tsx` | S |
| 23 | Route error copy via i18n (G3) | `error.tsx` | S |
| 24 | Global error visual alignment, RTL/bilingual clarity (G2) | `global-error.tsx` | S |
| 25 | Loading skeleton tidy (G4) | `loading.tsx` | S |
| 26 | Adopt `EmptyState` in all three retention pages; shared error block (G5) | watchlist/portfolio/alerts | S |
| 27 | Copy QA: AR register/voice, `ج.م` formatting, `tabular`, `rtl-flip` icons, remove "Pro"/version labels (P15/P16, R14, R15) | my files + report Lead items | S |

### Validation (run after each phase, report honestly)
- `npx tsc --noEmit`
- `npx eslint <changed files>`
- `npx vitest run` (baseline 185 passed / 4 pre-existing auth-env failures)
- Lead runs `npm run build`
- Visual/state matrix via `qa-visual`: EN LTR + AR RTL, light + dark, mobile + desktop, for: premium (signed-out / pending / active / payment-unconfigured), login/register (+ errors, password < 8, duplicate email, rate limit), alerts (signed-out / empty / API failure / triggered), watchlist (empty / populated / uncovered ids), portfolio (signed-out / error / empty / free cap), about (loaded / API failure), status (loaded / API failure), 404, global error.
- Manual check: skip link reaches `#main-content` on every page in the matrix; no fabricated claim remains (grep for `No ads`, `Recommended`, `2026 quarters`, `notified`, raw error codes).

---

## 8. Dependencies, decisions & blockers

Needs **Lead** decisions / file ownership:
1. `TopHeader.tsx` and `Sidebar.tsx` are Lead-owned: mounting the account menu (R11) and fixing upsell/version/account copy (R13–R15) must be coordinated or delegated.
2. `i18n.tsx` is Lead-owned: footer strings `ft.disclaimer`/`ft.demoNotice` (T9) need Lead edits; all my new copy will be inline `ar ? … : …` per BRIEF §Execution model.
3. Approve shell adoption: `LayoutShell chrome="marketing"` for premium/auth/about/status/legal (already implemented by Lead) — confirm auth pages should use it rather than a bespoke minimal shell.
4. Approve A5 (`next` redirect on register) as a permitted small routing change; otherwise flag as documented limitation.
5. Approve deleting dead `AuthForm` (`auth-form.tsx`) and (Lead) dead `app-header.tsx` after R11.
6. Mount points for the first-run checklist (A8): landing/dashboard are owned by Lead/`compare-discovery`.

Needs **ops / product** (cannot be fixed by source edits):
7. **Payment channel configuration** (P5): real `PAYMENT_PHONE`/`WHATSAPP_NUMBER` and `PAYMENT_INSTRUCTIONS` in production settings; the seed default instructions reference a WhatsApp that does not exist. Until then the UI must show the honest "not published yet" state.
8. **Contact/support mailbox (T6/T7):** a monitored address for privacy, password reset, billing and account issues — required before A9/C27 and the footer contact line ship. Do not invent an address; the current `privacy@meza-ashy.vercel.app` is a deployment hostname.
9. **Custom domain (T8):** credibility decision outside source; until then avoid printing the host in visible legal copy.
10. **Email verification / delivery** (X5, forgot-password): product decision; out of scope for this presentation pass.

No blockers for starting Phase 1: it is all copy/state/UI in my own files. Payment/recovery copy will be written to be truthful in the *current* unconfigured state, so it does not depend on ops config to ship.

---

## 9. Open questions

1. Should Premium/auth pages use `chrome="marketing"` (public header + footer) or a slimmer "trust shell" (logo + footer only)? The marketing header's nav includes "Screener"/"Premium", which is fine, but on `/login` it competes with the form.
2. For the activation checklist: is a new route acceptable (e.g. `/welcome`), or must it stay an inline component mounted on existing pages? Scope says no new routing without Lead approval.
3. Do we want the plan price in `/terms` (hardcoded) or only a link to `/premium`? Recommendation: link, never hardcode a price in legal copy.
4. Is the Egyptian-Arabic register acceptable for legal text (T2), or should legal sections stay in neutral MSA while product copy uses Egyptian register? Recommendation: MSA for legal, Egyptian for product/marketing (per strategy §6).
5. Should "AI interpretations" get a visible `DataStateBadge state="ai"` on the premium page and AI report surface? The component exists; premium page currently makes no AI disclosure.

---

## Appendix A — Claim → verification matrix

| Claim found in UI | Verified in code? | Evidence | Action |
| --- | --- | --- | --- |
| "No ads" premium / "+ Ads" free | **No** — no ad UI anywhere | `AdSlot` unused (`lib/client/subscription.ts:25-35`); `ADS_ENABLED` unused; grep no ad component | Remove claim (P1) |
| Notified price alerts | **No** — in-app lazy evaluation only | `api/v1/alerts/route.ts:9-20,37-88`; no mail/push for alerts in `lib/mail.ts` | Rewrite copy (R2) |
| Unlimited Smart Analyses | Yes | `lib/smart-analysis-usage.ts:105-108`; `company-detail` unlimited for premium | Keep, quantify free cap (P9) |
| 3 free Smart Analyses / month | Yes | `smart-analysis-usage.ts:28-29` `limit: 3` | Keep |
| Company events premium-only | Yes | `api/v1/companies/[id]/events/route.ts:4-13`; `api/v1/events/route.ts` | Keep as exclusive benefit (P6) |
| Full report + print/PDF premium | Yes | `app/company/[id]/report/page.tsx:6-58,124` | Add as premium benefit (P6) |
| Portfolio 2 positions free, unlimited premium | Yes (server + client mirror) | `api/v1/portfolio/route.ts:11,134-142`; `portfolio/client.tsx:294` | Keep, add manual-activation note (R9) |
| Rankings limited to 10 for free | UI-only cap (data still returned) | `rankings/client.tsx:131` | Present honestly as "preview" (P9); do not advertise enforcement |
| Valuation screen limited to 3 for free | UI-only cap | `undervalued/client.tsx:86` | "Preview" (P9) |
| Health score 0–100 free, full visual premium | Yes | `health-tab.tsx:126-170` | Phrase as "visual" exclusive (P6) |
| "Verified 2026 quarters" | Unverifiable/time-bound | no code claim; data coverage from status API | Remove year (P7) |
| "Recommended" plan | No basis (single plan) | `premium/client.tsx:190-193` | Remove (P8) |
| Manual admin review activation | Yes | `api/v1/subscription/request/route.ts:34-88`; `admin/payment-requests/[id]/verify/route.ts` | Move above CTA (P3) |
| "No card is stored" | Yes | privacy §2; payment flow has no card fields | Keep, surface at CTA (P11) |
| Prices delayed 15 min | Yes — but data provider is a delayed **public** feed | `api/v1/status` `delayMinutes:15`; `lib/market/refresh.ts:21` | Keep; add to disclaimer/status (T3/T11) |
| AI analysis available | Yes, labelled by generation | `company-detail` AI tab; `lib/ai/report/*` | Add "interpretation, not advice" at purchase/legal (T3/C24) |
| Independent / not affiliated with EGX | Not stated in visible copy (only metadata) | `about/page.tsx:8` vs `about/client.tsx` | Add visible independence block (T4) |
| Data export is a premium benefit | **No** — CSV export is public | `api/v1/companies/export`; linked from `/status:146`; landing FAQ `landing-client.tsx:99-102` | Report to Lead (X2) |

## Appendix B — Per-page issue index

| Page | Issues |
| --- | --- |
| `/premium` | P1–P16, T1, T9, X4 |
| `/login` | A1–A3, A6, A10–A12, T1 |
| `/register` | A1–A8, A10–A11, T1 |
| `/forgot-password`, `/reset-password` | A3, A6, A9, A10–A11, T1, T6 |
| `/auth/finish` | T1 (otherwise keep — best error copy in the app) |
| `/watchlist` | R4–R7, S5 |
| `/portfolio` | R8–R10, S5 |
| `/alerts` | R1–R3, G5, T1, T6 |
| `/about` | T4, T6, T10, T12 |
| `/status` | T1, T5, T10, T11 |
| `/disclaimer` | T3, T10, T12 |
| `/terms` | T2, T10, T12 |
| `/privacy` | T7 (content itself is good — keep) |
| 404 | G1, T1 |
| global states | G2–G4, G6 |
| shared chrome/account | R11–R15, T9, X1–X4 |
