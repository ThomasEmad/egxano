"use client"

// /signals — market-wide technical signals board.
//
// ZBorsa-style reading surface built on EGXANO's own deterministic engine:
// rule-based confluence score (trend/momentum/volume/risk, documented weights),
// a buy/wait/sell-press READING (disclosed as a rule output, not advice),
// trading-style fit tags, and live filters. Every number traces to the
// close-based engine in src/lib/technical/signals.ts.

import { useMemo, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
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
import { api } from "@/lib/client/api"
import { useI18n } from "@/lib/i18n"
import { useWatchlist } from "@/lib/client/watchlist"
import { useMarketLive } from "./use-market-live"
import { SIGNAL_META, STYLE_TAG_META, type TechSignalType, type TechStyleTag } from "@/lib/technical/signals"
import type { MarketSignalRow } from "@/lib/technical/signals-service"

type SignalFilter = "all" | "buy" | "hold" | "sell" | "fav"
type StyleFilter = "all" | TechStyleTag
type RsiFilter = "all" | "oversold" | "neutral" | "overbought"
type LiquidityFilter = "all" | "high" | "normal"
type DayMoveFilter = "all" | "up" | "down"
type SortKey = "score" | "change" | "perfM1" | "rsi" | "relVol"

function pctStr(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "—"
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`
}

function pctCls(v: number | null | undefined): string {
  if (v === null || v === undefined) return "text-muted-foreground"
  return v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-muted-foreground"
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

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["technical-signals"],
    queryFn: () => api.technicalSignals(),
    staleTime: 120_000,
  })

  // While EGX is in session the board follows the price refresh cadence.
  useMarketLive(["technical-signals"])

  const [signalFilter, setSignalFilter] = useState<SignalFilter>("all")
  const [styleFilter, setStyleFilter] = useState<StyleFilter>("all")
  const [rsiFilter, setRsiFilter] = useState<RsiFilter>("all")
  const [liquidity, setLiquidity] = useState<LiquidityFilter>("all")
  const [dayMove, setDayMove] = useState<DayMoveFilter>("all")
  const [sector, setSector] = useState("")
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<SortKey>("score")

  const rows = data?.rows ?? []

  const sectors = useMemo(
    () => [...new Set(rows.map((r) => r.sector))].sort((a, b) => a.localeCompare(b)),
    [rows]
  )

  const counts = useMemo(() => {
    const c = { all: rows.length, buy: 0, hold: 0, sell: 0, fav: 0 }
    for (const r of rows) {
      if (r.signal) c[r.signal]++
      if (watch.has(r.companyId)) c.fav++
    }
    return c
  }, [rows, watch.items])

  const filtered = useMemo(() => {
    let list = rows
    if (signalFilter === "fav") list = list.filter((r) => watch.has(r.companyId))
    else if (signalFilter !== "all") list = list.filter((r) => r.signal === signalFilter)
    if (styleFilter !== "all") list = list.filter((r) => r.styleFits.some((f) => f.tag === styleFilter))
    if (rsiFilter !== "all" && rsiFilter !== "neutral") list = list.filter((r) => r.metrics.rsi14 !== null && (rsiFilter === "oversold" ? r.metrics.rsi14 < 30 : r.metrics.rsi14 > 70))
    if (rsiFilter === "neutral") list = list.filter((r) => r.metrics.rsi14 !== null && r.metrics.rsi14 >= 30 && r.metrics.rsi14 <= 70)
    if (liquidity === "high") list = list.filter((r) => r.metrics.relVol !== null && r.metrics.relVol >= 1.5)
    if (liquidity === "normal") list = list.filter((r) => r.metrics.relVol === null || r.metrics.relVol < 1.5)
    if (dayMove === "up") list = list.filter((r) => (r.changePct ?? 0) > 0)
    if (dayMove === "down") list = list.filter((r) => (r.changePct ?? 0) < 0)
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
  }, [rows, signalFilter, styleFilter, rsiFilter, liquidity, dayMove, sector, q, sort, watch.items])

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
              ? "قراءة قواعدية حتمية لكل الأسهم المتداولة من بيانات الأسعار الحقيقية — مؤشرات الاتجاه والزخم والحجم والتقلب تُدمج في درجة واحدة موثقة الأوزان. الإشارة قراءة فنية قابلة للتحقق — وليست توصية استثمارية."
              : "A deterministic rule-based reading of every traded name from real price data — trend, momentum, volume and volatility indicators merge into one documented score. The signal is a verifiable technical reading — not an investment recommendation."}
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
            data.pctAboveSma20 !== null
              ? ar
                ? `${data.pctAboveSma20}% من الأسهم فوق متوسط 20 جلسة`
                : `${data.pctAboveSma20}% of names above their SMA20`
              : ar ? "اتساع فني" : "technical breadth"
          }
        />
      </div>

      {/* Style chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{ar ? "أسلوب التداول:" : "Trading style:"}</span>
        <button className={chip(styleFilter === "all")} onClick={() => setStyleFilter("all")}>
          {ar ? "كل الأنماط" : "All styles"}
        </button>
        {(["day", "swing", "trend", "reversal"] as TechStyleTag[]).map((st) => {
          const n = rows.filter((r) => r.styleFits.some((f) => f.tag === st)).length
          return (
            <button key={st} className={chip(styleFilter === st)} onClick={() => setStyleFilter(st)}>
              {ar ? STYLE_TAG_META[st].ar : STYLE_TAG_META[st].en}
              <span className="ms-1 tabular opacity-80">{n}</span>
            </button>
          )
        })}
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
      {data.weakData > 0 || data.rows.some((r) => r.limitations.length > 0) ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {ar
            ? `الشفافية: الحساب يعمل على أسعار الإغلاق اليومية من مسح السوق (${data.scored} شركة قابلة للقراءة، ${data.weakData} بتاريخ غير كافٍ — تظهر بدون درجة). الجلسات القليلة الأخيرة قد تكون بسعر الجلسة الجاري وليس إغلاقًا نهائيًا.`
            : `Transparency: the engine runs on daily closing prices from the market scan (${data.scored} scored, ${data.weakData} with insufficient history — shown without a score). The latest sessions may carry the running session's price rather than a final close.`}
        </p>
      ) : null}

      {/* Cards */}
      {filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {ar ? "لا توجد نتائج مطابقة للفلاتر الحالية." : "No matches for the current filters."}
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => (
            <SignalCard key={r.companyId} row={r} ar={ar} fav={watch.has(r.companyId)} onFav={() => watch.toggle({ id: r.companyId, ticker: r.ticker })} />
          ))}
        </div>
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
  return (
    <Card className={`group relative p-0 transition-shadow hover:shadow-md ${sigCls?.ring ?? "border-border/60"}`}>
      <CardContent className="space-y-2.5 px-4 py-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/company/${row.companyId}`} className="flex items-center gap-1.5 text-sm font-bold text-foreground hover:text-primary">
              <span dir="ltr">{row.ticker}</span>
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

function MiniMetric({ label, value, tone }: { label: string; value: string; tone: "positive" | "negative" | "muted" }) {
  const cls = tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-foreground/80"
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 px-1 py-1">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className={`text-[11px] font-semibold tabular ${cls}`} dir="ltr">{value}</p>
    </div>
  )
}
