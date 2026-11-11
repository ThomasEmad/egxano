"use client"

// /compare?ids=a,b,c — side-by-side comparison of 2-4 companies.
//
// Research rules implemented here (brand: "قارن في نفس الظروف"):
//  · Default basis = ALIGNED: the newest fiscal year where at least two of the
//    selected companies have ANNUAL data (probed, not guessed). "Each company's
//    latest period" remains available, explicitly, with a comparability warning.
//  · A "stronger figure" mark is shown ONLY when every column shares the same
//    reporting period, the metric is a ratio with a defensible direction, and no
//    value is degenerate (negative P/E, negative P/B, negative leverage).
//    Absolute levels (revenue, profit, assets, equity, EPS, market cap) are never
//    ranked — they are shown as levels plus a change against the first column.
//  · Every column states its exact period; the page states source, calculation
//    and market-data freshness. Values are never invented: missing → "—".

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, Copy, Info, Plus, Scale, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { MetricTip } from "@/components/brand/metric-tip"
import { MarketDataLine, SourceLine, UnavailableValue } from "@/components/brand/data-trust"
import { EmptyState } from "@/components/brand/empty-state"
import { BRAND, TRUST } from "@/lib/brand"
import { SECTOR_AR } from "@/lib/sectors"
import { useI18n } from "@/lib/i18n"
import { api } from "@/lib/client/api"
import { formatEgp } from "@/lib/financial/units"

interface CompareCompany {
  id: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
  fiscalYear: number | null
  periodLabel: string | null
  periodType: string | null
  metrics: Record<string, number>
}

interface CompareData {
  companies: CompareCompany[]
  metricDefs: { code: string; labelEn: string; labelAr: string; unit: string }[]
  year: number | null
  /** fiscal years where ≥2 selected companies have data (descending) */
  years: number[]
}

type BasisMode = "aligned" | "latest" | string

/** Ratios where a direction (and therefore a "stronger" figure) is defensible.
 *  Everything else is a level: assets, equity, market cap, revenue, profit, EPS. */
const RATIO_DIRECTION: Record<string, "higher" | "lower"> = {
  net_margin: "higher",
  roe: "higher",
  roa: "higher",
  p_e: "lower",
  p_b: "lower",
  debt_to_equity: "lower",
}

const GROUPS: { key: string; en: string; ar: string; codes: string[] }[] = [
  {
    key: "profitability",
    en: "Profitability & returns",
    ar: "الربحية والعوائد",
    codes: ["net_margin", "roe", "roa"],
  },
  {
    key: "valuation",
    en: "Valuation & leverage",
    ar: "التقييم والرفع المالي",
    codes: ["p_e", "p_b", "debt_to_equity"],
  },
  {
    key: "scale",
    en: "Scale & balance sheet — size, not a quality judgement",
    ar: "الحجم والمركز المالي — حجم وليس حكمًا على الجودة",
    codes: ["revenue", "net_profit", "total_assets", "total_equity", "eps", "market_cap"],
  },
]

const MAX_COMPANIES = 4

async function fetchCompare(ids: string[], year: string | null): Promise<CompareData> {
  const res = await fetch(`/api/v1/compare?ids=${ids.join(",")}${year ? `&year=${year}` : ""}`)
  if (!res.ok) {
    const message = res.status === 404 || res.status === 400 ? "INSUFFICIENT" : `HTTP ${res.status}`
    throw new Error(message)
  }
  return (await res.json()) as CompareData
}

function fmtNumber(unit: string, v: number, lang: "en" | "ar"): string {
  if (unit === "PERCENT") return `${v.toFixed(1)}%`
  if (unit === "EGP") return `${formatEgp(v, { withCurrency: false })} ${lang === "ar" ? "ج.م" : "EGP"}`
  if (unit === "EGP_PER_SHARE") return `${v.toFixed(2)} ${lang === "ar" ? "ج.م" : "EGP"}`
  return v.toFixed(2)
}

function readInitialIds(): string[] {
  if (typeof window === "undefined") return []
  const u = new URLSearchParams(window.location.search)
  const ids = u.get("ids")
  if (!ids) return []
  return ids
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_COMPANIES)
}

function readInitialTickers(): string[] {
  if (typeof window === "undefined") return []
  const t = new URLSearchParams(window.location.search).get("tickers")
  if (!t) return []
  return t
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_COMPANIES)
}

function readInitialMode(): BasisMode {
  if (typeof window === "undefined") return "aligned"
  const u = new URLSearchParams(window.location.search)
  if (u.get("basis") === "latest") return "latest"
  const y = u.get("year")
  if (y && /^\d{4}$/.test(y)) return y
  return "aligned"
}

export default function ComparePage() {
  const { lang } = useI18n()
  const ar = lang === "ar"

  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), [])

  const [ids, setIds] = useState<string[]>(mounted ? readInitialIds() : [])
  const [mode, setMode] = useState<BasisMode>(mounted ? readInitialMode() : "aligned")
  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ?tickers=COMI,ADIB is the readable share form; resolve it once to ids.
  const [tickersFromUrl] = useState<string[]>(mounted ? readInitialTickers() : [])
  const { data: resolvedTickers, isLoading: resolvingTickers } = useQuery({
    queryKey: ["compare-ticker-resolve", tickersFromUrl.join(",")],
    queryFn: () => api.companies({ tickers: tickersFromUrl, pageSize: MAX_COMPANIES }),
    enabled: tickersFromUrl.length >= 2 && ids.length < 2,
    staleTime: 5 * 60_000,
    retry: false,
  })
  useEffect(() => {
    if (ids.length >= 2 || !resolvedTickers) return
    const next = resolvedTickers.companies.slice(0, MAX_COMPANIES).map((c) => c.id)
    // Syncing fetched tickers into selection state is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (next.length >= 2) setIds(next)
  }, [resolvedTickers, ids.length])

  const idsKey = ids.join(",")

  // Selected companies' identity + the site-wide price freshness they were read at.
  const { data: selected } = useQuery({
    queryKey: ["compare-selected", idsKey],
    queryFn: () => api.companies({ ids, pageSize: MAX_COMPANIES }),
    enabled: ids.length > 0,
    staleTime: 60_000,
    retry: false,
  })

  const { data: searchResults } = useQuery({
    queryKey: ["compare-search", debounced],
    queryFn: () => api.companies({ search: debounced, pageSize: 6 }),
    enabled: debounced.length >= 2,
    staleTime: 60_000,
    retry: false,
  })

  // Start suggestions: the largest listed companies — real data, never hardcoded ids.
  const { data: suggestions } = useQuery({
    queryKey: ["compare-suggestions"],
    queryFn: () => api.companies({ pageSize: 6, sort: "marketCap" }),
    enabled: ids.length < 2,
    staleTime: 10 * 60_000,
    retry: false,
  })

  // Always load the "each company's latest" view: it supplies the year list and
  // is the fallback when no shared annual year exists.
  const latestQ = useQuery({
    queryKey: ["compare-latest", idsKey],
    queryFn: () => fetchCompare(ids, null),
    enabled: ids.length >= 2,
    staleTime: 120_000,
  })

  // Aligned probe: newest fiscal year where ≥2 companies report ANNUAL figures.
  const alignedQ = useQuery({
    queryKey: ["compare-aligned", idsKey],
    queryFn: async () => {
      const years = latestQ.data?.years ?? []
      for (const y of years.slice(0, 3)) {
        const d = await fetchCompare(ids, String(y))
        const annual = d.companies.filter((c) => c.periodType === "ANNUAL").length
        if (annual >= 2) return { year: String(y), data: d }
      }
      return null
    },
    enabled: ids.length >= 2 && mode === "aligned" && !!latestQ.data,
    staleTime: 120_000,
  })

  const pinnedQ = useQuery({
    queryKey: ["compare-pinned", idsKey, mode],
    queryFn: () => fetchCompare(ids, mode),
    enabled: ids.length >= 2 && mode !== "aligned" && mode !== "latest",
    staleTime: 120_000,
  })

  const isAligned = mode === "aligned"
  const alignedUnavailable = isAligned && alignedQ.isSuccess && alignedQ.data === null
  const data: CompareData | undefined = isAligned
    ? (alignedQ.data?.data ?? (alignedUnavailable ? latestQ.data : undefined))
    : mode === "latest"
      ? latestQ.data
      : pinnedQ.data

  const isLoading =
    ids.length < 2 ||
    (isAligned && !data && !alignedUnavailable && !alignedQ.error && !latestQ.error && (alignedQ.isPending || latestQ.isPending)) ||
    (!isAligned && (mode === "latest" ? latestQ.isPending : pinnedQ.isPending)) ||
    resolvingTickers
  const queryError = isAligned
    ? alignedQ.error ?? latestQ.error ?? null
    : mode === "latest"
      ? latestQ.error
      : pinnedQ.error
  const insufficient = queryError instanceof Error && queryError.message === "INSUFFICIENT"

  const toggle = useCallback(
    (id: string) => {
      setIds((prev) => {
        if (prev.includes(id)) return prev.filter((x) => x !== id)
        if (prev.length >= MAX_COMPANIES) return prev
        return [...prev, id]
      })
    },
    []
  )

  // Keep the URL shareable: ids (compatible) + readable tickers when known.
  const tickerOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of selected?.companies ?? []) map.set(c.id, c.ticker)
    for (const c of searchResults?.companies ?? []) map.set(c.id, c.ticker)
    for (const c of suggestions?.companies ?? []) map.set(c.id, c.ticker)
    return map
  }, [selected, searchResults, suggestions])

  useEffect(() => {
    const u = new URL(window.location.href)
    u.searchParams.delete("ids")
    u.searchParams.delete("tickers")
    u.searchParams.delete("year")
    u.searchParams.delete("basis")
    if (ids.length >= 2) {
      const tickers = ids.map((id) => tickerOf.get(id)).filter(Boolean) as string[]
      if (tickers.length === ids.length) u.searchParams.set("tickers", tickers.join(","))
      else u.searchParams.set("ids", ids.join(","))
    }
    if (mode === "latest") u.searchParams.set("basis", "latest")
    else if (mode !== "aligned") u.searchParams.set("year", mode)
    window.history.replaceState(null, "", u.toString())
  }, [ids, mode, tickerOf])

  function onSearch(v: string) {
    setSearch(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setDebounced(v.trim()), 250)
  }

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — the URL is still visible and copyable */
    }
  }, [])

  const companies = data?.companies ?? []
  const defs = data?.metricDefs ?? []

  const periodsAligned = useMemo(() => {
    if (companies.length < 2) return false
    const first = companies[0]
    if (!first.periodLabel) return false
    return companies.every((c) => c.periodLabel === first.periodLabel && c.periodType === first.periodType)
  }, [companies])

  const sectorsMixed = useMemo(() => new Set(companies.map((c) => c.sector)).size > 1, [companies])

  const marks = useMemo(() => {
    const result = new Map<string, Set<string>>()
    if (!periodsAligned) return result
    for (const def of defs) {
      const direction = RATIO_DIRECTION[def.code]
      if (!direction) continue
      const entries = companies
        .map((c) => ({ id: c.id, v: c.metrics[def.code] }))
        .filter((e): e is { id: string; v: number } => typeof e.v === "number" && Number.isFinite(e.v))
      // A mark must never hide a missing value: require every column to have one.
      if (entries.length < companies.length) continue
      const values = entries.map((e) => e.v)
      // Degenerate values break the meaning of "lower is better".
      if (direction === "lower" && values.some((v) => v <= 0)) continue
      const target = direction === "higher" ? Math.max(...values) : Math.min(...values)
      const winners = entries.filter((e) => e.v === target)
      if (winners.length === entries.length) continue
      result.set(def.code, new Set(winners.map((w) => w.id)))
    }
    return result
  }, [companies, defs, periodsAligned])

  const base = companies[0]
  const groups = useMemo(() => {
    const used = new Set<string>()
    const built = GROUPS.map((g) => {
      const rows = defs.filter((d) => g.codes.includes(d.code))
      rows.forEach((r) => used.add(r.code))
      return { ...g, rows }
    }).filter((g) => g.rows.length > 0)
    const rest = defs.filter((d) => !used.has(d.code))
    if (rest.length > 0) {
      built.push({ key: "other", en: "Other metrics", ar: "مؤشرات أخرى", codes: [], rows: rest })
    }
    return built
  }, [defs])

  /** Biggest relative gaps, ratio metrics only — "where they differ most". */
  const differences = useMemo(() => {
    const rows: { code: string; labelEn: string; labelAr: string; spread: number; low: string; high: string }[] = []
    for (const def of defs) {
      if (!RATIO_DIRECTION[def.code]) continue
      const entries = companies
        .map((c) => ({ ticker: c.ticker, v: c.metrics[def.code] }))
        .filter((e): e is { ticker: string; v: number } => typeof e.v === "number" && Number.isFinite(e.v))
      if (entries.length < 2) continue
      const values = entries.map((e) => e.v)
      const min = Math.min(...values)
      const max = Math.max(...values)
      const scale = Math.max(Math.abs(min), Math.abs(max), 1e-9)
      const spread = (max - min) / scale
      if (spread <= 0) continue
      const low = entries.find((e) => e.v === min)!
      const high = entries.find((e) => e.v === max)!
      rows.push({ code: def.code, labelEn: def.labelEn, labelAr: def.labelAr, spread, low: low.ticker, high: high.ticker })
    }
    return rows.sort((a, b) => b.spread - a.spread).slice(0, 3)
  }, [companies, defs])

  const pickedInfo = useMemo(() => {
    return ids.map((id) => {
      const fromSelected = selected?.companies.find((c) => c.id === id)
      const fromSearch = searchResults?.companies.find((c) => c.id === id)
      return {
        id,
        ticker: fromSelected?.ticker ?? fromSearch?.ticker ?? tickerOf.get(id) ?? "…",
        name: fromSelected ? (ar ? fromSelected.nameAr ?? fromSelected.nameEn : fromSelected.nameEn) : fromSearch?.nameEn ?? "",
        sector: fromSelected?.sector ?? fromSearch?.sector ?? "",
      }
    })
  }, [ids, selected, searchResults, tickerOf, ar])

  const basisTriggerLabel =
    mode === "latest"
      ? ar
        ? "أحدث فترة لكل شركة"
        : "Each company's latest period"
      : mode === "aligned"
        ? alignedQ.data
          ? ar
            ? `متطابق — سنة ${alignedQ.data.year}`
            : `Aligned — FY ${alignedQ.data.year}`
          : ar
            ? "فترات متطابقة (تلقائي)"
            : "Aligned periods (auto)"
        : ar
          ? `سنة مالية ${mode}`
          : `Fiscal year ${mode}`

  const retry = () => {
    if (isAligned) {
      // The probe cannot run until the base comparison loads.
      if (latestQ.error) latestQ.refetch()
      else alignedQ.refetch()
    } else if (mode === "latest") latestQ.refetch()
    else pinnedQ.refetch()
  }

  return (
    <LayoutShell showMobileNav={true}>
      <div className="mx-auto w-full max-w-7xl space-y-4">
          {/* ── Header ─────────────────────────────────────────────────── */}
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
                <Scale className="h-5 w-5 text-primary" aria-hidden="true" />
                {ar ? "مقارنة الشركات" : "Compare companies"}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {ar
                  ? "قارن حتى أربع شركات في نفس الفترة، بنفس النسب. القيم النسبية فقط هي التي تُقارن؛ أرقام الحجم تُعرض كما هي مع الفرق مقابل العمود الأول."
                  : "Compare up to four companies on the same period and the same ratios. Only ratios are compared; absolute figures are shown as levels with the change against the first column."}
              </p>
            </div>
            {ids.length >= 2 ? (
              <button
                type="button"
                onClick={copyLink}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-background px-3 text-xs font-semibold transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-positive" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                {copied ? (ar ? "تم نسخ الرابط" : "Link copied") : ar ? "نسخ رابط المقارنة" : "Copy comparison link"}
              </button>
            ) : null}
          </header>

          {/* ── Period basis ───────────────────────────────────────────── */}
          {ids.length >= 2 ? (
            <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="compare-basis" className="text-xs font-medium text-muted-foreground">
                  {ar ? "أساس المقارنة" : "Comparison basis"}
                </label>
                <Select value={mode} onValueChange={setMode}>
                  <SelectTrigger id="compare-basis" className="h-8 w-64 text-xs">
                    <SelectValue>{basisTriggerLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="aligned" className="text-xs">
                      {ar ? "فترات متطابقة — أحدث سنة مالية مشتركة" : "Aligned periods — newest shared fiscal year"}
                    </SelectItem>
                    <SelectItem value="latest" className="text-xs">
                      {ar ? "أحدث فترة لكل شركة (غير متطابقة)" : "Each company's latest period (not aligned)"}
                    </SelectItem>
                    {(data?.years ?? latestQ.data?.years ?? []).map((y) => (
                      <SelectItem key={y} value={String(y)} className="text-xs">
                        {ar ? `سنة مالية ${y}` : `Fiscal year ${y}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {ar
                  ? "المقارنة المتكافئة تتطلب نفس الفترة. «أحدث فترة لكل شركة» أسرع لكنها قد تجمع ربعًا مع سنة كاملة."
                  : "Like-for-like needs one period. “Each company's latest” is faster but can mix a quarter with a full year."}
              </p>
            </div>
          ) : null}

          {/* ── Comparability status ───────────────────────────────────── */}
          {companies.length >= 2 ? (
            <div className="space-y-2">
              {periodsAligned ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <Check className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
                  <span className="font-medium text-foreground">{ar ? "فترة قابلة للمقارنة" : "Comparable period"}:</span>
                  <span>{companies[0].periodLabel}</span>
                  <span className="text-muted-foreground/70">
                    {ar ? "— كل الأعمدة على نفس الأساس." : "— every column uses the same basis."}
                  </span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="font-medium">{ar ? "الفترات غير متطابقة — المقارنة إرشادية." : "Periods not aligned — comparison is indicative."}</span>
                  <span className="text-warning/90">
                    {ar
                      ? "كل عمود يوضح أساسه، وعلامات «القيمة الأقوى» مخفية حتى تتوحد الفترة."
                      : "Each column states its basis; stronger-figure marks stay hidden until the period is identical."}
                  </span>
                  {mode !== "aligned" ? (
                    <Button variant="outline" size="sm" className="ms-auto h-7 border-warning/40 text-[11px]" onClick={() => setMode("aligned")}>
                      {ar ? "وحّد الفترة" : "Align periods"}
                    </Button>
                  ) : null}
                </div>
              )}
              {sectorsMixed ? (
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  {ar
                    ? "الشركات من قطاعات مختلفة — الفروق في الهوامش والرفع المالي قد تكون هيكلية أكثر منها تشغيلية."
                    : "The companies sit in different sectors — differences in margins and leverage can be structural rather than operational."}
                </p>
              ) : null}
              {alignedUnavailable ? (
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-warning">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  {ar
                    ? "لا توجد سنة مالية مشتركة بقوائم سنوية لهذه الشركات — نعرض أحدث فترة لكل شركة، وهي مقارنة إرشادية."
                    : "No shared fiscal year with annual filings for these companies — showing each company's latest period, which is indicative only."}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* ── Selection ──────────────────────────────────────────────── */}
          <section aria-label={ar ? "الشركات المختارة" : "Selected companies"} className="rounded-xl border border-border/60 bg-card p-3">
            {pickedInfo.length > 0 ? (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {pickedInfo.map((p) => (
                  <Badge key={p.id} variant="outline" className="gap-1.5 border-border/60 py-1 text-xs">
                    <span className="font-semibold">{p.ticker}</span>
                    {p.name ? <span className="max-w-40 truncate text-muted-foreground">{p.name}</span> : null}
                    {p.sector ? <span className="text-[10px] text-muted-foreground/70">{ar ? SECTOR_AR[p.sector] ?? p.sector : p.sector}</span> : null}
                    <button
                      type="button"
                      onClick={() => toggle(p.id)}
                      aria-label={ar ? `إزالة ${p.ticker}` : `Remove ${p.ticker}`}
                      className="ms-0.5 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </Badge>
                ))}
                <span className="text-[11px] text-muted-foreground">
                  {ids.length < 2
                    ? ar
                      ? "أضف شركة أخرى على الأقل"
                      : "Add at least one more company"
                    : ids.length >= MAX_COMPANIES
                      ? ar
                        ? "٤ شركات كحد أقصى"
                        : "4 companies maximum"
                      : ar
                        ? `${ids.length} من ٤`
                        : `${ids.length} of 4`}
                </span>
              </div>
            ) : null}
            <div className="relative">
              <Input
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder={ar ? "ابحث بالاسم أو الرمز لإضافة شركة…" : "Search by name or ticker to add a company…"}
                className="h-9 text-sm"
                aria-label={ar ? "البحث عن شركة للمقارنة" : "Search for a company to compare"}
                disabled={ids.length >= MAX_COMPANIES}
              />
            </div>
            {ids.length >= MAX_COMPANIES ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {ar ? "تم الوصول إلى الحد الأقصى (٤). أزل شركة لإضافة غيرها." : "Maximum of 4 reached. Remove one to add another."}
              </p>
            ) : null}
            {debounced.length >= 2 && (searchResults?.companies ?? []).length > 0 && ids.length < MAX_COMPANIES ? (
              <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {(searchResults?.companies ?? []).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      toggle(c.id)
                      setSearch("")
                      setDebounced("")
                    }}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-start text-xs transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="font-bold">{c.ticker}</span>
                    <span className="truncate text-muted-foreground">{ar ? c.nameAr ?? c.nameEn : c.nameEn}</span>
                    <span className="ms-auto shrink-0 text-[10px] text-muted-foreground/70">
                      {ar ? SECTOR_AR[c.sector] ?? c.sector : c.sector}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {debounced.length >= 2 && searchResults && searchResults.companies.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {ar ? "لا نتائج مطابقة — جرّب الاسم أو الرمز فقط." : "No matches — try the name or the ticker only."}
              </p>
            ) : null}
          </section>

          {/* ── Body ───────────────────────────────────────────────────── */}
          {ids.length < 2 ? (
            <EmptyState
              icon={Scale}
              title={ar ? "اختر شركتين على الأقل للمقارنة" : "Pick at least two companies to compare"}
              description={
                ar
                  ? "شركتان من القطاع نفسه تعطيان أدق قراءة أولى. يمكنك البدء بأكبر الشركات المدرجة أدناه."
                  : "Two companies from the same sector give the fairest first reading. You can start from the largest listed companies below."
              }
              action={
                <div className="flex flex-wrap justify-center gap-1.5">
                  {(suggestions?.companies ?? []).slice(0, 6).map((c) => (
                    <Button key={c.id} variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => toggle(c.id)}>
                      <Plus className="h-3 w-3" aria-hidden="true" />
                      {c.ticker}
                    </Button>
                  ))}
                </div>
              }
            />
          ) : isLoading ? (
            <Skeleton className="h-96 rounded-xl" />
          ) : queryError && !insufficient ? (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-sm font-medium text-destructive">
                  {ar ? "تعذّر تحميل المقارنة — لم تُفقد اختياراتك." : "The comparison could not be loaded — your selection is kept."}
                </p>
                <p className="max-w-md text-xs text-muted-foreground">
                  {ar ? "حدث خطأ في الاتصال أو في الخادم. أعد المحاولة؛ إن تكرر تحقق من حالة الخدمة." : "A connection or server error occurred. Retry; if it persists check the status page."}
                </p>
                <Button variant="outline" size="sm" onClick={retry} className="h-8 text-xs">
                  {ar ? "إعادة المحاولة" : "Retry"}
                </Button>
              </CardContent>
            </Card>
          ) : insufficient || companies.length < 2 ? (
            <EmptyState
              icon={Scale}
              title={ar ? "لا تتوفر فترة مشتركة كافية" : "No shared period with enough verified values"}
              description={
                ar
                  ? "هاتان الشركتان لا تملكان قيمًا موثقة كافية في فترة واحدة. جرّب «أحدث فترة لكل شركة»، أو اختر شركة أخرى."
                  : "These companies do not share enough verified values in one period. Try “each company's latest period”, or change the selection."
              }
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setMode("latest")}>
                    {ar ? "أحدث فترة لكل شركة" : "Use each company's latest"}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setIds([])}>
                    {ar ? "مسح الاختيار" : "Clear selection"}
                  </Button>
                </div>
              }
            />
          ) : (
            <>
              {/* Where they differ most */}
              {differences.length > 0 ? (
                <section aria-label={ar ? "مواضع الاختلاف الأكبر" : "Where they differ most"} className="rounded-xl border border-border/60 bg-card p-4">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {ar ? "أين يختلفون أكثر" : "Where they differ most"}
                  </h2>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {differences.map((d) => (
                      <div key={d.code} className="rounded-lg border border-border/50 bg-muted/20 p-2.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[11px] font-medium text-foreground">
                            <MetricTip code={d.code} label={ar ? d.labelAr : d.labelEn} />
                          </span>
                          <span className="tabular text-sm font-semibold text-foreground">{Math.round(d.spread * 100)}%</span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {ar ? "من" : "from"} {d.low} {ar ? "إلى" : "to"} {d.high}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                    {ar
                      ? "الفارق النسبي بين أقل وأعلى قيمة في المؤشرات النسبية فقط. الأرقام الصغيرة جدًا قد تبدو فروقها واسعة."
                      : "Relative spread between the lowest and highest value, for ratio metrics only. Very small values can look like wide spreads."}
                  </p>
                </section>
              ) : null}

              {/* Comparison table */}
              <Card className="border-border/60 p-0">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <caption className="sr-only">
                        {ar ? "مقارنة الشركات حسب المؤشر" : "Company comparison by metric"}
                      </caption>
                      <thead>
                        <tr className="border-b border-border/60 bg-muted/40">
                          <th scope="col" className="p-3 text-start text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {ar ? "المؤشر" : "Metric"}
                          </th>
                          {companies.map((c) => (
                            <th key={c.id} scope="col" className="min-w-28 p-3 text-end align-top">
                              <a href={`/company/${c.ticker}`} className="block rounded hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <span className="block text-sm font-bold text-foreground">{c.ticker}</span>
                                <span className="block max-w-40 truncate text-[10px] font-normal text-muted-foreground">
                                  {ar ? c.nameAr ?? c.nameEn : c.nameEn}
                                </span>
                                <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground/80">
                                  {c.periodLabel ?? <UnavailableValue />}
                                </span>
                                <span className="block text-[10px] font-normal text-muted-foreground/60">
                                  {ar ? SECTOR_AR[c.sector] ?? c.sector : c.sector}
                                </span>
                              </a>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((group) => (
                          <GroupRows
                            key={group.key}
                            group={group}
                            companies={companies}
                            marks={marks}
                            base={base}
                            lang={lang}
                            ar={ar}
                            periodsAligned={periodsAligned}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Legend — only claims what the table actually does */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                {marks.size > 0 ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="text-primary">◆</span>
                    {ar
                      ? "القيمة الأقوى في الصف — للمؤشرات النسبية ذات الاتجاه الواضح فقط."
                      : "Stronger figure in the row — ratio metrics with a clear direction only."}
                  </span>
                ) : (
                  <span>
                    {ar
                      ? "بدون علامات: الفترات غير متطابقة أو المؤشرات أرقام حجم لا تُرتّب."
                      : "No marks: periods differ, or the rows are levels that are not ranked."}
                  </span>
                )}
                <span>
                  {ar
                    ? "الفرق (Δ) يُقاس مقابل العمود الأول — ليس أفضلية."
                    : "Δ is measured against the first column — it is not a ranking."}
                </span>
              </div>

              {/* Provenance */}
              <div className="space-y-1.5 rounded-xl border border-border/60 bg-card p-3">
                <SourceLine
                  source={ar ? TRUST.sourceFiling.ar : TRUST.sourceFiling.en}
                  period={
                    periodsAligned
                      ? companies[0].periodLabel
                      : ar
                        ? "لكل عمود فترته"
                        : "per column (see headers)"
                  }
                  asOf={selected?.marketAsOf ?? null}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] text-muted-foreground">
                    {ar
                      ? "القيم النسبية محسوبة من القوائم المنشورة — قيمة محسوبة وليست كما وردت."
                      : "Ratios are calculated from published statements — calculated values, not as reported."}
                  </p>
                  <MarketDataLine asOf={selected?.marketAsOf ?? null} delayMinutes={selected?.delayMinutes ?? null} source="market-ticker" />
                </div>
                <p className="text-[10px] text-muted-foreground">{ar ? BRAND.notAdviceAr : BRAND.notAdviceEn}</p>
              </div>
            </>
          )}
        </div>
    </LayoutShell>
  )
}

/* ── Metric rows, grouped ────────────────────────────────────────────── */
function GroupRows({
  group,
  companies,
  marks,
  base,
  lang,
  ar,
  periodsAligned,
}: {
  group: { key: string; en: string; ar: string; rows: { code: string; labelEn: string; labelAr: string; unit: string }[] }
  companies: CompareCompany[]
  marks: Map<string, Set<string>>
  base: CompareCompany | undefined
  lang: "en" | "ar"
  ar: boolean
  periodsAligned: boolean
}) {
  return (
    <>
      <tr className="border-b border-border/60 bg-muted/20">
        <th scope="colgroup" colSpan={companies.length + 1} className="px-3 py-1.5 text-start text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {ar ? group.ar : group.en}
        </th>
      </tr>
      {group.rows.map((def) => {
        const direction = RATIO_DIRECTION[def.code]
        const isScale = !direction
        const rowMarks = marks.get(def.code)
        return (
          <tr key={def.code} className="border-b border-border/40 last:border-0">
            <th scope="row" className="p-3 text-start align-top">
              <MetricTip code={def.code} label={ar ? def.labelAr : def.labelEn} className="text-xs font-medium text-muted-foreground" />
              <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground/70">
                {isScale
                  ? ar
                    ? "حجم — لا يُرتّب"
                    : "Size — not ranked"
                  : direction === "higher"
                    ? ar
                      ? "الأعلى أفضل"
                      : "Higher is better"
                    : ar
                      ? "الأقل أفضل (عند الموجب فقط)"
                      : "Lower is better (positive values only)"}
              </span>
            </th>
            {companies.map((c) => {
              const v = c.metrics[def.code]
              const marked = !!rowMarks?.has(c.id)
              const delta =
                isScale && base && typeof v === "number" && typeof base.metrics[def.code] === "number" && c.id !== base.id
                  ? relDelta(base.metrics[def.code], v)
                  : null
              return (
                <td
                  key={c.id}
                  className={`p-3 text-end align-top tabular ${marked ? "bg-primary/5 font-semibold text-primary" : "font-medium text-foreground"}`}
                >
                  {typeof v === "number" && Number.isFinite(v) ? (
                    <>
                      <span>
                        {marked ? (
                          <span aria-hidden="true" className="me-1 text-primary">
                            ◆
                          </span>
                        ) : null}
                        {fmtNumber(def.unit, v, lang)}
                      </span>
                      {marked ? <span className="sr-only">{ar ? " — القيمة الأقوى في هذا الصف" : " — stronger figure in this row"}</span> : null}
                      {delta !== null ? (
                        <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                          Δ {delta > 0 ? "+" : ""}
                          {delta.toFixed(1)}% {ar ? "مقابل" : "vs"} {base?.ticker}
                        </span>
                      ) : null}
                      {!isScale && !periodsAligned ? (
                        <span className="mt-0.5 block text-[10px] font-normal text-warning">
                          {ar ? "أساس غير متطابق" : "basis differs"}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <UnavailableValue />
                  )}
                </td>
              )
            })}
          </tr>
        )
      })}
    </>
  )
}

function relDelta(baseValue: number, value: number): number | null {
  if (!Number.isFinite(baseValue) || baseValue === 0) return null
  return ((value - baseValue) / Math.abs(baseValue)) * 100
}
