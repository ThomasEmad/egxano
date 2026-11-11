"use client"

// /dashboard#/companies — legacy company tab kept working. The canonical
// directory is /companies; this tab focuses on a compact table for quick
// switching inside the dashboard. Columns match their headers, each figure
// shows its period, and sorting controls were removed because they only sorted
// the 25 rows of the current page (misleading as a global sort).

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Building2, ChevronLeft, ChevronRight, Search, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type CompanyListItem } from "@/lib/client/api"
import { useWatchlist } from "@/lib/client/watchlist"
import { useI18n } from "@/lib/i18n"
import { formatEgp, formatPercent } from "@/lib/financial/units"
import { SECTORS, SECTOR_AR, sectorLabel } from "@/lib/sectors"
import { DemoBadge, StarButton } from "./shared"

export function CompaniesView({ onOpenCompany }: { onOpenCompany: (id: string) => void }) {
  const { lang, pick } = useI18n()
  const ar = lang === "ar"
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [sector, setSector] = useState<string>("all")
  const [page, setPage] = useState(1)
  const [watchlistOnly, setWatchlistOnly] = useState(false)
  const watchItems = useWatchlist((s) => s.items)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const watchIds = useMemo(() => [...new Set(watchItems.map((i) => i.id))], [watchItems])
  const watchKey = watchIds.join(",")
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["companies", debouncedSearch, sector, page, watchlistOnly, watchKey],
    queryFn: () =>
      api.companies({
        search: debouncedSearch,
        sector: sector === "all" ? undefined : sector,
        page,
        pageSize: 25,
        ids: watchlistOnly ? watchIds : undefined,
      }),
    enabled: !watchlistOnly || watchIds.length > 0,
  })

  const companies = data?.companies ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
            <Building2 className="h-5 w-5 text-primary" aria-hidden="true" />
            {ar ? "الشركات" : "Companies"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {ar
              ? "قائمة سريعة للتنقل داخل لوحة القيادة. الدليل الكامل مع فلاتر أكثر في صفحة الشركات."
              : "A quick switcher inside the dashboard. The full directory with more filters is on the Companies page."}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              className="h-9 w-full ps-9"
              placeholder={ar ? "ابحث بالاسم أو الرمز…" : "Search by name or ticker…"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={ar ? "البحث في الشركات" : "Search companies"}
            />
          </div>
          <Select value={sector} onValueChange={(v) => { setSector(v); setPage(1) }}>
            <SelectTrigger className="h-9 w-full sm:w-48" aria-label={ar ? "القطاع" : "Sector"}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">{ar ? "كل القطاعات" : "All sectors"}</SelectItem>
              {SECTORS.filter((s) => s !== "Other").map((s) => (
                <SelectItem key={s} value={s}>
                  {ar ? SECTOR_AR[s] ?? s : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => {
              setWatchlistOnly((v) => !v)
              setPage(1)
            }}
            className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
              watchlistOnly
                ? "border-warning/60 bg-warning/10 text-warning"
                : "border-border/70 text-muted-foreground hover:border-primary/30 hover:text-foreground"
            }`}
            aria-pressed={watchlistOnly}
          >
            <Star className={`h-3.5 w-3.5 ${watchlistOnly ? "fill-warning" : ""}`} aria-hidden="true" />
            {ar ? "قائمة المتابعة فقط" : "Watchlist only"}
            {watchItems.length > 0 ? <span className="tabular">({watchItems.length})</span> : null}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <Card className="border-destructive/30 bg-destructive/5 p-6 text-center">
          <p className="text-sm font-medium text-destructive">{ar ? "تعذّر تحميل الشركات" : "Could not load the companies"}</p>
          <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={() => refetch()}>
            {ar ? "إعادة المحاولة" : "Retry"}
          </Button>
        </Card>
      ) : !data || companies.length === 0 ? (
        <Card className="flex h-56 flex-col items-center justify-center gap-3 border-border/60 p-8 text-center text-sm text-muted-foreground">
          {watchlistOnly && watchItems.length === 0 ? (
            <>
              <Star className="h-6 w-6 text-warning/60" aria-hidden="true" />
              {ar ? "ميّز الشركات بنجمة لبناء قائمة المتابعة." : "Star companies to build your watchlist."}
            </>
          ) : (
            ar ? "لا توجد شركات مطابقة." : "No companies match."
          )}
        </Card>
      ) : (
        <>
          <p className="tabular text-xs text-muted-foreground">
            {data.total} {ar ? "شركة" : "companies"} · {ar ? "صفحة" : "page"} {data.page} {ar ? "من" : "of"} {data.totalPages}
          </p>

          <Card className="overflow-hidden border-border/60">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  {ar ? "شركات البورصة المصرية مع الإيرادات وصافي الربح والعائد على حقوق الملكية والقيمة السوقية" : "EGX companies with revenue, net profit, ROE and market cap"}
                </caption>
                <thead>
                  <tr className="border-b border-border/40 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="p-3 text-start font-medium">{ar ? "الشركة" : "Company"}</th>
                    <th scope="col" className="hidden p-3 text-start font-medium sm:table-cell">{ar ? "القطاع" : "Sector"}</th>
                    <th scope="col" className="p-3 text-end font-medium">{ar ? "الإيرادات" : "Revenue"}</th>
                    <th scope="col" className="p-3 text-end font-medium">{ar ? "صافي الربح" : "Net profit"}</th>
                    <th scope="col" className="p-3 text-end font-medium">{ar ? "ROE" : "ROE"}</th>
                    <th scope="col" className="hidden p-3 text-end font-medium lg:table-cell">{ar ? "القيمة السوقية" : "Market cap"}</th>
                    <th scope="col" className="w-20 p-3 text-center font-medium"><span className="sr-only">{ar ? "إجراءات" : "Actions"}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c: CompanyListItem) => (
                    <tr
                      key={c.id}
                      onClick={() => onOpenCompany(c.id)}
                      className="group cursor-pointer border-b border-border/40 bg-card transition-colors last:border-0 hover:bg-accent/30"
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-bold">{c.ticker}</span>
                              {c.isDemoData ? <DemoBadge small /> : null}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">{pick(c.nameEn, c.nameAr)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden p-3 sm:table-cell">
                        <span className="text-xs text-muted-foreground">{sectorLabel(c.sector, lang)}</span>
                        {c.industry ? <span className="block text-[10px] text-muted-foreground/70">{c.industry}</span> : null}
                      </td>
                      <td className="p-3 text-end tabular">
                        {c.snapshot.revenue?.value != null ? formatEgp(c.snapshot.revenue.value) : "—"}
                        {c.snapshot.revenue?.periodLabel ? (
                          <span className="block text-[9px] font-normal text-muted-foreground/80">{c.snapshot.revenue.periodLabel}</span>
                        ) : null}
                      </td>
                      <td className="p-3 text-end tabular">
                        <span className={`font-semibold ${(c.snapshot.net_profit?.value ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>
                          {c.snapshot.net_profit?.value != null ? formatEgp(c.snapshot.net_profit.value) : "—"}
                        </span>
                        {c.snapshot.net_profit?.periodLabel ? (
                          <span className="block text-[9px] font-normal text-muted-foreground/80">{c.snapshot.net_profit.periodLabel}</span>
                        ) : null}
                      </td>
                      <td className="p-3 text-end tabular">
                        <span className={`font-semibold ${(c.snapshot.roe?.value ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>
                          {c.snapshot.roe?.value != null ? formatPercent(c.snapshot.roe.value) : "—"}
                        </span>
                        {c.snapshot.roe?.periodLabel ? (
                          <span className="block text-[9px] font-normal text-muted-foreground/80">{c.snapshot.roe.periodLabel}</span>
                        ) : null}
                      </td>
                      <td className="hidden p-3 text-end tabular lg:table-cell">
                        <span className="text-xs text-muted-foreground">{c.marketCap != null ? formatEgp(c.marketCap) : "—"}</span>
                      </td>
                      <td className="p-3 text-center">
                        <span className="inline-flex items-center gap-1">
                          <StarButton companyId={c.id} ticker={c.ticker} />
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-colors group-hover:text-primary rtl-flip" aria-hidden="true" />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.totalPages > 1 ? (
              <div className="flex items-center justify-between border-t border-border/60 px-5 py-3">
                <div className="text-xs text-muted-foreground">
                  {data.total} {ar ? "شركة" : "companies"}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-8 gap-0.5 border-border/70 px-2">
                    {ar ? <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />}
                    <span className="sr-only">{ar ? "السابق" : "Previous"}</span>
                  </Button>
                  <span className="tabular text-xs text-muted-foreground">
                    {page} / {data.totalPages}
                  </span>
                  <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)} className="h-8 gap-0.5 border-border/70 px-2">
                    {ar ? <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
                    <span className="sr-only">{ar ? "التالي" : "Next"}</span>
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </>
      )}
    </div>
  )
}
