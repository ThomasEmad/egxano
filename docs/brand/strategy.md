# Meza — Brand Strategy & Messaging System

Status: working strategy for the brand-transformation implementation. This is a
decision document, not marketing copy — every claim below is grounded in what the
product actually does today.

---

## 1. What Meza is (the one sentence)

**Arabic:** منصة بحث للبورصة المصرية تجمع القوائم المالية والنسب والمؤشرات الفنية
والمقارنات في مكان واحد، وتشرح معنى الأرقام قبل أي قرار.

**English:** An Egyptian stock market research platform that brings financial
statements, ratios, technical context and company comparisons into one place —
and explains what the numbers mean before any decision.

Short form (for UI, metadata, footer):
`Meza — أبحاث البورصة المصرية` · `Meza — Egyptian stock market research`

## 2. Brand idea

> **الفهم قبل القرار.** · **Understanding before the decision.**

This is the strategic center. Meza is not a place to be told what to buy; it is
the place where a company becomes understandable. The promise is *preparedness
through understanding*: research the company, compare it fairly, notice what
changed, and decide with context.

## 3. Positioning

**Positioning equation**

- **Field:** Egyptian Exchange company research — published financials, calculated
  ratios, technical context, sector-aware comparison, detected events.
- **Tangible result:** understand a listed company's financial and technical
  position, compare alternatives on equivalent periods, and notice material change
  faster, in Arabic or English.
- **Emotional experience:** clarity and control — the feeling of understanding
  information instead of being buried by scattered numbers and market noise.

**Positioning statement**

> For Egyptian investors who want to understand a company rather than react to a
> price, Meza is the EGX research workspace that explains financial and technical
> information in one place, with the source and freshness of every figure visible.
> Unlike global charting platforms or news portals, Meza is built around Egyptian
> company fundamentals, fair comparison, and honest data provenance.

**Who we are not:** not a broker, not an execution platform, not a signals service,
not an AI oracle, not a news outlet, not a personal-brand page.

## 4. Audience

| Segment | What they need | What they fear | What Meza gives |
| --- | --- | --- | --- |
| Beginner / self-directed investor | A starting point, plain-language explanations, context for ratios | Losing money because of hype or a number they don't understand | Guided company reading, explained metrics, honest "unavailable" states |
| Active retail researcher | Speed, statements, comparisons, changes over time | Missing a material change or comparing incomparable figures | Fast company lookup, like-for-like comparison, detected events, watchlist |
| Experienced investor / analyst-lite | Depth, sources, period discipline, exportable evidence | Unreliable or unaudited data | Statement-level detail, period views, provenance, data-quality states |

The same product must serve all three: beginners get explanations, experienced
users get depth. Never hide depth to look simple; explain instead.

## 5. Messaging hierarchy

**1. Brand message (hero):**
- AR: **افهم السهم قبل ما تقرر.**
- EN: **Understand the stock before you decide.**

**2. Supporting message (sub-hero):**
- AR: افهم الشركات، قارن أداءها، وشوف الصورة المالية والفنية للسوق المصري من مكان واحد — مع مصدر وتاريخ كل رقم.
- EN: Understand the companies, compare their performance, and see the financial and technical picture of the Egyptian market in one place — with the source and date of every figure.

**3. Four proof pillars (used across homepage, nav, product empty states):**

| Pillar | AR | EN | Proof in product |
| --- | --- | --- | --- |
| Understand | افهم الشركة | Understand the company | Statements, calculated ratios, "what changed" events |
| Compare | قارن في نفس الظروف | Compare like-for-like | Same-period and own-latest comparison, sector peers, comparability warnings |
| Monitor | تابع اللي بيتغير | Monitor what changes | Watchlist, alerts, events, freshness indicators |
| Verify | اعرف مصدر كل رقم | Verify every figure | Source, reporting period, completeness, calculated-vs-reported, delayed price notice |

**4. Product-level messages** (headlines; details live in `docs/brand/copy-deck.md`):
- Company page: «الشركة في صورة واحدة — ثم التفاصيل اللي تهم.»
- Comparison: «قارن بنفس الفترة، وشوف الفرق اللي يستاهل.»
- Screener: «فلتر بمعنى — ونتيجة بتفسير.»
- AI report: «تفسير مساعد… مش توصية.»
- Trust: «كل رقم له مصدر. واللي مش متاح، بنقول إنه مش متاح.»

## 6. Voice & tone

**We sound:** intelligent, direct, clear, professional, human, confident without
arrogance. Detailed enough for professionals, accessible to beginners.

**Arabic writing rules**
- Write Arabic first, not translated English. Avoid passive-heavy MSA; use a clean
  Egyptian financial register ("شوف", "افهم", "قارن") in marketing moments, and
  precise neutral MSA inside data tables.
- Prefer short sentences. One idea per line.
- Explain a term the first time it appears: «مضاعف الربحية (P/E): السعر مقسومًا
  على ربحية السهم.»
- Keep English terms where they are industry-standard (RSI, MACD, EBITDA), but
  always pair with the Arabic explanation in tooltips/help text.
- Numbers are always written with Latin digits + `ج.م`/`EGP`, tabular, and RTL-safe.

**English writing rules**
- Same meaning, same confidence, no inflated adjectives.
- Short, concrete sentences; name the user action, not the feature.

**Avoid (hard ban list):** revolutionary, game-changing, powerful, ultimate,
next-generation, seamless, unlock, "the future of investing", guaranteed, "top
picks", "can't miss", "before the market moves", fear/urgency, exclamation marks,
profit claims, AI mysticism ("AI magically finds…"), feature lists without value.

**Micro-copy tone:** factual and reassuring. Explain *why* something is missing,
*how* a ratio is calculated, *why* a company matched a filter, *when* data was
updated, and *why* a comparison is valid — then get out of the way.

## 7. Trust vocabulary (exact, reusable labels)

| Meaning | Arabic label | English label |
| --- | --- | --- |
| Source of a figure | المصدر: الإفصاح المالي المنشور | Source: published filing |
| Reporting period | الفترة المالية | Reporting period |
| Last data refresh | آخر تحديث | Last updated |
| Value calculated by Meza | قيمة محسوبة | Calculated |
| Value as reported | قيمة كما وردت | As reported |
| Not disclosed / unavailable | غير متاح — لم يُنشر | Not reported |
| Price delay | أسعار متأخرة 15 دقيقة | Prices delayed 15 min |
| AI interpretation | تحليل بالذكاء الاصطناعي — تفسير مساعد، ليس توصية | AI-assisted analysis — interpretation, not advice |
| Data confidence | درجة الثقة | Confidence |
| Comparable period | فترة قابلة للمقارنة | Comparable period |
| Comparator warning | الفترات غير متطابقة — المقارنة إرشادية | Periods not aligned — comparison is indicative |

The rules: **show, don't claim.** No trust section that isn't literally the same
labels the data uses. Never present a calculated value as reported, never a
delayed price as live, never an AI reading as a fact.

## 8. Visual identity direction — Graphite + Acid Lime, refined

Keep the existing identity and make it institutional. The palette is currently
applied as if lime were a text color on white (it is not legible: ~1.7:1) and as
the positive/negative market color (it is not a semantic color). Fix the roles:

- **Ink / graphite** is the brand's base: headings, primary surfaces, dark theme.
- **Acid lime (#A3E635)** is an *accent*, never body text on light: highlights,
  active indicators, the brand mark, focused data series, small emphasis blocks.
- **Deep lime (#3F6212–#4D7C0F)** becomes the light-mode action/link color so
  interactive text passes contrast; dark mode keeps acid lime as the action color.
- **Semantic financial colors are independent of the brand**: positive = green
  (`--positive`), negative = red (`--negative`), caution = amber (`--warning`),
  informational = blue (`--info`). The accent must never be used to mean "up".
- **Typography:** Geist for Latin + numerals, IBM Plex Sans Arabic for Arabic.
  Tabular numerals everywhere numbers are compared. Three weights only: 400/500/600
  (700 for hero/brand). Data labels are small caps-like, letter-spaced, muted.
- **Shape:** one radius scale (4/8/12/16/24). Cards are quiet: 1px border, no
  hover lift, no gradient; emphasis comes from spacing and type, not effects.
- **Charts:** ink + one lime series + neutral grid; never a rainbow. Gains/losses
  use semantic colors. Always state period and source under a chart.
- **Motion:** 150–250ms, only for state feedback (open, tab, hover). No decorative
  animation, no glow, no glassmorphism, no gradient text.
- **Iconography:** Lucide at 16/20px, stroke consistent, only when it improves
  comprehension (domain icons in nav are accepted).

## 9. Information architecture

**Research** (primary): Companies · Compare · Screener (`/dashboard`) · Sectors
**Monitor** (return loop): Watchlist · Portfolio · Dividends · Alerts
**Plans & about:** Premium · About · Status · Legal

The homepage narrative is a research story, not a feature list:

1. Hero — understand the stock before you decide (+ real product preview).
2. What you can do — understand, compare, monitor, verify (four outcomes).
3. How a research session works — search → read the financial picture → compare →
   monitor (with real UI states).
4. One connected picture — financial + technical + events in context.
5. What changed — discovery without hype (events + screener with explanations).
6. Why the data can be trusted — provenance system shown as product labels.
7. Built for beginners and professionals — two honest paths.
8. Start — one clear action, free browsing, premium explained honestly.
9. FAQ — only questions that remove doubt.
10. Footer — institutional identity + trust/legal links.

## 10. Conversion & activation

- First visit: prove value before asking for an account. The homepage's primary CTA
  is *research*, not *sign up*.
- First session: search → company page → one clear "next step" (compare, watch,
  read what changed).
- Account created only when the user wants to save: watchlist, portfolio, alerts,
  saved screens, AI-assisted analysis.
- Premium copy: state exactly what is free and what is premium; manual billing is
  described plainly; no fake trial, no countdown, no "limited seats".
- Every empty state answers: why is this empty, what can I do now, what will
  happen when data exists.

## 11. What success looks like

Brand success is behavioural, not aesthetic: a first-time visitor can explain what
Meza is in one sentence; a researcher reaches a company page in one action; a
comparison is started from the homepage; a returning user checks "what changed";
and no screen promises something the product cannot deliver.

## 12. Non-negotiables

1. Never fabricate financial data, charts, statistics, or capabilities.
2. Never present delayed prices as live, calculated values as reported, or AI
   interpretation as fact.
3. Never give investment advice or imply guaranteed outcomes.
4. Never hide a missing-data state to make a screen look fuller.
5. Preserve every existing feature, route, API contract and calculation engine.
6. Arabic and English are equal citizens — same meaning, same quality, parity in
   layout (RTL/LTR), not one translated from the other at the last minute.
