"use client"

// /signals — the REBUILT technical signals board (tech-signals@6).
//
// 2026-11-15 full rebuild per the owner's product spec. What changed vs the
// old board (tech-signals@5 + opportunity layer):
//   • ONE coherent engine (src/lib/signals/*) instead of the stacked layers —
//     the same engine that enforces the plan-math invariants server-side
//     (stop < entry, target1 > live close, RR exact) builds what you see here.
//   • FOUR states, exactly the trading reality of an EGX investor:
//       شراء    — conditions met and executable (a real plan backs every level);
//       قرب التفعيل — a promising setup whose entry condition is still pending
//                     (activation level + provisional levels, labeled تقديري);
//       انتظار  — nothing publishable (never manufactured);
//       خروج    — close an existing LONG. Never a short-selling call (the EGX
//                 has no short selling and the board never offers one).
//   • BUY CARDS LEAD. The most important opportunities are the first thing on
//     the page; everything else lives below in a sortable table.
//   • DETAIL ON DEMAND: the summary stays light — full evidence, level bases,
//     invalidation and data quality open per row, not on the board.
//   • HONESTY kept: the session date travels with every row (delayed public
//     quotes), liquidity sits next to every plan, locked rows (free tier)
//     show identity + price only — the paid analysis never reaches the browser.

import { useMemo, useState } from "react"
import Link from "next/link"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  Crosshair,
  Lock,
  LogOut,
  MinusCircle,
  RefreshCw,
  Search,
  TrendingUp,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/client/api"
import { usePlan } from "@/lib/client/subscription"
import { useI18n } from "@/lib/i18n"
import { LiveMarketBadge } from "./live-market-badge"
import { useMarketLive } from "./use-market-live"
import { LevelStrip, WarningsStrip, EvidenceList } from "./signal-v2-bits"
import { TIER_AR } from "@/lib/market/tiers"
import {
  OPPORTUNITY_TYPE_AR,
  OPPORTUNITY_TYPE_EN,
  THIN_TRADED_VALUE_EGP,
  type SignalState,
} from "@/lib/signals/types"
import type { BoardRow, GatedRowV2, SignalsBoardResponse } from "@/lib/signals/board-service"

type StateFilter = "all" | SignalState
type TierFilter = "all" | "EGX30" | "EGX70" | "MAIN"
type SortKey = "score" | "change" | "ticker" | "rr"

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—"
  return v.toFixed(digits)
}

function pctStr(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—"
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`
}

function pctCls(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "text-muted-foreground"
  return v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-muted-foreground"
}

function isLocked(r: BoardRow): r is GatedRowV2 {
  return "locked" in r && r.locked
}

const STATE_META: Record<SignalState, { ar: string; en: string; chipCls: string; dotCls: string }> = {
  buy: { ar: "شراء", en: "Buy", chipCls: "bg-positive/15 text-positive border-positive/30", dotCls: "bg-positive" },
  near: { ar: "قرب التفعيل", en: "Near activation", chipCls: "bg-amber-500/15 text-amber-500 border-amber-500/30", dotCls: "bg-amber-500" },
  wait: { ar: "انتظار", en: "Wait", chipCls: "bg-muted text-muted-foreground border-border", dotCls: "bg-muted-foreground" },
  exit: { ar: "خروج", en: "Exit", chipCls: "bg-negative/15 text-negative border-negative/30", dotCls: "bg-negative" },
}

/** liquidity disclosure next to plans — thin EGX liquidity kills execution */
function liquidityLabel(liq: string, ar: boolean): string {
  switch (liq) {
    case "liquid":
      return ar ? "سيولة نشطة" : "Liquid"
    case "normal":
      return ar ? "سيولة طبيعية" : "Normal liquidity"
    case "thin":
      return ar ? "سيولة ضعيفة" : "Thin liquidity"
    default:
      return ar ? "سيولة غير معلومة" : "Liquidity unknown"
  }
}

function ageLabel(sessions: number | null, ar: boolean): string {
  if (sessions === null) return ar ? "جلسة غير معلومة" : "unknown age"
  if (sessions === 0) return ar ? "بيانات اليوم" : "today's data"
  if (sessions === 1) return ar ? "متأخرة جلسة واحدة" : "1 session old"
  return ar ? `متأخرة ${sessions} جلسات` : `${sessions} sessions old`
}

// ---------------------------------------------------------------------------
// Level strip + warnings strip live in ./signal-v2-bits (shared with the
// company technical tab so every surface renders the same plan block).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Row detail — the on-demand technical panel (evidence / bases / invalidation)
// ---------------------------------------------------------------------------

function RowDetail({ row, ar }: { row: Exclude<BoardRow, GatedRowV2>; ar: boolean }) {
  const m = row.metrics
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{ar ? "أدلة الإشارة (كل نقطة موثقة)" : "Signal evidence (every point documented)"}</div>
        <EvidenceList items={row.evidence} ar={ar} />
        {(row.warnings?.length ?? 0) > 0 ? (
          <div className="mt-3">
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{ar ? "تحذيرات مصاحبة (من البيانات المعلنة)" : "Disclosed warnings (from published data)"}</div>
            <WarningsStrip warnings={row.warnings} ar={ar} />
          </div>
        ) : null}
      </div>
      <div className="space-y-3">
        {(row.plan || row.setup) && (
          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{ar ? "أساس المستويات" : "Level bases"}</div>
            <ul className="space-y-1 text-sm leading-relaxed text-muted-foreground">
              {row.plan ? (
                <>
                  <li>• {ar ? "الدخول:" : "Entry:"} {fmt(row.plan.entryLow)}–{fmt(row.plan.entryHigh)}</li>
                  <li>• {ar ? "الوقف:" : "Stop:"} {row.plan.stopBasisAr}</li>
                  <li>• {ar ? "الهدف الأول:" : "Target 1:"} {row.plan.target1BasisAr}</li>
                  {row.plan.target2 && row.plan.target2BasisAr ? <li>• {ar ? "الهدف الثاني:" : "Target 2:"} {row.plan.target2BasisAr}</li> : null}
                </>
              ) : row.setup ? (
                <>
                  <li>• {row.setup.activationAr}</li>
                  <li>• {ar ? "الوقف التقديري:" : "Provisional stop:"} {row.setup.provisional.stopBasisAr}</li>
                  <li>• {ar ? "الهدف الأول التقديري:" : "Provisional target 1:"} {row.setup.provisional.target1BasisAr}</li>
                </>
              ) : null}
            </ul>
          </div>
        )}
        {row.invalidationAr ? (
          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{ar ? "إلغاء السيناريو" : "Scenario invalidation"}</div>
            <div className="rounded-md border border-negative/30 bg-negative/5 px-3 py-2 text-sm leading-relaxed text-negative">{row.invalidationAr}</div>
          </div>
        ) : null}
        <div>
          <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{ar ? "مؤشرات وسيولة وجودة بيانات" : "Metrics, liquidity & data quality"}</div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {m?.rsi14 !== null && m?.rsi14 !== undefined ? <Badge variant="outline">RSI {fmt(m.rsi14, 0)}</Badge> : null}
            {m?.ema20 !== null && m?.ema20 !== undefined ? <Badge variant="outline">EMA20 {fmt(m.ema20)}</Badge> : null}
            {m?.ema50 !== null && m?.ema50 !== undefined ? <Badge variant="outline">EMA50 {fmt(m.ema50)}</Badge> : null}
            {m?.relVol !== null && m?.relVol !== undefined ? <Badge variant="outline">{ar ? "حجم" : "RelVol"} ×{fmt(m.relVol)}</Badge> : null}
            {m?.perfM1 !== null && m?.perfM1 !== undefined ? <Badge variant="outline">{ar ? "شهر" : "1M"} {pctStr(m.perfM1, 1)}</Badge> : null}
            {m?.perfM3 !== null && m?.perfM3 !== undefined ? <Badge variant="outline">{ar ? "3 أشهر" : "3M"} {pctStr(m.perfM3, 1)}</Badge> : null}
            {m?.atr14 !== null && m?.atr14 !== undefined ? <Badge variant="outline">ATR {fmt(m.atr14)}</Badge> : null}
            <Badge variant="outline">{liquidityLabel(row.quality.liquidity, ar)}</Badge>
            {row.quality.avgTradedValueEgp !== null ? (
              <Badge variant="outline">
                {ar ? "متوسط التداول اليومي" : "avg daily value"}:{" "}
                {row.quality.avgTradedValueEgp >= THIN_TRADED_VALUE_EGP
                  ? `${(row.quality.avgTradedValueEgp / 1_000_000).toFixed(1)}M ${ar ? "ج" : "EGP"}`
                  : `${Math.round(row.quality.avgTradedValueEgp / 1000).toLocaleString(ar ? "ar-EG" : "en-GB")}K ${ar ? "ج" : "EGP"}`}
              </Badge>
            ) : null}
            <Badge variant="outline">{ageLabel(row.quality.dataAgeSessions, ar)}</Badge>
            <Badge variant="outline">{ar ? "جلسات التاريخ" : "history"}: {row.quality.bars}</Badge>
          </div>
          {row.quality.notesAr.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {row.quality.notesAr.map((n, i) => (
                <li key={i}>• {n}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Opportunity card (buy / near / exit) — the prominent lead of the page
// ---------------------------------------------------------------------------

function OpportunityCard({ row, ar }: { row: Exclude<BoardRow, GatedRowV2>; ar: boolean }) {
  const [open, setOpen] = useState(false)
  const meta = STATE_META[row.state]
  const isBuy = row.state === "buy"
  const isExit = row.state === "exit"
  const borderCls = isBuy ? "border-positive/40" : row.state === "near" ? "border-amber-500/40" : "border-negative/40"
  return (
    <Card className={`border-2 ${borderCls}`}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <Link href={`/company/${row.companyId}?tab=technical`} className="flex items-baseline gap-2 text-base font-bold text-foreground hover:text-primary">
              {row.ticker}
              <span className="text-xs font-normal text-muted-foreground">{ar ? (row.nameAr ?? row.nameEn) : row.nameEn}</span>
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.chipCls}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dotCls}`} />
                {ar ? meta.ar : meta.en}
              </span>
              {row.type ? (
                <Badge variant="outline" className="text-xs">
                  {ar ? OPPORTUNITY_TYPE_AR[row.type] : OPPORTUNITY_TYPE_EN[row.type]}
                </Badge>
              ) : null}
              {row.marketTier && row.marketTier !== "MAIN" ? (
                <Badge variant="outline" className="text-xs">
                  {TIER_AR[row.marketTier]?.short ?? row.marketTier}
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="text-end">
            {/* ① owner mandate: this number is the stock's CURRENT price (last
                stored close from the market feed) — labeled as such so it can
                never be mistaken for an entry level; it refreshes on the
                15-minute board cycle. */}
            <div className="text-[10px] font-medium text-muted-foreground">{ar ? "السعر الحالي" : "Current price"}</div>
            <div className="text-lg font-bold tabular-nums text-foreground">{fmt(row.lastClose)}</div>
            <div className={`text-xs font-semibold tabular-nums ${pctCls(row.changePct)}`}>
              {row.changePct !== null ? (
                <>
                  {row.changePct > 0 ? <ArrowUpRight className="inline h-3 w-3" /> : row.changePct < 0 ? <ArrowDownRight className="inline h-3 w-3" /> : null}
                  {pctStr(row.changePct)}
                </>
              ) : (
                "—"
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {ar ? "القوة" : "Score"} {fmt(row.score, 0)}
            </div>
          </div>
        </div>

        <div className="mt-3">
          {row.plan ? (
            <LevelStrip plan={row.plan} ar={ar} />
          ) : row.setup ? (
            <LevelStrip plan={row.setup.provisional} provisional={true} ar={ar} />
          ) : isExit ? (
            <div className="rounded-md border border-negative/30 bg-negative/5 px-3 py-2 text-sm text-negative">
              {ar ? "إغلاق مركز شراء قائم عند/بعد الكسر — ليست دعوة للبيع على المكشوف (غير متاح في EGX)" : "Close an existing long — not a short-selling call (unavailable on EGX)"}
            </div>
          ) : null}
        </div>

        {(row.warnings?.length ?? 0) > 0 ? (
          <div className="mt-2">
            <WarningsStrip warnings={row.warnings} ar={ar} compact={true} />
          </div>
        ) : null}

        {row.evidence.length > 0 ? (
          <div className="mt-3 border-t border-border/60 pt-2">
            <EvidenceList items={row.evidence.slice(0, isBuy ? 3 : 2)} ar={ar} />
          </div>
        ) : null}

        <div className="mt-2 flex items-center justify-between">
          <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            {ar ? "التفاصيل الفنية" : "Technical details"}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          <span className="text-[11px] text-muted-foreground">
            {ar ? "آخر تحديث" : "as of"} {row.asOf ?? "—"}
          </span>
        </div>
        {open ? (
          <div className="mt-3 border-t border-border/60 pt-3">
            <RowDetail row={row} ar={ar} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Table row expand (the full-universe section)
// ---------------------------------------------------------------------------

function BoardTableRow({ row, ar, expanded, onToggle }: { row: BoardRow; ar: boolean; expanded: boolean; onToggle: () => void }) {
  const locked = isLocked(row)
  const meta = locked ? null : STATE_META[row.state]
  const plan = locked ? null : row.plan
  const prov = locked ? null : row.setup?.provisional ?? null
  const warnCount = locked ? 0 : (row.warnings?.length ?? 0)
  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/40" onClick={onToggle}>
        <TableCell className="whitespace-nowrap font-bold">
          {locked ? row.ticker : <Link href={`/company/${row.companyId}?tab=technical`} className="hover:text-primary">{row.ticker}</Link>}
          {warnCount > 0 ? <AlertTriangle className="ms-1 inline h-3 w-3 text-amber-500" aria-label={ar ? "تحذيرات مصاحبة" : "warnings"} /> : null}
        </TableCell>
        <TableCell>
          {meta ? (
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.chipCls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dotCls}`} />
              {ar ? meta.ar : meta.en}
            </span>
          ) : (
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="tabular-nums">{fmt(row.lastClose)}</TableCell>
        <TableCell className={`tabular-nums ${pctCls(row.changePct)}`}>{pctStr(row.changePct)}</TableCell>
        <TableCell className="tabular-nums">{locked ? "—" : fmt(row.score, 0)}</TableCell>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{locked ? "—" : row.type ? (ar ? OPPORTUNITY_TYPE_AR[row.type] : OPPORTUNITY_TYPE_EN[row.type]) : "—"}</TableCell>
        <TableCell className="whitespace-nowrap tabular-nums">{plan ? fmt(plan.entryLow) : prov ? `${fmt(prov.entryLow)}~` : "—"}</TableCell>
        <TableCell className="whitespace-nowrap tabular-nums text-negative">{plan ? fmt(plan.stop) : prov ? `${fmt(prov.stop)}~` : "—"}</TableCell>
        <TableCell className="whitespace-nowrap tabular-nums text-positive">{plan ? fmt(plan.target1) : prov ? `${fmt(prov.target1)}~` : "—"}</TableCell>
        <TableCell className="tabular-nums text-positive">{(plan?.target1ReturnPct ?? prov?.target1ReturnPct) != null ? pctStr(plan?.target1ReturnPct ?? prov?.target1ReturnPct, 1) : "—"}</TableCell>
        <TableCell className="tabular-nums">{(plan?.riskReward ?? prov?.riskReward) ? fmt(plan?.riskReward ?? prov?.riskReward) : "—"}</TableCell>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{row.asOf ?? "—"}</TableCell>
        <TableCell className="w-6">
          {!locked ? <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} /> : null}
        </TableCell>
      </TableRow>
      {expanded && !locked ? (
        <TableRow>
          <TableCell colSpan={13} className="bg-muted/20 p-4">
            <RowDetail row={row} ar={ar} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export function SignalsView() {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const { isPremium: isPaid } = usePlan()
  const { status: liveStatus, lastUpdated: liveUpdated } = useMarketLive([])

  const [stateFilter, setStateFilter] = useState<StateFilter>("all")
  const [tier, setTier] = useState<TierFilter>("all")
  const [sector, setSector] = useState<string>("all")
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<SortKey>("score")
  const [expanded, setExpanded] = useState<string | null>(null)

  const [refreshNonce, setRefreshNonce] = useState(0)
  const query = useMemo(() => {
    const sp = new URLSearchParams()
    if (stateFilter !== "all") sp.set("signal", stateFilter)
    if (tier !== "all") sp.set("tier", tier)
    if (sector !== "all") sp.set("sector", sector)
    if (q.trim()) sp.set("q", q.trim())
    sp.set("sort", sort)
    // cache-buster: bumping refreshNonce changes the URL (and the queryKey)
    // so the post-sync refetch can never be served from the browser's
    // max-age=60 HTTP cache nor keyed to the previous board
    if (refreshNonce) sp.set("t", String(refreshNonce))
    return sp.toString()
  }, [stateFilter, tier, sector, q, sort, refreshNonce])

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["signals-board-v2", query],
    queryFn: () => api.technicalSignals(query),
    staleTime: 5 * 60_000,
    // ① owner mandate 2026-11-16: the price on every card is the stock's real
    // price and must move on its own — refetch every 15 minutes.
    refetchInterval: 15 * 60_000,
    // ③ owner complaint: typing in the search box MUST NOT blank the page —
    // the previous rows stay on screen while the filtered fetch runs.
    placeholderData: keepPreviousData,
  })

  // ④ the refresh button must actually refresh: nudge the server-side market
  // pull first (rate-limited public endpoint — a successful sync also
  // invalidates the server caches), THEN bump the nonce: the queryKey change
  // forces a network fetch of the REBUILT board (no-store client side, cache
  // invalidated server side) — not the same 10-minute-old rows.
  const [sessionRefreshing, setSessionRefreshing] = useState(false)
  const handleSessionRefresh = async () => {
    setSessionRefreshing(true)
    try {
      await fetch("/api/v1/market/sync", { method: "POST" }).catch(() => null)
      setRefreshNonce((n) => n + 1)
    } finally {
      setSessionRefreshing(false)
    }
  }

  // client-side re-sort mirrors the server sort keys (the server already ran
  // the same engine, so this only re-orders the rows the caller can see)
  const rows = useMemo(() => {
    const base = [...(data?.rows ?? [])]
    const rrOf = (r: BoardRow): number => (isLocked(r) ? -1 : (r.plan?.riskReward ?? r.setup?.provisional.riskReward ?? -1))
    switch (sort) {
      case "change":
        base.sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999))
        break
      case "ticker":
        base.sort((a, b) => a.ticker.localeCompare(b.ticker))
        break
      case "rr":
        base.sort((a, b) => rrOf(b) - rrOf(a))
        break
      default:
        break
    }
    return base
  }, [data, sort])

  const buyRows = useMemo(() => rows.filter((r) => !isLocked(r) && r.state === "buy") as Exclude<BoardRow, GatedRowV2>[], [rows])
  const nearRows = useMemo(() => rows.filter((r) => !isLocked(r) && r.state === "near") as Exclude<BoardRow, GatedRowV2>[], [rows])
  const exitRows = useMemo(() => rows.filter((r) => !isLocked(r) && r.state === "exit") as Exclude<BoardRow, GatedRowV2>[], [rows])
  const summary = data?.summary
  const showUpgrade = !isPaid && (data?.lockedRemaining ?? 0) > 0

  if (isLoading) {
    return (
      <div className="space-y-3 py-4">
        <Skeleton className="h-8 w-64" />
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-28" />
          ))}
        </div>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <Card className="my-6 border-negative/30">
        <CardContent className="p-4 text-sm text-negative">
          {error instanceof Error ? error.message : "Failed to load signals"}
          <Button variant="outline" size="sm" className="ms-3" onClick={() => void refetch()}>
            <RefreshCw className="h-3.5 w-3.5" /> {ar ? "إعادة" : "Retry"}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const chip = (key: StateFilter, count: number) => {
    const meta = key === "all" ? null : STATE_META[key]
    const label = key === "all" ? (ar ? "الكل" : "All") : ar ? meta!.ar : meta!.en
    const active = stateFilter === key
    return (
      <button
        key={key}
        type="button"
        onClick={() => setStateFilter(key)}
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
          active ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"
        }`}
      >
        {meta ? <span className={`h-2 w-2 rounded-full ${meta.dotCls}`} /> : null}
        {label}
        <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{count}</span>
      </button>
    )
  }

  return (
    <div className="py-4">
      {/* ---- header ---- */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-foreground">{ar ? "الإشارات الفنية — نشرة الجلسة" : "Technical Signals — Session Board"}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {ar
              ? "محرك قواعد ثابت على أسعار حقيقية — كل رقم بإثباته، ولا فرص عند غيابها. ليست توصية استثمارية."
              : "A deterministic rules engine over real prices — every number cited, opportunities never manufactured. Not investment advice."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LiveMarketBadge ar={ar} on={[]} status={liveStatus} lastUpdated={liveUpdated} />
          <Badge variant="outline" className="text-[11px]">{data.version}</Badge>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => void handleSessionRefresh()}
            disabled={isRefetching || sessionRefreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefetching || sessionRefreshing ? "animate-spin" : ""}`} />
            {sessionRefreshing ? (ar ? "جارٍ تحديث الجلسة…" : "Refreshing session…") : ar ? "تحديث الجلسة" : "Refresh"}
          </Button>
        </div>
      </div>

      {/* ---- freshness + coverage band ---- */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {ar ? "آخر جلسة معروضة" : "last session"}: <span className="font-semibold text-foreground">{data.asOf ?? "—"}</span>
        </span>
        <span>
          {ar ? "التغطية" : "coverage"}: <span className="font-semibold text-foreground">{data.scored}</span>/{data.universe} {ar ? "شركة" : "companies"}
        </span>
        {data.breadthAboveEma50Pct !== null ? (
          <span>
            {ar ? "نسبة فوق EMA50" : "above EMA50"}: <span className="font-semibold text-foreground">{data.breadthAboveEma50Pct}%</span>
          </span>
        ) : null}
        {data.computedAt ? (
          <span>
            {ar ? "حُسبت" : "computed"}: {new Date(data.computedAt).toLocaleString(ar ? "ar-EG" : "en-GB", { dateStyle: "short", timeStyle: "short" })}
          </span>
        ) : null}
        <span>{ar ? "الأسعار تتحدث تلقائيًا كل 15 دقيقة أثناء الجلسة" : "prices refresh automatically every 15 minutes during the session"}</span>
      </div>

      {/* ---- summary chips (counts are public even for free callers) ---- */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {chip("all", data.rows.length)}
        {chip("buy", summary?.buy ?? 0)}
        {chip("near", summary?.near ?? 0)}
        {chip("exit", summary?.exit ?? 0)}
        {chip("wait", summary?.wait ?? 0)}
      </div>

      {showUpgrade ? (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5 text-primary" />
          {data.upgradeHint?.message ?? (ar ? "باقي الشركات مقفلة — تحتاج باقة Pro للتفاصيل." : "Locked rows need Pro.")}
          <span className="tabular-nums font-semibold text-foreground">+{data.lockedRemaining}</span>
        </div>
      ) : null}

      {/* ---- BUY first ---- */}
      {buyRows.length > 0 ? (
        <section className="mb-5">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-positive">
            <TrendingUp className="h-4 w-4" />
            {ar ? `فرص شراء متحققة (${buyRows.length})` : `Confirmed buy opportunities (${buyRows.length})`}
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {buyRows.map((r) => (
              <OpportunityCard key={r.companyId} row={r} ar={ar} />
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- NEAR activation ---- */}
      {nearRows.length > 0 ? (
        <section className="mb-5">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-500">
            <Crosshair className="h-4 w-4" />
            {ar ? `قرب التفعيل — جاهزة للمراقبة (${nearRows.length})` : `Near activation — watchlist (${nearRows.length})`}
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {nearRows.map((r) => (
              <OpportunityCard key={r.companyId} row={r} ar={ar} />
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- EXIT (close long — never a short) ---- */}
      {exitRows.length > 0 ? (
        <section className="mb-5">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-negative">
            <LogOut className="h-4 w-4" />
            {ar ? `إشارات خروج من مراكز شراء (${exitRows.length})` : `Exit signals for open longs (${exitRows.length})`}
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {exitRows.map((r) => (
              <OpportunityCard key={r.companyId} row={r} ar={ar} />
            ))}
          </div>
        </section>
      ) : null}

      {buyRows.length === 0 && nearRows.length === 0 && exitRows.length === 0 ? (
        <div className="mb-5 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
          <MinusCircle className="h-4 w-4" />
          {ar
            ? "لا توجد فرص مؤهلة اليوم وفق المعايير — هذا طبيعي ولا يتم تصنيع إشارات عند غيابها. الجدول أدناه يعرض القراءة الكاملة لكل الأسهم."
            : "No qualifying opportunities today — that is a normal market state, and no signals are manufactured. The table below carries the full universe read."}
        </div>
      ) : null}

      {/* ---- full-universe table ---- */}
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-foreground">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          {ar ? "جدول السوق الكامل" : "Full market table"}
        </h3>

        {/* filters — four primary controls */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-[220px]">
            <Search className="absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? "بحث بالاسم أو الكود" : "Search ticker or name"} className="h-8 ps-7 text-sm" />
          </div>
          <Select value={tier} onValueChange={(v) => setTier(v as TierFilter)}>
            <SelectTrigger className="h-8 w-[130px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{ar ? "كل الطبقات" : "All tiers"}</SelectItem>
              <SelectItem value="EGX30">{TIER_AR["EGX30"]?.short ?? "EGX30"}</SelectItem>
              <SelectItem value="EGX70">{TIER_AR["EGX70"]?.short ?? "EGX70"}</SelectItem>
              <SelectItem value="MAIN">{ar ? "السوق الرئيسي" : "Main market"}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sector} onValueChange={setSector}>
            <SelectTrigger className="h-8 w-[170px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">{ar ? "كل القطاعات" : "All sectors"}</SelectItem>
              {(data.sectors ?? []).map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="h-8 w-[150px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="score">{ar ? "الأقوى أولاً" : "Score first"}</SelectItem>
              <SelectItem value="change">{ar ? "الأكثر تغيرًا" : "Top movers"}</SelectItem>
              <SelectItem value="rr">{ar ? "الأعلى عائد/مخاطرة" : "Best R/R"}</SelectItem>
              <SelectItem value="ticker">{ar ? "أبجديًا" : "Alphabetical"}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky start-0 bg-background">{ar ? "السهم" : "Ticker"}</TableHead>
                <TableHead>{ar ? "الحالة" : "State"}</TableHead>
                <TableHead>{ar ? "السعر" : "Price"}</TableHead>
                <TableHead>{ar ? "التغير" : "Chg"}</TableHead>
                <TableHead>{ar ? "القوة" : "Score"}</TableHead>
                <TableHead>{ar ? "النمط" : "Setup"}</TableHead>
                <TableHead>{ar ? "دخول" : "Entry"}</TableHead>
                <TableHead>{ar ? "وقف" : "Stop"}</TableHead>
                <TableHead>{ar ? "هدف 1" : "T1"}</TableHead>
                <TableHead>{ar ? "العائد" : "Return"}</TableHead>
                <TableHead>R/R</TableHead>
                <TableHead>{ar ? "تحديث" : "As of"}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <BoardTableRow
                  key={r.companyId}
                  row={r}
                  ar={ar}
                  expanded={expanded === r.companyId}
                  onToggle={() => setExpanded((v) => (v === r.companyId ? null : r.companyId))}
                />
              ))}
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={13} className="py-6 text-center text-sm text-muted-foreground">
                    {ar ? "لا نتائج مطابقة للفلاتر الحالية" : "No rows match the current filters"}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {ar
            ? "المستويات المسبوقة بـ ~ تقديرية (قرب التفعيل) وتُعاد كتابتها عند تحقق الشرط. العائد والمخاطرة أرقام تقريبية محسوبة من متوسط نطاق الدخول إلى الهدف الأول/وقف الخسارة ولا تشمل العمولات أو فروق التنفيذ. علامة ⚠ تعني وجود تحذير مصاحب (أساسيات أو سيولة) موثق في تفاصيل الصف. EGX تفرض حدود تذبذب يومية فقد يفتح السعر فوق/تحت مستوى دون تداوله؛ الأسعار أسعار عامة مؤجلة وليست توصية استثمارية."
            : "Levels prefixed with ~ are provisional (near activation) and are rewritten when the trigger fires. Return/risk figures are approximate, computed from the entry-band mid to target 1 / the stop, excluding fees and slippage. A ⚠ marker means a disclosed warning (fundamentals or liquidity) documented in the row detail. EGX daily price limits can gap through a level without trading it; quotes are delayed public prices, not investment advice."}
        </p>
      </section>
    </div>
  )
}
