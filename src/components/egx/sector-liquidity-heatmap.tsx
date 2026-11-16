"use client"

// =============================================================================
// SectorLiquidityHeatmap — the DAILY SECTOR-LIQUIDITY heatmap (owner feature
// request 2026-11-16: "خريطة حرارية لتغير سيولة القطاعات كل يوم زي خريطة
// الشركات كده ... زي fundalens بس عندي هتبقى مجانية").
//
// Sits beside the price treemap on /sectors and answers a different question:
// not "which prices moved" but "where did the money trade today vs yesterday".
//   • tile SIZE  = the sector's share of today's total value traded (EGP)
//   • tile COLOR = day-over-day liquidity change % (green = money flowing IN
//     vs the previous session, red = flowing out, grey = no previous session)
// Data: /api/v1/market/liquidity-heatmap (Σ valueTraded per effective EGX
// session day, price×volume fallback, 60s cache). No invented numbers — a
// sector with no previous session renders grey, not green.
// =============================================================================

import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Droplets } from "lucide-react"
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

/** Liquidity swings are far larger than price swings — ±40% spans the scale. */
function liquidityFill(chg: number | null): string {
  if (chg === null) return "var(--hm-flat)"
  const intensity = Math.min(Math.abs(chg) / 40, 1)
  const pct = Math.round(20 + intensity * 80)
  if (chg > 0) return `color-mix(in oklab, var(--hm-pos) ${pct}%, var(--hm-flat))`
  if (chg < 0) return `color-mix(in oklab, var(--hm-neg) ${pct}%, var(--hm-flat))`
  return "var(--hm-flat)"
}

/** Owner redesign 2026-11-17: with no prior session the old map rendered a
 *  dead GRAY WALL of dashes. First-day tiles now tint by the sector's LIQUIDITY
 *  SHARE (accent) so the map is informative from day one — clearly marked as
 *  "first tracking" instead of an empty "—". */
function shareFill(sharePct: number): string {
  const intensity = Math.min(Math.max((sharePct - 2) / 30, 0), 1)
  const pct = Math.round(12 + intensity * 34)
  return `color-mix(in oklab, var(--primary) ${pct}%, var(--hm-flat))`
}

function liquidityLabelTone(chg: number | null): string {
  if (chg === null) return "text-foreground"
  const intensity = Math.min(Math.abs(chg) / 40, 1)
  return intensity > 0.3 ? "text-white" : chg > 0 ? "text-positive" : chg < 0 ? "text-negative" : "text-muted-foreground"
}

const fmtEgp = (v: number, ar: boolean): string =>
  v >= 1e9
    ? `${(v / 1e9).toFixed(2)} ${ar ? "مليار ج" : "B EGP"}`
    : v >= 1e6
      ? `${(v / 1e6).toFixed(1)} ${ar ? "مليون ج" : "M EGP"}`
      : `${Math.round(v).toLocaleString(ar ? "ar-EG" : "en-US")} ${ar ? "ج" : "EGP"}`

const fmtChg = (chg: number | null): string => (chg === null ? "—" : `${chg > 0 ? "+" : ""}${chg.toFixed(1)}%`)

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

  // net-flow counts follow the SIGNED net (today − yesterday), not the colour
  const flowingIn = sectors.filter((s) => (s.netValue ?? 0) > 0).length
  const flowingOut = sectors.filter((s) => (s.netValue ?? 0) < 0).length
  const total = sectors.reduce((a, s) => a + s.valueToday, 0)
  const netTotal = sectors.every((s) => s.netValue !== null)
    ? sectors.reduce((a, s) => a + (s.netValue ?? 0), 0)
    : null

  return (
    <Card className="border-border/60 overflow-hidden">
      <CardHeader className="pb-4 px-5">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
          <Droplets className="h-3.5 w-3.5 text-primary" aria-hidden />
          {ar ? "خريطة سيولة القطاعات — تغيّر اليوم" : "Sector liquidity heatmap — today's change"}
          {data?.asOf ? (
            <span className="text-[10px] font-normal text-muted-foreground" dir="ltr">
              {data.asOf}
              {data.prevAsOf ? ` ↔ ${data.prevAsOf}` : ""}
            </span>
          ) : null}
          {data?.sessionLive ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              {ar ? "الجلسة جارية — تراكم اليوم جزئي" : "session live — today still accumulating"}
            </span>
          ) : null}
          {total > 0 ? (
            <span className="ms-auto flex items-center gap-2.5 text-[10px] font-semibold text-muted-foreground" dir="ltr">
              <span className="text-positive">▲ {flowingIn} {ar ? "داخل" : "in"}</span>
              <span className="text-negative">▼ {flowingOut} {ar ? "خارج" : "out"}</span>
              <span>Σ {fmtEgp(total, ar)}</span>
              {netTotal !== null ? (
                <span className={netTotal >= 0 ? "text-positive" : "text-negative"}>
                  {ar ? "الصافي" : "net"} {netTotal >= 0 ? "+" : "−"}{fmtEgp(Math.abs(netTotal), ar)}
                </span>
              ) : null}
            </span>
          ) : null}
        </CardTitle>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {ar
            ? "حجم المربع = نصيب القطاع من سيولة اليوم (القيمة المتداولة بالجنيه)، واللون = التغير مقارنة بجلسة الأمس. الرمادي = لا توجد جلسة سابقة للمقارنة."
            : "Tile size = the sector's share of today's traded value (EGP); colour = change vs the previous session. Grey = no previous session to compare."}
        </p>
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
              {/* legend */}
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-muted-foreground">
                <span>{ar ? "حجم المربع = السيولة اليوم" : "Tile size = today's liquidity"}</span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-6 rounded-sm" style={{ background: liquidityFill(40) }} />
                  {ar ? "سيولة داخلية" : "flowing in"}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-6 rounded-sm" style={{ background: liquidityFill(-40) }} />
                  {ar ? "سيولة خارجية" : "flowing out"}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-6 rounded-sm" style={{ background: shareFill(30) }} />
                  {ar ? "أول تتبع — الشدة = نصيب السيولة" : "first tracking — shade = liquidity share"}
                </span>
              </div>
              <div ref={boxRef} className="relative w-full overflow-hidden rounded-xl" style={{ height: rect.h }}>
                {rects.map((r, i) => {
                  const s = sectors[i]
                  if (!s) return null
                  const showBody = r.w > 96 && r.h > 56
                  const net = s.netValue
                  const netText = net === null ? null : `${net >= 0 ? "+" : "−"}${fmtEgp(Math.abs(net), ar)}`
                  const firstTracking = s.changePct === null
                  return (
                    <a
                      key={s.sector}
                      href={`/sectors/${encodeURIComponent(s.sector)}`}
                      className="absolute flex flex-col justify-between overflow-hidden rounded-lg p-2.5 ring-1 ring-inset ring-black/10 transition-[left,top,width,height] duration-300 hover:z-10 hover:scale-[1.01] focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: firstTracking ? shareFill(s.sharePct) : liquidityFill(s.changePct) }}
                      title={`${sectorLabel(s.sector, lang)} — ${ar ? "اليوم" : "today"} ${fmtEgp(s.valueToday, ar)} · ${ar ? "الصافي" : "net"} ${netText ?? "—"} (${fmtChg(s.changePct)}, ${ar ? `نصيب ${s.sharePct}%` : `${s.sharePct}% share`}, ${s.companies} ${ar ? "شركة" : "cos"})`}
                    >
                      <span className="flex items-start justify-between gap-1.5">
                        <span className={`truncate text-[11.5px] font-bold leading-tight ${liquidityLabelTone(s.changePct)}`}>
                          {sectorLabel(s.sector, lang)}
                        </span>
                        {firstTracking ? (
                          <span className="shrink-0 rounded-full bg-background/70 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                            {ar ? "أول تتبع" : "first"}
                          </span>
                        ) : (
                          <span className={`shrink-0 rounded-full bg-background/70 px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${s.changePct! > 0 ? "text-positive" : s.changePct! < 0 ? "text-negative" : "text-muted-foreground"}`} dir="ltr">
                            {fmtChg(s.changePct)}
                          </span>
                        )}
                      </span>
                      {showBody ? (
                        <span className={`tabular-nums leading-tight ${liquidityLabelTone(s.changePct)}`}>
                          <span className="block text-[15px] font-extrabold" dir="ltr">{fmtEgp(s.valueToday, ar)}</span>
                          <span className="block text-[9px] opacity-75">{ar ? `سيولة اليوم · نصيب ${s.sharePct.toFixed(1)}٪ · ${s.companies} شركة` : `today · ${s.sharePct.toFixed(1)}% share · ${s.companies} cos`}</span>
                          {netText !== null ? (
                            <span className={`mt-1 block text-[10px] font-semibold ${net! >= 0 ? "text-positive" : "text-negative"}`} dir="ltr">
                              {ar ? `الصافي ${netText}` : `net ${netText}`}
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
                    ? "الجلسة لسه شغالة: تراكم اليوم الجزئي بيتقارن بإجمالي أمس الكامل، فالخروج الظاهر أثناء الجلسة طبيعي — الصورة النهائية تتكل بعد الإغلاق. وبلأسلوب دائمًا: السيولة مش مرآة للسعر — يوم هابط ممكن يشوف سيولة أعلى من الأمس (بيع بحجم أكبر)."
                    : "The session is still live: today's partial cumulative total is compared against yesterday's FULL total, so a visible outflow mid-session is expected — the final picture lands after the close. And liquidity is not a price mirror: a down day can still print higher liquidity than yesterday (heavier selling volume)."}
                </p>
              ) : null}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
