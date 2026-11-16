"use client"

// /sectors/[sector] — one sector's listed companies. Owner redesign 2026-11-17
// («صفحة قطاع البنوك UI سيء جدا»): gradient hero, icon stat tiles, and the
// companies rendered as professional cards instead of a bare table — same
// design language as the /companies grid. Single language per render,
// localized labels, explicit EGP units, and the price's own date.

import Link from "next/link"
import { ArrowLeftRight, ArrowUpRight, Building2, CalendarDays, Coins, Info, Scale } from "lucide-react"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { Badge } from "@/components/ui/badge"
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

function StatTile({ label, value, sub, icon, tone }: { label: string; value: string; sub?: string; icon: React.ReactNode; tone?: "primary" | "positive" | "negative" }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm transition-colors hover:border-primary/40">
      <div className="flex items-start gap-3 p-3.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone === "positive" ? "bg-positive/15 text-positive" : tone === "negative" ? "bg-negative/15 text-negative" : "bg-primary/15 text-primary"}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className={`mt-0.5 truncate text-lg font-bold tabular ${tone === "negative" ? "text-negative" : tone === "positive" ? "text-positive" : ""}`}>{value}</p>
          {sub ? <p className="text-[10px] text-muted-foreground">{sub}</p> : null}
        </div>
      </div>
    </div>
  )
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
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <nav aria-label={ar ? "مسار التنقل" : "Breadcrumb"} className="text-xs text-muted-foreground">
          <Link href="/" className="hover:text-primary hover:underline">
            {ar ? "الرئيسية" : "Home"}
          </Link>
          <span className="mx-1.5">/</span>
          <Link href="/sectors" className="hover:text-primary hover:underline">
            {ar ? "القطاعات" : "Sectors"}
          </Link>
          <span className="mx-1.5">/</span>
          <span className="font-medium text-foreground">{ar ? sectorAr : sector}</span>
        </nav>

        {/* hero */}
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/10 via-card to-card shadow-sm">
          <div className="flex flex-wrap items-start gap-4 p-5 md:p-6">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/30">
              <Building2 className="h-7 w-7 text-primary" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
                {ar ? `قطاع ${sectorAr}` : `${sector} on the EGX`}
              </h1>
              <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {ar
                  ? year
                    ? `${companies.length} شركة نشطة، معروضة على السنة المالية ${year} — نفس الفترة لكل الشركات. الأسعار آخر لقطة مسجلة بتاريخها، و«—» تعني عدم توفر قيمة موثوقة (لا تُعامل كصفر).`
                    : `${companies.length} شركة نشطة. الأسعار آخر لقطة مسجلة بتاريخها، والإيراد وصافي الربح آخر قيمة سنوية متحقق منها مع طباعة الفترة، و«—» تعني عدم توفر قيمة موثوقة (لا تُعامل كصفر).`
                  : year
                    ? `${companies.length} active companies on fiscal year ${year} — the same period for every company. “—” means no authoritative value; never zero.`
                    : `${companies.length} active companies. Prices are the latest snapshot with their date; “—” means no authoritative value — never zero.`}
              </p>
            </div>
            {years.length > 0 ? <SectorPeriodSelect sector={sector} year={year ? String(year) : "all"} years={years} /> : null}
          </div>
        </div>

        {/* sector summary — coverage-aware, never a roll-up of estimates */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label={ar ? "شركات نشطة" : "Active companies"} value={String(companies.length)} icon={<Building2 className="h-4 w-4" aria-hidden />} />
          <StatTile
            label={ar ? "لديها بيانات إيراد" : "With revenue data"}
            value={String(revenueValues.length)}
            sub={ar ? `من ${companies.length}` : `of ${companies.length}`}
            icon={<Coins className="h-4 w-4" aria-hidden />}
          />
          <StatTile
            label={ar ? `إجمالي الإيرادات (${currency})` : `Total revenue (${currency})`}
            value={revenueValues.length ? formatEgp(totalRevenue, { withCurrency: false }) : "—"}
            icon={<ArrowUpRight className="h-4 w-4" aria-hidden />}
            tone="positive"
          />
          <StatTile
            label={ar ? `إجمالي صافي الربح (${currency})` : `Total net profit (${currency})`}
            value={profitValues.length ? formatEgp(totalProfit, { withCurrency: false }) : "—"}
            icon={<Scale className="h-4 w-4" aria-hidden />}
            tone={profitValues.length && totalProfit < 0 ? "negative" : "positive"}
          />
        </div>
        <p className="-mt-3 text-[10px] leading-relaxed text-muted-foreground">
          {ar
            ? "المجاميع محسوبة على الشركات التي لديها قيم منشورة فقط — وليست إسقاطًا على بقية القطاع."
            : "Totals sum the companies with published values only — they are not an extrapolation to the rest of the sector."}
        </p>

        {/* companies — professional cards, same language as /companies */}
        {companies.length === 0 ? (
          <div className="rounded-xl border border-border/60 p-10 text-center text-sm text-muted-foreground">
            {ar ? "لا توجد شركات نشطة في هذا القطاع بعد." : "No active companies in this sector yet."}
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="flex items-center gap-2 text-base font-bold">
              <Building2 className="h-4.5 w-4.5 text-primary" aria-hidden />
              {ar ? `شركات القطاع (${companies.length})` : `Sector companies (${companies.length})`}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map(({ company: c, revenue, profit, price, period }) => (
                <Link
                  key={c.id}
                  href={`/company/${c.ticker}`}
                  className="group block rounded-xl border border-border/60 bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Badge variant="secondary" className="font-mono text-[11px]">{c.ticker}</Badge>
                      <p className="mt-1.5 truncate font-bold group-hover:text-primary">{ar ? c.nameAr ?? c.nameEn : c.nameEn}</p>
                      {c.industry ? <p className="truncate text-[10px] text-muted-foreground">{c.industry}</p> : null}
                    </div>
                    <div className="shrink-0 text-end">
                      <p className="text-[10px] text-muted-foreground">{ar ? "السعر" : "Price"}</p>
                      <p className="text-base font-extrabold tabular" dir="ltr">{price ? price.price.toFixed(2) : "—"}</p>
                      <p className="text-[9px] text-muted-foreground" dir="ltr">{fmtDate(price?.asOf, lang)}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/40 pt-3 text-sm">
                    <div>
                      <p className="text-[10px] text-muted-foreground">{ar ? "الإيرادات السنوية" : "Annual revenue"}</p>
                      <p className="font-bold tabular">{revenue ? formatEgp(revenue.value, { withCurrency: false }) : "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">{ar ? "صافي الربح السنوي" : "Annual net profit"}</p>
                      <p className={`font-bold tabular ${profit && profit.value < 0 ? "text-negative" : "text-positive"}`}>
                        {profit ? formatEgp(profit.value, { withCurrency: false }) : "—"}
                      </p>
                    </div>
                  </div>
                  {period ? (
                    <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <CalendarDays className="h-3 w-3" aria-hidden />
                      <span>{ar ? "الفترة:" : "Period:"} <b className="font-semibold">{period}</b></span>
                    </div>
                  ) : null}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* related actions */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href={`/rankings?sector=${encodeURIComponent(sector)}`}
            className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-4 text-sm font-semibold shadow-sm transition-all hover:border-primary/50 hover:shadow-md"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <ArrowLeftRight className="h-4 w-4" aria-hidden />
            </span>
            {ar ? "رتّب شركات هذا القطاع حسب مؤشر" : "Rank companies in this sector"}
          </Link>
          <Link
            href="/compare"
            className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-4 text-sm font-semibold shadow-sm transition-all hover:border-primary/50 hover:shadow-md"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <ArrowLeftRight className="h-4 w-4 rotate-90" aria-hidden />
            </span>
            {ar ? "قارن شركتين من هذا القطاع" : "Compare two companies from this sector"}
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
