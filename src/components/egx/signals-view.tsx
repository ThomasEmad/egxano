"use client"

// /signals — market-wide technical signals board.
//
// ZBorsa-style reading surface built on EGXANO's own deterministic engine:
// rule-based confluence score (trend/momentum/volume/risk, documented weights),
// a buy/wait/sell-press READING (disclosed as a rule output, not advice),
// trading-style fit tags, a deterministic TRADE PLAN strip (entry zone / stop /
// target from src/lib/technical/trade-plan.ts), and live filters. Every number
// traces to the close-based engine in src/lib/technical/signals.ts.
// Free-tier gating: free/anonymous users read the first FREE_SIGNALS_ROWS rows
// fully; the rest render as locked cards with a Pro upgrade CTA.

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Lock,
  RefreshCw,
  Search,
  Star,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { api, getUserToken } from "@/lib/client/api"
import { usePlan } from "@/lib/client/subscription"
import { useI18n } from "@/lib/i18n"
import { useWatchlist } from "@/lib/client/watchlist"
import { FREE_SIGNALS_ROWS } from "@/lib/plans/entitlements"
import { useMarketLive } from "./use-market-live"
import { SIGNAL_META, STYLE_TAG_HINT_AR, STYLE_TAG_META, type TechSignalType, type TechStyleTag } from "@/lib/technical/signals"
import type { GatedSignalRow, MarketSignalRow, MarketSignalsResponse } from "@/lib/technical/signals-service"
import { TIER_AR } from "@/lib/market/tiers"

type SignalFilter = "all" | "buy" | "hold" | "sell" | "fav"
type StyleFilter = "all" | TechStyleTag
type RsiFilter = "all" | "oversold" | "neutral" | "overbought"
type LiquidityFilter = "all" | "high" | "normal"
type DayMoveFilter = "all" | "up" | "down"
type TierFilter = "all" | "EGX30" | "EGX70" | "MAIN" | "OTC"
type MaFilter = "all" | "aboveEma50" | "belowEma50"
type RangePosFilter = "all" | "top" | "middle" | "bottom"
type ScoreFilter = "all" | "s70" | "s60"
type SortKey = "score" | "change" | "perfM1" | "rsi" | "relVol"

function pctStr(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "—"
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`
}

function pctCls(v: number | null | undefined): string {
  if (v === null || v === undefined) return "text-muted-foreground"
  return v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-muted-foreground"
}

/** Defensive tier label lookup — unknown/missing tiers render no badge at all. */
function tierShort(tier: string | null | undefined): string {
  if (!tier) return ""
  const map = TIER_AR as unknown as Partial<Record<string, { short?: string }>> | undefined
  return map?.[tier]?.short ?? ""
}

const SIGNAL_CLS: Record<TechSignalType, { badge: string; ring: string; dot: string }> = {
  buy: { badge: "border-positive/40 bg-positive/10 text-positive", ring: "border-positive/40", dot: "bg-positive" },
  hold: { badge: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400", ring: "border-amber-500/40", dot: "bg-amber-500" },
  sell: { badge: "border-negative/40 bg-negative/10 text-negative", ring: "border-negative/40", dot: "bg-negative" },
}

export function SignalsView() {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const watch = useWatchlist()
  // Plan gating (usePlan contract: { plan, isPremium, isLoading }). While the
  // plan query is still loading we render normal unlocked cards — no
  // flash-of-locked while data loads.
  const { isPremium, isLoading: planLoading } = usePlan()
  const authed = !!getUserToken()
  // Free/anonymous filtering runs SERVER-SIDE (one engine with the API): the
  // server executes the filters on the FULL universe and returns matched
  // companies — free ones unlocked, premium ones as locked identity cards.
  // Premium keeps the instant client-side filtering over full rows.
  const gateActive = !planLoading && !isPremium

  const [signalFilter, setSignalFilter] = useState<SignalFilter>("all")
  const [styleFilter, setStyleFilter] = useState<StyleFilter>("all")
  const [rsiFilter, setRsiFilter] = useState<RsiFilter>("all")
  const [liquidity, setLiquidity] = useState<LiquidityFilter>("all")
  const [dayMove, setDayMove] = useState<DayMoveFilter>("all")
  const [tierFilter, setTierFilter] = useState<TierFilter>("all")
  const [maFilter, setMaFilter] = useState<MaFilter>("all")
  const [rangePosFilter, setRangePosFilter] = useState<RangePosFilter>("all")
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>("all")
  const [sector, setSector] = useState("")
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<SortKey>("score")

  const filtersActive =
    signalFilter !== "all" ||
    styleFilter !== "all" ||
    rsiFilter !== "all" ||
    liquidity !== "all" ||
    dayMove !== "all" ||
    tierFilter !== "all" ||
    maFilter !== "all" ||
    rangePosFilter !== "all" ||
    scoreFilter !== "all" ||
    sector !== "" ||
    q.trim() !== ""

  // Debounced search term for server-side filtering (a request per keystroke
  // would be wasteful; 350ms is the standard search debounce).
  const [debouncedQ, setDebouncedQ] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), gateActive ? 350 : 0)
    return () => clearTimeout(t)
  }, [q, gateActive])

  // Query string sent to the API when the server executes the filters.
  const serverQuery = useMemo(() => {
    if (!gateActive) return ""
    const sp = new URLSearchParams()
    if (signalFilter !== "all" && signalFilter !== "fav") sp.set("signal", signalFilter)
    if (styleFilter !== "all") sp.set("style", styleFilter)
    if (rsiFilter !== "all") sp.set("rsi", rsiFilter)
    if (liquidity !== "all") sp.set("liquidity", liquidity)
    if (dayMove !== "all") sp.set("dayMove", dayMove)
    if (tierFilter !== "all") sp.set("tier", tierFilter)
    if (maFilter !== "all") sp.set("ma", maFilter)
    if (rangePosFilter !== "all") sp.set("rangePos", rangePosFilter)
    if (scoreFilter !== "all") sp.set("score", scoreFilter)
    if (sector) sp.set("sector", sector)
    if (debouncedQ.trim()) sp.set("q", debouncedQ.trim())
    if (sort !== "score") sp.set("sort", sort)
    return sp.toString()
  }, [gateActive, signalFilter, styleFilter, rsiFilter, liquidity, dayMove, tierFilter, maFilter, rangePosFilter, scoreFilter, sector, debouncedQ, sort])

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["technical-signals", serverQuery || "client"],
    queryFn: () => api.technicalSignals(serverQuery || undefined),
    staleTime: gateActive ? 60_000 : 120_000,
  })

  // While EGX is in session the board follows the price refresh cadence.
  useMarketLive(["technical-signals"])

  const allRows = data?.rows ?? []
  const matched = (data as MarketSignalsResponse | undefined)?.matched
  const serverTiers = (data as MarketSignalsResponse | undefined)?.tiers
  const serverStyles = (data as MarketSignalsResponse | undefined)?.styles
  const lockedRemaining = (data as MarketSignalsResponse | undefined)?.lockedRemaining ?? 0
  const upgradeMessage = (data as MarketSignalsResponse | undefined)?.upgradeHint?.message

  const rows = allRows

  const sectors = useMemo(
    () => [...new Set(rows.map((r) => r.sector))].sort((a, b) => a.localeCompare(b)),
    [rows]
  )

  // Chip counts: server aggregates when the server filters (locked rows can't
  // expose their own values), local counts over full rows for premium.
  const counts = useMemo(() => {
    if (gateActive) {
      return {
        all: matched?.total ?? 0,
        buy: matched?.buy ?? 0,
        hold: matched?.hold ?? 0,
        sell: matched?.sell ?? 0,
        fav: allRows.filter((r) => watch.has(r.companyId)).length,
      }
    }
    const c = { all: rows.length, buy: 0, hold: 0, sell: 0, fav: 0 }
    for (const r of rows) {
      if ("locked" in r) continue
      if (r.signal) c[r.signal]++
      if (watch.has(r.companyId)) c.fav++
    }
    return c
  }, [gateActive, matched, allRows, rows, watch])

  // Premium path: identical client-side filtering as before (full rows).
  const clientFiltered = useMemo(() => {
    const fullRows = rows.filter((r): r is MarketSignalRow => !("locked" in r))
    let list = fullRows
    if (signalFilter === "fav") list = list.filter((r) => watch.has(r.companyId))
    else if (signalFilter !== "all") list = list.filter((r) => r.signal === signalFilter)
    if (styleFilter !== "all") list = list.filter((r) => r.styleFits.some((f) => f.tag === styleFilter))
    if (rsiFilter !== "all" && rsiFilter !== "neutral") list = list.filter((r) => r.metrics.rsi14 !== null && (rsiFilter === "oversold" ? r.metrics.rsi14 < 30 : r.metrics.rsi14 > 70))
    if (rsiFilter === "neutral") list = list.filter((r) => r.metrics.rsi14 !== null && r.metrics.rsi14 >= 30 && r.metrics.rsi14 <= 70)
    if (liquidity === "high") list = list.filter((r) => r.metrics.relVol !== null && r.metrics.relVol >= 1.5)
    if (liquidity === "normal") list = list.filter((r) => r.metrics.relVol === null || r.metrics.relVol < 1.5)
    if (dayMove === "up") list = list.filter((r) => (r.changePct ?? 0) > 0)
    if (dayMove === "down") list = list.filter((r) => (r.changePct ?? 0) < 0)
    if (tierFilter !== "all") list = list.filter((r) => (r.marketTier ?? "MAIN") === tierFilter)
    if (maFilter === "aboveEma50") list = list.filter((r) => r.metrics.ema50 !== null && r.lastClose !== null && r.lastClose > r.metrics.ema50)
    if (maFilter === "belowEma50") list = list.filter((r) => r.metrics.ema50 !== null && r.lastClose !== null && r.lastClose < r.metrics.ema50)
    if (rangePosFilter === "top") list = list.filter((r) => r.metrics.rangePos60 !== null && r.metrics.rangePos60 >= 80)
    if (rangePosFilter === "bottom") list = list.filter((r) => r.metrics.rangePos60 !== null && r.metrics.rangePos60 <= 20)
    if (rangePosFilter === "middle") list = list.filter((r) => r.metrics.rangePos60 !== null && r.metrics.rangePos60 > 20 && r.metrics.rangePos60 < 80)
    if (scoreFilter === "s70") list = list.filter((r) => (r.score ?? -1) >= 70)
    if (scoreFilter === "s60") list = list.filter((r) => (r.score ?? -1) >= 60)
    if (sector) list = list.filter((r) => r.sector === sector)
    const needle = q.trim().toLowerCase()
    if (needle) {
      list = list.filter(
        (r) =>
          r.ticker.toLowerCase().includes(needle) ||
          r.nameEn.toLowerCase().includes(needle) ||
          (r.nameAr ?? "").includes(needle)
      )
    }
    const sorted = [...list]
    sorted.sort((a, b) => {
      switch (sort) {
        case "change": return (b.changePct ?? -99) - (a.changePct ?? -99)
        case "perfM1": return (b.metrics.perfM1 ?? -99) - (a.metrics.perfM1 ?? -99)
        case "rsi": return (a.metrics.rsi14 ?? 999) - (b.metrics.rsi14 ?? 999)
        case "relVol": return (b.metrics.relVol ?? 0) - (a.metrics.relVol ?? 0)
        default: return (b.score ?? -1) - (a.score ?? -1)
      }
    })
    return sorted
  }, [rows, signalFilter, styleFilter, rsiFilter, liquidity, dayMove, tierFilter, maFilter, rangePosFilter, scoreFilter, sector, q, sort, watch])

  // Free path: the server already filtered + sorted the full universe.
  const serverRows = useMemo(() => {
    if (signalFilter !== "fav") return allRows
    return allRows.filter((r) => watch.has(r.companyId))
  }, [allRows, signalFilter, watch])

  const visibleRows = gateActive ? serverRows : clientFiltered

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-10 rounded-lg" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        {ar ? "تعذر تحميل الإشارات الفنية الآن — أعد المحاولة." : "Technical signals could not be loaded — try again."}
      </Card>
    )
  }

  const dist = data.distribution
  const total = dist.buy + dist.hold + dist.sell
  const strengthPct = total > 0 ? Math.round(((dist.buy + dist.hold * 0.5) / total) * 100) : null

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      active ? "border-primary bg-primary text-primary-foreground" : "border-border/60 bg-muted/40 text-muted-foreground hover:text-foreground"
    }`

  const styleHintAr = (["day", "swing", "trend", "reversal"] as TechStyleTag[])
    .map((t) => `${STYLE_TAG_META[t].ar} = ${STYLE_TAG_HINT_AR[t]}`)
    .join(" · ")
  const styleHintEn = "Day trade = in and out within the session · Days trade = two days to two weeks · Weeks trade = with the trend for months · Reversal watch = near the lows"

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
            <Activity className="h-5 w-5 text-primary" aria-hidden />
            {ar ? "الإشارات الفنية" : "Technical Signals"}
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {ar
              ? "قراءة قواعدية حتمية لكل الأسهم المتداولة من بيانات الأسعار الحقيقية — الاتجاه والزخم ومناطق الدخول والخروج تُدمج في درجة واحدة موثقة الأوزان. الإشارة قراءة فنية قابلة للتحقق — وليست توصية استثمارية."
              : "A deterministic rule-based reading of every traded name from real price data — trend, momentum and entry/exit zones merge into one documented score. The signal is a verifiable technical reading — not an investment recommendation."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {ar ? "آخر جلسة: " : "Last session: "}
            <span dir="ltr">{data.pricedAsOf ?? "—"}</span>
          </span>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void refetch()} disabled={isRefetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} aria-hidden />
            {ar ? "تحديث" : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={ar ? "قراءات شراء" : "Buy reads"}
          value={dist.buy}
          tone="positive"
          hint={ar ? `من ${total} شركة مقروءة` : `of ${total} scored`}
        />
        <StatCard
          label={ar ? "انتظار" : "Wait"}
          value={dist.hold}
          tone="amber"
          hint={ar ? "إشارات متعارضة أو زخم ضعيف" : "mixed or weak momentum"}
        />
        <StatCard
          label={ar ? "ضغط بيعي" : "Sell pressure"}
          value={dist.sell}
          tone="negative"
          hint={ar ? "اتجاه وزخم هابطان" : "trend and momentum down"}
        />
        <StatCard
          label={ar ? "قوة القراءة السوقية" : "Market read strength"}
          value={strengthPct !== null ? `${strengthPct}%` : "—"}
          tone={strengthPct !== null && strengthPct >= 55 ? "positive" : strengthPct !== null && strengthPct < 40 ? "negative" : "amber"}
          hint={
            data.pctAboveEma20 !== null
              ? ar
                ? `${data.pctAboveEma20}% من الأسهم فوق متوسط 20 جلسة`
                : `${data.pctAboveEma20}% of names above their EMA20`
              : ar ? "اتساع فني" : "technical breadth"
          }
        />
      </div>

      {/* Style chips */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{ar ? "أسلوب التداول:" : "Trading style:"}</span>
          <button className={chip(styleFilter === "all")} onClick={() => setStyleFilter("all")}>
            {ar ? "كل الأنماط" : "All styles"}
          </button>
          {(["day", "swing", "trend", "reversal"] as TechStyleTag[]).map((st) => {
            const n = gateActive
              ? serverStyles?.[st] ?? 0
              : rows.filter((r) => !("locked" in r) && r.styleFits.some((f) => f.tag === st)).length
            return (
              <button key={st} className={chip(styleFilter === st)} onClick={() => setStyleFilter(st)}>
                {ar ? STYLE_TAG_META[st].ar : STYLE_TAG_META[st].en}
                <span className="ms-1 tabular opacity-80">{n}</span>
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">{ar ? styleHintAr : styleHintEn}</p>
      </div>

      {/* Signal filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{ar ? "فلترة:" : "Filter:"}</span>
        <button className={chip(signalFilter === "all")} onClick={() => setSignalFilter("all")}>
          {ar ? "الكل" : "All"} <span className="ms-1 tabular opacity-80">{counts.all}</span>
        </button>
        <button className={chip(signalFilter === "buy")} onClick={() => setSignalFilter("buy")}>
          {ar ? "شراء" : "Buy"} <span className="ms-1 tabular opacity-80">{counts.buy}</span>
        </button>
        <button className={chip(signalFilter === "hold")} onClick={() => setSignalFilter("hold")}>
          {ar ? "انتظار" : "Wait"} <span className="ms-1 tabular opacity-80">{counts.hold}</span>
        </button>
        <button className={chip(signalFilter === "sell")} onClick={() => setSignalFilter("sell")}>
          {ar ? "بيع" : "Sell"} <span className="ms-1 tabular opacity-80">{counts.sell}</span>
        </button>
        <button className={chip(signalFilter === "fav")} onClick={() => setSignalFilter("fav")}>
          <Star className={`inline h-3 w-3 ${counts.fav > 0 ? "fill-warning text-warning" : ""}`} aria-hidden />
          {ar ? "المفضلة" : "Favorites"} <span className="ms-1 tabular opacity-80">{counts.fav}</span>
        </button>
      </div>

      {/* Tier filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{ar ? "التصنيف:" : "Tier:"}</span>
        <button className={chip(tierFilter === "all")} onClick={() => setTierFilter("all")}>
          {ar ? "الكل" : "All"}
        </button>
        {(["EGX30", "EGX70", "MAIN", "OTC"] as Exclude<TierFilter, "all">[]).map((t) => {
          const n = gateActive
            ? serverTiers?.[t] ?? 0
            : rows.filter((r) => !("locked" in r) && (r.marketTier ?? "MAIN") === t).length
          const label = ar ? (TIER_AR as unknown as Record<string, { short?: string }> | undefined)?.[t]?.short ?? t : t
          return (
            <button key={t} className={chip(tierFilter === t)} onClick={() => setTierFilter(t)}>
              {/* Parentheses keep the count visually separate in RTL — «مؤشر 30 (31)» not «مؤشر 3031» */}
              {ar ? `${label} (${n})` : `${label} ${n}`}
            </button>
          )
        })}
      </div>

      {/* Moving-average / range / score filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{ar ? "المتوسطات:" : "Averages:"}</span>
        <button className={chip(maFilter === "all")} onClick={() => setMaFilter("all")}>
          {ar ? "الكل" : "All"}
        </button>
        <button className={chip(maFilter === "aboveEma50")} onClick={() => setMaFilter("aboveEma50")}>
          {ar ? "فوق EMA50" : "Above EMA50"}
        </button>
        <button className={chip(maFilter === "belowEma50")} onClick={() => setMaFilter("belowEma50")}>
          {ar ? "تحت EMA50" : "Below EMA50"}
        </button>
        <span className="mx-1 hidden text-border sm:inline" aria-hidden>|</span>
        <span className="text-xs text-muted-foreground">{ar ? "الموقع السعري:" : "Price position:"}</span>
        <button className={chip(rangePosFilter === "all")} onClick={() => setRangePosFilter("all")}>
          {ar ? "الكل" : "All"}
        </button>
        <button className={chip(rangePosFilter === "top")} onClick={() => setRangePosFilter("top")}>
          {ar ? "قرب قمة 60 جلسة (≥80%)" : "Near 60-session high (≥80%)"}
        </button>
        <button className={chip(rangePosFilter === "bottom")} onClick={() => setRangePosFilter("bottom")}>
          {ar ? "قرب قاع (≤20%)" : "Near low (≤20%)"}
        </button>
        <button className={chip(rangePosFilter === "middle")} onClick={() => setRangePosFilter("middle")}>
          {ar ? "المنتصف" : "Middle"}
        </button>
        <span className="mx-1 hidden text-border sm:inline" aria-hidden>|</span>
        <span className="text-xs text-muted-foreground">{ar ? "الدرجة:" : "Score:"}</span>
        <button className={chip(scoreFilter === "all")} onClick={() => setScoreFilter("all")}>
          {ar ? "الكل" : "All"}
        </button>
        <button className={chip(scoreFilter === "s70")} onClick={() => setScoreFilter("s70")}>
          ≥70
        </button>
        <button className={chip(scoreFilter === "s60")} onClick={() => setScoreFilter("s60")}>
          ≥60
        </button>
      </div>

      {/* Advanced filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={ar ? "رمز أو اسم…" : "Ticker or name…"}
            className="h-8 w-44 ps-8 text-xs"
            aria-label={ar ? "بحث" : "Search"}
          />
        </div>
        <Select value={sector || "all"} onValueChange={(v) => setSector(v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 w-40 text-xs" aria-label={ar ? "القطاع" : "Sector"}>
            <SelectValue placeholder={ar ? "كل القطاعات" : "All sectors"} />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value="all">{ar ? "كل القطاعات" : "All sectors"}</SelectItem>
            {sectors.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={rsiFilter} onValueChange={(v) => setRsiFilter(v as RsiFilter)}>
          <SelectTrigger className="h-8 w-36 text-xs" aria-label="RSI">
            <SelectValue placeholder="RSI" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{ar ? "RSI: الكل" : "RSI: all"}</SelectItem>
            <SelectItem value="oversold">{ar ? "تشبع بيعي (<30)" : "Oversold (<30)"}</SelectItem>
            <SelectItem value="neutral">{ar ? "منطقة محايدة" : "Neutral band"}</SelectItem>
            <SelectItem value="overbought">{ar ? "تشبع شرائي (>70)" : "Overbought (>70)"}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={liquidity} onValueChange={(v) => setLiquidity(v as LiquidityFilter)}>
          <SelectTrigger className="h-8 w-36 text-xs" aria-label={ar ? "السيولة" : "Liquidity"}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{ar ? "السيولة: الكل" : "Liquidity: all"}</SelectItem>
            <SelectItem value="high">{ar ? "نشاط مرتفع (≥1.5×)" : "High activity (≥1.5×)"}</SelectItem>
            <SelectItem value="normal">{ar ? "نشاط عادي" : "Normal activity"}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={dayMove} onValueChange={(v) => setDayMove(v as DayMoveFilter)}>
          <SelectTrigger className="h-8 w-32 text-xs" aria-label={ar ? "أداء اليوم" : "Day move"}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{ar ? "اليوم: الكل" : "Today: all"}</SelectItem>
            <SelectItem value="up">{ar ? "صاعد اليوم" : "Up today"}</SelectItem>
            <SelectItem value="down">{ar ? "هابط اليوم" : "Down today"}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="h-8 w-40 text-xs" aria-label={ar ? "الترتيب" : "Sort"}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="score">{ar ? "الأقوى فنيًا" : "Strongest read"}</SelectItem>
            <SelectItem value="change">{ar ? "أداء اليوم" : "Day move"}</SelectItem>
            <SelectItem value="perfM1">{ar ? "أداء الشهر" : "1-month perf"}</SelectItem>
            <SelectItem value="rsi">{ar ? "RSI (الأدنى أولًا)" : "RSI (lowest first)"}</SelectItem>
            <SelectItem value="relVol">{ar ? "نشاط التداول" : "Volume activity"}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Data-trust line */}
      {data.weakData > 0 || data.rows.some((r) => !("locked" in r) && r.limitations.length > 0) ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {ar
            ? `الشفافية: الحساب يعمل على أسعار الإغلاق اليومية من مسح السوق (${data.scored} شركة قابلة للقراءة، ${data.weakData} بتاريخ غير كافٍ — تظهر بدون درجة). السلسلة معدّلة لتوزيعات الأرباح والزيادات قبل الحساب، والجلسات القليلة الأخيرة قد تكون بسعر الجلسة الجاري وليس إغلاقًا نهائيًا.`
            : `Transparency: the engine runs on daily closing prices from the market scan (${data.scored} scored, ${data.weakData} with insufficient history — shown without a score). The series is rebuilt across corporate actions before computing, and the latest sessions may carry the running session's price rather than a final close.`}
        </p>
      ) : null}

      {/* Cards */}
      {visibleRows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {ar ? "لا توجد نتائج مطابقة للفلاتر الحالية." : "No matches for the current filters."}
        </Card>
      ) : (
        <>
          {/* Free-tier banner — real results, real counts, honest copy */}
          {gateActive ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2">
              <span className="text-xs font-medium leading-relaxed text-foreground">
                {filtersActive
                  ? ar
                    ? `تم العثور على ${matched?.total ?? visibleRows.length} شركة تطابق معاييرك${lockedRemaining > 0 ? ` — وإليك أول ${visibleRows.length}` : ""}. التفاصيل الكاملة متاحة مع Pro.`
                    : `${matched?.total ?? visibleRows.length} companies match your filters${lockedRemaining > 0 ? ` — showing the first ${visibleRows.length}` : ""}. Full details with Pro.`
                  : ar
                    ? `التغطية المجانية: ${FREE_SIGNALS_ROWS} شركات بتفاصيل الإشارات الكاملة، و${Math.max((matched?.total ?? 0) - FREE_SIGNALS_ROWS, 0)} شركة أخرى مطابقة تظهر كشركات مقفولة.`
                    : `Free coverage: ${FREE_SIGNALS_ROWS} companies with full signal details, and the other matches appear as locked cards.`}
              </span>
              <Button asChild size="sm" variant="link" className="h-auto px-0 text-xs font-semibold">
                <Link href="/premium">{ar ? "ترقية الآن" : "Upgrade now"}</Link>
              </Button>
            </div>
          ) : null}
          {gateActive && upgradeMessage ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">{upgradeMessage}</p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleRows.map((r) =>
              "locked" in r ? (
                <CompanyLockedCard key={r.companyId} row={r} ar={ar} authed={authed} filtersActive={filtersActive} />
              ) : (
                <SignalCard key={r.companyId} row={r} ar={ar} fav={watch.has(r.companyId)} onFav={() => watch.toggle({ id: r.companyId, ticker: r.ticker })} />
              )
            )}
            {gateActive && lockedRemaining > 0 ? <MoreLockedCard ar={ar} count={lockedRemaining} /> : null}
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, tone, hint }: { label: string; value: number | string; tone: "positive" | "negative" | "amber"; hint?: string }) {
  const cls = tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-amber-600 dark:text-amber-400"
  return (
    <Card className="p-0">
      <CardContent className="px-4 py-3">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold tabular ${cls}`} dir="ltr">{value}</p>
        {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

function SignalCard({ row, ar, fav, onFav }: { row: MarketSignalRow; ar: boolean; fav: boolean; onFav: () => void }) {
  const m = row.metrics
  const sig = row.signal
  const sigCls = sig ? SIGNAL_CLS[sig] : null
  const tp = row.tradePlan
  const tier = tierShort(row.marketTier)
  const planZone = (low: number, high: number): string => (low === high ? low.toFixed(2) : `${low.toFixed(2)}–${high.toFixed(2)}`)
  return (
    <Card className={`group relative p-0 transition-shadow hover:shadow-md ${sigCls?.ring ?? "border-border/60"}`}>
      <CardContent className="space-y-2.5 px-4 py-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/company/${row.companyId}?tab=technical`} className="flex items-center gap-1.5 text-sm font-bold text-foreground hover:text-primary">
              <span dir="ltr">{row.ticker}</span>
              {tier ? <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-medium text-muted-foreground">{tier}</span> : null}
              <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </Link>
            <p className="truncate text-xs text-muted-foreground" title={ar ? (row.nameAr ?? row.nameEn) : row.nameEn}>
              {ar ? (row.nameAr ?? row.nameEn) : row.nameEn}
            </p>
          </div>
          <button
            onClick={onFav}
            aria-label={ar ? "إضافة للمفضلة" : "Toggle favorite"}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-warning"
          >
            <Star className={`h-4 w-4 ${fav ? "fill-warning text-warning" : ""}`} aria-hidden />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-1.5" dir="ltr">
            <span className="text-lg font-bold tabular text-foreground">{row.lastClose?.toFixed(2) ?? "—"}</span>
            <span className={`flex items-center text-xs font-semibold tabular ${pctCls(row.changePct)}`}>
              {row.changePct !== null && row.changePct > 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : row.changePct !== null && row.changePct < 0 ? <ArrowDownRight className="h-3 w-3" aria-hidden /> : null}
              {pctStr(row.changePct)}
            </span>
          </div>
          {sig && sigCls ? (
            <Badge variant="outline" className={`shrink-0 gap-1.5 ${sigCls.badge}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${sigCls.dot}`} aria-hidden />
              {ar ? SIGNAL_META[sig].ar : SIGNAL_META[sig].en}
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0 border-border/40 text-muted-foreground/70">{ar ? "بيانات غير كافية" : "Weak data"}</Badge>
          )}
        </div>

        {/* Score + one-line reason */}
        {row.score !== null ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{ar ? "الدرجة الفنية" : "Technical score"}</span>
              <span className="tabular" dir="ltr">{row.score}/100</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${row.score >= 62 ? "bg-positive" : row.score <= 38 ? "bg-negative" : "bg-amber-500"}`}
                style={{ width: `${row.score}%` }}
              />
            </div>
            {row.reasons[0] ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">{ar ? row.reasons[0].ar : row.reasons[0].en}</p>
            ) : null}
          </div>
        ) : (
          row.limitations[0] ? <p className="text-[11px] leading-relaxed text-muted-foreground">{row.limitations[0]}</p> : null
        )}

        {/* Trade plan strip — deterministic entry / stop / target zones */}
        {tp ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
              {ar ? "دخول: " : "Entry: "}
              <span className="tabular" dir="ltr">{planZone(tp.entryLow, tp.entryHigh)}</span>
            </span>
            <span className="rounded-md border border-positive/40 bg-positive/10 px-1.5 py-0.5 text-[10px] font-semibold text-positive">
              {ar ? "الهدف: " : "Target: "}
              <span className="tabular" dir="ltr">{planZone(tp.targetLow, tp.targetHigh)} ({tp.targetPct.toFixed(1)}%)</span>
            </span>
            <span className="rounded-md border border-negative/40 bg-negative/10 px-1.5 py-0.5 text-[10px] font-semibold text-negative">
              {ar ? "وقف الخسارة: " : "Stop: "}
              <span className="tabular" dir="ltr">{tp.stop.toFixed(2)} ({tp.stopPct.toFixed(1)}%)</span>
            </span>
            <span className="rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {ar ? "مخاطرة/عائد " : "R/R "}
              <span className="tabular" dir="ltr">{tp.riskReward.toFixed(2)}</span>
            </span>
          </div>
        ) : sig !== null ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {ar ? "مفيش منطقة دخول واضحة دلوقتي — استنى إشارة أوضح." : "No clear entry zone right now — wait for a cleaner read."}
          </p>
        ) : null}

        {/* Metric chips */}
        <div className="grid grid-cols-4 gap-1.5 text-center">
          <MiniMetric label="RSI" value={m.rsi14 !== null ? m.rsi14.toFixed(0) : "—"} tone={m.rsi14 === null ? "muted" : m.rsi14 > 70 ? "negative" : m.rsi14 < 30 ? "positive" : "muted"} />
          <MiniMetric label={ar ? "شهر" : "1M"} value={pctStr(m.perfM1)} tone={m.perfM1 === null ? "muted" : m.perfM1 > 0 ? "positive" : m.perfM1 < 0 ? "negative" : "muted"} />
          <MiniMetric label={ar ? "حجم" : "Vol×"} value={m.relVol !== null ? `${m.relVol.toFixed(1)}×` : "—"} tone="muted" />
          <MiniMetric label={ar ? "النطاق" : "Range"} value={m.rangePos60 !== null ? `${m.rangePos60.toFixed(0)}%` : "—"} tone="muted" />
        </div>

        {/* Style tags */}
        {row.styleFits.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.styleFits.map((f) => (
              <Badge key={f.tag} variant="secondary" className="px-1.5 py-0 text-[10px]">
                {ar ? STYLE_TAG_META[f.tag].ar : STYLE_TAG_META[f.tag].en}
                <span className="ms-1 tabular opacity-70">{f.earned}/{f.total}</span>
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

/**
 * Locked Premium Card — a REAL matched company, not a placeholder: identity +
 * public market price stay visible (the filter genuinely ran on the whole
 * market), while the paid analysis (signal, score, metrics, levels) never
 * reached the browser — the blur here is decorative, the server redacted the
 * data. The design teases the locked value and gives one clear CTA.
 */
function CompanyLockedCard({
  row,
  ar,
  authed,
  filtersActive,
}: {
  row: GatedSignalRow
  ar: boolean
  authed: boolean
  filtersActive: boolean
}) {
  const tier = tierShort(row.marketTier)
  return (
    <Card className="group relative overflow-hidden p-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
      {/* Brand-accent glow on hover — subtle, not an ad */}
      <div
        className="pointer-events-none absolute -top-10 left-1/2 h-20 w-40 -translate-x-1/2 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-20"
        style={{ background: "var(--brand-accent)" }}
        aria-hidden
      />
      <CardContent className="relative space-y-2.5 px-4 py-3.5">
        {/* Identity — real company the filter matched */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-bold text-foreground">
              <span dir="ltr">{row.ticker}</span>
              {tier ? <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-medium text-muted-foreground">{tier}</span> : null}
            </div>
            <p className="truncate text-xs text-muted-foreground" title={ar ? (row.nameAr ?? row.nameEn) : row.nameEn}>
              {ar ? (row.nameAr ?? row.nameEn) : row.nameEn}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{row.sector}</p>
          </div>
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 via-[var(--brand-accent)] to-emerald-500 shadow-sm"
            aria-hidden
          >
            <Lock className="h-4 w-4 text-white" />
          </span>
        </div>

        {/* Public market price — free data, keeps the card honest and useful */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-1.5" dir="ltr">
            <span className="text-lg font-bold tabular text-foreground">{row.lastClose?.toFixed(2) ?? "—"}</span>
            <span className={`flex items-center text-xs font-semibold tabular ${pctCls(row.changePct)}`}>
              {row.changePct !== null && row.changePct > 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : row.changePct !== null && row.changePct < 0 ? <ArrowDownRight className="h-3 w-3" aria-hidden /> : null}
              {pctStr(row.changePct)}
            </span>
          </div>
          {filtersActive ? (
            <Badge variant="outline" className="shrink-0 border-primary/40 bg-primary/10 text-[10px] text-primary">
              {ar ? "مطابق لفلاترك" : "Matches your filters"}
            </Badge>
          ) : null}
        </div>

        {/* Teaser of the locked value — blurred bars represent the hidden
            signal details (decorative: the real values were never sent). */}
        <div className="select-none space-y-1.5 blur-[3px]" aria-hidden>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{ar ? "الدرجة الفنية" : "Technical score"}</span>
            <span className="tabular" dir="ltr">••/100</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-amber-500/60 via-[var(--brand-accent)]/60 to-emerald-500/60" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-md border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600/70 dark:text-blue-400/70">{ar ? "دخول: ••" : "Entry: ••"}</span>
            <span className="rounded-md border border-positive/30 bg-positive/10 px-1.5 py-0.5 text-[10px] font-semibold text-positive/70">{ar ? "الهدف: ••" : "Target: ••"}</span>
            <span className="rounded-md border border-negative/30 bg-negative/10 px-1.5 py-0.5 text-[10px] font-semibold text-negative/70">{ar ? "وقف: ••" : "Stop: ••"}</span>
          </div>
        </div>

        {/* Value proposition + CTA */}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {ar
            ? "الشركة دي طابقت فلاترك — افتح قراءتها الفنية كاملة: الاتجاه، الدرجات، ومناطق الدخول والخروج ووقف الخسارة."
            : "This company matches your filters — unlock its full technical read: direction, score, entry/exit zones and stop-loss."}
        </p>
        <Button asChild size="sm" className="h-7 w-full gap-1.5 px-3 text-xs font-semibold">
          <Link href="/premium">{ar ? "افتح التحليل مع Pro" : "Unlock with Pro"}</Link>
        </Button>
        {!authed ? (
          <Link href="/login" className="block text-center text-[11px] text-muted-foreground underline-offset-2 hover:underline">
            {ar ? "عندك باقة؟ سجّل دخول" : "Already subscribed? Sign in"}
          </Link>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Tail teaser — the server caps identity rows; the rest stay counted. */
function MoreLockedCard({ ar, count }: { ar: boolean; count: number }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 border-dashed border-primary/30 bg-primary/5 p-6 text-center">
      <span
        className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 via-[var(--brand-accent)] to-emerald-500 shadow-sm"
        aria-hidden
      >
        <Lock className="h-4 w-4 text-white" />
      </span>
      <p className="text-xs font-semibold text-foreground">
        {ar
          ? `و ${count} شركة أخرى مطابقة لفلاترك`
          : `${count} more matched companies`}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {ar ? "افتح كل النتائج وتفاصيلها مع باقة Pro" : "Unlock every match and its details with Pro"}
      </p>
      <Button asChild size="sm" variant="outline" className="h-7 px-3 text-xs font-semibold">
        <Link href="/premium">{ar ? "ترقية الآن" : "Upgrade now"}</Link>
      </Button>
    </Card>
  )
}

function MiniMetric({ label, value, tone }: { label: string; value: string; tone: "positive" | "negative" | "muted" }) {
  const cls = tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-foreground/80"
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 px-1 py-1">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className={`text-[11px] font-semibold tabular ${cls}`} dir="ltr">{value}</p>
    </div>
  )
}
