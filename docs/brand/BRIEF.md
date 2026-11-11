# MEZA — Brand Transformation Brief (internal working document)

This is the shared contract for the brand-transformation session. Read it fully
before auditing or editing. The full client brief is longer; this file captures
what every collaborator must know.

## Mission

Make Meza feel like a recognizable, differentiated, trusted Egyptian stock-market
**research** brand — not a generic AI-finance dashboard, not a marketing landing
page with invented numbers. Work is **frontend / presentation only**.

Starting position:

> **Meza is an Egyptian stock market research platform that brings financial data,
> technical insights, company comparisons, and research tools together to help
> investors understand stocks more clearly.**

Primary Arabic brand message:

> **افهم السهم قبل ما تقرر.**

Supporting message:

> افهم الشركات، قارن أداءها، واكتشف الصورة المالية والفنية للسوق المصري من مكان واحد.

Desired associations: clarity, financial understanding, confidence through
information, transparency, intelligent research, simplicity without losing depth,
a better understanding of the Egyptian stock market.

Never promise profits, guaranteed opportunities, or perfect predictions. Never
use fear / urgency. The emotional outcome is *preparedness through understanding*.

## Product truth (verified in the repo — do not contradict it)

- Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Radix UI, Recharts,
  Prisma + hosted Postgres, `next-intl`-less custom bilingual i18n (`src/lib/i18n.tsx`).
- Bilingual EN/AR with full RTL (`useI18n()` → `{ t, lang }`; `ar ? "..." : "..."`).
- Real EGX data: ~274 listed companies, published statements, calculated metrics,
  detected events, live/delayed prices, technical engine, AI reports with
  deterministic identity/hash. Missing data renders as `—`, never as 0 or a guess.
- Public pages: `/` (landing), `/dashboard`, `/companies`, `/company/[id]`,
  `/compare`, `/sectors`, `/sectors/[sector]`, `/rankings`, `/undervalued`,
  `/dividends`, `/premium`, `/about`, `/watchlist`, `/portfolio`, `/alerts`,
  `/login`, `/register`, `/status`, legal pages.
- Design system: `src/app/globals.css` design tokens, `src/components/ui/*` Radix
  primitives, `src/components/egx/*` product components,
  `src/components/layout/*` shell/nav.
- Existing palette is **Graphite + Acid Lime** (`--primary: #A3E635`). Keep and
  refine this identity; do not replace it with an unrelated one.

## Brand principles (apply, don't just quote)

1. **A brand is what people think and feel when they hear the name.** Every screen
   should reinforce clarity, evidence, and preparation.
2. **Differentiation through experience:** deep EGX focus, financial + technical
   context together, honest comparison, transparent data provenance, "what changed
   and why it matters". Do not compete on feature count.
3. **Institutional, not personal.** No founder-centric copy.
4. **Preparation, not hype.** Research happens before price moves.
5. **Trust is shown, not claimed.** Show source, last-updated date, reporting
   period, data completeness, computed-vs-reported, delayed prices, AI
   interpretation labels.

## Voice

Intelligent, direct, clear, professional, human, confident without arrogance,
accessible to beginners but precise for experienced investors. Arabic must read as
naturally written Arabic (Egyptian financial register), not translated English.
Keep RSI, MACD, ROE, EPS, P/E, EBITDA where useful — and explain them at first use.
Avoid: "ultimate/powerful/revolutionary/game-changing", guaranteed returns,
superlatives, exclamation marks, aggressive trading language, feature lists
without user value.

## Hard technical constraints

1. Inspect before editing; preserve framework/architecture.
2. Do NOT change financial calculation engines (`src/lib/financial/**`,
   `src/lib/technical/**`, audit engines).
3. Do NOT modify AI provider integrations (`src/lib/ai/**`).
4. Do NOT change DB schemas, migrations, or production data.
5. Do NOT replace real APIs with mock data; never fabricate financial values,
   charts, company data, or platform capabilities.
6. Preserve API contracts and existing auth/routing/business logic.
7. No new dependencies unless unavoidable and approved by the Lead.
8. Accessibility is not sacrificed for looks (contrast, focus, labels, RTL).
9. Do NOT deploy, publish, push, or commit. Local filesystem edits only.
10. Do not expose secrets/tokens in code, docs, or commits.
11. Do not remove functionality without documenting why.

## Execution model

- The **Lead** owns the foundation: strategy doc, design tokens (`globals.css`),
  shared brand components (`src/components/brand/*`), i18n dictionary
  (`src/lib/i18n.tsx`), shell/navigation (`src/components/layout/*`,
  `src/components/egx/app-footer.tsx`), homepage (`src/app/page.tsx`,
  `src/app/landing-client.tsx`), SEO config, and final integration/validation.
- **Teammates own disjoint page areas** (assigned per task). Do not edit files
  outside your scope; do not edit `src/lib/i18n.tsx` (add new copy inline with
  `ar ? ... : ...` or request keys from the Lead).
- Report back concisely: what changed, files, rationale tied to brand principles,
  validation performed, limitations.

## Audit deliverable format (audit phase)

Write `docs/brand/audit-<scope>.md` with:

1. Scope & pages inspected (paths).
2. What currently works (keep).
3. Where identity is inconsistent / generic / overstates / hides limitations /
   increases cognitive load / fails to explain data / makes research harder.
   Use concrete file + line references and screenshot observations.
4. Brand-risk table: issue | severity | brand principle violated | proposed fix.
5. Recommended information hierarchy for each page in scope.
6. Copy that must change (EN + AR, before → after suggestions).

## Validation

- `npx tsc --noEmit`
- `npx eslint <changed files>`
- `npx vitest run` (baseline: 185 passed / 4 pre-existing auth-env failures)
- `npm run build` (Lead runs final build; report honestly if it cannot run)
- Visual checks: desktop + mobile, AR RTL + EN LTR, light + dark, tables/charts,
  empty/error/loading states.
