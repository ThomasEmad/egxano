"use client"

// /sectors/[sector] — one sector's listed companies. Single language per render
// (the previous version printed an English and an Arabic paragraph together),
// localized table headers, explicit EGP units, and the price's own date.

import Link from "next/link"
import { Info } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { useI18n } from "@/lib/i18n"
import { formatEgp } from "@/lib/financial/units"
import { SectorPeriodSelect } from "./period-select"

function fmtDate(value: Date | null | undefined, lang: "en" | "ar"): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric" })
}

interface SectorPageShellProps {
  sector: string
  ar: string
  companies: Array<{
    id: string
    ticker: string
    nameEn: string
    nameAr: string | null
    industry: string | null
    updatedAt: Date
  }>
  latestMetric: Map<string, { value: number; periodLabel: string }>
  latestPrice: Map<string, { price: number; asOf: Date }>
  url: string
  /** pinned fiscal year (null = auto — each company's latest annual) */
  year: number | null
  /** fiscal years this sector covers, descending — drives the dropdown */
  years: number[]
}

export function SectorPageShell({ sector, ar: sectorAr, companies, latestMetric, latestPrice, year, years }: SectorPageShellProps) {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const currency = ar ? "ج.م" : "EGP"

  const revenueValues = companies.map((c) => latestMetric.get(`${c.id}:revenue`)?.value).filter((v): v is number => typeof v === "number")
  const profitValues = companies.map((c) => latestMetric.get(`${c.id}:net_profit`)?.value).filter((v): v is number => typeof v === "number")
  const totalRevenue = revenueValues.reduce((a, b) => a + b, 0)
  const totalProfit = profitValues.reduce((a, b) => a + b, 0)

  const list = companies.map((c) => {
    const revenue = latestMetric.get(`${c.id}:revenue`)
    const profit = latestMetric.get(`${c.id}:net_profit`)
    const price = latestPrice.get(c.id)
    return {
      company: c,
      revenue,
      profit,
      price,
      period: revenue?.periodLabel ?? profit?.periodLabel ?? null,
    }
  })

  return (
    <LayoutShell showMobileNav={true}>
      <div className="mx-auto w-full max-w-7xl space-y-4">
        <nav aria-label={ar ? "مسار التنقل" : "Breadcrumb"} className="text-xs text-muted-foreground">
          <Link href="/" className="hover:underline">
            {ar ? "الرئيسية" : "Home"}
          </Link>
          <span className="mx-1.5">/</span>
          <Link href="/sectors" className="hover:underline">
            {ar ? "القطاعات" : "Sectors"}
          </Link>
          <span className="mx-1.5">/</span>
          <span>{ar ? sectorAr : sector}</span>
        </nav>

        <header className="max-w-3xl">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {ar ? `شركات قطاع ${sectorAr}` : `${sector} companies on the EGX`}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {ar
              ? year
                ? `${companies.length} شركة نشطة في قطاع ${sectorAr}، معروضة على السنة المالية ${year} — نفس الفترة لكل الشركات. الأسعار هي آخر لقطة مسجلة بتاريخها. «—» تعني عدم توفر قيمة موثوقة لهذه السنة، ولا تُعامل كصفر.`
                : `${companies.length} شركة نشطة في قطاع ${sectorAr}. الأسعار هي آخر لقطة مسجلة بتاريخها، والإيراد وصافي الربح هما آخر قيمة سنوية متحقق منها مع طباعة الفترة. «—» تعني عدم توفر قيمة موثوقة، ولا تُعامل كصفر.`
              : year
                ? `${companies.length} active companies in the ${sector} sector, shown on fiscal year ${year} — the same period for every company. Prices are the latest recorded snapshot with their date. “—” means no authoritative value for that year; it is never treated as zero.`
                : `${companies.length} active companies in the ${sector} sector. Prices are the latest recorded snapshot with their date; revenue and net profit are the latest verified annual figures with their period printed. “—” means no authoritative value is available — it is never treated as zero.`}
          </p>
          {years.length > 0 ? (
            <div className="mt-3">
              <SectorPeriodSelect sector={sector} year={year ? String(year) : "all"} years={years} />
            </div>
          ) : null}
        </header>

        {/* Sector summary — coverage-aware, never a roll-up of estimates */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Card className="border-border/60 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{ar ? "شركات نشطة" : "Active companies"}</p>
            <p className="mt-1 text-lg font-semibold tabular">{companies.length}</p>
          </Card>
          <Card className="border-border/60 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{ar ? "لديها بيانات إيراد" : "With revenue data"}</p>
            <p className="mt-1 text-lg font-semibold tabular">
              {revenueValues.length}
              <span className="text-xs font-normal text-muted-foreground"> / {companies.length}</span>
            </p>
          </Card>
          <Card className="border-border/60 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{ar ? `إجمالي الإيرادات (${currency})` : `Total revenue (${currency})`}</p>
            <p className="mt-1 text-lg font-semibold tabular">{revenueValues.length ? `${formatEgp(totalRevenue, { withCurrency: false })}` : "—"}</p>
          </Card>
          <Card className="border-border/60 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{ar ? `إجمالي صافي الربح (${currency})` : `Total net profit (${currency})`}</p>
            <p className={`mt-1 text-lg font-semibold tabular ${profitValues.length && totalProfit < 0 ? "text-negative" : ""}`}>
              {profitValues.length ? `${formatEgp(totalProfit, { withCurrency: false })}` : "—"}
            </p>
          </Card>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {ar
            ? "المجاميع محسوبة على الشركات التي لديها قيم منشورة فقط — وليست إسقاطًا على بقية القطاع."
            : "Totals sum the companies with published values only — they are not an extrapolation to the rest of the sector."}
        </p>

        <Card className="border-border/60 p-0">
          <CardContent className="p-0">
            {companies.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {ar ? "لا توجد شركات نشطة في هذا القطاع بعد." : "No active companies in this sector yet."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    {ar ? `شركات قطاع ${sectorAr} مع السعر والإيرادات وصافي الربح والفترة` : `${sector} companies with price, revenue, net profit and period`}
                  </caption>
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th scope="col" className="p-3 text-start font-medium">{ar ? "الشركة" : "Company"}</th>
                      <th scope="col" className="p-3 text-start font-medium">{ar ? "الرمز" : "Ticker"}</th>
                      <th scope="col" className="p-3 text-end font-medium">{ar ? `السعر (${currency})` : `Price (${currency})`}</th>
                      <th scope="col" className="hidden p-3 text-end font-medium sm:table-cell">{ar ? `الإيرادات السنوية (${currency})` : `Annual revenue (${currency})`}</th>
                      <th scope="col" className="hidden p-3 text-end font-medium sm:table-cell">{ar ? `صافي الربح السنوي (${currency})` : `Annual net profit (${currency})`}</th>
                      <th scope="col" className="hidden p-3 text-end font-medium md:table-cell">{ar ? "الفترة" : "Period"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map(({ company: c, revenue, profit, price, period }) => (
                      <tr key={c.id} className="border-b border-border/40 last:border-0 hover:bg-accent/30">
                        <td className="p-3">
                          <Link href={`/company/${c.ticker}`} className="font-medium hover:text-primary hover:underline">
                            {ar ? c.nameAr ?? c.nameEn : c.nameEn}
                          </Link>
                          {c.industry ? <span className="block text-[10px] text-muted-foreground">{c.industry}</span> : null}
                        </td>
                        <td className="p-3 font-bold">{c.ticker}</td>
                        <td className="p-3 text-end tabular">
                          {price ? price.price.toFixed(2) : "—"}
                          <span className="ms-1 text-[10px] text-muted-foreground">{fmtDate(price?.asOf, lang)}</span>
                        </td>
                        <td className="hidden p-3 text-end tabular sm:table-cell">{revenue ? `${formatEgp(revenue.value, { withCurrency: false })}` : "—"}</td>
                        <td className={`hidden p-3 text-end tabular sm:table-cell ${profit && profit.value < 0 ? "text-negative" : ""}`}>
                          {profit ? `${formatEgp(profit.value, { withCurrency: false })}` : "—"}
                        </td>
                        <td className="hidden p-3 text-end text-[11px] text-muted-foreground md:table-cell">{period ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <Link href={`/rankings?sector=${encodeURIComponent(sector)}`} className="text-primary hover:underline">
            {ar ? "رتّب شركات هذا القطاع حسب مؤشر" : "Rank companies in this sector"}
          </Link>
          <Link href="/compare" className="text-primary hover:underline">
            {ar ? "قارن شركتين من هذا القطاع" : "Compare two companies from this sector"}
          </Link>
          <Link href="/sectors" className="text-muted-foreground hover:underline">
            {ar ? "كل القطاعات" : "All sectors"}
          </Link>
        </div>

        <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {ar
            ? "القيم المالية من الإفصاحات المنشورة، والأسعار من آخر لقطة سوق مسجلة بتاريخها."
            : "Financial figures come from published filings; prices are the latest recorded market snapshot, with its date shown."}
        </p>
      </div>
    </LayoutShell>
  )
}
