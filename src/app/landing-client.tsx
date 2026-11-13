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
import { AdSlot } from "@/components/egx/ad-slot"

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

  // Real market movers (gainers / losers / most active) from the live market
  // snapshot — the old cards sliced the top-8-by-cap list and mislabeled it.
  const { data: marketMovers } = useQuery({
    queryKey: ["market-ticker"],
    queryFn: () =>
      fetch("/api/v1/market/ticker").then((r) =>
        r.ok
          ? (r.json() as Promise<{
              gainers?: { ticker: string; name?: string | null; price: number; changePct: number }[]
              losers?: { ticker: string; name?: string | null; price: number; changePct: number }[]
              active?: { ticker: string; name?: string | null; price: number; changePct: number; volume?: number }[]
              pricesAsOf?: string | null
            }>)
          : null,
      ),
    staleTime: 60_000,
  })

  const { data: heroMetrics, isLoading: heroMetricsLoading } = useQuery({
    queryKey: ["home-hero-metrics", heroCompany?.id],
    queryFn: () => api.metrics(heroCompany!.id, undefined, "annual"),
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

        {/* AdSense — calm strip between the feature sections */}
        <div className="border-b border-border/70 py-8">
          <AdSlot slot="landing-in-article" format="leaderboard" />
        </div>

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
                    <ArrowRight className="h-3.5 w-3.5 rtl-flip" aria-hidden="true" />
                    {ar ? "ابدأ البحث" : "Start researching"}
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <Link href="/compare">
                    <Scale className="h-3.5 w-3.5" aria-hidden="true" />
                    {ar ? "قارن شركتين" : "Compare companies"}
                  </Link>
                </Button>
              </div>
            </div>

            <div className="space-y-8">
              <Step
                number="01"
                title={ar ? "اختار الشركة" : "Pick the company"}
                description={
                  ar
                    ? "ابحث بالاسم، التريكر، أو القطاع. أو ادخل على الماسح المالي واختار معيار — EGXANO بيعرضلك الشركات اللي بتطابق."
                    : "Search by name, ticker, or sector. Or open the financial screener and pick a criterion — EGXANO shows matching companies."
                }
                action={ar ? "تصفح الشركات" : "Browse companies"}
                href="/companies"
              />
              <Step
                number="02"
                title={ar ? "اقرأ الأرقام بمعناها" : "Read numbers with meaning"}
                description={
                  ar
                    ? "كل مؤشر مع تفسيره، مصدره، وفترته. القيم اللي ما اتنشرتش بتظهر «—» — مش صفر، مش تقدير مخفي."
                    : "Every metric comes with its explanation, source, and period. Unpublished values show “—” — never zero, never a hidden estimate."
                }
                action={ar ? "افتح شركة" : "Open a company"}
                href="/companies"
              />
              <Step
                number="03"
                title={ar ? "قارن في نفس الظروف" : "Compare like-for-like"}
                description={
                  ar
                    ? "نفس الفترة (سنوي/ربعي)، نفس المقاييس، ومقارنة داخل القطاع. لو الفترات مش متطابقة، EGXANO بيبين التنبيه."
                    : "The same period (annual/quarterly), the same metrics, and comparisons within the sector. If periods are not aligned, EGXANO shows a warning."
                }
                action={ar ? "قارن شركتين" : "Compare companies"}
                href="/compare"
              />
              <Step
                number="04"
                title={ar ? "تابع اللي بيتغير" : "Monitor what changes"}
                description={
                  ar
                    ? "إفصاحات جديدة، أحداث، وإشارات تداول على الشركات اللي بتتابعها. كل حدث مع الأرقام قبل وبعد والتفسير."
                    : "New filings, detected events, and trading signals for the companies you follow. Every event with before/after numbers and an explanation."
                }
                action={ar ? "قائمة المتابعة" : "Open watchlist"}
                href="/watchlist"
              />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Scanners preview                                                   */}
        {/* ---------------------------------------------------------------- */}
        <section className="border-b border-border/70">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20 lg:px-8">
            <SectionHeading
              eyebrow={ar ? "ماسحات مالية جاهزة" : "Ready-to-use financial screens"}
              title={ar ? "شغل فلتر، تابع التفسير، قارن النتائج." : "Run a screen, read the reasoning, compare results."}
              description={
                ar
                  ? "كل ماسح مع قواعد صريحة وتفسير لكل شرط مطابق. النتيجة مش مجرد قائمة — هي نقطة بداية للبحث."
                  : "Every screen has explicit rules and a per-condition explanation. The result is not just a list — it’s a research starting point."
              }
            />

            <div className="mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
              {scannerCards.map((card) => (
                <ScannerCard key={card.presetKey ?? card.description} card={card} ar={ar} />
              ))}
            </div>

            <div className="mt-8 text-center">
              <Link
                href="/scanners"
                className="inline-flex items-center gap-2 font-medium text-primary underline-offset-4 hover:underline"
              >
                {ar ? "كل الماسحات المالية" : "All financial screens"}
                <ArrowRight className="h-4 w-4 rtl-flip" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Latest results                                                     */}
        {/* ---------------------------------------------------------------- */}
        <section className="border-b border-border/70 bg-surface-secondary">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20 lg:px-8">
            <SectionHeading
              eyebrow={ar ? "أحدث القوائم المالية" : "Latest financial statements"}
              title={ar ? "نتائج صعدت، نتائج هبطت، وتفاصيل كل تقرير." : "Results that rose, results that fell, and the detail in every report."}
              description={
                ar
                  ? "آخر التقارير المضافة للموقع، مع صافي الربح للسنوي أو الربع، ومعدل التغير — اضغط الشركة عشان ترى القوائم كاملة."
                  : "The latest reports added to the site, with annual/quarterly net profit and the change rate — open the company to see full statements."
              }
            />

            <div className="mt-10 space-y-4">
              {latestResults.length === 0 ? (
                <p className="text-center text-muted-foreground">{ar ? "لا توجد نتائج حديثة" : "No recent results"}</p>
              ) : (
                latestResults.map((result) => (
                  <ResultRow key={result.companyId} result={result} ar={ar} />
                ))
              )}

              <div className="mt-8 text-center">
                <Link
                  href="/companies"
                  className="inline-flex items-center gap-2 font-medium text-primary underline-offset-4 hover:underline"
                >
                  {ar ? "كل جولات النتائج" : "All results rounds"}
                  <ArrowRight className="h-4 w-4 rtl-flip" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Market movers                                                     */}
        {/* ---------------------------------------------------------------- */}
        <section className="border-b border-border/70">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20 lg:px-8">
            <SectionHeading
              eyebrow={ar ? "حركة السوق" : "Market movers"}
              title={ar ? "الأعلى صعودًا، الأعلى هبوطًا، وأعلى قيمة تداول." : "Biggest gainers, biggest losers, and highest volume."}
              description={
                ar
                  ? "توزيع التغيرات في جلسة واحدة، مع ربط كل سهم بصفحته عشان تعرف ليه تحرك."
                  : "Distribution of changes in a single session, with each stock linked to its page so you know why it moved."
              }
            />

            <div className="mt-10 grid gap-8 lg:grid-cols-3">
              <MarketMoversCard
                title={ar ? "الأعلى صعودًا" : "Biggest gainers"}
                color="text-success"
                items={marketMovers?.gainers?.slice(0, 5) ?? []}
                ar={ar}
              />
              <MarketMoversCard
                title={ar ? "الأعلى هبوطًا" : "Biggest losers"}
                color="text-destructive"
                items={marketMovers?.losers?.slice(0, 5) ?? []}
                ar={ar}
              />
              <MarketMoversCard
                title={ar ? "الأكثر تداولًا" : "Most active"}
                color="text-primary"
                items={marketMovers?.active?.slice(0, 5) ?? []}
                ar={ar}
              />
            </div>
            {marketMovers?.pricesAsOf ? (
              <p className="mt-4 text-center text-[11px] text-muted-foreground" dir="ltr">
                {new Date(marketMovers.pricesAsOf).toLocaleString(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {ar ? " · متأخر 15 دقيقة" : " · 15-min delayed"}
              </p>
            ) : null}

            <div className="mt-8 text-center">
              <Link
                href="/sectors"
                className="inline-flex items-center gap-2 font-medium text-primary underline-offset-4 hover:underline"
              >
                {ar ? "الخريطة الحرارية للسوق كاملة" : "Full market heatmap"}
                <ArrowRight className="h-4 w-4 rtl-flip" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Sector performance                                                 */}
        {/* ---------------------------------------------------------------- */}
        <section className="border-b border-border/70 bg-surface-secondary">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20 lg:px-8">
            <SectionHeading
              eyebrow={ar ? "أداء القطاعات" : "Sector performance"}
              title={ar ? "متوسط التغير مرجحًا بقيمة التداول، لكل قطاع." : "Average change weighted by volume, per sector."}
              description={
                ar
                  ? "اضغط قطاعًا لتشوف شركاته، ترتيبه، ومقارنته بباقي القطاعات."
                  : "Open a sector to see its companies, ranking, and comparison with other sectors."
              }
            />

            <div className="mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[
                { name: "Healthcare & Pharma", key: "healthcare-pharma" },
                { name: "Industrial & Automotive", key: "industrial-automotive" },
                { name: "Construction", key: "construction" },
                { name: "Non-Bank Financial", key: "non-bank-financial" },
                { name: "Education", key: "education" },
                { name: "Paper & Packaging", key: "paper-packaging" },
                { name: "Basic Resources", key: "basic-resources" },
                { name: "Travel & Leisure", key: "travel-leisure" },
                { name: "Food & Beverages", key: "food-beverages" },
                { name: "Textiles & Durables", key: "textiles-durables" },
                { name: "Real Estate", key: "real-estate" },
                { name: "Trade & Distributors", key: "trade-distributors" },
                { name: "Banks", key: "banks" },
                { name: "Building Materials", key: "building-materials" },
                { name: "IT, Media & Telecom", key: "it-media-telecom" },
                { name: "Shipping & Transport", key: "shipping-transport" },
                { name: "Energy", key: "energy" },
                { name: "Chemicals", key: "chemicals" },
              ].map((sector) => (
                <SectorCard key={sector.key} sector={sector} ar={ar} />
              ))}
            </div>

            <div className="mt-8 text-center">
              <Link
                href="/sectors"
                className="inline-flex items-center gap-2 font-medium text-primary underline-offset-4 hover:underline"
              >
                {ar ? "كل القطاعات" : "All sectors"}
                <ArrowRight className="h-4 w-4 rtl-flip" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Trust & methodology                                                */}
        {/* ---------------------------------------------------------------- */}
        <section className="border-b border-border/70">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20 lg:px-8">
            <SectionHeading
              eyebrow={ar ? "شفافية ومصدر" : "Transparency & methodology"}
              title={ar ? "كل رقم له مصدر، فترة، وتفسير." : "Every figure has a source, a period, and an explanation."}
              description={
                ar
                  ? "مش بتاخد أي رقم على أنه مسلم بيه. EGXANO بيبينلك المصدر، الفترة، ونوع القيمة (منشور/محسوب/غير متاح) جنب كل رقم."
                  : "We don’t take any figure at face value. EGXANO shows the source, the period, and the value type (reported/calculated/unavailable) next to every number."
              }
            />

            <div className="mt-12 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              <TrustCard
                icon={<FileText className="h-4 w-4" aria-hidden="true" />}
                title={ar ? "من الإفصاحات المنشورة" : "From published filings"}
                description={ar
                  ? "كل رقم مالي بييجي من القوائم المالية المنشورة على موقع البورصة — مش من تقديرات طرف تالت."
                  : "Every financial figure comes from statements published on the Exchange — not from third-party estimates."}
              />
              <TrustCard
                icon={<Clock3 className="h-4 w-4" aria-hidden="true" />}
                title={ar ? "الفترة والتاريخ واضحين" : "Period and date are clear"}
                description={ar
                  ? "سواء سنوي أو ربعي، تاريخ الإفصاح ونوع الفترة واضح جنب كل قيمة."
                  : "Whether annual or quarterly, the filing date and period type are shown next to every value."}
              />
              <TrustCard
                icon={<Scale className="h-4 w-4" aria-hidden="true" />}
                title={ar ? "القيم المحسوبة واضحة" : "Calculated values are marked"}
                description={ar
                  ? "النسب والمضاعفات المحسوبة من القوائم المالية واضحة ومميزة عن القيم المنشورة مباشرة."
                  : "Ratios and multiples calculated from financial statements are clearly distinguished from directly reported values."}
              />
              <TrustCard
                icon={<Minus className="h-3 w-3" aria-hidden="true" />}
                title={ar ? "اللي ما اتنشرتش = «—»" : "Unpublished = “—”"}
                description={ar
                  ? "القيم اللي ما اتنشرتش بتظهر «—» — مش صفر، مش تقدير مخفي، مش رقم مخمن."
                  : "Values that were not published show “—” — never zero, never a hidden estimate, never a guessed number."}
              />
              <TrustCard
                icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
                title={ar ? "بدون توصيات شراء/بيع" : "No buy/sell recommendations"}
                description={ar
                  ? "EGXANO منصة بحث ومعلومات. مبيقدمش توصيات استثمارية، والتحليل بالذكاء الاصطناعي مبين بوضوح إنه تفسير مش توصية."
                  : "EGXANO is a research and information platform. It does not provide investment recommendations, and AI-assisted analysis is clearly labelled as interpretation, not advice."}
              />
              <TrustCard
                icon={<Calculator className="h-4 w-4" aria-hidden="true" />}
                title={ar ? "فحوص الاتساق" : "Consistency checks"}
                description={ar
                  ? "القوائم المالية بتتطبق عليها فحوص اتساق (Balance Sheet Identity، Cross-quarter) — القيم اللي ما تنجحش في الفحوص بتتعلق عليها علامة تحذير."
                  : "Financial statements undergo consistency checks (Balance Sheet Identity, Cross-quarter) — values that fail checks are flagged with a warning."}
              />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* CTA / Final                                                        */}
        {/* ---------------------------------------------------------------- */}
        <section className="bg-surface-secondary">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-24 lg:px-8 text-center">
            <EGXANOMark size={48} />
            <h2 className="mt-6 text-balance text-3xl font-bold leading-tight text-foreground sm:text-4xl">
              {ar ? "افهم السهم قبل ما تقرر." : "Understand the stock before you decide."}
            </h2>
            <p className="mt-4 max-w-2xl mx-auto text-base leading-relaxed text-muted-foreground">
              {ar
                ? "ابدأ البحث في الشركات، قارن في نفس الظروف، وتابع اللي بيتغير — من مكان واحد."
                : "Start researching companies, compare like-for-like, and monitor what changes — from one place."
              }
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg" className="gap-2">
                <Link href="/companies">
                  <ArrowRight className="h-4.5 w-4.5 rtl-flip" aria-hidden="true" />
                  {ar ? "ابدأ البحث" : "Start researching"}
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="gap-2">
                <Link href="/compare">
                  <Scale className="h-4.5 w-4.5" aria-hidden="true" />
                  {ar ? "قارن شركتين" : "Compare companies"}
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </LayoutShell>
  )
}

/* ---------------------------------------------------------------- */
/* Components used in the landing page                                 */
/* ---------------------------------------------------------------- */

function HeroPreview({
  company,
  metrics,
  marketAsOf,
  loading,
  metricsLoading,
}: {
  company: CompanyListItem | null
  metrics: MetricsData | undefined
  marketAsOf: string | null
  loading: boolean
  metricsLoading: boolean
}) {
  if (!company) return null
  const { lang } = useI18n()
  const ar = lang === "ar"

  return (
    <div className="relative rounded-2xl border border-border/70 bg-card overflow-hidden shadow-xl">
      <div className="absolute inset-0 brand-grid opacity-[0.04]" aria-hidden="true" />
      <div className="relative p-6 lg:p-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">{company.nameEn}</p>
              <p className="text-[11px] text-muted-foreground">{company.ticker} · {sectorLabel(company.sector ?? "", ar ? "ar" : "en")}</p>
            </div>
          </div>
          {marketAsOf && (
            <span className="flex-shrink-0 text-[10px] px-2 py-1 rounded-full bg-muted/50 text-muted-foreground">
              {ar ? `أسعار: ${marketAsOf}` : `Prices: ${marketAsOf}`}
            </span>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricPreview
            label={ar ? "السعر" : "Price"}
            value={priceText(company.marketPrice?.price)}
            change={changeText(company.marketPrice?.changePct)}
            unit={ar ? "ج.م" : "EGP"}
          />
          <MetricPreview
            label={ar ? "التغير" : "Change"}
            value={changeText(company.marketPrice?.changePct)}
            unit="%"
          />
          <MetricPreview
            label={ar ? "القيمة السوقية" : "Market Cap"}
            value={company.marketCap ? egp(company.marketCap, ar) : "—"}
            unit={ar ? "مليار ج.م" : "B EGP"}
          />
          <MetricPreview
            label={ar ? "صافي الربح (سنوي)" : "Net Profit (Annual)"}
            value={metricValue(metrics, "net_profit")}
          />
        </div>

        <div className="mt-6 flex items-center justify-between">
          <Link
            href={`/company/${company.id}`}
            className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline"
          >
            {ar ? "عرض الشركة كاملة" : "View full company"}
            <ArrowUpRight className="h-3.5 w-3.5 rtl-flip" aria-hidden="true" />
          </Link>
          {metricsLoading && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
              {ar ? "جاري تحميل المؤشرات…" : "Loading metrics…"}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function MetricPreview({
  label,
  value,
  change,
  unit,
}: { label: string; value: string; change?: string; unit?: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/40 p-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-2xl font-bold tabular text-foreground">{value}</span>
        {unit && <span className="text-xs text-muted-foreground shrink-0">{unit}</span>}
      </div>
      {change && (
        <p className="mt-1 text-xs font-medium text-success">
          {change.startsWith("+") ? change : change.startsWith("-") ? change : `+${change}`}
        </p>
      )}
    </div>
  )
}

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
  const { lang } = useI18n()
  const ar = lang === "ar"
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-6 transition-colors hover:border-primary/30 hover:bg-muted/30"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-primary/70">{number}</span>
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-4 inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline">
        {action}
        <ArrowRight className="h-3.5 w-3.5 rtl-flip group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
      </div>
    </Link>
  )
}

function Step({
  number,
  title,
  description,
  action,
  href,
}: { number: string; title: string; description: string; action: string; href: string }) {
  const { lang } = useI18n()
  const ar = lang === "ar"
  return (
    <Link
      href={href}
      className="group flex items-start gap-4 rounded-xl border border-border/70 bg-card p-5 transition-colors hover:border-primary/30 hover:bg-muted/30"
    >
      <div className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
        {number}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        <div className="mt-3 inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline">
          {action}
          <ArrowRight className="h-3.5 w-3.5 rtl-flip group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
        </div>
      </div>
    </Link>
  )
}

function ScannerCard({
  card,
  ar,
}: { card: { presetKey: string | null; description: string | null }; ar: boolean }) {
  return (
    <Link
      href={`/scanners?preset=${card.presetKey ?? "unknown"}`}
      className="group flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-6 transition-colors hover:border-primary/30 hover:bg-muted/30"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Calculator className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {ar ? (card.presetKey ? `ماسح: ${card.presetKey}` : "ماسح مالي") : card.presetKey ? `Screen: ${card.presetKey}` : "Financial screen"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-3">{scannerDescription(card, ar)}</p>
        </div>
      </div>
      <div className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline">
        {ar ? "شغل الماسح" : "Run screen"}
        <ArrowRight className="h-3.5 w-3.5 rtl-flip group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
      </div>
    </Link>
  )
}

function ResultRow({ result, ar }: { result: { id: string; companyId: string; companyName: string; period: string; netProfit: number | null; change: number | null; reportUrl: string }; ar: boolean }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50">
            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground truncate">{result.companyName}</p>
            <p className="text-[11px] text-muted-foreground">{result.period}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right min-w-[120px]">
            <p className="text-sm font-bold tabular text-foreground">
              {result.netProfit == null ? "—" : result.netProfit >= 1e9 ? `${(result.netProfit / 1e9).toFixed(2)}B` : result.netProfit >= 1e6 ? `${(result.netProfit / 1e6).toFixed(1)}M` : `${result.netProfit?.toLocaleString(ar ? "ar-EG" : "en-GB")}`}
            </p>
            <p className="text-[10px] text-muted-foreground">{ar ? "صافي الربح" : "Net profit"}</p>
          </div>
          {result.change != null && (
            <div className={`text-right font-semibold ${result.change >= 0 ? "text-success" : "text-destructive"}`}>
              <p className="text-sm">{result.change >= 0 ? "+" : ""}{result.change.toFixed(1)}%</p>
              <p className="text-[10px] text-muted-foreground">{ar ? "التغير" : "Change"}</p>
            </div>
          )}
          <Link
            href={result.reportUrl}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {ar ? "عرض التقرير" : "View report"}
            <ArrowUpRight className="h-3.5 w-3.5 rtl-flip" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  )
}

function MarketMoversCard({
  title,
  color,
  items,
  ar,
}: { title: string; color: string; items: { ticker: string; name?: string | null; price?: number; changePct: number; volume?: number }[]; ar: boolean }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <Link
            key={item.ticker}
            href={`/company/${encodeURIComponent(item.ticker)}`}
            className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 p-2 transition-colors hover:bg-muted/60"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{item.name ?? item.ticker}</p>
              <p className="text-[11px] text-muted-foreground">{item.ticker}</p>
            </div>
            <div className="flex items-center gap-2 text-right">
              <span className={`text-sm font-bold tabular ${item.changePct >= 0 ? "text-positive" : "text-negative"}`} dir="ltr">
                {item.changePct != null ? `${item.changePct >= 0 ? "+" : ""}${item.changePct.toFixed(2)}%` : "—"}
              </span>
              <span className="text-[11px] text-muted-foreground">{priceText(item.price ?? null)} {ar ? "ج.م" : "EGP"}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

function SectorCard({ sector, ar }: { sector: { name: string; key: string }; ar: boolean }) {
  const { lang } = useI18n()
  const isAr = lang === "ar"
  return (
    <Link
      href={`/sectors/${sector.key}`}
      className="group flex items-center gap-3 rounded-xl border border-border/70 bg-card p-4 transition-colors hover:border-primary/30 hover:bg-muted/30"
    >
      <div className="flex-shrink-0 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Building2 className="h-4.5 w-4.5" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{isAr ? translateSector(sector.name) : sector.name}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all rtl-flip" aria-hidden="true" />
    </Link>
  )
}

function translateSector(name: string): string {
  const map: Record<string, string> = {
    "Healthcare & Pharma": "الرعاية الصحية والأدوية",
    "Industrial & Automotive": "الخدمات والمنتجات الصناعية والسيارات",
    "Construction": "المقاولات والإنشاءات الهندسية",
    "Non-Bank Financial": "الخدمات المالية غير المصرفية",
    "Education": "الخدمات التعليمية",
    "Paper & Packaging": "الورق ومواد التعبئة والتغليف",
    "Basic Resources": "الموارد الأساسية",
    "Travel & Leisure": "السياحة والترفيه",
    "Food & Beverages": "الأغذية والمشروبات والتبغ",
    "Textiles & Durables": "المنسوجات والسلع المعمرة",
    "Real Estate": "العقارات",
    "Trade & Distributors": "التجارة والموزعون",
    "Banks": "البنوك",
    "Building Materials": "مواد البناء",
    "IT, Media & Telecom": "الاتصالات والإعلام وتكنولوجيا المعلومات",
    "Shipping & Transport": "خدمات النقل والشحن",
    "Energy": "الطاقة والخدمات المساندة",
    "Chemicals": "الكيماويات",
  }
  return map[name] ?? name
}

function TrustCard({
  icon,
  title,
  description,
}: { icon: React.ReactNode; title: string; description: string }) {
  const { lang } = useI18n()
  const ar = lang === "ar"
  return (
    <div className="group flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-6 transition-colors hover:border-primary/30 hover:bg-muted/30">
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}