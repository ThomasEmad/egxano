"use client"

// /signals — market-wide technical signals board ("نشرة الجلسة").
//
// RESTRUCTURE (read this before touching the layout):
// The old page was a flat wall — five chip rows, six selects, four identical
// stat cards, and one interleaved card grid whose rows were sorted by score so
// confirmed reads with a live plan scrolled past in between "wait" rows. Three
// structural ideas replace that:
//
//   1. STATE FIRST. A row's publication state (confirmed / watching / wait) is
//      the first question an EGX trader asks — "which of these can I actually
//      trade today?" — so the board is SPLIT INTO SECTIONS by state, in that
//      order, instead of one score-sorted list. Sorting still applies INSIDE a
//      section. A directional read is never mixed in with "no edge".
//   2. THE MARKET COMES BEFORE THE STOCKS. One briefing band answers "where is
//      the tape?" — regime (bull / neutral / bear from the board's own
//      breadth + median score), breadth above EMA20, and the read mix — so the
//      reader knows how to weigh the list below it before scanning it.
//   3. FILTERS HAVE A HIERARCHY. Four primary controls stay visible; the rest
//      live behind "فلاتر متقدمة". Nothing is removed — the same filters and
//      the same server-side gating still run.
//
// EGXAN-specific honesty carried on the page (never decorative):
//   • the engine reads DAILY CLOSES, so the "day trade" style is disclosed as
//     unavailable rather than silently offered;
//   • EGX applies daily price limits, so a level can gap and never trade — the
//     plan strip says so once, in the reader's language;
//   • liquidity on the EGX is thin outside EGX30, so relative volume sits next
//     to every plan: a perfect level with no volume is not an executable level;
//   • prices are delayed public quotes and the last session may be the running
//     one, so freshness is stated with the session date, not implied.
//
// Engine provenance: every number traces to the close-based engine in
// src/lib/technical/signals.ts, overlaid by the canonical OHLC stance so the
// board and the company tab agree. Free-tier gating is unchanged: free and
// anonymous callers receive the first FREE_SIGNALS_ROWS rows fully and the rest
// as locked identity cards (the paid fields never reach the browser).

import { useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  Info,
  Lock,
  RefreshCw,
  Search,
  SlidersHorizontal,
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
import { LiveMarketBadge } from "./live-market-badge"
import { useMarketLive } from "./use-market-live"
import { SIGNAL_META, STYLE_TAG_HINT_AR, STYLE_TAG_META, type TechSignalType, type TechStyleTag, type WatchingSetup } from "@/lib/technical/signals"
import type { BoardRow, GatedSignalRow, MarketSignalRow, MarketSignalsResponse } from "@/lib/technical/signals-service"
import { lifecycleChipLabel, type LifecycleState } from "@/lib/technical/lifecycle"
import { OpportunitiesStrip } from "./opportunities-strip"
import { NumbersTable } from "./numbers-table"
import { TIER_AR } from "@/lib/market/tiers"
import { EMPTY_REGIME_INPUT, REGIME_META, marketRegime, type MarketRegime } from "@/lib/technical/board-gates"

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

const WATCHING_CLS = {
  badge: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  dot: "bg-amber-500",
}

const REGIME_CLS: Record<MarketRegime, { pill: string; dot: string }> = {
  bull: { pill: "border-positive/40 bg-positive/10 text-positive", dot: "bg-positive" },
  neutral: { pill: "border-border/70 bg-muted/50 text-foreground/80", dot: "bg-muted-foreground/60" },
  bear: { pill: "border-negative/40 bg-negative/10 text-negative", dot: "bg-negative" },
}

/**
 * Three-state publication badge (engine contract: every published row is
 * confirmed / watching / wait — a directional read is never naked). Falls
 * back to the legacy signal badge for payloads computed before the layer.
 */
function stateBadgeInfo(
  row: { signalState?: "confirmed" | "watching" | "wait"; signal: TechSignalType | null; setup?: WatchingSetup | null },
  ar: boolean
): { label: string; cls: string; dot: string } | null {
  const st = row.signalState
  if (!st) return null
  if (st === "confirmed" && (row.signal === "buy" || row.signal === "sell")) {
    const c = SIGNAL_CLS[row.signal]
    return {
      label: ar ? (row.signal === "buy" ? "شراء مؤكد" : "بيع مؤكد") : row.signal === "buy" ? "Confirmed buy" : "Confirmed sell",
      cls: c.badge,
      dot: c.dot,
    }
  }
  if (st === "watching" && row.setup) {
    const buy = row.setup.direction === "buy"
    return {
      label: ar ? (buy ? "شراء تحت المراقبة" : "بيع تحت المراقبة") : buy ? "Buy setup — watching" : "Sell setup — watching",
      cls: WATCHING_CLS.badge,
      dot: WATCHING_CLS.dot,
    }
  }
  // wait — only when no directional read is published (invariant: a buy/sell
  // row always carries a plan or a setup)
  if (st === "wait" && row.signal !== "buy" && row.signal !== "sell") {
    return { label: ar ? "انتظار" : "Wait", cls: SIGNAL_CLS.hold.badge, dot: SIGNAL_CLS.hold.dot }
  }
  return null
}

type RowGroup = "ready" | "watch" | "sell" | "rest"

/**
 * Which section a row belongs to. State-first: the reader's question is
 * "what can I act on today", so confirmed beats watching beats everything else.
 * Rows from a payload older than the three-state layer fall back to the legacy
 * test — a directional read that carries a tradable plan IS actionable.
 */
function rowGroup(r: BoardRow): RowGroup {
  if ("locked" in r) return "rest"
  if (r.signalState === "confirmed") return "ready"
  if (r.signalState === "watching") return "watch"
  if (!r.signalState && r.signal !== null && r.signal !== "hold" && r.tradePlan) return "ready"
  // Sell pressure is its own section, never mixed with "no edge": on the EGX
  // it is an avoid / exit warning, not a trade, so it must not read as noise.
  if (r.signal === "sell") return "sell"
  return "rest"
}

/** Compact watched-setup strip for board cards: activation (close-based),
 *  provisional levels (تقديري), recompute note and the pre-entry invalidation. */
function WatchingSetupStrip({ setup, ar }: { setup: WatchingSetup; ar: boolean }) {
  const fmt = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : "—")
  const zone = (lo: number | null, hi: number | null): string => (lo === null || hi === null ? "—" : lo === hi ? lo.toFixed(2) : `${lo.toFixed(2)}–${hi.toFixed(2)}`)
  const above = setup.activation.kind === "close_above"
  return (
    <div className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
          {ar ? `شرط التفعيل — ${setup.direction === "buy" ? "فرصة شراء" : "فرصة بيع"}` : `Activation — ${setup.direction} setup`}
        </p>
        <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1 py-0.5 text-[9px] font-medium text-amber-600 dark:text-amber-400">
          {ar ? "بالإغلاق اليومي فقط" : "daily close only"}
        </span>
      </div>
      <p className="text-[11px] font-medium leading-relaxed text-foreground">
        {ar ? "إغلاق يومي " : "Daily close "}
        <span className="font-bold" dir="ltr">{above ? ">" : "<"} {fmt(setup.activation.level)}</span>
        {ar
          ? ` ${above ? "فوق" : "تحت"} المستوى + ${setup.activation.volumeConditionAr}`
          : ` ${above ? "above" : "below"} the level + volume ≥ 1.5× the 20-session average`}
      </p>
      <p className="text-[10px] leading-relaxed text-muted-foreground">{ar ? `الأساس: ${setup.activation.basisAr}` : setup.activation.basisAr}</p>
      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-md border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
          {ar ? "دخول تقديري: " : "Est. entry: "}
          <span className="tabular" dir="ltr">{zone(setup.provisionalEntry?.low ?? null, setup.provisionalEntry?.high ?? null)}</span>
        </span>
        <span className="rounded-md border border-negative/40 bg-negative/10 px-1.5 py-0.5 text-[10px] font-semibold text-negative">
          {ar ? "وقف تقديري: " : "Est. stop: "}
          <span className="tabular" dir="ltr">{setup.provisionalStop ? fmt(setup.provisionalStop.level) : "—"}</span>
        </span>
        <span className="rounded-md border border-positive/40 bg-positive/10 px-1.5 py-0.5 text-[10px] font-semibold text-positive">
          {ar ? "هدف تقديري: " : "Est. target: "}
          <span className="tabular" dir="ltr">{zone(setup.provisionalTarget?.low ?? null, setup.provisionalTarget?.high ?? null)}</span>
        </span>
        {setup.provisionalRiskReward !== null ? (
          <span className="rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {ar ? "م/ع تقديري " : "Est. R/R "}
            <span className="tabular" dir="ltr">{setup.provisionalRiskReward.toFixed(2)}</span>
          </span>
        ) : null}
      </div>
      <p className="text-[10px] leading-relaxed text-amber-700 dark:text-amber-400/90">
        {ar ? setup.recomputeNoteAr : "Provisional (estimates) — recomputed at activation; the setup confirms only if R/R is at least 1.5 then."}
      </p>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {ar
          ? setup.preEntryInvalidation.conditionAr
          : `Pre-entry invalidation: a daily close ${above ? "below" : "above"} ${fmt(setup.preEntryInvalidation.level)} cancels the setup.`}
      </p>
    </div>
  )
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
  // Advanced filters are a disclosure, not a wall: the four primary controls
  // (state chips, style chips, liquidity, search/sort/sector) stay visible.
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const advancedActive =
    rsiFilter !== "all" ||
    dayMove !== "all" ||
    tierFilter !== "all" ||
    maFilter !== "all" ||
    rangePosFilter !== "all" ||
    scoreFilter !== "all"

  const filtersActive =
    signalFilter !== "all" ||
    styleFilter !== "all" ||
    liquidity !== "all" ||
    advancedActive ||
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

  // The query key carries the resolved gate state: the very first fetch can
  // complete before the plan query resolves (and in rare cookie-less sessions
  // the server then answers with the free slice) — once the gate resolves, the
  // key changes and the board re-fetches instead of sitting on a payload that
  // was sliced for the wrong tier.
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["technical-signals", gateActive ? `free:${serverQuery}` : "premium"],
    queryFn: () => api.technicalSignals(serverQuery || undefined),
    staleTime: gateActive ? 60_000 : 120_000,
  })

  // While EGX is in session the board AND the opportunities strip follow the
  // 30-second pulse cadence (the strip's query key rides the same invalidator).
  const { status: marketStatus, lastUpdated } = useMarketLive(["technical-signals", "signal-opportunities"])

  const allRows = data?.rows ?? []
  const matched = (data as MarketSignalsResponse | undefined)?.matched
  const serverTiers = (data as MarketSignalsResponse | undefined)?.tiers
  const serverStyles = (data as MarketSignalsResponse | undefined)?.styles
  const lockedRemaining = (data as MarketSignalsResponse | undefined)?.lockedRemaining ?? 0
  const upgradeMessage = (data as MarketSignalsResponse | undefined)?.upgradeHint?.message

  const rows = allRows

  // Sector dropdown options: the server facet covers the FULL filtered universe
  // (computed before gating), so a gated/free response still lists every sector
  // — deriving options from the visible rows alone would starve the dropdown
  // (the live "empty sector options" bug). Row-derived list stays as fallback
  // for an older cached payload without the facet.
  const sectorsFacet = data?.sectors
  const sectors = useMemo(() => {
    if (sectorsFacet?.length) return [...sectorsFacet].sort((a, b) => a.localeCompare(b))
    return [...new Set(rows.map((r) => r.sector))].sort((a, b) => a.localeCompare(b))
  }, [sectorsFacet, rows])

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

  // State-first grouping. The order inside each section is whatever the sort
  // control says; the SECTION order is fixed (ready → watch → rest).
  const grouped = useMemo(() => {
    const ready: MarketSignalRow[] = []
    const watching: MarketSignalRow[] = []
    const sellPressure: MarketSignalRow[] = []
    const rest: MarketSignalRow[] = []
    const locked: GatedSignalRow[] = []
    for (const r of visibleRows) {
      if ("locked" in r) {
        locked.push(r)
        continue
      }
      const g = rowGroup(r)
      if (g === "ready") ready.push(r)
      else if (g === "watch") watching.push(r)
      else if (g === "sell") sellPressure.push(r)
      else rest.push(r)
    }
    return { ready, watching, sellPressure, rest, locked }
  }, [visibleRows])

  const regimeInput = data?.regimeInput
  const marketRegimeValue = useMemo(() => marketRegime(regimeInput ?? EMPTY_REGIME_INPUT), [regimeInput])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-10 rounded-lg" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
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

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      active ? "border-primary bg-primary text-primary-foreground" : "border-border/60 bg-muted/40 text-muted-foreground hover:text-foreground"
    }`

  const styleHintAr = (["swing", "trend", "reversal"] as TechStyleTag[])
    .map((t) => `${STYLE_TAG_META[t].ar} = ${STYLE_TAG_HINT_AR[t]}`)
    .join(" · ")
  const styleHintEn = "Days trade = two days to two weeks · Weeks trade = with the trend for months · Reversal watch = near the lows"

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
            <Activity className="h-5 w-5 text-primary" aria-hidden />
            {ar ? "الإشارات الفنية" : "Technical Signals"}
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {ar
              ? "قراءة قواعدية حتمية لكل الأسهم المتداولة على إغلاقات الأسعار الفعلية — الاتجاه والزخم والتداول والموقع السعري بيندمجوا في درجة واحدة موثقة الأوزان. الإشارة قراءة فنية قابلة للتحقق، مش توصية استثمارية."
              : "A deterministic rule-based reading of every traded name from real closing prices — trend, momentum, participation and price location merge into one documented score. The signal is a verifiable technical reading, not an investment recommendation."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LiveMarketBadge ar={ar} on={["technical-signals", "signal-opportunities"]} status={marketStatus} lastUpdated={lastUpdated} />
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void refetch()} disabled={isRefetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} aria-hidden />
            {ar ? "تحديث" : "Refresh"}
          </Button>
        </div>
      </div>

      {/* ── Market state band — the tape before the tickers ─────────────── */}
      <MarketStateBand
        ar={ar}
        regime={marketRegimeValue}
        breadthPct={data.pctAboveEma20}
        bullishShare={data.regimeInput?.breadthBullishShare ?? null}
        medianScore={data.regimeInput?.medianScore ?? null}
        distribution={dist}
        total={total}
        scored={data.scored}
        weakData={data.weakData}
        pricedAsOf={data.pricedAsOf ?? null}
      />

      {/* ── "فرص اليوم" strip — the ordered, capped, regime-gated digest ── */}
      <OpportunitiesStrip />

      {/* Full-market numbers table — premium only (locked rows carry no
          analytical fields server-side; the free board stays identity-only). */}
      {!gateActive ? <NumbersTable rows={rows.filter((r): r is MarketSignalRow => !("locked" in r))} ar={ar} /> : null}

      {/* ── Filter bar: four primary controls, everything else behind a reply ── */}
      <div className="space-y-2.5 rounded-xl border border-border/60 bg-card/40 p-3">
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
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
            className={`ms-auto flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              advancedActive || advancedOpen
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border/60 bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
            {ar ? "فلاتر متقدمة" : "Advanced filters"}
            {advancedActive ? (
              <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                {[rsiFilter, dayMove, tierFilter, maFilter, rangePosFilter, scoreFilter].filter((v) => v !== "all").length}
              </span>
            ) : null}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`} aria-hidden />
          </button>
        </div>

        {/* Primary chips: state + style + liquidity */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{ar ? "القراءة:" : "Read:"}</span>
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

          <span className="mx-1 hidden text-border sm:inline" aria-hidden>|</span>

          <Select value={liquidity} onValueChange={(v) => setLiquidity(v as LiquidityFilter)}>
            <SelectTrigger className="h-7 w-36 text-xs" aria-label={ar ? "السيولة" : "Liquidity"}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{ar ? "السيولة: الكل" : "Liquidity: all"}</SelectItem>
              <SelectItem value="high">{ar ? "نشاط مرتفع (≥1.5×)" : "High activity (≥1.5×)"}</SelectItem>
              <SelectItem value="normal">{ar ? "نشاط عادي" : "Normal activity"}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Style chips — the trading horizon, not a filter afterthought */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{ar ? "الأفق:" : "Horizon:"}</span>
          <button className={chip(styleFilter === "all")} onClick={() => setStyleFilter("all")}>
            {ar ? "كل الآفاق" : "All horizons"}
          </button>
          {(["swing", "trend", "reversal"] as TechStyleTag[]).map((st) => {
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
        <p className="text-[11px] leading-relaxed text-muted-foreground">{ar ? styleHintAr : styleHintEn}</p>

        {/* Advanced disclosure */}
        {advancedOpen ? (
          <div className="space-y-2 border-t border-border/50 pt-2.5">
            <FilterRow label={ar ? "التصنيف" : "Tier"}>
              <button className={chip(tierFilter === "all")} onClick={() => setTierFilter("all")}>
                {ar ? "الكل" : "All"}
              </button>
              {(["EGX30", "EGX70", "MAIN"] as Exclude<TierFilter, "all">[]).map((t) => {
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
            </FilterRow>

            <FilterRow label={ar ? "المتوسطات" : "Averages"}>
              <button className={chip(maFilter === "all")} onClick={() => setMaFilter("all")}>
                {ar ? "الكل" : "All"}
              </button>
              <button className={chip(maFilter === "aboveEma50")} onClick={() => setMaFilter("aboveEma50")}>
                {ar ? "فوق EMA50" : "Above EMA50"}
              </button>
              <button className={chip(maFilter === "belowEma50")} onClick={() => setMaFilter("belowEma50")}>
                {ar ? "تحت EMA50" : "Below EMA50"}
              </button>
            </FilterRow>

            <FilterRow label={ar ? "الموقع السعري" : "Price position"}>
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
            </FilterRow>

            <FilterRow label={ar ? "الدرجة" : "Score"}>
              <button className={chip(scoreFilter === "all")} onClick={() => setScoreFilter("all")}>
                {ar ? "الكل" : "All"}
              </button>
              <button className={chip(scoreFilter === "s70")} onClick={() => setScoreFilter("s70")}>
                ≥70
              </button>
              <button className={chip(scoreFilter === "s60")} onClick={() => setScoreFilter("s60")}>
                ≥60
              </button>
            </FilterRow>

            <FilterRow label="RSI">
              <button className={chip(rsiFilter === "all")} onClick={() => setRsiFilter("all")}>
                {ar ? "الكل" : "All"}
              </button>
              <button className={chip(rsiFilter === "oversold")} onClick={() => setRsiFilter("oversold")}>
                {ar ? "تشبع بيعي (<30)" : "Oversold (<30)"}
              </button>
              <button className={chip(rsiFilter === "neutral")} onClick={() => setRsiFilter("neutral")}>
                {ar ? "منطقة محايدة" : "Neutral band"}
              </button>
              <button className={chip(rsiFilter === "overbought")} onClick={() => setRsiFilter("overbought")}>
                {ar ? "تشبع شرائي (>70)" : "Overbought (>70)"}
              </button>
            </FilterRow>

            <FilterRow label={ar ? "أداء اليوم" : "Today"}>
              <button className={chip(dayMove === "all")} onClick={() => setDayMove("all")}>
                {ar ? "الكل" : "All"}
              </button>
              <button className={chip(dayMove === "up")} onClick={() => setDayMove("up")}>
                {ar ? "صاعد اليوم" : "Up today"}
              </button>
              <button className={chip(dayMove === "down")} onClick={() => setDayMove("down")}>
                {ar ? "هابط اليوم" : "Down today"}
              </button>
            </FilterRow>
          </div>
        ) : null}
      </div>

      {/* Free-tier banner — real results, real counts, honest copy */}
      {gateActive ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2">
          <span className="text-xs font-medium leading-relaxed text-foreground">
            {filtersActive
              ? ar
                ? `تم العثور على ${matched?.total ?? visibleRows.length} شركة تطابق معاييرك${lockedRemaining > 0 ? ` — وإليك أول ${visibleRows.length}` : ""}. التفاصيل الكاملة متاحة مع Pro.`
                : `${matched?.total ?? visibleRows.length} companies match your filters${lockedRemaining > 0 ? ` — showing the first ${visibleRows.length}` : ""}. Full details with Pro.`
              : ar
                ? `التغطية المجانية: ${FREE_SIGNALS_ROWS} شركات بتفاصيل الإشارات الكاملة، والباقي يظهر كشركات مقفولة.`
                : `Free coverage: ${FREE_SIGNALS_ROWS} companies with full signal details, and the rest appear as locked cards.`}
          </span>
          <Button asChild size="sm" variant="link" className="h-auto px-0 text-xs font-semibold">
            <Link href="/premium">{ar ? "ترقية الآن" : "Upgrade now"}</Link>
          </Button>
        </div>
      ) : null}
      {gateActive && upgradeMessage ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{upgradeMessage}</p>
      ) : null}

      {/* ── Sections ──────────────────────────────────────────────────── */}
      {grouped.ready.length === 0 && grouped.watching.length === 0 && grouped.sellPressure.length === 0 && grouped.rest.length === 0 && grouped.locked.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {ar ? "لا توجد نتائج مطابقة للفلاتر الحالية." : "No matches for the current filters."}
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.ready.length > 0 ? (
            <section className="space-y-2.5">
              <SectionHeader
                ar={ar}
                title={ar ? "جاهز الآن" : "Ready now"}
                count={grouped.ready.length}
                hint={
                  ar
                    ? "قراءة اتجاهية عدّت كل البوابات، ومعه خطة تداول بأرقام (دخول / وقف / هدف) ونسبة مخاطرة/عائد لا تقل عن 1.5."
                    : "A directional read that cleared every gate, with a priced plan (entry / stop / target) and a risk-reward of at least 1.5."
                }
                tone="positive"
              />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {grouped.ready.map((r) => (
                  <SignalCard key={r.companyId} row={r} ar={ar} fav={watch.has(r.companyId)} onFav={() => watch.toggle({ id: r.companyId, ticker: r.ticker })} />
                ))}
              </div>
            </section>
          ) : null}

          {grouped.watching.length > 0 ? (
            <section className="space-y-2.5">
              <SectionHeader
                ar={ar}
                title={ar ? "تحت المراقبة" : "Watching"}
                count={grouped.watching.length}
                hint={
                  ar
                    ? "القراءة الاتجاهية موجودة لكن الهيكل السعري واقف في طريقها — مقاومة مُختبرة فوقها أو دعم تحتها. الشرط مكتوب على كل كارت: إغلاق يومي عند مستوى محدد."
                    : "The directional case exists but price structure blocks it — tested resistance above or support below. Each card states its condition: a daily close at a specific level."
                }
                tone="amber"
              />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {grouped.watching.map((r) => (
                  <SignalCard key={r.companyId} row={r} ar={ar} fav={watch.has(r.companyId)} onFav={() => watch.toggle({ id: r.companyId, ticker: r.ticker })} />
                ))}
              </div>
            </section>
          ) : null}

          {grouped.sellPressure.length > 0 ? (
            <section className="space-y-2.5">
              <SectionHeader
                ar={ar}
                title={ar ? "ضغط بيعي — تجنّب أو خروج" : "Sell pressure — avoid or exit"}
                count={grouped.sellPressure.length}
                hint={
                  ar
                    ? "اتجاه وزخم هابطين. البورصة المصرية مش بتسمح بالبيع على المكشوف، فمفيش خطة بيع هنا: دي قراءة خطر للسهم اللي في محفظتك أو تحذير من الشراء."
                    : "Trend and momentum are down. The Egyptian Exchange does not allow short selling, so there is no sell plan here: this is a risk read for names you already hold, or a warning against buying."
                }
                tone="negative"
              />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {grouped.sellPressure.map((r) => (
                  <SignalCard key={r.companyId} row={r} ar={ar} fav={watch.has(r.companyId)} onFav={() => watch.toggle({ id: r.companyId, ticker: r.ticker })} />
                ))}
              </div>
            </section>
          ) : null}

          {grouped.rest.length > 0 ? (
            <section className="space-y-2.5">
              <SectionHeader
                ar={ar}
                title={ar ? "بدون أفضلية" : "No edge"}
                count={grouped.rest.length}
                hint={
                  ar
                    ? "إشارات متعارضة أو زخم ضعيف أو تاريخ سعري غير كافٍ. عدم وجود إشارة نتيجة، مش نقص في البيانات — وده الجزء الأكبر من السوق في أي جلسة."
                    : "Mixed signals, weak momentum or too little price history. No read is itself a result, not a data gap — and it is the bulk of the market on any given session."
                }
                tone="muted"
              />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {grouped.rest.map((r) => (
                  <SignalCard key={r.companyId} row={r} ar={ar} fav={watch.has(r.companyId)} onFav={() => watch.toggle({ id: r.companyId, ticker: r.ticker })} />
                ))}
              </div>
            </section>
          ) : null}

          {grouped.locked.length > 0 ? (
            <section className="space-y-2.5">
              <SectionHeader
                ar={ar}
                title={ar ? "مطابقات مقفولة" : "Locked matches"}
                count={grouped.locked.length}
                hint={
                  ar
                    ? "شركات حقيقية طابقت فلاترك — الاسم والسعر العام ظاهرين، والتحليل المدفوع متقفل."
                    : "Real companies that matched your filters — identity and public price visible, the paid analysis locked."
                }
                tone="muted"
              />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {grouped.locked.map((r) => (
                  <CompanyLockedCard key={r.companyId} row={r} ar={ar} authed={authed} filtersActive={filtersActive} />
                ))}
                {gateActive && lockedRemaining > 0 ? <MoreLockedCard ar={ar} count={lockedRemaining} /> : null}
              </div>
            </section>
          ) : null}
        </div>
      )}

      {/* ── How to read this board — EGX-specific, not boilerplate ─────── */}
      <BoardReadingNotes ar={ar} pricedAsOf={data.pricedAsOf ?? null} scored={data.scored} weakData={data.weakData} />
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-24 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function SectionHeader({
  ar,
  title,
  count,
  hint,
  tone,
}: {
  ar: boolean
  title: string
  count: number
  hint: string
  tone: "positive" | "amber" | "negative" | "muted"
}) {
  const bar =
    tone === "positive" ? "bg-positive" : tone === "amber" ? "bg-amber-500" : tone === "negative" ? "bg-negative" : "bg-muted-foreground/40"
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className={`h-4 w-1 rounded-full ${bar}`} aria-hidden />
        <h2 className="text-sm font-bold tracking-tight text-foreground">{title}</h2>
        <span className="rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold tabular text-muted-foreground">
          {count}
        </span>
      </div>
      <p className="ps-3 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      <span className="sr-only">{ar ? "قسم" : "section"}</span>
    </div>
  )
}

/**
 * The market briefing band. Replaces four identical stat cards with the three
 * things that actually change how the list below should be read: the regime,
 * the breadth, and the mix of published reads. Every number is the board's own
 * aggregate — nothing is modelled here.
 */
function MarketStateBand({
  ar,
  regime,
  breadthPct,
  bullishShare,
  medianScore,
  distribution,
  total,
  scored,
  weakData,
  pricedAsOf,
}: {
  ar: boolean
  regime: MarketRegime
  breadthPct: number | null
  bullishShare: number | null
  medianScore: number | null
  distribution: { buy: number; hold: number; sell: number }
  total: number
  scored: number
  weakData: number
  pricedAsOf: string | null
}) {
  const meta = REGIME_META[regime]
  const cls = REGIME_CLS[regime]
  const buyPct = total > 0 ? (distribution.buy / total) * 100 : 0
  const holdPct = total > 0 ? (distribution.hold / total) * 100 : 0
  const sellPct = total > 0 ? (distribution.sell / total) * 100 : 0

  return (
    <Card className="overflow-hidden p-0">
      <CardContent className="space-y-3 px-4 py-3.5">
        {/* Regime line */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">{ar ? "حالة السوق" : "Market regime"}</span>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold ${cls.pill}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${cls.dot}`} aria-hidden />
              {ar ? meta.labelAr : meta.labelEn}
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {ar ? "آخر جلسة: " : "Last session: "}
            <span dir="ltr" className="tabular">{pricedAsOf ?? "—"}</span>
          </span>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{ar ? meta.noteAr : meta.labelEn}</p>

        {/* Read mix — one proportional bar instead of three separate numbers */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium text-foreground">{ar ? "توزيع القراءات" : "Read mix"}</span>
            <span className="tabular text-muted-foreground" dir="ltr">
              {distribution.buy} / {distribution.hold} / {distribution.sell}
            </span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={ar ? "توزيع القراءات" : "Read distribution"}>
            {total > 0 ? (
              <>
                <div className="h-full bg-positive" style={{ width: `${buyPct}%` }} />
                <div className="h-full bg-amber-500" style={{ width: `${holdPct}%` }} />
                <div className="h-full bg-negative" style={{ width: `${sellPct}%` }} />
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-positive" aria-hidden />{ar ? "شراء" : "Buy"} <span className="tabular text-foreground/80">{distribution.buy}</span></span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />{ar ? "انتظار" : "Wait"} <span className="tabular text-foreground/80">{distribution.hold}</span></span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-negative" aria-hidden />{ar ? "ضغط بيعي" : "Sell pressure"} <span className="tabular text-foreground/80">{distribution.sell}</span></span>
          </div>
        </div>

        {/* Breadth — the EGX-specific context: how much of the market is
            actually participating in the up-move, not just how many names
            scored well. Thin breadth + strong scores = a few crowded names. */}
        <div className="grid gap-3 border-t border-border/50 pt-2.5 sm:grid-cols-3">
          <BreadthTile
            ar={ar}
            label={ar ? "فوق متوسط 20 جلسة" : "Above EMA20"}
            value={breadthPct}
            suffix="%"
            hint={ar ? "اتساع الحركة القصيرة" : "short-term breadth"}
          />
          <BreadthTile
            ar={ar}
            label={ar ? "اتجاه صاعد مؤكد" : "Confirmed uptrend"}
            value={bullishShare !== null ? Math.round(bullishShare * 1000) / 10 : null}
            suffix="%"
            hint={ar ? "EMA20 صاعد + فوق EMA50" : "rising EMA20 + above EMA50"}
          />
          <BreadthTile
            ar={ar}
            label={ar ? "وسيط الدرجات" : "Median score"}
            value={medianScore}
            suffix=""
            hint={ar ? `${scored} مقروءة · ${weakData} بيانات ناقصة` : `${scored} scored · ${weakData} weak data`}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function BreadthTile({ ar, label, value, suffix, hint }: { ar: boolean; label: string; value: number | null; suffix: string; hint: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular text-foreground" dir="ltr">
        {value !== null ? `${value}${suffix}` : "—"}
      </p>
      <p className="text-[10px] leading-relaxed text-muted-foreground">{hint}</p>
      <span className="sr-only">{ar ? "قراءة" : "read"}</span>
    </div>
  )
}

/** Compact plan-lifecycle chip (derived on demand from the lifecycle API).
 *  Free callers receive only { signalState, lifecycleState } — the chip needs
 *  exactly that, so it renders for every tier without leaking paid detail. */
const LIFECYCLE_CLS: Partial<Record<LifecycleState, string>> = {
  watching: "border-border/60 bg-muted/40 text-muted-foreground",
  confirmed: "border-positive/40 bg-positive/10 text-positive",
  invalidated: "border-negative/40 bg-negative/10 text-negative",
  expired: "border-border/60 bg-muted/40 text-muted-foreground",
  active: "border-positive/40 bg-positive/10 text-positive",
  stopped: "border-negative/40 bg-negative/10 text-negative",
  targeted: "border-positive/40 bg-positive/10 text-positive",
}

function LifecycleChip({ companyId, ar, signalState }: { companyId: string; ar: boolean; signalState: "confirmed" | "watching" }) {
  const { data } = useQuery({
    queryKey: ["signal-lifecycle", companyId],
    queryFn: () => api.signalLifecycle(companyId),
    staleTime: 120_000,
    retry: false,
  })
  const state = data?.lifecycleState
  if (!state) return null
  const basis = signalState === "confirmed" ? "confirmed" : "watching"
  const cls = LIFECYCLE_CLS[state] ?? LIFECYCLE_CLS.watching
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[9px] font-semibold ${cls}`}
      title={ar ? "دورة حياة الفرصة/الخطة" : "Plan lifecycle"}
    >
      {lifecycleChipLabel(basis, state, ar, data?.lifecycle?.activation?.date ?? null, data?.lifecycle?.asOf ?? null)}
    </span>
  )
}

/**
 * The card. Hierarchy is deliberate and reads top-to-bottom in the order a
 * trader needs it:
 *   1. WHAT — ticker, tier, name, and the state badge (can I act on this?)
 *   2. WHERE — price and the day's move
 *   3. HOW — the plan (entry / stop / target / R:R), visually the centre.
 *      For a watching row this slot is the ACTIVATION condition instead,
 *      because that is the only actionable number on a blocked setup.
 *   4. WHY — the engine's own strongest reason, one line
 *   5. HOW STRONG — score, then the metric chips (RSI / 1M / volume / range).
 *      Volume sits beside the plan on purpose: on the EGX a level with no
 *      participation behind it is not executable.
 */
function SignalCard({ row, ar, fav, onFav }: { row: MarketSignalRow; ar: boolean; fav: boolean; onFav: () => void }) {
  const m = row.metrics
  const sig = row.signal
  const sigCls = sig ? SIGNAL_CLS[sig] : null
  const tp = row.tradePlan
  const tier = tierShort(row.marketTier)
  const stateBadge = stateBadgeInfo(row, ar)
  const planZone = (low: number, high: number): string => (low === high ? low.toFixed(2) : `${low.toFixed(2)}–${high.toFixed(2)}`)
  return (
    <Card className={`group relative p-0 transition-shadow hover:shadow-md ${sigCls?.ring ?? "border-border/60"}`}>
      <CardContent className="space-y-2.5 px-4 py-3.5">
        {/* 1 — identity + state */}
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
          <div className="flex shrink-0 items-center gap-1">
            {(row.signalState === "watching" || row.signalState === "confirmed") ? (
              <LifecycleChip companyId={row.companyId} ar={ar} signalState={row.signalState} />
            ) : null}
            <button
              onClick={onFav}
              aria-label={ar ? "إضافة للمفضلة" : "Toggle favorite"}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-warning"
            >
              <Star className={`h-4 w-4 ${fav ? "fill-warning text-warning" : ""}`} aria-hidden />
            </button>
          </div>
        </div>

        {/* 2 — price + state badge */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-1.5" dir="ltr">
            <span className="text-lg font-bold tabular text-foreground">{row.lastClose?.toFixed(2) ?? "—"}</span>
            <span className={`flex items-center text-xs font-semibold tabular ${pctCls(row.changePct)}`}>
              {row.changePct !== null && row.changePct > 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : row.changePct !== null && row.changePct < 0 ? <ArrowDownRight className="h-3 w-3" aria-hidden /> : null}
              {pctStr(row.changePct)}
            </span>
          </div>
          {stateBadge ? (
            <Badge variant="outline" className={`shrink-0 gap-1.5 ${stateBadge.cls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${stateBadge.dot}`} aria-hidden />
              {stateBadge.label}
            </Badge>
          ) : sig && sigCls ? (
            <Badge variant="outline" className={`shrink-0 gap-1.5 ${sigCls.badge}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${sigCls.dot}`} aria-hidden />
              {ar ? SIGNAL_META[sig].ar : SIGNAL_META[sig].en}
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0 border-border/40 text-muted-foreground/70">{ar ? "بيانات غير كافية" : "Weak data"}</Badge>
          )}
        </div>

        {/* 3 — the plan is the centre of the card; a watching row shows its
            activation condition in the same slot (the only tradeable number). */}
        {row.signalState === "watching" && row.setup ? (
          <WatchingSetupStrip setup={row.setup} ar={ar} />
        ) : tp ? (
          <PlanGrid ar={ar} tp={tp} planZone={planZone} />
        ) : row.setup ? (
          <WatchingSetupStrip setup={row.setup} ar={ar} />
        ) : sig !== null ? (
          <p className="rounded-lg border border-border/50 bg-muted/20 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
            {ar ? "مفيش منطقة دخول واضحة دلوقتي — استنى إشارة أوضح." : "No clear entry zone right now — wait for a cleaner read."}
          </p>
        ) : null}

        {/* 4 — why (the engine's own strongest line) */}
        {row.reasons[0] ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">{ar ? row.reasons[0].ar : row.reasons[0].en}</p>
        ) : row.limitations[0] ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">{row.limitations[0]}</p>
        ) : null}

        {/* 5 — how strong */}
        {row.score !== null ? <ScoreMeter ar={ar} score={row.score} /> : null}

        <div className="grid grid-cols-4 gap-1.5 text-center">
          <MiniMetric label="RSI" value={m.rsi14 !== null ? m.rsi14.toFixed(0) : "—"} tone={m.rsi14 === null ? "muted" : m.rsi14 > 70 ? "negative" : m.rsi14 < 30 ? "positive" : "muted"} />
          <MiniMetric label={ar ? "شهر" : "1M"} value={pctStr(m.perfM1)} tone={m.perfM1 === null ? "muted" : m.perfM1 > 0 ? "positive" : m.perfM1 < 0 ? "negative" : "muted"} />
          <MiniMetric label={ar ? "حجم" : "Vol×"} value={m.relVol !== null ? `${m.relVol.toFixed(1)}×` : "—"} tone={m.relVol !== null && m.relVol >= 1.5 ? "positive" : "muted"} />
          <MiniMetric label={ar ? "النطاق" : "Range"} value={m.rangePos60 !== null ? `${m.rangePos60.toFixed(0)}%` : "—"} tone="muted" />
        </div>

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

/** The three numbers a plan is made of. Equal columns, tabular figures, the
 *  risk-reward as the footnote that decides whether the geometry is worth it. */
function PlanGrid({
  ar,
  tp,
  planZone,
}: {
  ar: boolean
  tp: NonNullable<MarketSignalRow["tradePlan"]>
  planZone: (low: number, high: number) => string
}) {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        <PlanCell
          label={ar ? "دخول" : "Entry"}
          value={planZone(tp.entryLow, tp.entryHigh)}
          tone="neutral"
        />
        <PlanCell
          label={ar ? "هدف" : "Target"}
          value={planZone(tp.targetLow, tp.targetHigh)}
          sub={`${tp.targetPct.toFixed(1)}%`}
          tone="positive"
        />
        <PlanCell
          label={ar ? "وقف" : "Stop"}
          value={tp.stop.toFixed(2)}
          sub={`${tp.stopPct.toFixed(1)}%`}
          tone="negative"
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {ar ? "مخاطرة/عائد " : "R/R "}
          <span className={`tabular font-semibold ${tp.riskReward >= 2 ? "text-positive" : "text-foreground/80"}`} dir="ltr">{tp.riskReward.toFixed(2)}</span>
        </span>
        <span title={ar ? "النسب محسوبة من منتصف منطقة الدخول — نفس الأساس اللي نسبة المخاطرة/العائد متحسبة عليه" : "Percentages are measured from the entry midpoint — the same basis the R/R uses"}>
          {ar ? "النسب من الدخول" : "from entry"}
        </span>
      </div>
    </div>
  )
}

function PlanCell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: "neutral" | "positive" | "negative" }) {
  const cls =
    tone === "positive"
      ? "border-positive/40 bg-positive/10 text-positive"
      : tone === "negative"
        ? "border-negative/40 bg-negative/10 text-negative"
        : "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400"
  return (
    <div className={`rounded-md border px-1.5 py-1 ${cls}`}>
      <p className="text-[9px] font-medium opacity-80">{label}</p>
      <p className="text-[11px] font-bold tabular" dir="ltr">{value}</p>
      {sub ? <p className="text-[9px] tabular opacity-80" dir="ltr">{sub}</p> : null}
    </div>
  )
}

/** Score with its band made legible: the number alone never told a reader
 *  whether 62 is "just above the buy gate" or "almost perfect". */
function ScoreMeter({ ar, score }: { ar: boolean; score: number }) {
  const band = score >= 62 ? "positive" : score <= 38 ? "negative" : "amber"
  const cls = band === "positive" ? "text-positive" : band === "negative" ? "text-negative" : "text-amber-600 dark:text-amber-400"
  const fill = band === "positive" ? "bg-positive" : band === "negative" ? "bg-negative" : "bg-amber-500"
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">{ar ? "الدرجة الفنية" : "Technical score"}</span>
        <span className={`tabular font-semibold ${cls}`} dir="ltr">{score}/100</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
    </div>
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
            ? "الشركة دي طابقت فلاترك — افتح قراءتها الفنية كاملة: الاتجاه، الدرجة، ومناطق الدخول والخروج ووقف الخسارة."
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
        {ar ? `و ${count} شركة أخرى مطابقة لفلاترك` : `${count} more matched companies`}
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

/**
 * The footnotes that make the board honest on the EGX specifically — written
 * once, at the bottom, instead of repeated inside every card. Each line is a
 * real property of the data or the market, not decoration:
 *   • closing prices only, so intraday claims are not made;
 *   • corporate actions are rebuilt before any indicator runs;
 *   • EGX daily price limits mean a level can gap through without trading;
 *   • outside EGX30 liquidity thins, which is why relative volume is shown;
 *   • public quotes are delayed, and the newest session may be running.
 */
function BoardReadingNotes({
  ar,
  pricedAsOf,
  scored,
  weakData,
}: {
  ar: boolean
  pricedAsOf: string | null
  scored: number
  weakData: number
}) {
  const notes = ar
    ? [
        `المحرك بيقرأ إغلاقات يومية فقط على ${scored} شركة قابلة للقراءة (${weakData} بتاريخ غير كافٍ — بتظهر بدون درجة). عشان كده مفيش أي مطالبة بتداول داخل الجلسة.`,
        "السلسلة السعرية بتُعاد بناؤها عبر توزيعات الأرباح والزيادات وتقسيم الأسهم قبل حساب أي مؤشر، فالفجوة الوهمية على تاريخ الاستحقاق مش موجودة.",
        "السوق المصري عليه حدود يومية لتغير السعر: السهم ممكن يقفل على الحد ولا يتداول عند مستوى الدخول أو الوقف — الخطة احتمالية، مش أمر تنفيذ مضمون.",
        "بره مؤشر EGX30 السيولة بتقل: عشان كده حجم التداول النسبي جنب كل خطة. مستوى فني ممتاز من غير مشاركة مش مستوى قابل للتنفيذ.",
        `الأسعار من مصدر عام متأخر، وآخر جلسة (${pricedAsOf ?? "—"}) ممكن تكون سعر الجلسة الجاري ومش إغلاق نهائي.`,
        "القراءة الفنية مبنية على قواعد مكتوبة وموثقة الأوزان — مش توصية شراء أو بيع، والقرار قرارك.",
      ]
    : [
        `The engine reads daily closes only, across ${scored} scoreable companies (${weakData} with insufficient history — shown without a score), so no intraday claim is ever made.`,
        "The price series is rebuilt across dividends, bonus shares and splits before any indicator runs, so an ex-date is never mistaken for a real gap.",
        "The Egyptian market applies daily price limits: a name can close at its limit and never trade at your entry or stop — a plan is a probability, not a guaranteed fill.",
        "Outside EGX30 liquidity thins, which is why relative volume sits beside every plan: a clean level with no participation is not an executable level.",
        `Quotes come from a delayed public source, and the newest session (${pricedAsOf ?? "—"}) may carry the running session's price rather than a final close.`,
        "The technical read is rule-based with documented weights — not a buy or sell recommendation. The decision stays yours.",
      ]
  return (
    <details className="group rounded-xl border border-border/60 bg-card/40 p-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-semibold text-foreground">
        <Info className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        {ar ? "إزاي تقرأ اللوحة دي" : "How to read this board"}
        <ChevronDown className="ms-auto h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <ul className="mt-2 space-y-1.5 ps-1">
        {notes.map((n, i) => (
          <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
            <span>{n}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}
