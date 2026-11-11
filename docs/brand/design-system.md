# Meza Design System — Graphite & Acid Lime, refined

This is the implemented visual system (source of truth: `src/app/globals.css`).
It keeps the existing Graphite + Acid Lime identity and corrects how the palette
is applied: lime is an **accent**, not a text color, and not a financial
direction color.

## Brand constants (theme-independent)

| Token | Value | Use |
| --- | --- | --- |
| `--brand-ink` | `#0B0F0D` | The mark tile, graphite brand blocks |
| `--brand-lime` | `#A3E635` | The mark, lime accent surfaces on graphite |

The mark (`MezaMark`, `public/logo.svg`) is always graphite + acid lime — it never
changes with the UI theme.

## Color roles

### Light theme (default)

| Token | Value | Role |
| --- | --- | --- |
| `--background` | `#F7F8F6` | Paper |
| `--foreground` | `#0B0F0D` | Ink text |
| `--card` / `--popover` | `#FFFFFF` | Raised surfaces |
| `--primary` | `#4D7C0F` (lime-700) | Actions, links, focus ring. 4.8:1 on paper |
| `--primary-foreground` | `#FFFFFF` | Text on primary fills |
| `--accent` | `#A3E635` | Acid-lime accent fills only (never body text on light) |
| `--accent-foreground` | `#0A0F0B` | Text on accent fills |
| `--muted-foreground` | `#56655C` | Secondary text (6.2:1 on white) |
| `--border` | `#E1E7DB` | Hairlines |
| `--positive` / `--negative` | `#15803D` / `#B91C1C` | Financial direction only |
| `--warning` / `--info` | `#B45309` / `#1D4ED8` | Caution / informational |
| `--chart-1…5` | lime-700, teal, amber, indigo, rose | Categorical chart series |

### Dark theme (the signature state)

| Token | Value | Role |
| --- | --- | --- |
| `--background` | `#060906` | Graphite |
| `--primary` | `#A3E635` | Acid lime — 13.3:1 on graphite |
| `--primary-foreground` | `#050807` | Text on lime |
| `--muted-foreground` | `#9AA79C` | Secondary text |
| `--border` | `#202B23` | Hairlines |
| `--positive` / `--negative` | `#34D399` / `#F87171` | Financial direction |

**Rules**
1. Lime is never used to mean “up”. Financial direction always uses
   `positive`/`negative`.
2. Never place small lime text on light surfaces. Use `--primary` (lime-700) or
   `--muted-foreground`.
3. No gradient text, no glassmorphism, no neon glows. The only allowed “glow” is
   the flat `bg-accent/…` highlight block in the hero / CTA.

## Typography

- Latin + numerals: **Geist** (`--font-geist-sans`, `--font-mono`).
- Arabic: **IBM Plex Sans Arabic** (400/500/600/700).
- Scale: `text-[10px]` data labels · `text-xs` metadata · `text-sm` body ·
  `text-base` lead · `text-lg/xl` card titles · `text-2xl/3xl` section titles ·
  hero `text-4xl → 6xl`.
- Weights: 400 body, 500 labels/links, 600 headings, 700 hero/brand only.
- Every numeric comparison uses `.num`/`.tabular` (tabular numerals). This class
  previously existed in markup but was never defined; it is now real.

## Utilities (defined in `globals.css`)

| Class | Purpose |
| --- | --- |
| `.num`, `.tabular` | Tabular numerals for tables, KPIs, prices |
| `.rtl-flip` | Mirrors directional icons in RTL |
| `.eyebrow` | 11px, 600, uppercase, letter-spaced section kicker |
| `.data-label` | 10px uppercase label for data fields |
| `.brand-grid` | Quiet grid background for marketing surfaces only |
| `.data-rule` | A single hairline data rule |

## Shape, spacing, elevation

- Radius scale: `4 / 8 / 12 / 16 / 24px` via `--radius` and `rounded-*`.
  Cards use `rounded-xl`/`rounded-2xl`, controls `rounded-lg`/`rounded-xl`.
- Spacing follows a 4px base; section rhythm is `py-16` mobile → `py-20/24`
  desktop; content width `max-w-7xl` with `px-4/6/8`.
- Cards are quiet: 1px border, `shadow-sm` at most, **no hover lift** on data
  surfaces. Hover is reserved for interactive rows/links.
- No decorative gradients or blur on content surfaces.

## Components

Shared brand primitives live in `src/components/brand/`:

- `MezaMark` / `MezaWordmark` — brand mark.
- `SectionHeading` / `Stat` — editorial section headers and figures.
- `DataStateBadge` — `reported`, `calculated`, `unavailable`, `ai`, `delayed`,
  `needs-review`, `comparable`.
- `SourceLine` — source · period · last updated, in that order.
- `FreshnessBadge` — relative age with amber/red escalation.
- `MarketDataLine` — price snapshot time + server `delayMinutes` (never hardcode).
- `UnavailableValue` / `UnavailableNote` — the “—” is a statement, not a blank.
- `CalculationNote` — calculated value + formula.
- `MetricTip` — plain-language explanation for ROE, P/E, etc.
- `EmptyState` — why it is empty, what it means, what to do next.
- `CompanySearch` — real company autocomplete.
- `PublicHeader` — marketing chrome for public pages.

UI primitives remain in `src/components/ui/*` (Radix-based). Product components
(`company-detail`, `dashboard-view`, `scanners-view`, comparison, etc.) consume the
brand primitives above.

## Data visualization

- Financial level vs change is always textually labelled.
- Charts show the reporting period and source below the chart.
- One emphasized series per chart (primary), everything else neutral ink.
- Missing points are gaps, never zero.
- “Best value” highlighting is only allowed for comparable periods and metrics
  with a defensible direction (ratios), never for absolute scale.

## RTL / LTR

- `dir` is synchronized by the i18n provider; Arabic is `rtl`.
- All spacing uses logical properties (`ms/me/ps/pe/start/end`).
- Icons that imply direction get `.rtl-flip`.
- Arabic and English are equal citizens: same meaning, same depth, same trust
  labels. Arabic is written first, not translated word-for-word.

## Accessibility

- Light-mode action color raised to WCAG AA (lime-700).
- Focus ring: 2px `--ring` + offset, on every interactive element.
- Every icon-only button has an Arabic/English `aria-label`.
- Skip link targets `<main id="main-content">`; public pages now render it.
- Color is never the only signal: direction, state and comparison marks have
  text/icon equivalents.
- Reduced-motion media query disables decorative motion.
