"use client"

// Price history chart — renders harvested MarketPrice snapshots (never interpolated:
// each point is a real stored price with its source), so gaps are real gaps.
//
// The TradingView view is an external display: it is labelled as third-party and
// delayed, and it is never the source of a calculated EGXANO figure. In Arabic the
// snapshot view is the default, because the EGX TradingView symbol is not
// rendered by the widget's Arabic locale and users would otherwise see an empty
// frame on the first screen.

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Clock, TrendingDown, TrendingUp } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useI18n } from "@/lib/i18n"
import { formatDate } from "@/lib/brand"
import { TradingViewChart } from "@/components/egx/tradingview"

interface PricePoint {
  asOf: string
  price: number
  currency: string
}

const RANGES = [
  { key: "6m", months: 6 },
  { key: "1y", months: 12 },
  { key: "all", months: 0 },
] as const

function fmtCompact(v: number): string {
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v.toFixed(2)
}

export function PriceChart({
  companyId,
  ticker,
  height = 300,
}: {
  companyId: string
  /** TradingView symbol suffix (EGX ticker). Absent → TV view hidden. */
  ticker?: string
  height?: number
}) {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("1y")
  const [source, setSource] = useState<"tv" | "snapshots">(ar ? "snapshots" : "tv")

  // Language change resets the default view; an explicit user choice is not
  // preserved across languages on purpose (Arabic users get our own snapshots).
  useEffect(() => {
    // Hydration-safe language-dependent default.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSource(ar ? "snapshots" : "tv")
  }, [ar])

  const { data, isLoading } = useQuery({
    queryKey: ["prices", companyId],
    queryFn: () => fetch(`/api/v1/companies/${companyId}/prices`).then((r) => (r.ok ? (r.json() as Promise<{ prices: PricePoint[] }>) : { prices: [] as PricePoint[] })),
    staleTime: 300_000,
  })

  const series = useMemo(() => {
    const rows = (data?.prices ?? []).map((p) => ({ ...p, ts: new Date(p.asOf).getTime() }))
    if (range !== "all") {
      const months = RANGES.find((r) => r.key === range)!.months
      const cutoff = Date.now() - months * 30 * 24 * 3600 * 1000
      const sliced = rows.filter((r) => r.ts >= cutoff)
      // keep at least the last two points so the change badge stays meaningful
      return sliced.length >= 2 ? sliced : rows.slice(-2)
    }
    return rows
  }, [data, range])

  const first = series.length > 0 ? series[0].price : null
  const last = series.length > 0 ? series[series.length - 1].price : null
  const lastAsOf = series.length > 0 ? series[series.length - 1].asOf : null
  const changePct = first && last && first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null
  const changeGood = (changePct ?? 0) >= 0
  const showTv = source === "tv" && !!ticker

  const sourceSwitch = (
    <div className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={() => setSource("tv")}
        disabled={!ticker}
        aria-pressed={showTv}
        className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors duration-150 ${
          showTv ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60 disabled:opacity-40 disabled:hover:bg-transparent"
        }`}
      >
        TradingView
      </button>
      <button
        type="button"
        onClick={() => setSource("snapshots")}
        disabled={series.length < 2}
        aria-pressed={!showTv}
        className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors duration-150 ${
          !showTv ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60 disabled:opacity-40 disabled:hover:bg-transparent"
        }`}
      >
        {ar ? "لقطات EGXANO" : "EGXANO snapshots"}
      </button>
    </div>
  )

  if (showTv) {
    return (
      <Card className="border-border/60 p-0">
        <CardContent className="min-w-0 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {ar ? "خارجي" : "External"}
              </span>
              {sourceSwitch}
            </div>
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden />
              {ar ? "TradingView · متأخر 15 دقيقة · للعرض فقط" : "TradingView · delayed 15 min · display only"}
            </span>
          </div>
          <TradingViewChart ticker={ticker!} height={Math.max(height + 160, 420)} />
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            {ar
              ? "الشارت من مصدر خارجي (TradingView). الأرقام المحسوبة في EGXANO لا تأتي من هذا الشارت."
              : "Chart by a third party (TradingView). EGXANO's calculated figures are not sourced from this chart."}
          </p>
        </CardContent>
      </Card>
    )
  }

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />
  if (series.length < 2) {
    return (
      <Card className="border-border/60">
        <CardContent className="flex min-w-0 flex-col items-center justify-center gap-2 py-8 text-center">
          <p className="text-xs font-medium text-muted-foreground">
            {ar ? "لا يوجد تاريخ سعري كافٍ لهذه الشركة بعد" : "Not enough price history for this company yet"}
          </p>
          {series.length === 1 ? (
            <p className="text-[11px] text-muted-foreground/80">
              {ar ? "آخر سعر مسجّل" : "Latest recorded price"}:{" "}
              <span className="font-semibold tabular">{series[0].price.toLocaleString()} {series[0].currency}</span>
              <span className="ms-1">· {formatDate(series[0].asOf, lang)}</span>
            </p>
          ) : null}
          {ticker ? <div className="mt-1">{sourceSwitch}</div> : null}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border/60 p-0">
      <CardContent className="min-w-0 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <span className="num text-2xl font-bold">{last!.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            <span className="text-xs font-medium text-muted-foreground">{series[series.length - 1].currency}</span>
            {changePct !== null ? (
              <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular ${changeGood ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                {changeGood ? <TrendingUp className="h-3 w-3" aria-hidden /> : <TrendingDown className="h-3 w-3" aria-hidden />}
                {changeGood ? "+" : ""}{changePct.toFixed(1)}%
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {sourceSwitch}
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                aria-pressed={range === r.key}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors duration-150 ${range === r.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60"}`}
              >
                {r.key === "all" ? (ar ? "الكل" : "All") : r.key.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div style={{ height }} dir="ltr" className="w-full max-w-full overflow-hidden">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={changeGood ? "var(--success)" : "var(--destructive)"} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={changeGood ? "var(--success)" : "var(--destructive)"} stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(ts) => new Date(ts).toLocaleDateString(ar ? "ar-EG-u-nu-latn" : "en-GB", { month: "short", year: "2-digit" })}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                minTickGap={40}
              />
              <YAxis
                domain={["auto", "auto"]}
                tickFormatter={(v) => fmtCompact(v)}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                width={52}
              />
              <Tooltip
                contentStyle={{ borderRadius: 10, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", fontSize: 12 }}
                labelFormatter={(ts) => formatDate(new Date(ts as number), lang)}
                formatter={(value) => [`${(value as number).toLocaleString()} EGP`, ar ? "السعر" : "Price"]}
              />
              <Area type="monotone" dataKey="price" stroke={changeGood ? "var(--success)" : "var(--destructive)"} strokeWidth={2.5} fill="url(#priceFill)" dot={series.length <= 30 ? { r: 2.5, fill: changeGood ? "var(--success)" : "var(--destructive)", strokeWidth: 0 } : false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          {ar
            ? `${series.length} نقطة سعرية محفوظة · آخر نقطة ${formatDate(lastAsOf, lang)} · ليست سعرًا لحظيًا`
            : `${series.length} stored price snapshots · last point ${formatDate(lastAsOf, lang)} · not a live quote`}
        </p>
      </CardContent>
    </Card>
  )
}
