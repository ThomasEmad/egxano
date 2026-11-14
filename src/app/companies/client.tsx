"use client"

// /companies — the EGX company directory. Every card labels each figure with
// its reporting period, shows the company's data coverage (filings, detected
// events, dividend records), states the market-price freshness, and can feed a
// comparison selection (2–4) that hands off to /compare.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Building2, ChevronLeft, ChevronRight, Download, FileText, Scale, Search, TrendingDown, TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useI18n } from "@/lib/i18n"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { SECTORS, SECTOR_AR, sectorLabel } from "@/lib/sectors"
import { formatEgp } from "@/lib/financial/units"
import { api, getUserToken } from "@/lib/client/api"
import { BRAND } from "@/lib/brand"
import { MarketDataLine, UnavailableValue } from "@/components/brand/data-trust"
import { EmptyState } from "@/components/brand/empty-state"

interface SnapshotMetric {
  value: number | null
  status: string
  periodLabel: string
  fiscalYear: number
}

interface CompanyRow {
  id: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
  industry: string | null
  listingStatus: string
  counts: { reports: number; events: number; dividends: number }
  snapshot: Record<string, SnapshotMetric>
  marketPrice: { price: number; asOf: string | null; currency: string; changePct: number | null } | null
  marketCap: number | null
}

interface CompaniesData {
  page: number
  pageSize: number
  total: number
  totalPages: number
  sort: string
  marketAsOf: string | null
  delayMinutes: number | null
  companies: CompanyRow[]
}

const PAGE_SIZE = 12
const MAX_COMPARE = 4

function usable(metric: SnapshotMetric | undefined): metric is SnapshotMetric & { value: number } {
  return !!metric && metric.status === "OK" && typeof metric.value === "number" && Number.isFinite(metric.value)
}

export function CompaniesPageShell() {
  const { lang, pick } = useI18n()
  const ar = lang === "ar"
  const router = useRouter()

  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [sector, setSector] = useState<string | null>(null)
  // Fixed sort — market cap only (alphabetical filter removed 2026-11-14 by owner request).
  const [sort] = useState<"ticker" | "marketCap">("marketCap")
  const [page, setPage] = useState(1)
  const [compareMode, setCompareMode] = useState(false)
  const [selected, setSelected] = useState<string[]>([])

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [searchInput])

  const { data, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: ["companies", search, sector, sort, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort })
      if (search) params.set("search", search)
      if (sector) params.set("sector", sector)
      const res = await fetch(`/api/v1/companies?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as CompaniesData
    },
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  })

  const companies = data?.companies ?? []
  const totalPages = data?.totalPages ?? 1

  const sectorOptions = useMemo(() => SECTORS.filter((s) => s !== "Other" || sector === "Other"), [sector])

  function pickSector(next: string) {
    setSector(next === "all" ? null : next)
    setPage(1)
  }

  const toggleCompare = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_COMPARE ? prev : [...prev, id]))
  }, [])

  const compareAllowed = idsFit(selected)

  if (error) {
    return (
      <LayoutShell showMobileNav={true}>
        <div className="mx-auto w-full max-w-7xl">
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm font-medium text-destructive">
                {ar ? "تعذّر تحميل الشركات — لم تُفقد فلاترك." : "The companies could not be loaded — your filters are kept."}
              </p>
              <p className="text-xs text-muted-foreground">{ar ? "حدث خطأ في الاتصال أو في الخادم." : "A connection or server error occurred."}</p>
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
      <div className="mx-auto w-full max-w-7xl space-y-4">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
              <Building2 className="h-5 w-5 text-primary" aria-hidden="true" />
              {ar ? "الشركات" : "Companies"}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {data
                ? ar
                  ? `${data.total.toLocaleString("ar-EG")} شركة مدرجة في البورصة المصرية — ابحث، فلتر بالقطاع، وافتح أي شركة. كل رقم موضح بالفترة التي يخصها.`
                  : `${data.total.toLocaleString("en-GB")} companies listed on the Egyptian Exchange — search, filter by sector, and open any company. Every figure is labelled with the period it comes from.`
                : ar
                  ? "شركات البورصة المصرية مع السعر والقيمة السوقية وأهم الأرقام المالية وفتراتها."
                  : "EGX companies with price, market cap and key financial figures — each with its reporting period."}
            </p>
          </div>
          <a
            href="/api/v1/companies/export"
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            download
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {ar ? "تصدير CSV" : "Export CSV"}
          </a>
        </header>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={ar ? "ابحث بالاسم أو الرمز…" : "Search by name or ticker…"}
              className="h-9 ps-9 text-sm"
              aria-label={ar ? "البحث في الشركات" : "Search companies"}
            />
          </div>

          <Select value={sector ?? "all"} onValueChange={pickSector}>
            <SelectTrigger className="h-9 w-56 text-xs" aria-label={ar ? "القطاع" : "Sector"}>
              <SelectValue placeholder={ar ? "كل القطاعات" : "All sectors"} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all" className="text-xs">{ar ? "كل القطاعات" : "All sectors"}</SelectItem>
              {sectorOptions.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  {ar ? SECTOR_AR[s] ?? s : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={compareMode ? "default" : "outline"}
            size="sm"
            className="h-9 gap-1.5 text-xs"
            aria-pressed={compareMode}
            onClick={() => {
              setCompareMode((v) => !v)
              if (compareMode) setSelected([])
            }}
          >
            <Scale className="h-3.5 w-3.5" aria-hidden="true" />
            {ar ? "وضع المقارنة" : "Compare mode"}
          </Button>
          {compareMode ? (
            <span className="text-[11px] text-muted-foreground">
              {ar ? `اختر ٢ إلى ٤ شركات (${selected.length} محددة)` : `Select 2–4 companies (${selected.length} selected)`}
            </span>
          ) : null}
        </div>

        {/* Market data freshness — the server's own delay value */}
        {data ? (
          <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
            <MarketDataLine asOf={data.marketAsOf} delayMinutes={data.delayMinutes} source="market-ticker" />
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {ar ? "الأرقام المالية من الإفصاحات المنشورة، وكل رقم موضح بفترته." : "Financial figures come from published filings; each figure states its period."}
            </p>
          </div>
        ) : null}

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-48 rounded-2xl" />
            ))}
          </div>
        ) : companies.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={search || sector ? (ar ? "لا توجد شركات مطابقة" : "No companies match") : ar ? "لا بيانات متاحة بعد" : "No data available yet"}
            description={
              search || sector
                ? ar
                  ? "البحث أو فلتر القطاع ضيّق النتائج. جرّب توسيع الفلاتر."
                  : "The search or sector filter narrowed the results. Try widening them."
                : ar
                  ? "تظهر الشركات هنا بعد توفر البيانات المنشورة."
                  : "Companies appear here once published data is available."
            }
            action={
              search || sector ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setSearchInput("")
                    setSector(null)
                    setPage(1)
                  }}
                >
                  {ar ? "مسح كل الفلاتر" : "Clear all filters"}
                </Button>
              ) : null
            }
          />
        ) : (
          <div className={`grid grid-cols-1 gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-3 ${isFetching ? "opacity-70" : ""}`}>
            {companies.map((c) => {
              const name = pick(c.nameEn, c.nameAr ?? c.nameEn)
              const price = c.marketPrice?.price ?? null
              const chg = c.marketPrice?.changePct ?? null
              const roe = c.snapshot["roe"]
              const revenue = c.snapshot["revenue"]
              const profit = c.snapshot["net_profit"]
              const checked = selected.includes(c.id)
              return (
                <Card
                  key={c.id}
                  className={`border-border/60 transition-colors hover:border-primary/40 ${compareMode ? "" : "cursor-pointer"}`}
                  role={compareMode ? undefined : "link"}
                  tabIndex={compareMode ? undefined : 0}
                  aria-label={compareMode ? undefined : name}
                  onClick={() => {
                    if (!compareMode) router.push(`/company/${c.ticker}`)
                  }}
                  onKeyDown={(e) => {
                    if (compareMode) return
                    // Only the card itself opens the profile — not its inner buttons.
                    if (e.target !== e.currentTarget) return
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      router.push(`/company/${c.ticker}`)
                    }
                  }}
                >
                  <CardContent className="flex flex-col gap-3 p-4">
                    {/* Identity + price */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        {compareMode ? (
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCompare(c.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-1.5 h-3.5 w-3.5 shrink-0 accent-primary"
                            aria-label={ar ? `اختيار ${c.ticker} للمقارنة` : `Select ${c.ticker} for comparison`}
                          />
                        ) : null}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="flex h-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 px-2 text-[11px] font-bold text-primary">
                              {c.ticker}
                            </span>
                            <span className="truncate text-sm font-bold text-foreground" title={name}>
                              {name}
                            </span>
                          </div>
                          <p className="mt-1.5 text-[11px] text-muted-foreground">
                            {sectorLabel(c.sector, lang)}
                            {c.listingStatus === "SUSPENDED" ? (
                              <span className="ms-2 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                                {ar ? "موقوفة" : "Suspended"}
                              </span>
                            ) : null}
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0 text-end">
                        <div className="tabular text-sm font-bold text-foreground">
                          {price !== null ? price.toLocaleString(ar ? "ar-EG" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                        </div>
                        {chg !== null ? (
                          <div className={`flex items-center justify-end gap-0.5 text-[11px] font-semibold tabular ${chg >= 0 ? "text-positive" : "text-negative"}`}>
                            {chg >= 0 ? <TrendingUp className="h-3 w-3" aria-hidden="true" /> : <TrendingDown className="h-3 w-3" aria-hidden="true" />}
                            {chg >= 0 ? "+" : ""}
                            {chg.toFixed(2)}%
                          </div>
                        ) : (
                          <div className="text-[11px] text-muted-foreground">{price !== null ? (ar ? "بلا تغير مسجل" : "no change recorded") : "—"}</div>
                        )}
                      </div>
                    </div>

                    {/* Key figures — each with its period */}
                    <div className="grid grid-cols-3 gap-2 border-t border-border/40 pt-3">
                      <Figure label={ar ? "القيمة السوقية (ج.م)" : "Mkt cap (EGP)"} value={c.marketCap !== null ? formatEgp(c.marketCap, { withCurrency: false }) : null} period={null} />
                      <Figure
                        label={ar ? "الإيرادات (ج.م)" : "Revenue (EGP)"}
                        value={usable(revenue) ? formatEgp(revenue.value, { withCurrency: false }) : null}
                        period={usable(revenue) ? revenue.periodLabel : null}
                      />
                      <Figure
                        label={ar ? "صافي الربح (ج.م)" : "Net profit (EGP)"}
                        value={usable(profit) ? formatEgp(profit.value, { withCurrency: false }) : null}
                        period={usable(profit) ? profit.periodLabel : null}
                        negative={usable(profit) && profit.value < 0}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span>
                          {ar ? "ROE" : "ROE"}{" "}
                          <span className="font-bold tabular text-foreground">{usable(roe) ? `${roe.value.toFixed(1)}%` : "—"}</span>
                        </span>
                        {usable(roe) && roe.periodLabel ? <span>{roe.periodLabel}</span> : null}
                      </span>
                      <span className="inline-flex items-center gap-1" title={ar ? "تغطية البيانات: الإفصاحات والأحداث والتوزيعات" : "Data coverage: filings, events, dividends"}>
                        <FileText className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
                        {ar
                          ? `${c.counts.reports} إفصاح · ${c.counts.events} حدث${c.counts.dividends > 0 ? ` · ${c.counts.dividends} توزيع` : ""}`
                          : `${c.counts.reports} filings · ${c.counts.events} events${c.counts.dividends > 0 ? ` · ${c.counts.dividends} dividends` : ""}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground">
                        {c.marketPrice?.asOf
                          ? ar
                            ? `سعر بتاريخ ${new Date(c.marketPrice.asOf).toLocaleDateString("ar-EG", { day: "numeric", month: "short" })}`
                            : `price as of ${new Date(c.marketPrice.asOf).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                          : ar
                            ? "لا يوجد سعر مسجل"
                            : "no recorded price"}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 ? (
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex h-8 items-center gap-1 rounded-lg border border-border/60 px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              aria-label={ar ? "الصفحة السابقة" : "Previous page"}
            >
              {ar ? <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />}
              {ar ? "السابق" : "Prev"}
            </button>
            <span className="tabular text-xs text-muted-foreground">
              {ar ? `صفحة ${page.toLocaleString("ar-EG")} من ${totalPages.toLocaleString("ar-EG")}` : `Page ${page} of ${totalPages}`}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex h-8 items-center gap-1 rounded-lg border border-border/60 px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              aria-label={ar ? "الصفحة التالية" : "Next page"}
            >
              {ar ? "التالي" : "Next"}
              {ar ? <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          </div>
        ) : null}

        <p className="text-center text-[10px] text-muted-foreground">{ar ? BRAND.trustLineAr : BRAND.trustLineEn}</p>

        {/* Compare selection bar */}
        {compareMode ? (
          <div className="sticky bottom-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-card/95 p-2.5 shadow-sm backdrop-blur">
            <span className="text-xs font-medium text-foreground">
              {ar ? `${selected.length} محددة للمقارنة` : `${selected.length} selected`}
            </span>
            {!compareAllowed ? (
              <span className="text-[11px] text-muted-foreground">{ar ? "اختر شركتين على الأقل." : "Select at least two."}</span>
            ) : null}
            <Button
              size="sm"
              className="ms-auto h-7 gap-1.5 text-xs"
              disabled={!compareAllowed}
              onClick={() => router.push(`/compare?ids=${selected.join(",")}`)}
            >
              <Scale className="h-3.5 w-3.5" aria-hidden="true" />
              {ar ? "قارن المحدد" : "Compare selected"}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected([])}>
              {ar ? "إلغاء" : "Clear"}
            </Button>
          </div>
        ) : null}
      </div>
    </LayoutShell>
  )
}

function idsFit(selected: string[]): boolean {
  return selected.length >= 2 && selected.length <= MAX_COMPARE
}

function Figure({
  label,
  value,
  period,
  negative,
}: {
  label: string
  value: string | null
  period: string | null
  negative?: boolean
}) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {value === null ? (
        <UnavailableValue className="mt-0.5 block text-xs" />
      ) : (
        <p className={`mt-0.5 truncate text-xs font-bold tabular ${negative ? "text-negative" : "text-foreground"}`}>{value}</p>
      )}
      {period ? <p className="truncate text-[9px] text-muted-foreground/80">{period}</p> : null}
    </div>
  )
}
