"use client"

// /dashboard#/companies — company table with rich filtering and sorting backed
// by the /api/v1/companies advanced mode (server-side sort/filter across the
// whole active universe — not just the visible page). Preset chips map to the
// classic screens investors ask for first (cheap earnings, dividend payers,
// quality ROE, today's movers) so a new visitor gets value in one click.

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRight,
  ArrowUpDown,
  Building2,
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from "lucide-react"
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

type SortKey = "ticker" | "marketCap" | "changePct" | "p_e" | "dividend_yield" | "roe" | "net_margin" | "name"

const SORT_OPTIONS: { value: SortKey; ar: string; en: string }[] = [
  { value: "ticker", ar: "الرمز (أ ب ت)", en: "Ticker (A-Z)" },
  { value: "marketCap", ar: "القيمة السوقية", en: "Market cap" },
  { value: "changePct", ar: "تغير اليوم", en: "Today's change" },
  { value: "p_e", ar: "المكرر الأرخص أولًا (P/E)", en: "Cheapest P/E first" },
  { value: "dividend_yield", ar: "عائد التوزيعات", en: "Dividend yield" },
  { value: "roe", ar: "العائد على حقوق الملكية", en: "Return on equity" },
  { value: "net_margin", ar: "هامش صافي الربح", en: "Net margin" },
  { value: "name", ar: "الاسم", en: "Name" },
]

interface Filters {
  priceMin?: string
  priceMax?: string
  changeMin?: string
  peMax?: string
  dyMin?: string
  roeMin?: string
}

const PRESETS: { key: string; ar: string; en: string; patch: Partial<Filters>; sort?: SortKey }[] = [
  { key: "cheap", ar: "أرباح رخيصة", en: "Cheap earnings", patch: { peMax: "12" }, sort: "p_e" },
  { key: "dividend", ar: "دافعي توزيعات", en: "Dividend payers", patch: { dyMin: "3" }, sort: "dividend_yield" },
  { key: "quality", ar: "جودة عالية", en: "High quality", patch: { roeMin: "12" }, sort: "roe" },
  { key: "gainers", ar: "صاعدة اليوم", en: "Up today", patch: { changeMin: "1" }, sort: "changePct" },
  { key: "losers", ar: "هابطة اليوم", en: "Down today", patch: { changeMin: "-100" }, sort: "changePct" },
]

function num(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === "") return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function CompaniesView({ onOpenCompany }: { onOpenCompany: (id: string) => void }) {
  const { lang, pick } = useI18n()
  const ar = lang === "ar"
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [sector, setSector] = useState<string>("all")
  const [page, setPage] = useState(1)
  const [watchlistOnly, setWatchlistOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>("ticker")
  const [dir, setDir] = useState<"asc" | "desc">("asc")
  const [filters, setFilters] = useState<Filters>({})
  const [showFilters, setShowFilters] = useState(false)
  const [activePreset, setActivePreset] = useState<string | null>(null)
  const watchItems = useWatchlist((s) => s.items)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const fNums = useMemo(
    () => ({
      priceMin: num(filters.priceMin),
      priceMax: num(filters.priceMax),
      changeMin: num(filters.changeMin),
      peMax: num(filters.peMax),
      dyMin: num(filters.dyMin),
      roeMin: num(filters.roeMin),
    }),
    [filters]
  )
  const hasFilters = Object.values(fNums).some((v) => v !== undefined)

  const watchIds = useMemo(() => [...new Set(watchItems.map((i) => i.id))], [watchItems])
  const watchKey = watchIds.join(",")
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["companies", debouncedSearch, sector, page, watchlistOnly, watchKey, sort, dir, fNums],
    queryFn: () =>
      api.companies({
        search: debouncedSearch,
        sector: sector === "all" ? undefined : sector,
        page,
        pageSize: 25,
        ids: watchlistOnly ? watchIds : undefined,
        sort,
        dir,
        priceMin: fNums.priceMin,
        priceMax: fNums.priceMax,
        changeMin: fNums.changeMin,
        peMax: fNums.peMax,
        dyMin: fNums.dyMin,
        roeMin: fNums.roeMin,
      }),
    enabled: !watchlistOnly || watchIds.length > 0,
  })

  const companies = data?.companies ?? []

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    if (activePreset === preset.key) {
      setActivePreset(null)
      setFilters({})
      setSort("ticker")
      setDir("asc")
    } else {
      setActivePreset(preset.key)
      setFilters({ ...preset.patch } as Filters)
      if (preset.sort) {
        setSort(preset.sort)
        setDir(preset.sort === "p_e" ? "asc" : "desc")
      }
    }
    setPage(1)
  }

  const clearAll = () => {
    setFilters({})
    setSort("ticker")
    setDir("asc")
    setSector("all")
    setSearch("")
    setActivePreset(null)
    setPage(1)
  }

  const filterChips: string[] = []
  if (fNums.priceMin !== undefined || fNums.priceMax !== undefined)
    filterChips.push(`${ar ? "السعر" : "Price"} ${fNums.priceMin ?? 0}–${fNums.priceMax ?? "∞"} ${ar ? "جنيه" : "EGP"}`)
  if (fNums.changeMin !== undefined)
    filterChips.push(`${ar ? "تغير ≥" : "Change ≥"} ${formatPercent(fNums.changeMin)}`)
  if (fNums.peMax !== undefined) filterChips.push(`P/E ≤ ${fNums.peMax}`)
  if (fNums.dyMin !== undefined) filterChips.push(`${ar ? "عائد ≥" : "Yield ≥"} ${formatPercent(fNums.dyMin)}`)
  if (fNums.roeMin !== undefined) filterChips.push(`ROE ≥ ${formatPercent(fNums.roeMin)}`)

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
              ? "فلتر على السوق كله مش على الصفحة — رتب باللي يهمك وتوصل للشركة المناسبة أسرع."
              : "Server-side filtering and sorting across the whole market — rank by what matters to you."}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              className="h-9 w-full ps-9"
              placeholder={ar ? "دوّر بالاسم أو الرمز…" : "Search by name or ticker…"}
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
            {ar ? "متابعتي بس" : "Watchlist only"}
            {watchItems.length > 0 ? <span className="tabular">({watchItems.length})</span> : null}
          </button>
        </div>
      </div>

      {/* Preset chips — one click to a classic screen */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          {ar ? "مجاميع جاهزة:" : "Quick screens:"}
        </span>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => applyPreset(p)}
            aria-pressed={activePreset === p.key}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              activePreset === p.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            {ar ? p.ar : p.en}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            hasFilters
              ? "border-primary bg-primary/10 text-primary"
              : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground"
          }`}
        >
          <Filter className="h-3.5 w-3.5" aria-hidden="true" />
          {ar ? "فلاتر دقيقة" : "Custom filters"}
        </button>
        {(hasFilters || sort !== "ticker" || sector !== "all" || search) && (
          <button
            type="button"
            onClick={clearAll}
            className="flex items-center gap-1 rounded-full border border-destructive/40 px-3 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            {ar ? "امسح الكل" : "Clear all"}
          </button>
        )}
      </div>

      {/* Sort + numeric filters row */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={sort}
          onValueChange={(v) => {
            const next = v as SortKey
            setSort(next)
            setDir(next === "ticker" || next === "name" || next === "p_e" ? "asc" : "desc")
            setActivePreset(null)
            setPage(1)
          }}
        >
          <SelectTrigger className="h-8 w-56 text-xs" aria-label={ar ? "الترتيب حسب" : "Sort by"}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {ar ? o.ar : o.en}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
          aria-label={ar ? (dir === "asc" ? "حوّل لترتيب تنازلي" : "حوّل لترتيب تصاعدي") : dir === "asc" ? "Switch to descending" : "Switch to ascending"}
        >
          <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
          {dir === "asc" ? (ar ? "الأقل أولًا" : "Low first") : ar ? "الأعلى أولًا" : "High first"}
        </button>
        {isFetching && !isLoading ? (
          <span className="text-[11px] text-muted-foreground" role="status">{ar ? "بنحدّث النتايج…" : "Updating…"}</span>
        ) : null}
      </div>

      {showFilters ? (
        <Card className="p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              {ar ? "السعر من (جنيه)" : "Price from (EGP)"}
              <Input className="h-8" inputMode="decimal" placeholder="مثال: 5" value={filters.priceMin ?? ""} onChange={(e) => { setFilters((f) => ({ ...f, priceMin: e.target.value })); setPage(1) }} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              {ar ? "السعر إلى (جنيه)" : "Price to (EGP)"}
              <Input className="h-8" inputMode="decimal" placeholder="مثال: 100" value={filters.priceMax ?? ""} onChange={(e) => { setFilters((f) => ({ ...f, priceMax: e.target.value })); setPage(1) }} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              {ar ? "تغير اليوم ≥ %" : "Today's change ≥ %"}
              <Input className="h-8" inputMode="decimal" placeholder="مثال: 2" value={filters.changeMin ?? ""} onChange={(e) => { setFilters((f) => ({ ...f, changeMin: e.target.value })); setPage(1) }} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              {ar ? "مكرر الربحية ≤" : "P/E ≤"}
              <Input className="h-8" inputMode="decimal" placeholder="مثال: 10" value={filters.peMax ?? ""} onChange={(e) => { setFilters((f) => ({ ...f, peMax: e.target.value })); setPage(1) }} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              {ar ? "عائد التوزيعات ≥ %" : "Dividend yield ≥ %"}
              <Input className="h-8" inputMode="decimal" placeholder="مثال: 5" value={filters.dyMin ?? ""} onChange={(e) => { setFilters((f) => ({ ...f, dyMin: e.target.value })); setPage(1) }} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              {ar ? "ROE ≥ %" : "ROE ≥ %"}
              <Input className="h-8" inputMode="decimal" placeholder="مثال: 10" value={filters.roeMin ?? ""} onChange={(e) => { setFilters((f) => ({ ...f, roeMin: e.target.value })); setPage(1) }} />
            </label>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            {ar
              ? "الشركة اللي معندهاش رقم موثق للفيلتر ده مش هتظهر — مش بنخمّن أرقام."
              : "Companies without a verified figure for a filter are excluded — we never guess numbers."}
          </p>
        </Card>
      ) : null}

      {filterChips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {filterChips.map((chip) => (
            <span key={chip} className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{chip}</span>
          ))}
        </div>
      ) : null}

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <Card className="border-destructive/30 bg-destructive/5 p-6 text-center">
          <p className="text-sm font-medium text-destructive">{ar ? "حصل خطأ في تحميل الشركات — جرّب تاني" : "Could not load the companies"}</p>
          <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={() => refetch()}>
            {ar ? "جرّب تاني" : "Retry"}
          </Button>
        </Card>
      ) : !data || companies.length === 0 ? (
        <Card className="flex h-56 flex-col items-center justify-center gap-3 border-border/60 p-8 text-center text-sm text-muted-foreground">
          {watchlistOnly && watchItems.length === 0 ? (
            <>
              <Star className="h-6 w-6 text-warning/60" aria-hidden="true" />
              {ar ? "اضغط النجمة على أي شركة و هتبني قائمة متابعتك هنا." : "Star companies to build your watchlist."}
            </>
          ) : (
            <>
              <Filter className="h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
              <p>{ar ? "مفيش شركة بتطابق الفلاتر دي بالأرقام الموثقة." : "No companies match these verified-data filters."}</p>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={clearAll}>{ar ? "امسح الفلاتر و جرّب بحاجة أوسع" : "Clear filters"}</Button>
            </>
          )}
        </Card>
      ) : (
        <>
          <p className="tabular text-xs text-muted-foreground">
            {data.total} {ar ? "شركة مطابقة" : "matching companies"} · {ar ? "صفحة" : "page"} {data.page} {ar ? "من" : "of"} {data.totalPages}
          </p>

          <Card className="overflow-hidden border-border/60">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  {ar ? "شركات البورصة المصرية مع السعر والتغير والإيرادات وصافي الربح والعائد على حقوق الملكية والقيمة السوقية" : "EGX companies with price, change, revenue, net profit, ROE and market cap"}
                </caption>
                <thead>
                  <tr className="border-b border-border/40 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="p-3 text-start font-medium">{ar ? "الشركة" : "Company"}</th>
                    <th scope="col" className="hidden p-3 text-start font-medium sm:table-cell">{ar ? "القطاع" : "Sector"}</th>
                    <th scope="col" className="p-3 text-end font-medium">{ar ? "السعر / التغير" : "Price / change"}</th>
                    <th scope="col" className="hidden p-3 text-end font-medium md:table-cell">{ar ? "الإيرادات" : "Revenue"}</th>
                    <th scope="col" className="hidden p-3 text-end font-medium sm:table-cell">{ar ? "صافي الربح" : "Net profit"}</th>
                    <th scope="col" className="p-3 text-end font-medium">{ar ? "ROE" : "ROE"}</th>
                    <th scope="col" className="hidden p-3 text-end font-medium lg:table-cell">{ar ? "P/E" : "P/E"}</th>
                    <th scope="col" className="hidden p-3 text-end font-medium lg:table-cell">{ar ? "القيمة السوقية" : "Market cap"}</th>
                    <th scope="col" className="w-20 p-3 text-center font-medium"><span className="sr-only">{ar ? "إجراءات" : "Actions"}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c: CompanyListItem) => {
                    const changePct = c.marketPrice?.changePct ?? null
                    const pe = c.metrics?.p_e ?? null
                    const roe = c.metrics?.roe ?? c.snapshot.roe?.value ?? null
                    return (
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
                          {c.marketPrice?.price != null ? (
                            <span className="font-semibold">{c.marketPrice.price.toLocaleString("en-EG", { maximumFractionDigits: 2 })}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {changePct != null ? (
                            <span className={`block text-[10px] font-semibold ${changePct >= 0 ? "text-positive" : "text-negative"}`} dir="ltr">
                              {changePct >= 0 ? "▲" : "▼"} {formatPercent(Math.abs(changePct))}
                            </span>
                          ) : (
                            <span className="block text-[9px] text-muted-foreground/80">{ar ? "بدون تغير اليوم" : "no move today"}</span>
                          )}
                        </td>
                        <td className="hidden p-3 text-end tabular md:table-cell">
                          {c.snapshot.revenue?.value != null ? formatEgp(c.snapshot.revenue.value) : "—"}
                          {c.snapshot.revenue?.periodLabel ? (
                            <span className="block text-[9px] font-normal text-muted-foreground/80">{c.snapshot.revenue.periodLabel}</span>
                          ) : null}
                        </td>
                        <td className="hidden p-3 text-end tabular sm:table-cell">
                          <span className={`font-semibold ${(c.snapshot.net_profit?.value ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>
                            {c.snapshot.net_profit?.value != null ? formatEgp(c.snapshot.net_profit.value) : "—"}
                          </span>
                          {c.snapshot.net_profit?.periodLabel ? (
                            <span className="block text-[9px] font-normal text-muted-foreground/80">{c.snapshot.net_profit.periodLabel}</span>
                          ) : null}
                        </td>
                        <td className="p-3 text-end tabular">
                          <span className={`font-semibold ${(roe ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>
                            {roe != null ? formatPercent(roe) : "—"}
                          </span>
                          {c.metrics?.roe == null && c.snapshot.roe?.periodLabel ? (
                            <span className="block text-[9px] font-normal text-muted-foreground/80">{c.snapshot.roe.periodLabel}</span>
                          ) : null}
                        </td>
                        <td className="hidden p-3 text-end tabular lg:table-cell">
                          {pe != null ? (
                            <span className="font-semibold">{pe.toFixed(1)}</span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground/70">{ar ? "غير متاح" : "n/a"}</span>
                          )}
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
                    )
                  })}
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
