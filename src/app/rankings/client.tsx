"use client"

// /rankings — rank companies by ONE metric, with the direction stated.
//
// Rules:
//  · Lower-is-better metrics (P/E, P/B, liabilities/equity) are requested with
//    order=asc, so rank 1 is the genuinely lowest figure — never the most
//    expensive company wearing a crown.
//  · The footer claim is computed from the active basis and period pin; it never
//    says "annual filings" while showing TTM or mixed-quarter rows.
//  · Ranks are descriptive: a rank is a sort of one figure, not a verdict.
//  · A sector-median column appears for the ratios that have a published sector
//    median (ROE, P/E, P/B) so "high" can be read against its own sector.

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { ListOrdered, Lock, Scale } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { MetricTip } from "@/components/brand/metric-tip"
import { EmptyState } from "@/components/brand/empty-state"
import { CalculationNote } from "@/components/brand/data-trust"
import { useSubscriptionGate } from "@/lib/client/subscription-gate"
import { useI18n } from "@/lib/i18n"
import { TRUST } from "@/lib/brand"
import { sectorLabel } from "@/lib/sectors"
interface RankRow {
  companyId: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
  value: number
  fiscalYear: number
  periodLabel: string
  periodType: string
  stale: boolean
}

interface RankingsData {
  metric: { code: string; labelEn: string; labelAr: string; unit: string }
  basis: "latest" | "annual" | "ttm"
  year: number | null
  years: number[]
  results: RankRow[]
  sectors: string[]
  total: number
}

const METRIC_CHIPS = [
  "roe", "roa", "net_margin", "p_e", "p_b",
  "liabilities_to_equity", "market_cap", "revenue", "net_profit",
] as const

/** Defensible direction. Size metrics have none: a rank there is just size. */
const LOWER_IS_BETTER = new Set(["p_e", "p_b", "liabilities_to_equity", "debt_to_equity"])
const SCALE_METRICS = new Set(["market_cap", "revenue", "net_profit"])

const FALLBACK_LABELS: Record<string, { en: string; ar: string; unit: string }> = {
  roe: { en: "ROE", ar: "العائد على حقوق الملكية", unit: "PERCENT" },
  roa: { en: "ROA", ar: "العائد على الأصول", unit: "PERCENT" },
  net_margin: { en: "Net margin", ar: "هامش صافي الربح", unit: "PERCENT" },
  p_e: { en: "P/E", ar: "مضاعف الربحية", unit: "RATIO" },
  p_b: { en: "P/B", ar: "مضاعف القيمة الدفترية", unit: "RATIO" },
  liabilities_to_equity: { en: "Liabilities / equity", ar: "المطلوبات إلى حقوق الملكية", unit: "RATIO" },
  market_cap: { en: "Market cap", ar: "القيمة السوقية", unit: "EGP" },
  revenue: { en: "Revenue", ar: "الإيرادات", unit: "EGP" },
  net_profit: { en: "Net profit", ar: "صافي الربح", unit: "EGP" },
}

function fmtValue(unit: string, v: number): string {
  if (unit === "PERCENT") return `${v.toFixed(1)}%`
  if (unit === "EGP") {
    if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`
    if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  }
  if (unit === "EGP_PER_SHARE") return `${v.toFixed(2)}`
  return v.toFixed(2)
}

type Basis = "latest" | "annual" | "ttm"

function readUrlState(): { metric: string; sector: string | null; basis: Basis; year: string } {
  if (typeof window === "undefined") return { metric: "roe", sector: null, basis: "latest", year: "all" }
  const u = new URLSearchParams(window.location.search)
  const metric = u.get("metric") && (METRIC_CHIPS as readonly string[]).includes(u.get("metric")!) ? u.get("metric")! : "roe"
  const rawBasis = u.get("basis")
  const basis: Basis = rawBasis === "annual" || rawBasis === "ttm" ? rawBasis : "latest"
  const sector = u.get("sector")
  const year = u.get("year") && /^\d{4}$/.test(u.get("year")!) ? u.get("year")! : "all"
  return { metric, sector, basis, year }
}

export default function RankingsPage() {
  const { lang, pick } = useI18n()
  const { isPremium } = useSubscriptionGate()
  const router = useRouter()

  const initial = useMemo(() => readUrlState(), [])
  const [metric, setMetric] = useState(initial.metric)
  const [sector, setSector] = useState<string | null>(initial.sector)
  const [basis, setBasis] = useState<Basis>(initial.basis)
  const [year, setYear] = useState(initial.year)
  const [selected, setSelected] = useState<string[]>([])
  const ar = lang === "ar"

  const direction: "asc" | "desc" = LOWER_IS_BETTER.has(metric) ? "asc" : "desc"
  const isScale = SCALE_METRICS.has(metric)
  const hasSectorMedian = metric === "roe" || metric === "p_e" || metric === "p_b"

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["rankings", metric, sector, basis, year],
    queryFn: async () => {
      const q = new URLSearchParams({ metric, basis, order: direction })
      if (sector) q.set("sector", sector)
      if (year !== "all") q.set("year", year)
      const res = await fetch(`/api/v1/rankings?${q}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as RankingsData
    },
    staleTime: 120_000,
  })

  const { data: sectorAggs } = useQuery({
    queryKey: ["rankings-sector-medians", year],
    queryFn: async () => {
      const q = new URLSearchParams()
      if (year !== "all") q.set("year", year)
      const res = await fetch(`/api/v1/sectors${q.toString() ? `?${q}` : ""}`)
      if (!res.ok) return { sectors: [] as { sector: string; medianRoe?: number | null; medianPe?: number | null; medianPb?: number | null; periodLabel?: string | null }[] }
      return (await res.json()) as {
        sectors: { sector: string; medianRoe?: number | null; medianPe?: number | null; medianPb?: number | null; periodLabel?: string | null }[]
      }
    },
    enabled: hasSectorMedian,
    staleTime: 120_000,
  })

  // A pin that the metric/basis cannot satisfy falls back to auto.
  useEffect(() => {
    if (data && year !== "all" && !(data.years ?? []).includes(Number(year))) {
      // Deliberate correction of an invalid pin after the data arrives.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setYear("all")
    }
  }, [data, year])

  // Keep the view shareable.
  useEffect(() => {
    if (typeof window === "undefined") return
    const u = new URL(window.location.href)
    u.searchParams.set("metric", metric)
    if (basis !== "latest") u.searchParams.set("basis", basis)
    else u.searchParams.delete("basis")
    if (sector) u.searchParams.set("sector", sector)
    else u.searchParams.delete("sector")
    if (year !== "all") u.searchParams.set("year", year)
    else u.searchParams.delete("year")
    window.history.replaceState(null, "", u.toString())
  }, [metric, basis, sector, year])

  const labels = useMemo(() => {
    const map: Record<string, { en: string; ar: string; unit: string }> = { ...FALLBACK_LABELS }
    if (data?.metric) map[data.metric.code] = { en: data.metric.labelEn, ar: data.metric.labelAr, unit: data.metric.unit }
    return map
  }, [data])

  const medianBySector = useMemo(() => {
    const map = new Map<string, number | null>()
    for (const s of sectorAggs?.sectors ?? []) {
      const v = metric === "roe" ? s.medianRoe : metric === "p_e" ? s.medianPe : metric === "p_b" ? s.medianPb : null
      if (typeof v === "number" && Number.isFinite(v)) map.set(s.sector, v)
    }
    return map
  }, [sectorAggs?.sectors, metric])

  const unit = labels[metric]?.unit ?? "RATIO"
  const metricLabel = pick(labels[metric]?.en ?? metric, labels[metric]?.ar ?? metric)
  const visible = isPremium ? data?.results ?? [] : (data?.results ?? []).slice(0, 10)
  const hiddenCount = Math.max(0, (data?.results.length ?? 0) - visible.length)

  const basisLabel =
    basis === "annual"
      ? ar
        ? "أحدث سنة سنوية"
        : "latest annual"
      : basis === "ttm"
        ? ar
          ? "آخر ١٢ شهرًا"
          : "trailing twelve months"
        : ar
          ? "أحدث بيانات متاحة"
          : "latest available"

  const directionLabel = isScale
    ? ar
      ? "الأعلى يعني حجمًا أكبر — ليس إشارة جودة"
      : "Higher means larger — not a quality signal"
    : direction === "asc"
      ? ar
        ? "الأقل أفضل"
        : "Lower is better"
      : ar
        ? "الأعلى أفضل"
        : "Higher is better"

  const periodClaim = year !== "all"
    ? ar
      ? `سنة مالية مشتركة ${year} لكل الشركات المرتبة`
      : `shared fiscal year ${year} for every ranked company`
    : ar
      ? "كل صف يعرض فترته — لا فترة موحدة"
      : "each row shows its own period — no shared window"

  function toggleSelect(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 4 ? prev : [...prev, id]))
  }

  if (error) {
    return (
      <LayoutShell showMobileNav={true}>
        <div className="mx-auto w-full max-w-7xl">
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm font-medium text-destructive">
                {ar ? "تعذّر تحميل الترتيب — لم يُفقد اختيارك." : "The ranking could not be loaded — your selection is kept."}
              </p>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => refetch()}>
                {ar ? "إعادة المحاولة" : "Retry"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </LayoutShell>
    )
  }

  return (
    <LayoutShell showMobileNav={true}>
      <TooltipProvider delayDuration={100}>
        <div className="mx-auto w-full max-w-7xl space-y-4">
          <header>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
              <ListOrdered className="h-5 w-5 text-primary" aria-hidden="true" />
              {ar ? "ترتيب الشركات حسب مؤشر واحد" : "Rank companies by one metric"}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {ar
                ? "الترتيب هو فرز لقيمة مؤشر واحد، وليس حكمًا عامًا على الشركة. الاتجاه موضح لكل مؤشر، والفترة مطبوعة في كل صف."
                : "A rank is a sort of one figure, not an overall judgement. The direction is stated for each metric, and every row prints its own period."}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">{directionLabel}</p>
          </header>

          {/* Basis + period pin */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-xl border border-border/60 bg-surface-secondary/50" role="group" aria-label={ar ? "أساس الترتيب" : "Ranking basis"}>
              {([
                ["latest", ar ? "أحدث بيانات" : "Latest available"],
                ["ttm", ar ? "١٢ شهرًا" : "TTM"],
                ["annual", ar ? "آخر سنة سنوية" : "Latest annual"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setBasis(key)}
                  aria-pressed={basis === key}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    basis === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="h-8 w-48 text-xs" aria-label={ar ? "الفترة" : "Period"}>
                <SelectValue placeholder={ar ? "الفترة" : "Period"} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all" className="text-xs">
                  {ar ? "تلقائي — أحدث فترة لكل شركة" : "Auto — each company's latest"}
                </SelectItem>
                {(data?.years ?? []).map((y) => (
                  <SelectItem key={y} value={String(y)} className="text-xs">
                    {ar ? `سنة مالية ${y}` : `Fiscal year ${y}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sector ?? "all"} onValueChange={(v) => setSector(v === "all" ? null : v)}>
              <SelectTrigger className="h-8 w-48 text-xs" aria-label={ar ? "القطاع" : "Sector"}>
                <SelectValue placeholder={ar ? "كل القطاعات" : "All sectors"} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all" className="text-xs">{ar ? "كل القطاعات" : "All sectors"}</SelectItem>
                {(data?.sectors ?? []).map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">
                    {sectorLabel(s, lang)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(metric === "roe" || metric === "roa") && basis === "latest" ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {ar
                ? "ROE/ROA في أساس «أحدث بيانات» تُحسب على آخر فترة كاملة (TTM أو سنوية) — لا تُقارن أرباع غير سنوية بفترات سنوية."
                : "On the latest basis, ROE/ROA use the latest full period (TTM or annual) — unannualised quarters are not ranked against annual figures."}
            </p>
          ) : null}

          {/* Metric chips */}
          <div className="flex flex-wrap gap-1.5">
            {METRIC_CHIPS.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setMetric(code)}
                aria-pressed={metric === code}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  metric === code
                    ? "bg-primary text-primary-foreground"
                    : "border border-border/60 bg-card text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
              >
                {pick(labels[code]?.en ?? code, labels[code]?.ar ?? code)}
                {LOWER_IS_BETTER.has(code) ? <span aria-hidden="true" className="ms-1 text-[10px]">↓</span> : null}
              </button>
            ))}
          </div>

          {/* Table */}
          <Card className="overflow-hidden border-border/60">
            <CardContent className="p-0">
              {isLoading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 rounded-lg" />
                  ))}
                </div>
              ) : !data || data.results.length === 0 ? (
                <EmptyState
                  icon={ListOrdered}
                  title={ar ? "لا بيانات لهذا المؤشر في هذا النطاق" : "No data for this metric in this scope"}
                  description={
                    ar
                      ? "قد لا تكون القيم متاحة بعد لهذه الفترة، أو لا يوجد في القطاع شركات لديها بيانات لهذا المؤشر. جرّب أساس «أحدث بيانات متاحة» أو قطاعًا آخر."
                      : "Values may not exist yet for this period, or no company in the sector has data for this metric. Try the latest basis or another sector."
                  }
                  action={
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setYear("all"); setBasis("latest") }}>
                      {ar ? "أعد الضبط" : "Reset to latest"}
                    </Button>
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      {ar ? `ترتيب الشركات حسب ${metricLabel}` : `Companies ranked by ${metricLabel}`}
                    </caption>
                    <thead>
                      <tr className="border-b border-border/40 bg-card/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th scope="col" className="w-10 p-2 text-center font-medium">
                          <span aria-hidden="true">✓</span>
                          <span className="sr-only">{ar ? "اختيار للمقارنة" : "Select for comparison"}</span>
                        </th>
                        <th scope="col" className="w-10 p-3 text-start font-medium">#</th>
                        <th scope="col" className="p-3 text-start font-medium">{ar ? "الشركة" : "Company"}</th>
                        <th scope="col" className="hidden p-3 text-start font-medium sm:table-cell">{ar ? "القطاع" : "Sector"}</th>
                        <th scope="col" className="p-3 text-end font-medium">
                          <MetricTip code={metric} label={metricLabel} />
                        </th>
                        {hasSectorMedian ? (
                          <th scope="col" className="hidden p-3 text-end font-medium md:table-cell">
                            {ar ? "وسيط القطاع" : "Sector median"}
                          </th>
                        ) : null}
                        <th scope="col" className="hidden p-3 text-end font-medium md:table-cell">{ar ? "الفترة" : "Period"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((r, i) => {
                        const top = i < 3
                        const median = hasSectorMedian ? medianBySector.get(r.sector) ?? null : null
                        return (
                          <tr
                            key={r.companyId}
                            className={`border-b border-border/40 transition-colors last:border-0 hover:bg-accent/30 ${top ? "bg-primary/[0.03]" : ""}`}
                          >
                            <td className="p-2 text-center">
                              <input
                                type="checkbox"
                                checked={selected.includes(r.companyId)}
                                onChange={() => toggleSelect(r.companyId)}
                                className="h-3.5 w-3.5 accent-primary"
                                aria-label={ar ? `اختيار ${r.ticker} للمقارنة` : `Select ${r.ticker} for comparison`}
                              />
                            </td>
                            <td className="p-3">
                              <span className={`tabular text-xs ${top ? "font-bold text-primary" : "font-medium text-muted-foreground"}`}>{i + 1}</span>
                            </td>
                            <td className="p-3">
                              <button
                                type="button"
                                onClick={() => router.push(`/company/${r.ticker}`)}
                                className="flex min-w-0 items-center gap-2 text-start hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <span className="font-bold">{r.ticker}</span>
                                <span className="hidden max-w-56 truncate text-xs text-muted-foreground sm:inline">{pick(r.nameEn, r.nameAr ?? r.nameEn)}</span>
                              </button>
                            </td>
                            <td className="hidden p-3 text-xs text-muted-foreground sm:table-cell">{sectorLabel(r.sector, lang)}</td>
                            <td className={`p-3 text-end font-bold tabular ${top ? "text-foreground" : ""}`}>{fmtValue(unit, r.value)}</td>
                            {hasSectorMedian ? (
                              <td className="hidden p-3 text-end text-xs tabular text-muted-foreground md:table-cell">
                                {median !== null ? fmtValue(unit, median) : "—"}
                              </td>
                            ) : null}
                            <td className="hidden p-3 text-end text-[11px] text-muted-foreground md:table-cell">
                              {r.periodLabel}
                              {r.stale ? (
                                <Badge
                                  variant="outline"
                                  className="ms-1 border-warning/40 px-1 py-0 text-[9px] text-warning"
                                  title={ar ? "الفترة أقدم من أحدث فترة بالسوق بأكثر من أربعة أرباع" : "More than four quarters behind the market's freshest period"}
                                >
                                  {ar ? "قديمة" : "stale"}
                                </Badge>
                              ) : null}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {selected.length > 0 ? (
            <div className="sticky bottom-2 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-card/95 p-2.5 shadow-sm backdrop-blur">
              <span className="text-xs font-medium text-foreground">
                {ar ? `${selected.length} محددة للمقارنة` : `${selected.length} selected for comparison`}
              </span>
              <Button size="sm" className="ms-auto h-7 gap-1.5 text-xs" disabled={selected.length < 2} onClick={() => router.push(`/compare?ids=${selected.join(",")}`)}>
                <Scale className="h-3.5 w-3.5" aria-hidden="true" />
                {ar ? "قارن" : "Compare"}
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected([])}>
                {ar ? "إلغاء" : "Clear"}
              </Button>
            </div>
          ) : null}
          {selected.length === 1 ? (
            <p className="text-[11px] text-muted-foreground">{ar ? "اختر شركة أخرى للمقارنة." : "Select one more company to compare."}</p>
          ) : null}

          {!isPremium && hiddenCount > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gold/30 bg-gold/5 p-3">
              <p className="flex items-center gap-2 text-xs text-warning">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                {ar ? `${hiddenCount} شركة إضافية مع بريميوم` : `${hiddenCount} more companies with Premium`}
              </p>
              <Button size="sm" className="h-7 text-xs" onClick={() => router.push("/premium")}>
                {ar ? "تفاصيل بريميوم" : "Premium details"}
              </Button>
            </div>
          ) : null}

          {/* Provenance — computed from the active basis, never a fixed claim */}
          <div className="space-y-1">
            <CalculationNote />
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {ar
                ? `المصدر: ${TRUST.sourceFiling.ar} · الأساس: ${basisLabel} · الفترة: ${periodClaim}. الترتيب لا يعني توصية.`
                : `Source: ${TRUST.sourceFiling.en} · basis: ${basisLabel} · period: ${periodClaim}. A rank is not a recommendation.`}
            </p>
          </div>
        </div>
      </TooltipProvider>
    </LayoutShell>
  )
}
