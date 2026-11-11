"use client"

import { useMemo } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Calculator,
  Clock3,
  FileText,
  Layers,
  Minus,
  Scale,
  ShieldCheck,
  TrendingUp,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { useI18n } from "@/lib/i18n"
import {
  api,
  type CompanyDetail,
  type CompanyListItem,
  type MetricsData,
} from "@/lib/client/api"
import { formatEgp, formatPercent, formatRatio } from "@/lib/financial/units"
import { sectorLabel } from "@/lib/sectors"
import { BRAND } from "@/lib/brand"
import { SectionHeading, Stat } from "@/components/brand/section-heading"
import { CompanySearch } from "@/components/brand/company-search"
import { EGXANOMark } from "@/components/brand/brand-mark"
import {
  DataStateBadge,
  FreshnessBadge,
  SourceLine,
  UnavailableNote,
} from "@/components/brand/data-trust"
import { MetricTip } from "@/components/brand/metric-tip"

function egp(value: number | null | undefined, ar: boolean): string {
  const text = formatEgp(value)
  return ar ? text.replace("EGP", "ج.م") : text
}

function priceText(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toFixed(2)
}

function changeText(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

function annualPeriods(metrics: MetricsData | undefined) {
  return metrics?.periods.filter((period) => period.periodType === "ANNUAL") ?? []
}

function metricCell(metrics: MetricsData | undefined, code: string) {
  const periods = annualPeriods(metrics)
  const latest = periods[periods.length - 1]
  if (!latest) return null
  const row = metrics?.rows.find((candidate) => candidate.code === code)
  const cell = row?.cells[latest.key]
  if (!cell || cell.status !== "OK" || cell.value === null) return null
  return { value: cell.value, unit: row?.unit ?? "" }
}

function metricValue(metrics: MetricsData | undefined, code: string): string {
  const cell = metricCell(metrics, code)
  if (!cell) return "—"
  if (cell.unit === "PERCENT") return formatPercent(cell.value)
  if (cell.unit === "RATIO") return formatRatio(cell.value)
  return egp(cell.value, false)
}

function scannerDescription(
  card: { presetKey: string | null; description: string | null },
  ar: boolean,
): string {
  if (ar) {
    // The scanner API stores English descriptions; do not leak English copy
    // into the Arabic homepage. Map the known preset keys and fall back to a
    // neutral Arabic sentence.
    const known: Record<string, string> = {
      TURNAROUND: "شركات انتقلت من صافي خسارة إلى صافي ربح في أحدث سنة مالية.",
      DETERIORATION: "شركات انتقلت من صافي ربح إلى صافي خسارة في أحدث سنة مالية.",
      DEBT_REDUCTION: "شركات خفّضت إجمالي الدين بنسبة 5% أو أكثر.",
      STRONG_CASH_FLOW: "شركات تدفقها النقدي التشغيلي موجب في أحدث سنة مالية.",
      STRONG_ROE: "شركات بعائد على حقوق الملكية 15% أو أكثر.",
      HIGH_ASSETS: "شركات بإجمالي أصول 10 مليار جنيه أو أكثر.",
    }
    if (card.presetKey && known[card.presetKey]) return known[card.presetKey]
    if (card.description && /[\u0600-\u06FF]/.test(card.description)) return card.description
    return "ماسح مالي جاهز بقواعد صريحة، مع تفسير لكل شرط مطابق."
  }
  return card.description ?? "A preset financial screen with per-condition proof."
}

export default function LandingClient() {
  const { lang } = useI18n()
  const ar = lang === "ar"

  const { data: featuredData, isLoading: featuredLoading } = useQuery({
    queryKey: ["home-featured"],
    queryFn: () => api.companies({ sort: "marketCap", pageSize: 8 }),
    staleTime: 120_000,
  })
  const featured = featuredData?.companies ?? []
  const heroCompany = featured[0] ?? null

  const { data: heroMetrics, isLoading: heroMetricsLoading } = useQuery({
    queryKey: ["home-hero-metrics", heroCompany?.id],
    queryFn: () => api.metrics(heroCompany!.id, undefined, "annual"),
    enabled: !!heroCompany,
    staleTime: 300_000,
  })

  const { data: heroDetail } = useQuery({
    queryKey: ["home-hero-detail", heroCompany?.id],
    queryFn: () => api.company(heroCompany!.id),
    enabled: !!heroCompany,
    staleTime: 300_000,
  })

  const { data: dashboardData } = useQuery({
    queryKey: ["home-dashboard"],
    queryFn: api.dashboard,
    staleTime: 120_000,
  })

  const { data: latestResultsData } = useQuery({
    queryKey: ["home-latest-results"],
    queryFn: api.latestResults,
    staleTime: 300_000,
  })

  const stats = dashboardData?.stats ?? null
  const scannerCards = dashboardData?.scannerCards ?? []
  const latestResults = latestResultsData?.results.slice(0, 5) ?? []
  const marketAsOf = featuredData?.marketAsOf ?? null

  return (
    <LayoutShell chrome="marketing" flush>
      <div className="flex flex-1 flex-col bg-background">
        {/* ---------------------------------------------------------------- */}
        {/* Hero                                                             */}
        {/* ---------------------------------------------------------------- */}
        <section className="relative overflow-hidden border-b border-border/70">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-[420px] brand-grid opacity-[0.35]"
            aria-hidden="true"
          />
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16 lg:px-8">
            <div>
              <p className="eyebrow flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                {ar ? "أبحاث البورصة المصرية · منصة بحث" : "Egyptian Exchange research · research platform"}
              </p>

              <h1 className="mt-5 text-balance text-4xl font-bold leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                {ar ? (
                  <>
                    افهم السهم <br />
                    <span className="relative inline-block">
                      قبل ما تقرر.
                      <span
                        className="absolute inset-x-0 -bottom-1 h-2 -skew-x-6 bg-accent/70"
                        aria-hidden="true"
                      />
                    </span>
                  </>
                ) : (
                  <>
                    Understand the stock <br />
                    <span className="relative inline-block">
                      before you decide.
                      <span
                        className="absolute inset-x-0 -bottom-1 h-2 -skew-x-6 bg-accent/70"
                        aria-hidden="true"
                      />
                    </span>
                  </>
                )}
              </h1>

              <p className="mt-6 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                {ar ? BRAND.supportAr : BRAND.supportEn}
              </p>

              <div className="mt-7 max-w-xl">
                <CompanySearch size="lg" />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                <Link
                  href="/compare"
                  className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline"
                >
                  <Scale className="h-3.5 w-3.5" aria-hidden="true" />
                  {ar ? "أو قارن بين شركتين" : "Or compare two companies"}
                  <ArrowRight className="h-3.5 w-3.5 rtl-flip" aria-hidden="true" />
                </Link>
                <Link
                  href="#how-it-works"
                  className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {ar ? "إزاي بتبدأ البحث؟" : "How research works"}
                </Link>
              </div>

              <div className="mt-8 grid max-w-xl grid-cols-3 gap-5 border-t border-border/70 pt-5">
                <Stat
                  value={stats ? stats.companies.toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-GB") : "—"}
                  label={ar ? "شركة مدرجة" : "Listed companies"}
                />
                <Stat
                  value={stats ? stats.reports.toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-GB") : "—"}
                  label={ar ? "قائمة مالية" : "Financial statements"}
                />
                <Stat
                  value={stats ? stats.validValues.toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-GB") : "—"}
                  label={ar ? "قيمة مالية متحققة" : "Verified values"}
                  hint={ar ? "بعد فحوص الاتساق" : "after consistency checks"}
                />
              </div>

              <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <FileText className="h-3 w-3" aria-hidden="true" />
                  {ar ? "من الإفصاحات المنشورة" : "From published filings"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Minus className="h-3 w-3" aria-hidden="true" />
                  {ar ? "القيم غير المتاحة «—»" : "Unavailable values show “—”"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock3 className="h-3 w-3" aria-hidden="true" />
                  {ar ? "أسعار متأخرة 15 دقيقة" : "Prices delayed 15 min"}
                </span>
              </p>
            </div>

            <HeroPreview
              company={heroCompany}
              detail={heroDetail ?? null}
              metrics={heroMetrics}
              marketAsOf={marketAsOf}
              loading={featuredLoading}
              metricsLoading={heroMetricsLoading}
            />
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* What you can do — four outcomes in the research loop              */}
        {/* ---------------------------------------------------------------- */}
        <section className="border-b border-border/70">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20 lg:px-8">
            <SectionHeading
              eyebrow={ar ? "ماذا تفعل في EGXANO" : "What you can do"}
              title={ar ? "أربع خطوات بحث، مش أربع صفحات تسويقية." : "Four research moves, not four marketing pages."}
              description={
                ar
                  ? "كل جزء من المنصة موجود عشان يساعدك تفهم شركة، تقارنها بعدل، أو تتابع اللي اتغير — مش عشان يزوّد عدد الأزرار."
                  : "Every part of EGXANO exists to help you understand a company, compare it fairly, or notice what changed — not to add more buttons."
              }
            />

            <div className="mt-12 grid gap-x-12 gap-y-10 sm:grid-cols-2">
              <OutcomeRow
                number="01"
                icon={<Building2 className="h-4 w-4" aria-hidden="true" />}
                title={ar ? "افهم الشركة" : "Understand the company"}
                description={
                  ar
                    ? "قوائم مالية من الإفصاحات المنشورة، نسب محسوبة، وتفسير لكل مؤشر — بدل ما تفتح عشر صفحات وتجمّع الأرقام بنفسك."
                    : "Statements from published filings, calculated ratios, and an explanation for every metric — instead of opening ten tabs and assembling numbers yourself."
                }
                href="/companies"
                action={ar ? "تصفح الشركات" : "Browse companies"}
              />
              <OutcomeRow
                number="02"
                icon={<Scale className="h-4 w-4" aria-hidden="true" />}
                title={ar ? "قارن في نفس الظروف" : "Compare like-for-like"}
                description={
                  ar
                    ? "نفس الفترة، نفس المقاييس، ومقارنة داخل القطاع — مع تنبيه واضح لما الفترات ما تكونش متطابقة أو المقارنة مش عادلة."
                    : "The same period, the same metrics, and comparisons within the sector — with a clear warning when periods are not aligned or a comparison is not fair."
                }
                href="/compare"
                action={ar ? "قارن شركتين" : "Compare companies"}
              />
              <OutcomeRow
                number="03"
                icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />}
                title={ar ? "تابع اللي بيتغير" : "Monitor what changes"}
                description={
                  ar
                    ? "إفصاحات جديدة وأحداث على الشركات اللي بتتابعها، مع الأرقام قبل وبعد والتفسير — عشان تبحث قبل الحركة، مش بعدها."
                    : "New filings and detected events for the companies you follow, with before/after numbers and an explanation — so research happens before the move, not after it."
                }
                href="/watchlist"
                action={ar ? "قائمة المتابعة" : "Open watchlist"}
              />
              <OutcomeRow
                number="04"
                icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
                title={ar ? "اعرف مصدر كل رقم" : "Verify every figure"}
                description={
                  ar
                    ? "المصدر والفترة وآخر تحديث جنب كل قيمة. والقيم اللي ما اتنشرتش بتظهر «—» — مش صفر ومش تقدير مخفي."
                    : "Source, reporting period and last update next to the figure. Values that were not published show “—” — never zero, never a hidden estimate."
                }
                href="/status"
                action={ar ? "حالة البيانات" : "Data status"}
              />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* How a research session works                                      */}
        {/* ---------------------------------------------------------------- */}
        <section id="how-it-works" className="border-b border-border/70 bg-surface-secondary">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 md:py-20 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16 lg:px-8">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <SectionHeading
                eyebrow={ar ? "جلسة بحث واحدة" : "One research session"}
                title={ar ? "من «إيه الأخبار؟» إلى «فاهم الشركة»." : "From “what’s the news?” to “I understand the company.”"}
                description={
                  ar
                    ? "مش لازم تكون محلل مالي عشان تبدأ. اختار شركة، اقرأ الأرقام ومعناها، قارنها بغيرها، وسيب لنفسك ملاحظة تتابعها."
                    : "You do not need to be an analyst to start. Pick a company, read the numbers with their meaning, compare it with peers, and keep a note on what to follow."
                }
              />
              <div className="mt-6 flex flex-wrap gap-3">
                <Button asChild size="sm" className="gap-1.5">
                  <Link href="/companies">
                    {ar ? "ابدأ بشركة" : "Start with a company"}
                    <ArrowRight className="h-3.5 w-3.5 rtl-flip" aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/compare">{ar ? "أو قارن مباشرة" : "Or compare directly"}</Link>
                </Button>
              </div>
              <div className="mt-8 rounded-xl border border-border bg-card p-4">
                <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
                  <EGXANOMark size={20} decorative className="mt-0.5" />
                  <span>
                    {ar
                      ? "مفيش توصيات شراء أو بيع. المنصة تعرض الأرقام وتفسيرها، والقرار قرارك."
                      : "There are no buy or sell recommendations. EGXANO shows the figures and their interpretation — the decision stays yours."}
                  </span>
                </p>
              </div>
            </div>

            <ol className="space-y-0">
              <ResearchStep
                number="1"
                title={ar ? "اختار الشركة" : "Pick the company"}
                description={
                  ar
                    ? "ابحث بالاسم أو الرمز أو القطاع. كل شركة مدرجة في البورصة المصرية ولها صفحة بحث واحدة."
                    : "Search by name, ticker or sector. Every listed EGX company has one research page."
                }
                detail={
                  <div className="flex flex-wrap gap-1.5">
                    {(featured.slice(1, 5).map((company) => company.ticker)).map((ticker) => (
                      <Link
                        key={ticker}
                        href={`/company/${ticker}`}
                        className="rounded-md border border-border bg-card px-2 py-0.5 text-[10px] font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                      >
                        {ticker}
                      </Link>
                    ))}
                    {featured.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground">
                        {ar ? "القائمة غير متاحة الآن" : "The list is unavailable right now"}
                      </span>
                    ) : null}
                  </div>
                }
              />
              <ResearchStep
                number="2"
                title={ar ? "اقرأ الصورة المالية" : "Read the financial picture"}
                description={
                  ar
                    ? "الإيرادات والأرباح على السنوات، النسب الرئيسية مع شرحها، والقوائم الكاملة (دخل، مركز مالي، تدفقات) لما تحتاجها."
                    : "Revenue and profit over the years, the key ratios with their meaning, and the full statements (income, balance sheet, cash flow) when you need them."
                }
                detail={
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                    <span>
                      {ar ? "هامش صافي الربح" : "Net margin"}:{" "}
                      <span className="num font-semibold text-foreground">{metricValue(heroMetrics, "net_margin")}</span>
                    </span>
                    <span>
                      {ar ? "العائد على حقوق الملكية" : "ROE"}:{" "}
                      <span className="num font-semibold text-foreground">{metricValue(heroMetrics, "roe")}</span>
                    </span>
                    <span>
                      {ar ? "مضاعف الربحية" : "P/E"}:{" "}
                      <span className="num font-semibold text-foreground">{metricValue(heroMetrics, "p_e")}</span>
                    </span>
                  </div>
                }
              />
              <ResearchStep
                number="3"
                title={ar ? "قارن مع المنافسين" : "Compare with peers"}
                description={
                  ar
                    ? "قارن شركتين أو أربع في نفس الفترة، وشوف الفروق في الربحية والنمو والتقييم — مع توضيح إن الفترات مش متطابقة لو ده حصل."
                    : "Compare two to four companies on the same period and see the differences in profitability, growth and valuation — with a clear note when periods do not align."
                }
                detail={
                  <div className="flex flex-wrap gap-1.5">
                    {(ar ? ["نفس الفترة", "مقاييس متكافئة", "تنبيه المقارنة"] : ["Same period", "Equivalent metrics", "Comparability note"]).map(
                      (label) => (
                        <span
                          key={label}
                          className="rounded-md border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {label}
                        </span>
                      ),
                    )}
                  </div>
                }
              />
              <ResearchStep
                number="4"
                title={ar ? "تابع الجديد" : "Follow what changes"}
                description={
                  ar
                    ? "ضيف الشركة لقائمة المتابعة، وارجع لما ينزل إفصاح جديد أو يتغير وضع مالي — مع تفسير الرقم قبل وبعد."
                    : "Add the company to your watchlist and come back when a new filing lands or a financial condition changes — with the before/after numbers explained."
                }
                detail={
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <FileText className="h-3 w-3" aria-hidden="true" />
                      {ar ? "إفصاحات جديدة" : "New filings"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" aria-hidden="true" />
                      {ar ? "تغيّر في الأرقام" : "Metric changes"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                      {ar ? "مصدر وتاريخ" : "Source and date"}
                    </span>
                  </div>
                }
                last
              />
            </ol>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* One connected picture: financial + technical + context            */}
        {/* ---------------------------------------------------------------- */}
        <section className="border-b border-border/70">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20 lg:px-8">
            <SectionHeading
              eyebrow={ar ? "الصورة الكاملة" : "The full picture"}
              title={ar ? "الرقم المالي لوحده مش كفاية — والسياق هو الفرق." : "A financial number alone is not enough — context is the difference."}
              description={
                ar
                  ? "EGXANO بتجمع اللي بيخص الشركة في مكان واحد: الأداء المالي من الإفصاحات، الوضع الفني من الأسعار الفعلية، والسياق من قطاع الشركة والأحداث المكتشفة."
                  : "EGXANO brings the company-relevant evidence together: financial performance from filings, technical context from actual prices, and context from the company's sector and detected events."
              }
            />

            <div className="mt-10 overflow-hidden rounded-2xl border border-border bg-card">
              <div className="grid divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
                <div className="p-6">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <Calculator className="h-3.5 w-3.5" aria-hidden="true" />
                    {ar ? "مالي" : "Financial"}
                  </div>
                  <h3 className="mt-3 text-base font-semibold">{ar ? "الأداء من الإفصاحات" : "Performance from filings"}</h3>
                  <ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
                    <li>{ar ? "قوائم الدخل والمركز المالي والتدفقات النقدية." : "Income statement, balance sheet and cash flow."}</li>
                    <li>{ar ? "نسب محسوبة لها معادلة ومصدر وفترة." : "Calculated ratios with formula, source and period."}</li>
                    <li>{ar ? "فصل واضح بين السنوي والربعي — بدون خلط." : "Annual and quarterly periods kept separate — never mixed."}</li>
                  </ul>
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                    {ar ? "فني" : "Technical"}
                  </div>
                  <h3 className="mt-3 text-base font-semibold">{ar ? "السياق من الأسعار" : "Context from prices"}</h3>
                  <ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
                    <li>{ar ? "الاتجاه بمتوسطات 50 و200 يوم." : "Trend via 50- and 200-day averages."}</li>
                    <li>{ar ? "الزخم بمؤشرات RSI وMACD، والتقلب بـ ATR." : "Momentum with RSI and MACD; volatility with ATR."}</li>
                    <li>{ar ? "مناطق دعم ومقاومة من نقاط سعرية فعلية — وتُخفى لو البيانات مش كافية." : "Support and resistance from actual price points — hidden when data is insufficient."}</li>
                  </ul>
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                    {ar ? "سياق" : "Context"}
                  </div>
                  <h3 className="mt-3 text-base font-semibold">{ar ? "مقارنة وأحداث" : "Peers and events"}</h3>
                  <ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
                    <li>{ar ? "مقارنة داخل القطاع بمقاييس مناسبة للبنوك وغير البنوك." : "Sector peers on metrics suited to banks and non-banks."}</li>
                    <li>{ar ? "أحداث مالية مكتشفة بقواعد معلنة، مع شرح لكل شرط." : "Detected financial events with stated rules and per-condition explanations."}</li>
                    <li>{ar ? "توزيعات وإفصاحات حديثة في نفس الصفحة." : "Dividends and recent filings on the same page."}</li>
                  </ul>
                </div>
              </div>
              <div className="border-t border-border bg-surface-secondary px-6 py-3">
                <p className="flex items-start gap-2 text-[10px] leading-relaxed text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  {ar
                    ? "المؤشرات الفنية محسوبة من أسعار فعلية، والتحليل المالي من القوائم المنشورة — وكل قسم بيقول مصدره."
                    : "Technical indicators are computed from actual prices; financial analysis comes from published statements — and every section states its source."}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* What changed — latest filings and screens                         */}
        {/* ---------------------------------------------------------------- */}
        <section id="discover" className="border-b border-border/70 bg-surface-secondary">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 md:py-20 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:px-8">
            <div>
              <SectionHeading
                eyebrow={ar ? "اكتشف اللي اتغير" : "Discover what changed"}
                title={ar ? "أحدث القوائم المنشورة — بالأرقام والتواريخ." : "The latest published statements — with numbers and dates."}
                description={
                  ar
                    ? "لما شركة تنشر قوائمها، بتضاف للمنصة. هنا آخر الإفصاحات اللي وصلت، وكل واحدة مكتوب فترتها وقيمتها الأساسية."
                    : "When a company publishes its statements, they enter the platform. These are the latest filings received — each with its period and headline figure."
                }
              />
              <div className="mt-8 overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {ar ? "أحدث الإفصاحات" : "Latest filings"}
                  </p>
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                  >
                    {ar ? "الكل" : "All"}
                    <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                  </Link>
                </div>
                {latestResults.length === 0 ? (
                  <p className="px-4 py-6 text-xs text-muted-foreground">
                    {ar
                      ? "أحدث الإفصاحات غير متاحة الآن. حاول تحديث الصفحة."
                      : "The latest filings are unavailable right now. Try refreshing the page."}
                  </p>
                ) : (
                  <ul className="divide-y divide-border/70">
                    {latestResults.map((result) => (
                      <li key={`${result.companyId}-${result.periodLabel}`}>
                        <Link
                          href={`/company/${result.ticker}`}
                          className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                        >
                          <span className="w-14 shrink-0 text-[11px] font-bold tabular text-primary">{result.ticker}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-foreground">
                              {ar ? result.name : result.nameEn}
                            </span>
                            <span className="block text-[10px] text-muted-foreground">
                              {result.periodLabel} ·{" "}
                              {result.periodType === "ANNUAL"
                                ? ar
                                  ? "سنوي"
                                  : "Annual"
                                : ar
                                  ? "ربعي"
                                  : "Quarterly"}
                            </span>
                          </span>
                          <span className="shrink-0 text-end">
                            <span className="block text-[10px] text-muted-foreground">
                              {ar ? "صافي الربح" : "Net profit"}
                            </span>
                            <span className="num block text-xs font-semibold text-foreground">
                              {egp(result.netProfit, ar)}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="border-t border-border bg-muted/20 px-4 py-2">
                  <p className="text-[10px] text-muted-foreground">
                    {ar
                      ? "القيم كما وردت في الإفصاح المنشور — وليست توصية."
                      : "Values as carried in the published filing — not a recommendation."}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <SectionHeading
                eyebrow={ar ? "فلتر بمعنى" : "Screens with meaning"}
                title={ar ? "كل شركة ظاهرة، ليها سبب." : "Every matched company has a reason."}
                description={
                  ar
                    ? "الماسحات قواعد صريحة — مش صندوق أسود. شوف الشرط، والفعلي، والحد، وليه الشركة طابقت."
                    : "Screens are explicit rules — not a black box. See the condition, the actual value, the threshold, and why the company matched."
                }
              />
              <div className="mt-8 space-y-3">
                {scannerCards.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-card px-4 py-6 text-xs text-muted-foreground">
                    {ar
                      ? "الماسحات الجاهزة غير متاحة الآن. تقدر تبني ماسحك الخاص من لوحة البحث."
                      : "Preset screens are unavailable right now. You can build your own from the research dashboard."}
                  </div>
                ) : (
                  scannerCards.slice(0, 3).map((card) => (
                    <Link
                      key={card.id}
                      href={
                        card.presetKey
                          ? `/dashboard?preset=${encodeURIComponent(card.presetKey)}#/scanners`
                          : "/dashboard#/scanners"
                      }
                      className="group block rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground group-hover:text-primary">
                            {ar ? (card.nameAr ?? card.name) : card.name}
                          </p>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                            {scannerDescription(card, ar)}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold tabular text-foreground">
                          {card.count} {ar ? "شركة" : "matches"}
                        </span>
                      </div>
                      {card.topMatches.length > 0 ? (
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          {card.topMatches.slice(0, 4).map((match) => (
                            <span
                              key={match.companyId}
                              className="rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium tabular text-muted-foreground"
                            >
                              {match.ticker}
                            </span>
                          ))}
                          <span className="ms-auto inline-flex items-center gap-1 text-[10px] font-medium text-primary">
                            {ar ? "شوف ليه طابقت" : "See why it matched"}
                            <ArrowRight className="h-3 w-3 rtl-flip" aria-hidden="true" />
                          </span>
                        </div>
                      ) : null}
                    </Link>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Trust is a product language, not a slogan                          */}
        {/* ---------------------------------------------------------------- */}
        <section id="trust" className="border-b border-border/70">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 md:py-20 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:px-8">
            <div>
              <SectionHeading
                eyebrow={ar ? "الثقة مش شعار" : "Trust is shown, not claimed"}
                title={ar ? "كل رقم له مصدر. واللي مش متاح، بنقول إنه مش متاح." : "Every number has a source. What is unavailable is stated as unavailable."}
                description={
                  ar
                    ? "مش بنكتب «بيانات موثوقة» ونسيبها كده. الوسوم اللي شايفها هنا هي نفسها اللي بتظهر جنب الأرقام في المنصة — من المصدر والفترة لحد القيمة المحسوبة وتأخير السعر."
                    : "We do not write “trusted data” and leave it there. The labels shown here are the same ones that appear next to figures in the product — from source and period to calculated values and price delay."
                }
              />
              <div className="mt-6">
                <SourceLine
                  source={ar ? "الإفصاح المالي المنشور" : "Published financial filing"}
                  period={heroDetail?.dataAsOf?.periodLabel ?? null}
                  asOf={heroDetail?.dataAsOf?.periodEnd ?? null}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <FreshnessBadge asOf={heroDetail?.dataAsOf?.periodEnd ?? null} />
                <Link
                  href="/status"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                  {ar ? "حالة البيانات والحداثة" : "Data status and freshness"}
                  <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              </div>
            </div>

            <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
              <TrustItem
                badge={<DataStateBadge state="reported" />}
                description={ar ? "قيمة كما وردت في القائمة المنشورة." : "A value carried as stated in the published statement."}
              />
              <TrustItem
                badge={<DataStateBadge state="calculated" />}
                description={
                  ar
                    ? "نسبة حسبتها المنصة من أرقام الإفصاح — ومكتوب معناها."
                    : "A ratio EGXANO calculated from filing figures — with its meaning stated."
                }
              />
              <TrustItem
                badge={<DataStateBadge state="unavailable" />}
                description={
                  ar
                    ? "مش منشورة. تظهر «—» ولا تُعرض كصفر ولا تقدير."
                    : "Not published. It shows “—” and is never zero or an estimate."
                }
              />
              <TrustItem
                badge={<DataStateBadge state="delayed" />}
                description={ar ? "سعر متأخر، ومكتوب جنبه إنه متأخر." : "A price that is delayed, and labelled as delayed."}
              />
              <TrustItem
                badge={<DataStateBadge state="needs-review" />}
                description={
                  ar
                    ? "قيمة تحت المراجعة ولا تدخل التحليلات لحد التحقق."
                    : "A value under review that stays out of analytics until verified."
                }
              />
              <TrustItem
                badge={<DataStateBadge state="ai" />}
                description={
                  ar
                    ? "تفسير بالذكاء الاصطناعي، مفصول بوضوح عن الأرقام المحسوبة."
                    : "AI interpretation, clearly separated from calculated figures."
                }
              />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* For beginners and experienced researchers                         */}
        {/* ---------------------------------------------------------------- */}
        <section className="border-b border-border/70 bg-surface-secondary">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20 lg:px-8">
            <SectionHeading
              align="center"
              eyebrow={ar ? "لمين EGXANO؟" : "Who is EGXANO for?"}
              title={ar ? "نفس المنصة — مستويين من العمق." : "One platform — two levels of depth."}
              description={
                ar
                  ? "المبتدئ يلاقي تفسير لكل مؤشر، والخبير يلاقي القوائم الكاملة والفترات المنفصلة ومصدر كل قيمة. نفس الأرقام، بدون تبسيط مضلل."
                  : "Beginners get an explanation for every metric; experienced investors get full statements, separated periods, and the source of every value. Same numbers, without misleading simplification."
              }
            />
            <div className="mt-12 grid gap-8 md:grid-cols-2">
              <div className="rounded-2xl border border-border bg-card p-6">
                <h3 className="text-base font-semibold">{ar ? "لو لسه في البداية" : "If you are just starting"}</h3>
                <ul className="mt-4 space-y-2.5 text-xs leading-relaxed text-muted-foreground">
                  <li>{ar ? "ابدأ بشركة تعرفها من حياتك اليومية، واقرأ صفحتها بهدوء." : "Start with a company you know from daily life and read its page slowly."}</li>
                  <li>{ar ? "كل نسبة لها شرح مختصر: معناها ومن فين جت." : "Every ratio has a short explanation: what it means and where it came from."}</li>
                  <li>{ar ? "شوف «اللي اتغير» قبل ما تقرر إن شركة تستاهل متابعة." : "See “what changed” before deciding a company deserves following."}</li>
                </ul>
                <Button asChild variant="outline" size="sm" className="mt-5 gap-1.5">
                  <Link href="/companies">
                    {ar ? "تصفح الشركات" : "Browse companies"}
                    <ArrowRight className="h-3.5 w-3.5 rtl-flip" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
              <div className="rounded-2xl border border-border bg-card p-6">
                <h3 className="text-base font-semibold">{ar ? "لو بتقرا القوائم من سنين" : "If you read statements already"}</h3>
                <ul className="mt-4 space-y-2.5 text-xs leading-relaxed text-muted-foreground">
                  <li>{ar ? "قوائم كاملة بعرض سنوي وربعي منفصل، مع ترتيب زمني." : "Full statements with separate annual and quarterly views, in chronological order."}</li>
                  <li>{ar ? "مقارنة شركتين لأربع في نفس الفترة، مع فروق واضحة." : "Compare two to four companies on the same period, with explicit differences."}</li>
                  <li>{ar ? "مصدر كل قيمة وحالتها: محسوبة، كما وردت، أو تحت المراجعة." : "Every value's source and state: calculated, as reported, or under review."}</li>
                </ul>
                <Button asChild variant="outline" size="sm" className="mt-5 gap-1.5">
                  <Link href="/dashboard">
                    {ar ? "افتح لوحة البحث" : "Open the research dashboard"}
                    <ArrowRight className="h-3.5 w-3.5 rtl-flip" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* FAQ                                                               */}
        {/* ---------------------------------------------------------------- */}
        <section id="faq" className="border-b border-border/70">
          <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 md:py-20 lg:px-8">
            <SectionHeading
              align="center"
              eyebrow={ar ? "أسئلة شائعة" : "Questions"}
              title={ar ? "قبل ما تبدأ." : "Before you start."}
            />
            <div className="mt-10 divide-y divide-border border-y border-border">
              {(ar
                ? [
                    {
                      q: "هل البيانات حقيقية أم مقدّرة؟",
                      a: "كل رقم مصدره قائمة مالية منشورة للشركة، ويمر بفحوص للفترة والاتساق قبل دخوله التحليلات. القيم المشتقة مكتوب إنها محسوبة، والقيم غير المنشورة تظهر «—» — ولا تُقدَّر أو تُخترع.",
                    },
                    {
                      q: "إيه الفرق بين المجاني وبريميوم؟",
                      a: "المجاني يشمل تصفح الشركات والقوائم المالية والترتيب العام والمقارنات. بريميوم يضيف التحليل المساعد بالذكاء الاصطناعي بحدود أعلى، وكل الأحداث، والترتيب والتقييم الكاملين، والتصدير. التفاصيل والمقارنة الكاملة بين الخطتين في صفحة بريميوم — من غير تجربة وهمية أو عدّاد وقت.",
                    },
                    {
                      q: "إزاي بتقارنوا بين الشركات؟",
                      a: "المقارنة بتكون على نفس الفترة (سنوي أو ربعي) وبنفس المقاييس. لما الفترات ما تكونش متطابقة، المنصة بتقول إن المقارنة إرشادية بدل ما تعرضها كأنها عادلة. والمقارنة القطاعية بتحترم طبيعة القطاع — البنوك مش زي الصناعة.",
                    },
                    {
                      q: "هل الأسعار لحظية؟",
                      a: "لا. الأسعار متأخرة 15 دقيقة، ومكتوب جنبها إنها متأخرة. التحليل المالي مبني على الإفصاحات المنشورة وتاريخ آخر فترة، مش على حركة السعر اللحظية.",
                    },
                    {
                      q: "هل بتقدموا توصيات شراء أو بيع؟",
                      a: "لا. EGXANO أداة بحث ومعلومات: تعرض الأرقام وتفسيرها والمخاطر والقيود، وتسيب القرار للمستخدم. التحليل المساعد بالذكاء الاصطناعي تفسير موسوم وليس توصية.",
                    },
                  ]
                : [
                    {
                      q: "Is the data real or estimated?",
                      a: "Every figure comes from a company's published financial statements and passes period and consistency checks before entering analytics. Derived values are labelled as calculated; unavailable values show “—” — they are never estimated or invented.",
                    },
                    {
                      q: "What is the difference between Free and Premium?",
                      a: "Free includes company browsing, financial statements, public rankings and comparisons. Premium adds higher limits on AI-assisted analysis, all detected events, full rankings and valuation screens, and data export. The complete plan comparison is on the Premium page — no fake trial, no countdown.",
                    },
                    {
                      q: "How do you compare companies?",
                      a: "Comparisons use the same period (annual or quarterly) and the same metrics. When periods are not aligned, the platform says the comparison is indicative instead of presenting it as fair. Sector comparisons respect the nature of the sector — banks are not compared like industrials.",
                    },
                    {
                      q: "Are prices real-time?",
                      a: "No. Prices are delayed by 15 minutes and labelled as delayed. Financial analysis is built on published filings and their period end, not on live price movement.",
                    },
                    {
                      q: "Do you provide buy or sell recommendations?",
                      a: "No. EGXANO is a research and information tool: it shows the figures, their interpretation, risks and limitations, and leaves the decision to the user. AI-assisted analysis is a labelled interpretation, not a recommendation.",
                    },
                  ]
              ).map((item) => (
                <details key={item.q} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-foreground">
                    {item.q}
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-transform group-open:rotate-45">
                      <span aria-hidden="true">+</span>
                    </span>
                  </summary>
                  <p className="mt-3 max-w-3xl text-xs leading-relaxed text-muted-foreground">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Final call to action                                              */}
        {/* ---------------------------------------------------------------- */}
        <section className="bg-background">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20 lg:px-8">
            <div className="overflow-hidden rounded-2xl bg-brand-ink px-6 py-12 text-center sm:px-12">
              <EGXANOMark size={40} className="mx-auto" decorative />
              <h2 className="mx-auto mt-5 max-w-2xl text-balance text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {ar ? "ابدأ بشركة مصرية… وافهمها قبل أي قرار." : "Start with an Egyptian company… understand it before any decision."}
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/70">
                {ar
                  ? "تصفح الشركات والقوائم والمقارنات مجانًا. الميزات المتقدمة متاحة في بريميوم بشروط واضحة."
                  : "Browse companies, statements and comparisons for free. Advanced features are available in Premium on clearly stated terms."}
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Button asChild size="lg" className="h-11 gap-2 bg-accent px-7 text-accent-foreground hover:bg-accent/90">
                  <Link href="/companies">
                    {ar ? "تصفح الشركات" : "Browse companies"}
                    <ArrowRight className="h-4 w-4 rtl-flip" aria-hidden="true" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="h-11 border-white/25 bg-transparent px-6 text-white hover:bg-white/10 hover:text-white"
                >
                  <Link href="/compare">{ar ? "قارن شركتين" : "Compare companies"}</Link>
                </Button>
              </div>
              <p className="mt-6 text-[10px] text-white/50">
                {ar ? BRAND.trustLineAr : BRAND.trustLineEn}
              </p>
            </div>
          </div>
        </section>
      </div>
    </LayoutShell>
  )
}

/* -------------------------------------------------------------------------- */
/* Hero product preview                                                        */
/* -------------------------------------------------------------------------- */

function HeroPreview({
  company,
  detail,
  metrics,
  marketAsOf,
  loading,
  metricsLoading,
}: {
  company: CompanyListItem | null
  detail: CompanyDetail | null
  metrics: MetricsData | undefined
  marketAsOf: string | null
  loading: boolean
  metricsLoading: boolean
}) {
  const { lang } = useI18n()
  const ar = lang === "ar"

  const series = useMemo(() => {
    if (!metrics) return []
    const periods = annualPeriods(metrics).slice(-4)
    const revenueRow = metrics.rows.find((row) => row.code === "revenue")
    const profitRow = metrics.rows.find((row) => row.code === "net_profit")
    return periods.map((period) => ({
      key: period.key,
      label: period.label.replace(/^FY\s*/, ""),
      revenue: revenueRow?.cells[period.key]?.value ?? null,
      profit: profitRow?.cells[period.key]?.value ?? null,
    }))
  }, [metrics])

  const maxValue = Math.max(
    ...series.flatMap((point) => [Math.abs(point.revenue ?? 0), Math.abs(point.profit ?? 0)]),
    1,
  )
  const price = company?.marketPrice ?? null
  const change = price?.changePct ?? null
  const latestAnnual = annualPeriods(metrics)[annualPeriods(metrics).length - 1] ?? null
  const heroName = company
    ? ar
      ? (company.nameAr ?? company.nameEn)
      : company.nameEn
    : null

  return (
    <div className="relative">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-border/70 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-brand-ink px-2 py-0.5 text-[11px] font-bold tabular text-brand-lime">
                {company?.ticker ?? "—"}
              </span>
              <span className="data-label">{company ? sectorLabel(company.sector, lang) : "—"}</span>
            </div>
            <p className="mt-2 truncate text-sm font-semibold text-foreground">
              {loading ? <span className="inline-block h-4 w-40 animate-pulse rounded bg-muted" /> : (heroName ?? "—")}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {ar ? "لقطة بحث حقيقية من المنصة" : "A real research snapshot from the product"}
            </p>
          </div>
          <div className="shrink-0 text-end">
            <div className="num text-xl font-semibold tracking-tight text-foreground">
              {price ? priceText(price.price) : "—"}
            </div>
            <div
              className={`num text-[11px] font-semibold ${
                change === null ? "text-muted-foreground" : change >= 0 ? "text-market-up" : "text-market-down"
              }`}
              dir="ltr"
            >
              {changeText(change)}
            </div>
            <div className="mt-1 text-[9px] text-muted-foreground">
              {ar ? "سعر متأخر 15 دقيقة" : "15-min delayed"}
            </div>
          </div>
        </div>

        <div className="px-5 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium text-foreground">
              {ar ? "الإيرادات وصافي الربح — آخر 4 سنوات منشورة" : "Revenue and net profit — last 4 published years"}
            </p>
            <div className="flex items-center gap-3 text-[9px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-sm bg-foreground/25" aria-hidden="true" />
                {ar ? "الإيرادات" : "Revenue"}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-sm bg-primary" aria-hidden="true" />
                {ar ? "صافي الربح" : "Net profit"}
              </span>
            </div>
          </div>

          <div className="mt-4 flex h-32 items-end gap-4" dir="ltr">
            {metricsLoading || series.length === 0 ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex h-full flex-1 items-end gap-1">
                  <div className="h-1/2 flex-1 animate-pulse rounded-t bg-muted" />
                  <div className="h-1/3 flex-1 animate-pulse rounded-t bg-muted" />
                </div>
              ))
            ) : (
              series.map((point) => (
                <div key={point.key} className="flex h-full flex-1 flex-col justify-end">
                  <div className="flex h-full items-end gap-1">
                    <div
                      className="w-full flex-1 rounded-t bg-foreground/20"
                      style={{ height: `${Math.max(2, (Math.abs(point.revenue ?? 0) / maxValue) * 100)}%` }}
                      title={`${ar ? "الإيرادات" : "Revenue"} ${point.label}: ${egp(point.revenue, ar)}`}
                    />
                    <div
                      className="w-full flex-1 rounded-t bg-primary"
                      style={{ height: `${Math.max(2, (Math.abs(point.profit ?? 0) / maxValue) * 100)}%` }}
                      title={`${ar ? "صافي الربح" : "Net profit"} ${point.label}: ${egp(point.profit, ar)}`}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="mt-2 flex gap-4 border-t border-border/60 pt-1.5" dir="ltr">
            {series.length > 0
              ? series.map((point) => (
                  <span key={point.key} className="num flex-1 text-center text-[9px] text-muted-foreground">
                    {point.label}
                  </span>
                ))
              : Array.from({ length: 4 }).map((_, index) => (
                  <span key={index} className="flex-1 text-center text-[9px] text-muted-foreground">
                    —
                  </span>
                ))}
          </div>
          {series.length > 0 ? (
            <p className="num mt-2 text-[10px] text-muted-foreground">
              {latestAnnual?.label}
              {" · "}
              {ar ? "إيرادات" : "Revenue"} {egp(series[series.length - 1]?.revenue, ar)}
              {" · "}
              {ar ? "صافي ربح" : "Net profit"} {egp(series[series.length - 1]?.profit, ar)}
            </p>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-3 divide-x divide-border/60 border-y border-border/70">
          <div className="px-3 py-3">
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <MetricTip code="p_e" label={ar ? "مضاعف الربحية" : "P/E"} />
            </p>
            <p className="num mt-1 text-sm font-semibold text-foreground">{metricValue(metrics, "p_e")}</p>
          </div>
          <div className="px-3 py-3">
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <MetricTip code="roe" label={ar ? "العائد على حقوق الملكية" : "ROE"} />
            </p>
            <p className="num mt-1 text-sm font-semibold text-foreground">{metricValue(metrics, "roe")}</p>
          </div>
          <div className="px-3 py-3">
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <MetricTip code="net_margin" label={ar ? "هامش صافي الربح" : "Net margin"} />
            </p>
            <p className="num mt-1 text-sm font-semibold text-foreground">{metricValue(metrics, "net_margin")}</p>
          </div>
        </div>

        <div className="px-5 py-3">
          <SourceLine
            source={ar ? "الإفصاح المالي المنشور" : "Published financial filing"}
            period={detail?.dataAsOf?.periodLabel ?? latestAnnual?.label ?? null}
            asOf={detail?.dataAsOf?.periodEnd ?? marketAsOf ?? null}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <FreshnessBadge asOf={detail?.dataAsOf?.periodEnd ?? marketAsOf ?? null} />
            {company ? (
              <Link
                href={`/company/${company.ticker}`}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                {ar ? "افتح صفحة الشركة" : "Open company page"}
                <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            ) : (
              <Link href="/companies" className="text-[11px] font-medium text-primary hover:underline">
                {ar ? "تصفح الشركات" : "Browse companies"}
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 px-1">
        <UnavailableNote className="text-[10px]">
          {ar
            ? "القيم غير المنشورة تظهر «—» — لا صفر ولا تقدير. أسعار السوق متأخرة 15 دقيقة."
            : "Unpublished values show “—”, never zero or an estimate. Market prices are delayed 15 minutes."}
        </UnavailableNote>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Section building blocks                                                     */
/* -------------------------------------------------------------------------- */

function OutcomeRow({
  number,
  icon,
  title,
  description,
  href,
  action,
}: {
  number: string
  icon: React.ReactNode
  title: string
  description: string
  href: string
  action: string
}) {
  return (
    <div className="group border-t border-border pt-5">
      <div className="flex items-center justify-between">
        <span className="num text-[11px] font-semibold text-muted-foreground/70">{number}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-accent/20 group-hover:text-foreground">
          {icon}
        </span>
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
      <Link
        href={href}
        className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary underline-offset-4 hover:underline"
      >
        {action}
        <ArrowRight className="h-3 w-3 rtl-flip" aria-hidden="true" />
      </Link>
    </div>
  )
}

function ResearchStep({
  number,
  title,
  description,
  detail,
  last = false,
}: {
  number: string
  title: string
  description: string
  detail?: React.ReactNode
  last?: boolean
}) {
  return (
    <li className="relative flex gap-4 pb-8">
      {!last ? (
        <span className="absolute bottom-0 start-[15px] top-9 w-px bg-border" aria-hidden="true" />
      ) : null}
      <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-xs font-semibold text-foreground">
        {number}
      </span>
      <div className="min-w-0 pt-0.5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-1.5 max-w-lg text-xs leading-relaxed text-muted-foreground">{description}</p>
        {detail ? <div className="mt-3">{detail}</div> : null}
      </div>
    </li>
  )
}

function TrustItem({ badge, description }: { badge: React.ReactNode; description: string }) {
  return (
    <div className="flex flex-col items-start gap-2 border-s-2 border-border/70 ps-3">
      {badge}
      <p className="text-[11px] leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}
