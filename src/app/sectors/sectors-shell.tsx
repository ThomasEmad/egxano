"use client"

// /sectors — sector overview. Every figure is a LEVEL from the latest available
// filing period for that sector, never a "change": median ROE is printed without
// a sign or an arrow, with its reporting period, and colour is used only for the
// sign of the return (negative ROE), never as a fake trend.
//
// The aggregate is a median (robust to one company with near-zero equity); the
// revenue/profit totals are sums over the companies that actually report, which
// the column header states.

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Building2, Info, TrendingDown, TrendingUp } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { useI18n } from "@/lib/i18n"
import { sectorLabel } from "@/lib/sectors"
import { formatEgp } from "@/lib/financial/units"

interface SectorAgg {
  sector: string
  companyCount: number
  avgRoe: number | null
  avgRoa: number | null
  avgNetMargin: number | null
  avgPe: number | null
  avgPb: number | null
  totalMarketCap: number | null
  totalRevenue: number | null
  totalNetProfit: number | null
  medianRoe: number | null
  medianPe: number | null
  medianPb: number | null
  periodLabel: string | null
  periodType: string | null
  fiscalYear: number | null
  /** Equal-weighted 1-day price change (%, finviz-style map). */
  dayChangePct?: number | null
  advancing?: number
  declining?: number
  unchanged?: number
}

interface SectorsPageShellProps {
  sectors: string[]
  counts: Map<string, number>
}

export function SectorsPageShell({ sectors, counts }: SectorsPageShellProps) {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const router = useRouter()
  const [sort, setSort] = useState<"taxonomy" | "roe">("taxonomy")
  // "all" = each sector on its own latest data — or ONE pinned fiscal year for
  // every sector (like-for-like historical comparison). Synced with ?year=.
  const [year, setYear] = useState<string>(() => {
    if (typeof window === "undefined") return "all"
    const y = new URLSearchParams(window.location.search).get("year")
    return y && /^\d{4}$/.test(y) ? y : "all"
  })

  const pickYear = useCallback((next: string) => {
    setYear(next)
    const u = new URL(window.location.href)
    if (next !== "all") u.searchParams.set("year", next)
    else u.searchParams.delete("year")
    window.history.replaceState(null, "", u.toString())
  }, [])

  const { data: sectorAggs, error: sectorError, refetch } = useQuery({
    queryKey: ["sector-aggs", year],
    queryFn: async () => {
      const res = await fetch(`/api/v1/sectors${year !== "all" ? `?year=${year}` : ""}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as { sectors: SectorAgg[]; year?: number | null; years?: number[] }
    },
    staleTime: 120_000,
  })

  // A pin the current basis can't satisfy resets to auto instead of showing dashes.
  useEffect(() => {
    const years = sectorAggs?.years
    if (years && year !== "all" && !years.includes(Number(year))) {
      // Deliberate correction of an invalid pin after the data arrives.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      pickYear("all")
    }
  }, [sectorAggs, year, pickYear])

  const aggMap = new Map((sectorAggs?.sectors ?? []).map((s) => [s.sector, s]))

  const rows = useMemo(() => {
    const built = sectors.map((s) => {
      const agg = aggMap.get(s)
      const roe = agg?.medianRoe ?? null
      return {
        sector: s,
        label: sectorLabel(s, lang),
        count: counts.get(s) ?? agg?.companyCount ?? 0,
        roe,
        periodLabel: agg?.periodLabel ?? null,
        totalMarketCap: agg?.totalMarketCap ?? null,
        totalRevenue: agg?.totalRevenue ?? null,
        totalNetProfit: agg?.totalNetProfit ?? null,
      }
    })
    if (sort === "roe") {
      return [...built].sort((a, b) => (b.roe ?? -Infinity) - (a.roe ?? -Infinity))
    }
    return built
  }, [sectors, aggMap, counts, lang, sort])

  const withRoe = rows.filter((r) => r.roe !== null)
  const maxAbsRoe = Math.max(...withRoe.map((r) => Math.abs(r.roe ?? 0)), 1)
  const totalCompanies = rows.reduce((sum, r) => sum + r.count, 0)
  const currency = ar ? "ج.م" : "EGP"
  const money = (v: number | null) => (v === null ? "—" : `${formatEgp(v, { withCurrency: false })} ${currency}`)

  return (
    <LayoutShell showMobileNav={true}>
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <nav aria-label={ar ? "مسار التنقل" : "Breadcrumb"} className="text-xs text-muted-foreground">
          <Link href="/" className="hover:underline">
            {ar ? "الرئيسية" : "Home"}
          </Link>
          <span className="mx-1.5">/</span>
          <span>{ar ? "القطاعات" : "Sectors"}</span>
        </nav>

        <header className="max-w-3xl">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {ar ? "قطاعات البورصة المصرية" : "EGX sectors"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {year !== "all"
              ? ar
                ? `مؤشرات القطاعات محسوبة على السنة المالية ${year} — نفس الفترة لكل القطاعات. القطاعات بدون قوائم منشورة لهذه السنة تظهر «—».`
                : `Sector metrics computed on fiscal year ${year} — the same period for every sector. Sectors without filings for that year show «—».`
              : ar
                ? "وسيط العائد على حقوق الملكية (ROE) والإيرادات وصافي الربح من القوائم المنشورة. الوسيط يُستخدم بدلًا من المتوسط حتى لا يحرّك رقمُ شركة واحدة صورةَ القطاع، والفترة مطبوعة في كل صف."
                : "Median return on equity (ROE), revenue and net profit from published filings. The median is used instead of the mean so one company cannot distort the sector, and every row prints its period."}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select value={year} onValueChange={pickYear}>
              <SelectTrigger className="h-8 w-56 text-xs" aria-label={ar ? "الفترة" : "Period"}>
                <SelectValue placeholder={ar ? "الفترة" : "Period"} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all" className="text-xs">
                  {ar ? "تلقائي — أحدث فترة لكل قطاع" : "Auto — each sector's latest"}
                </SelectItem>
                {(sectorAggs?.years ?? []).map((y) => (
                  <SelectItem key={y} value={String(y)} className="text-xs">
                    {ar ? `سنة مالية ${y}` : `Fiscal year ${y}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="inline-flex overflow-hidden rounded-lg border border-border/60" role="group" aria-label={ar ? "ترتيب الصفوف" : "Row order"}>
              {([
                ["taxonomy", ar ? "ترتيب القطاعات" : "Taxonomy"],
                ["roe", ar ? "حسب وسيط ROE" : "By median ROE"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSort(key)}
                  aria-pressed={sort === key}
                  className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    sort === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent/50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground">
              {ar ? `${rows.length} قطاعًا · ${totalCompanies} شركة` : `${rows.length} sectors · ${totalCompanies} companies`}
            </span>
          </div>
        </header>

        <Card className="overflow-hidden border-border/60">
          {sectorError ? (
            <div className="flex flex-col items-center gap-2 border-b border-destructive/20 bg-destructive/5 p-3 text-center text-xs">
              <p className="text-destructive">
                {ar ? "تعذّر تحميل مؤشرات القطاعات — الأسعار والأرقام قد تكون غير محدثة." : "Sector metrics could not be loaded — figures may be stale."}
              </p>
              <button type="button" onClick={() => refetch()} className="font-medium text-primary hover:underline">
                {ar ? "إعادة المحاولة" : "Retry"}
              </button>
            </div>
          ) : null}
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Building2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              {ar ? "نظرة على القطاعات" : "Sector overview"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  {ar ? "مؤشرات القطاعات: عدد الشركات ووسيط العائد على حقوق الملكية والفترة والقيمة السوقية والإيرادات وصافي الربح" : "Sector metrics: company count, median ROE and its period, market cap, revenue and net profit"}
                </caption>
                <thead>
                  <tr className="border-b border-border/40 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="p-3 text-start font-medium">{ar ? "القطاع" : "Sector"}</th>
                    <th scope="col" className="p-3 text-end font-medium">{ar ? "الشركات" : "Companies"}</th>
                    <th scope="col" className="min-w-40 p-3 text-start font-medium">{ar ? "وسيط ROE" : "Median ROE"}</th>
                    <th scope="col" className="hidden p-3 text-end font-medium sm:table-cell">{ar ? "الفترة" : "Period"}</th>
                    <th scope="col" className="hidden p-3 text-end font-medium md:table-cell">{ar ? `القيمة السوقية (${currency})` : `Market cap (${currency})`}</th>
                    <th scope="col" className="hidden p-3 text-end font-medium lg:table-cell">{ar ? `الإيرادات (${currency})` : `Revenue (${currency})`}</th>
                    <th scope="col" className="hidden p-3 text-end font-medium lg:table-cell">{ar ? `صافي الربح (${currency})` : `Net profit (${currency})`}</th>
                    <th scope="col" className="w-8 p-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {rows.map((r) => {
                    const negative = r.roe !== null && r.roe < 0
                    const width = r.roe === null ? 0 : Math.max(2, (Math.abs(r.roe) / maxAbsRoe) * 100)
                    return (
                      <tr key={r.sector} className="transition-colors hover:bg-accent/30">
                        <th scope="row" className="p-3 text-start">
                          <Link href={`/sectors/${encodeURIComponent(r.sector)}`} className="text-sm font-medium text-foreground hover:text-primary">
                            {r.label}
                          </Link>
                        </th>
                        <td className="p-3 text-end tabular text-muted-foreground">{r.count}</td>
                        <td className="p-3">
                          {r.roe === null ? (
                            <span className="text-muted-foreground/60" title={ar ? "لا توجد قوائم منشورة لهذا القطاع في هذه الفترة" : "No published filings for this sector in this period"}>
                              —
                            </span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className={`w-14 shrink-0 text-end text-xs font-semibold tabular ${negative ? "text-negative" : "text-foreground"}`}>
                                {r.roe.toFixed(1)}%
                              </span>
                              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/50" aria-hidden="true">
                                <span
                                  className={`block h-full rounded-full ${negative ? "bg-negative/70" : "bg-primary/70"}`}
                                  style={{ width: `${width}%` }}
                                />
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="hidden p-3 text-end text-[11px] text-muted-foreground sm:table-cell">{r.periodLabel ?? "—"}</td>
                        <td className="hidden p-3 text-end text-xs tabular md:table-cell">{money(r.totalMarketCap)}</td>
                        <td className="hidden p-3 text-end text-xs tabular lg:table-cell">{money(r.totalRevenue)}</td>
                        <td className={`hidden p-3 text-end text-xs tabular lg:table-cell ${r.totalNetProfit !== null && r.totalNetProfit < 0 ? "text-negative" : ""}`}>
                          {money(r.totalNetProfit)}
                        </td>
                        <td className="p-3 text-end">
                          <button
                            type="button"
                            onClick={() => router.push(`/sectors/${encodeURIComponent(r.sector)}`)}
                            className="text-muted-foreground hover:text-primary"
                            aria-label={ar ? `افتح قطاع ${r.label}` : `Open ${r.label} sector`}
                          >
                            <ArrowRight className="h-3.5 w-3.5 rtl-flip" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <p className="max-w-3xl">
            {ar
              ? "ROE هنا مستوى من آخر قوائم منشورة، وليس تغيّرًا في سعر السهم. الشريط يعبّر عن القيمة فقط (أطول شريط = أعلى وسيط في هذا العرض)، واللون الأحمر يعني عائدًا سالبًا. القيمة السوقية والإيرادات وصافي الربح مجموع الشركات المفصحة فعليًا، وليست تقديرًا لكل شركات القطاع."
              : "ROE here is a level from the latest published filings — not a price change. The bar only shows the value (longest bar = highest median in this view) and red means a negative return. Market cap, revenue and profit are sums over the companies that actually report, not estimates for every company in the sector."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <Link href="/rankings" className="inline-flex items-center gap-1 text-primary hover:underline">
            <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
            {ar ? "رتّب الشركات حسب مؤشر" : "Rank companies by a metric"}
          </Link>
          <Link href="/compare" className="inline-flex items-center gap-1 text-primary hover:underline">
            <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
            {ar ? "قارن شركتين من قطاع واحد" : "Compare two companies in one sector"}
          </Link>
        </div>

        {/* Sector assignment note — provenance, kept */}
        <section className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          <h2 className="mb-2 text-base font-semibold text-foreground">{ar ? "كيف تُنسب القطاعات" : "How sectors are assigned"}</h2>
          <p>
            {ar
              ? "تتبع العضوية القطاعية المؤشرات القطاعية المنشورة للبورصة المصرية، وليس تقديرًا بناءً على اسم الشركة. الشركات المنتمية خارج كل مؤشر منشور تُجمّع تحت «أخرى» بدلاً من إجبارها في قطاع غير ذي صلة."
              : "Sector membership follows the published EGX sector indices, not a heuristic on the company name. Companies outside every published index are grouped under “Other” rather than being forced into an unrelated sector."}
          </p>
        </section>
      </div>
    </LayoutShell>
  )
}