"use client"

// =============================================================================
// SectorLiquidityHeatmap — the DAILY SECTOR-LIQUIDITY map (owner feature
// 2026-11-16, redesigned 2026-11-20 after the owner's comprehension review:
// "لما أشوف الشكل في أول دقيقة مش بفهم حاجة — النسبة دي نسبة إيه؟ أنا كمستخدم
// يهمني القطاع دخل صافي كام أو خرج منه صافي كام").
//
// The page now answers the owner's question IN THE FIRST 5 SECONDS:
//   1. RANKED NET-FLOW LIST on top: أكبر دخول صافي / أكبر خروج صافي in EGP —
//      the literal "which sector gained / lost net money" answer with bars.
//   2. Treemap below for the size story: tile SIZE = the sector's share of
//      today's traded value; tile COLOR = day-over-day liquidity change on a
//      RELATIVE sqrt scale (the old fixed ±40% scale saturated everything to
//      one uniform green wall — +164% and +751% looked identical).
//   3. Every percentage is now labelled: the badge reads "+289%" next to a
//      legend line explaining it = سيولة اليوم مقابل جلسة الأمس.
// Data: /api/v1/market/liquidity-heatmap (Σ valueTraded per effective EGX
// session day, price×volume fallback, 60s cache). No invented numbers — a
// sector with no previous session renders grey, not green.
// =============================================================================

import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowDownRight, ArrowUpRight, Droplets } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useI18n } from "@/lib/i18n"
import { sectorLabel } from "@/lib/sectors"
import { squarify, type Rect } from "./sector-treemap"

interface LiquiditySector {
  sector: string
  valueToday: number
  valuePrev: number | null
  /** signed net: today − previous session (EGP). Null = no prior session. */
  netValue: number | null
  changePct: number | null
  sharePct: number
  companies: number
}

/** Owner redesign 2026-11-20: the old fixed ±40% scale saturated instantly
 *  (liquidity swings are ±300%), painting a uniform wall of green. The fill
 *  is now RELATIVE to the biggest swing of the day, sqrt-compressed so mid
 *  swings stay visibly lighter than the peak. */
function liquidityFill(chg: number | null, maxAbsChg: number): string {
  if (chg === null) return "var(--hm-flat)"
  const t = maxAbsChg > 0 ? Math.sqrt(Math.min(Math.abs(chg) / maxAbsChg, 1)) : 0
  const pct = Math.round(24 + t * 66)
  if (chg > 0) return `color-mix(in oklab, var(--hm-pos) ${pct}%, var(--hm-flat))`
  if (chg < 0) return `color-mix(in oklab, var(--hm-neg) ${pct}%, var(--hm-flat))`
  return "var(--hm-flat)"
}

/** First-day tiles (no previous session) tint by the sector's LIQUIDITY SHARE
 *  (accent) so the map is informative from day one — marked "أول تتبع". */
function shareFill(sharePct: number): string {
  const intensity = Math.min(Math.max((sharePct - 2) / 30, 0), 1)
  const pct = Math.round(12 + intensity * 34)
  return `color-mix(in oklab, var(--primary) ${pct}%, var(--hm-flat))`
}

/** Tile label tone follows the SAME relative intensity as the fill: deep
 *  tints get white text, light tints get coloured text. */
function liquidityLabelTone(chg: number | null, maxAbsChg: number): string {
  if (chg === null) return "text-foreground"
  const t = maxAbsChg > 0 ? Math.sqrt(Math.min(Math.abs(chg) / maxAbsChg, 1)) : 0
  return t > 0.55 ? "text-white" : chg > 0 ? "text-positive" : chg < 0 ? "text-negative" : "text-muted-foreground"
}

const fmtEgp = (v: number, ar: boolean): string =>
  v >= 1e9
    ? `${(v / 1e9).toFixed(2)} ${ar ? "مليار ج" : "B EGP"}`
    : v >= 1e6
      ? `${(v / 1e6).toFixed(1)} ${ar ? "مليون ج" : "M EGP"}`
      : `${Math.round(v).toLocaleString(ar ? "ar-EG" : "en-US")} ${ar ? "ج" : "EGP"}`

/** Compact change badge: "+290%" for big swings, "+7.4%" for small ones —
 *  the legend + subtitle explain WHAT the percentage compares against. */
const fmtChg = (chg: number | null): string => {
  if (chg === null) return "—"
  const abs = Math.abs(chg)
  const body = abs >= 100 ? String(Math.round(abs)) : abs.toFixed(1)
  return `${chg > 0 ? "+" : chg < 0 ? "−" : ""}${body}%`
}

function canvasHeightFor(w: number): number {
  if (w < 480) return 360
  if (w < 768) return 420
  return 480
}

export function SectorLiquidityHeatmap() {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const boxRef = useRef<HTMLDivElement>(null)
  const [boxW, setBoxW] = useState(1000)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setBoxW(e.contentRect.width)
    })
    ro.observe(el)
    setBoxW(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  const { data, isLoading } = useQuery({
    queryKey: ["market-liquidity-heatmap"],
    queryFn: () =>
      fetch("/api/v1/market/liquidity-heatmap").then((r) =>
        r.ok ? (r.json() as Promise<{ asOf: string | null; prevAsOf: string | null; sessionLive?: boolean; sectors: LiquiditySector[] }>) : null
      ),
    staleTime: 60_000,
    refetchInterval: 180_000,
  })

  const sectors = (data?.sectors ?? []).filter((s) => s.valueToday > 0)
  const rect: Rect = { x: 0, y: 0, w: boxW, h: canvasHeightFor(boxW) }
  const rects = squarify(
    sectors.map((s) => s.valueToday),
    rect,
  )

  const maxAbsChg = Math.max(...sectors.map((s) => Math.abs(s.changePct ?? 0)), 40)

  // ---- ranked net-flow list (the owner's literal question) ----------------
  const withNet = sectors.filter((s) => s.netValue !== null && s.netValue !== 0)
  const inflow = [...withNet].filter((s) => s.netValue! > 0).sort((a, b) => b.netValue! - a.netValue!).slice(0, 6)
  const outflow = [...withNet].filter((s) => s.netValue! < 0).sort((a, b) => a.netValue! - b.netValue!).slice(0, 6)
  const maxAbsNet = Math.max(...withNet.map((s) => Math.abs(s.netValue ?? 0)), 1)

  // header counters follow the SIGNED net (today − yesterday)
  const flowingIn = sectors.filter((s) => (s.netValue ?? 0) > 0).length
  const flowingOut = sectors.filter((s) => (s.netValue ?? 0) < 0).length
  const total = sectors.reduce((a, s) => a + s.valueToday, 0)
  const netTotal = sectors.every((s) => s.netValue !== null)
    ? sectors.reduce((a, s) => a + (s.netValue ?? 0), 0)
    : null

  const NetFlowRow = ({ s }: { s: LiquiditySector }) => {
    const net = s.netValue!
    const barPct = Math.max((Math.abs(net) / maxAbsNet) * 100, 3)
    return (
      <a
        href={`/sectors/${encodeURIComponent(s.sector)}`}
        className="group flex items-center gap-2 py-[3px]"
        title={`${sectorLabel(s.sector, lang)} — ${ar ? "سيولة اليوم" : "today"} ${fmtEgp(s.valueToday, ar)} · ${ar ? "الأمس" : "prev"} ${s.valuePrev !== null ? fmtEgp(s.valuePrev, ar) : "—"}`}
      >
        <span className="w-[7.25rem] shrink-0 truncate text-[11px] font-semibold text-foreground group-hover:text-primary sm:w-[9rem]">
          {sectorLabel(s.sector, lang)}
        </span>
        <span className="relative h-2 min-w-8 flex-1 overflow-hidden rounded-full bg-muted">
          <span
            className="absolute inset-y-0 start-0 rounded-full"
            style={{ width: `${barPct}%`, background: net > 0 ? "var(--positive)" : "var(--negative)" }}
          />
        </span>
        <span
          className={`w-24 shrink-0 text-end text-[11px] font-extrabold tabular-nums sm:w-28 ${net > 0 ? "text-positive" : "text-negative"}`}
        >
          {net > 0 ? "+" : "−"}
          {fmtEgp(Math.abs(net), ar)}
        </span>
      </a>
    )
  }

  return (
    <Card className="border-border/60 overflow-hidden">
      <CardHeader className="pb-4 px-5">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
          <Droplets className="h-3.5 w-3.5 text-primary" aria-hidden />
          {ar ? "فين دخلت وخرجت سيولة القطاعات النهاردة؟" : "Where did sector money flow today?"}
          {data?.asOf ? (
            <span className="text-[10px] font-normal text-muted-foreground" dir="ltr">
              {data.asOf}
              {data.prevAsOf ? ` ↔ ${data.prevAsOf}` : ""}
            </span>
          ) : null}
          {data?.sessionLive ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              {ar ? "الجلسة جارية — أرقام اليوم جزئية" : "session live — today still accumulating"}
            </span>
          ) : null}
        </CardTitle>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {ar
            ? "الصافي = سيولة اليوم ناقص سيولة جلسة الأمس بالجنيه. حجم المربع = نصيب القطاع من سيولة اليوم، ولونه = مقدار التغيّر عن الأمس. الرمادي = أول يوم تتبع."
            : "Net = today's traded value minus the previous session's, in EGP. Tile size = the sector's share of today's liquidity; its colour = how much that changed vs yesterday. Grey = first tracked day."}
        </p>
        {total > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2.5 text-[11px] font-semibold">
            <span className="rounded-md bg-muted/60 px-2 py-1 text-muted-foreground">
              {ar ? "إجمالي المتداول اليوم" : "traded today"} <span className="tabular-nums text-foreground">{fmtEgp(total, ar)}</span>
            </span>
            <span className="rounded-md bg-muted/60 px-2 py-1">
              <span className="text-positive">▲ {flowingIn} {ar ? "قطاع زادت سيولته" : "in"}</span>
              <span className="mx-1.5 text-border">·</span>
              <span className="text-negative">▼ {flowingOut} {ar ? "قطاع نقصت سيولته" : "out"}</span>
            </span>
            {netTotal !== null ? (
              <span className={`rounded-md px-2 py-1 ${netTotal >= 0 ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative"}`}>
                {ar ? "صافي السوق كله مقابل أمس" : "market net vs yesterday"}{" "}
                <span className="tabular-nums font-extrabold" dir="ltr">
                  {netTotal >= 0 ? "+" : "−"}
                  {fmtEgp(Math.abs(netTotal), ar)}
                </span>
              </span>
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <div className="px-5 pb-4">
          {isLoading ? (
            <Skeleton className="h-[480px] w-full rounded-xl" />
          ) : sectors.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {ar
                ? "لا توجد سيولة مسجلة بعد — تظهر الخريطة عند توفر بيانات الجلسة."
                : "No recorded liquidity yet — the map appears once session data lands."}
            </p>
          ) : (
            <>
              {/* ---- 1) ranked net-flow list: the 5-second answer ------------- */}
              {withNet.length > 0 ? (
                <div className="mb-4 rounded-xl border border-border/60 bg-card p-3.5">
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-foreground">
                    {ar ? "أولاً: صافي السيولة بالجنيه — القطاعات مرتبة من الأعلى للأقل" : "First: net flow in EGP — sectors ranked"}
                    <span className="font-normal text-muted-foreground">
                      ({ar ? "السهم الأخضر = دخول صافي · الأحمر = خروج صافي · مقارنة بجلسة الأمس" : "green = net inflow · red = net outflow · vs prev session"})
                    </span>
                  </p>
                  <div className="grid gap-x-8 md:grid-cols-2">
                    <div>
                      <p className="mb-1 flex items-center gap-1 text-[10px] font-bold text-positive">
                        <ArrowUpRight className="h-3 w-3" aria-hidden />
                        {ar ? "أكبر دخول صافي" : "largest net inflow"}
                      </p>
                      {inflow.map((s) => (
                        <NetFlowRow key={s.sector} s={s} />
                      ))}
                    </div>
                    <div className="mt-3 md:mt-0">
                      <p className="mb-1 flex items-center gap-1 text-[10px] font-bold text-negative">
                        <ArrowDownRight className="h-3 w-3" aria-hidden />
                        {ar ? "أكبر خروج صافي" : "largest net outflow"}
                      </p>
                      {outflow.length > 0 ? (
                        outflow.map((s) => <NetFlowRow key={s.sector} s={s} />)
                      ) : (
                        <p className="py-2 text-[11px] text-muted-foreground">
                          {ar ? "لا يوجد خروج صافي اليوم — كل القطاعات استقبلت سيولة أعلى من الأمس." : "No net outflow today — every sector out-traded yesterday."}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* ---- 2) the treemap: size + colour story ---------------------- */}
              {/* legend — every encoded channel is spelled out in plain Arabic */}
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-muted-foreground">
                <span>{ar ? "حجم المربع = سيولة القطاع اليوم" : "Tile size = today's liquidity"}</span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-6 rounded-sm" style={{ background: liquidityFill(maxAbsChg, maxAbsChg) }} />
                  {ar ? "سيولة زيادة عن الأمس" : "more than yesterday"}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-6 rounded-sm" style={{ background: liquidityFill(-maxAbsChg, maxAbsChg) }} />
                  {ar ? "سيولة أقل عن الأمس" : "less than yesterday"}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-6 rounded-sm" style={{ background: shareFill(30) }} />
                  {ar ? "أول يوم تتبع" : "first tracked day"}
                </span>
                <span className="text-foreground/70">
                  {ar ? "النسبة في الشارة = تغيّر سيولة القطاع مقابل جلسة الأمس (+ يعني سيولة أكبر). مثال: +290% يعني سيولة اليوم ≈ ×3.9 أمس" : "The badge % = liquidity change vs the previous session (+ = more). e.g. +290% ≈ ×3.9 yesterday"}
                </span>
              </div>
              <div ref={boxRef} className="relative w-full overflow-hidden rounded-xl" style={{ height: rect.h }}>
                {rects.map((r, i) => {
                  const s = sectors[i]
                  if (!s) return null
                  const net = s.netValue
                  const netText = net === null ? null : `${net >= 0 ? "+" : "−"}${fmtEgp(Math.abs(net), ar)}`
                  const firstTracking = s.changePct === null
                  // tiny tiles: name only — the old badge overlapped the label
                  const showBody = r.w > 96 && r.h > 56
                  const showBadge = !firstTracking && r.w > 88 && r.h > 44
                  const showPrevLine = showBody && r.h > 130 && r.w > 220 && s.valuePrev !== null
                  return (
                    <a
                      key={s.sector}
                      href={`/sectors/${encodeURIComponent(s.sector)}`}
                      className="absolute flex flex-col justify-between overflow-hidden rounded-lg p-2.5 ring-1 ring-inset ring-black/10 transition-[left,top,width,height] duration-300 hover:z-10 hover:scale-[1.01] focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: firstTracking ? shareFill(s.sharePct) : liquidityFill(s.changePct, maxAbsChg) }}
                      title={`${sectorLabel(s.sector, lang)} — ${ar ? "اليوم" : "today"} ${fmtEgp(s.valueToday, ar)} · ${ar ? "الصافي مقابل الأمس" : "net vs prev"} ${netText ?? "—"} (${fmtChg(s.changePct)}, ${ar ? `نصيب ${s.sharePct.toFixed(1)}٪` : `${s.sharePct.toFixed(1)}% share`}, ${s.companies} ${ar ? "شركة" : "cos"})`}
                    >
                      <span className="flex items-start justify-between gap-1.5">
                        <span className={`truncate text-[11.5px] font-bold leading-tight ${liquidityLabelTone(s.changePct, maxAbsChg)}`}>
                          {sectorLabel(s.sector, lang)}
                        </span>
                        {showBadge ? (
                          <span
                            className="shrink-0 rounded-full bg-background/70 px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                            style={{ color: s.changePct! > 0 ? "var(--hm-pos)" : s.changePct! < 0 ? "var(--hm-neg)" : "var(--muted-foreground)" }}
                            dir="ltr"
                          >
                            {fmtChg(s.changePct)}
                          </span>
                        ) : null}
                      </span>
                      {showBody ? (
                        <span className={`tabular-nums leading-tight ${liquidityLabelTone(s.changePct, maxAbsChg)}`}>
                          <span className="block text-[15px] font-extrabold" dir="ltr">{fmtEgp(s.valueToday, ar)}</span>
                          <span className="block text-[9px] opacity-75">{ar ? `سيولة اليوم · نصيب ${s.sharePct.toFixed(1)}٪ · ${s.companies} شركة` : `today · ${s.sharePct.toFixed(1)}% share · ${s.companies} cos`}</span>
                          {showPrevLine && s.valuePrev !== null ? (
                            <span className="block text-[9px] opacity-75">{ar ? "الأمس" : "prev"} {fmtEgp(s.valuePrev, ar)}</span>
                          ) : null}
                          {netText !== null ? (
                            <span className="mt-1 block text-[10px] font-extrabold" dir="ltr">
                              {ar ? "الصافي " : "net "}{netText}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </a>
                  )
                })}
              </div>
              {data?.sessionLive ? (
                <p className="mt-3 rounded-lg border border-border/60 bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  {ar
                    ? "الجلسة لسه شغالة: أرقام اليوم جزئية وبتتقارن بإجمالي أمس الكامل، فالخروج الظاهر أثناء التداول طبيعي — الصورة النهائية تتأكد بعد الإغلاق."
                    : "The session is still live: today's partial total is compared against yesterday's FULL total, so a visible outflow mid-session is expected — the final picture lands after the close."}
                </p>
              ) : null}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
