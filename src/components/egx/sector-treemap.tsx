"use client"

// Finviz-style market heatmap: a squarified treemap of listed companies
// grouped by sector — tile AREA = market cap, tile COLOR = today's price
// change % (green / red). Pure client layout over /api/v1/market/treemap.
//
// Professional-grade rules (learned from the first pass):
//   * EVERY tile renders — tiny ones become colored specks, never holes.
//   * Labels appear only when they genuinely FIT (px thresholds measured
//     against the real container width) — no clipped "CO… -1.2%" gibberish.
//   * "No quote today" tiles get a clearly visible neutral fill (--hm-flat),
//     never a color that melts into the card background.
//   * Sector groups are labeled with a small floating chip (name + weighted
//     day change), not a full-width header bar that reads as an empty strip.

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Activity } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useI18n } from "@/lib/i18n"
import { sectorLabel } from "@/lib/sectors"

interface TreemapTile {
  ticker: string
  name: string
  nameAr: string | null
  sector: string
  price: number | null
  changePct: number | null
  cap: number | null
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const CANVAS = { w: 100, h: 58 } // normalized units (rendered with % positioning)
const CANVAS_H = 480 // px — fixed so label thresholds are stable vertically

/** Squarified treemap (Bruls et al.) — values descending, aspect-ratio greedy. */
function squarify(values: number[], rect: Rect): Rect[] {
  const total = values.reduce((a, b) => a + b, 0)
  if (total <= 0) return values.map(() => ({ ...rect }))
  const scaled = values.map((v) => (v / total) * rect.w * rect.h)
  const order = scaled.map((v, i) => i).sort((a, b) => scaled[b] - scaled[a])
  const result: Rect[] = new Array(values.length)
  let { x, y, w, h } = rect
  let row: number[] = []
  let rowIdx: number[] = []

  const worst = (r: number[], len: number): number => {
    const sum = r.reduce((a, b) => a + b, 0)
    if (sum <= 0 || len <= 0) return Infinity
    const max = Math.max(...r)
    const min = Math.min(...r)
    const s2 = sum * sum
    const l2 = len * len
    return Math.max((l2 * max) / s2, s2 / (l2 * min))
  }

  const layoutRow = (): void => {
    const sum = row.reduce((a, b) => a + b, 0)
    if (sum <= 0) return
    if (w >= h) {
      const colW = sum / h
      let cy = y
      for (const idx of rowIdx) {
        const rh = scaled[idx] / colW
        result[idx] = { x, y: cy, w: colW, h: rh }
        cy += rh
      }
      x += colW
      w -= colW
    } else {
      const rowH = sum / w
      let cx = x
      for (const idx of rowIdx) {
        const rw = scaled[idx] / rowH
        result[idx] = { x: cx, y, w: rw, h: rowH }
        cx += rw
      }
      y += rowH
      h -= rowH
    }
  }

  for (const idx of order) {
    const len = Math.min(w, h)
    if (row.length === 0 || worst([...row, scaled[idx]], len) <= worst(row, len)) {
      row.push(scaled[idx])
      rowIdx.push(idx)
    } else {
      layoutRow()
      row = [scaled[idx]]
      rowIdx = [idx]
    }
  }
  layoutRow()
  return result
}

/** Tile fill: flat→saturated lerp in oklab via color-mix, floor keeps ±0.2% visible. */
function changeFill(chg: number | null): string {
  if (chg === null) return "var(--hm-flat)"
  const intensity = Math.min(Math.abs(chg) / 3.5, 1)
  const pct = Math.round(20 + intensity * 80) // never flatter than 20%
  if (chg > 0) return `color-mix(in oklab, var(--hm-pos) ${pct}%, var(--hm-flat))`
  if (chg < 0) return `color-mix(in oklab, var(--hm-neg) ${pct}%, var(--hm-flat))`
  return "var(--hm-flat)"
}

/** White text reads on saturated fills in both themes; foreground on flat ones. */
function labelTone(chg: number | null): string {
  if (chg === null) return "text-muted-foreground"
  const intensity = Math.min(Math.abs(chg) / 3.5, 1)
  return intensity > 0.3 ? "text-white" : chg > 0 ? "text-positive" : chg < 0 ? "text-negative" : "text-muted-foreground"
}

function fmtChg(chg: number | null): string {
  if (chg === null) return "—"
  return `${chg > 0 ? "+" : ""}${chg.toFixed(1)}%`
}

export function SectorTreemap() {
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
    queryKey: ["market-treemap"],
    queryFn: () =>
      fetch("/api/v1/market/treemap").then((r) =>
        r.ok ? (r.json() as Promise<{ asOf: string | null; delayMinutes: number | null; tiles: TreemapTile[] }>) : null
      ),
    staleTime: 60_000,
    refetchInterval: 180_000,
  })

  const tiles = (data?.tiles ?? []).filter((t) => t.cap !== null && t.cap > 0)
  const sectors = new Map<string, TreemapTile[]>()
  for (const t of tiles) {
    const list = sectors.get(t.sector) ?? []
    list.push(t)
    sectors.set(t.sector, list)
  }
  const sectorList = [...sectors.entries()]
    .map(([sector, list]) => ({
      sector,
      list,
      total: list.reduce((a, t) => a + (t.cap ?? 0), 0),
      chg: capWeightedChange(list),
    }))
    .sort((a, b) => b.total - a.total)

  const priced = tiles.filter((t) => t.changePct !== null)
  const advancing = priced.filter((t) => (t.changePct ?? 0) > 0).length
  const declining = priced.filter((t) => (t.changePct ?? 0) < 0).length
  const flat = tiles.length - priced.length

  return (
    <Card className="border-border/60 overflow-hidden">
      <CardHeader className="pb-4 px-5">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
          <Activity className="h-3.5 w-3.5 text-primary" />
          {ar ? "الخريطة الحرارية للسوق — تغيّر السعر اليوم" : "Market heatmap — today's price change"}
          {data?.asOf ? (
            <span className="text-[10px] font-normal text-muted-foreground" dir="ltr">
              {new Date(data.asOf).toLocaleString(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              {data.delayMinutes != null ? ` · ${ar ? `متأخر ${data.delayMinutes} د` : `${data.delayMinutes}m delayed`}` : ""}
            </span>
          ) : null}
          <span className="ms-auto flex items-center gap-2.5 text-[10px] font-semibold text-muted-foreground" dir="ltr">
            <span className="text-positive">▲ {advancing}</span>
            <span className="text-negative">▼ {declining}</span>
            {flat > 0 ? <span>• {flat}</span> : null}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="px-5 pb-4">
          {isLoading ? (
            <Skeleton className="h-[480px] w-full rounded-xl" />
          ) : tiles.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {ar ? "لا توجد أسعار اليوم بعد — تظهر الخريطة عند توفر بيانات الجلسة." : "No quotes for today yet — the map appears once session data lands."}
            </p>
          ) : (
            <>
              {/* legend */}
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-muted-foreground">
                <span>{ar ? "حجم المربع = القيمة السوقية" : "Tile size = market cap"}</span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-6 rounded-sm" style={{ background: changeFill(-3.5) }} />
                  ≤ −3.5%
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-6 rounded-sm" style={{ background: changeFill(-1) }} />
                  −1%
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-6 rounded-sm" style={{ background: changeFill(0) }} />
                  {ar ? "بلا سعر" : "no quote"}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-6 rounded-sm" style={{ background: changeFill(1) }} />
                  +1%
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-6 rounded-sm" style={{ background: changeFill(3.5) }} />
                  ≥ +3.5%
                </span>
              </div>

              <div
                ref={boxRef}
                className="relative w-full overflow-hidden rounded-xl border border-border/60 bg-background/40"
                style={{ height: CANVAS_H }}
                dir="ltr"
              >
                <SectorLayout sectorList={sectorList} boxW={boxW} />
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/** Cap-weighted sector day change (null when no priced tile). */
function capWeightedChange(list: TreemapTile[]): number | null {
  let num = 0
  let den = 0
  for (const t of list) {
    if (t.changePct !== null && t.cap) {
      num += t.changePct * t.cap
      den += t.cap
    }
  }
  return den > 0 ? num / den : null
}

/** Two-level layout: sectors first, then companies inside each sector box. */
function SectorLayout({
  sectorList,
  boxW,
}: {
  sectorList: { sector: string; list: TreemapTile[]; total: number; chg: number | null }[]
  boxW: number
}) {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const sectorRects = squarify(sectorList.map((s) => s.total), { x: 0, y: 0, w: CANVAS.w, h: CANVAS.h })

  return (
    <>
      {sectorList.map((sec, si) => {
        const r = sectorRects[si]
        if (!r || r.w <= 0 || r.h <= 0) return null
        const pxW = (r.w / CANVAS.w) * boxW
        const pxH = (r.h / CANVAS.h) * CANVAS_H
        // fix: inner layout computed in LOCAL sector space — global canvas coords
        // applied inside the already-offset sector box caused double-offset voids
        const innerW = Math.max(0, r.w - 0.3)
        const innerH = Math.max(0, r.h - 0.3)
        const sorted = [...sec.list].sort((a, b) => (b.cap ?? 0) - (a.cap ?? 0))
        const rects = squarify(sorted.map((t) => t.cap ?? 0), { x: 0.15, y: 0.15, w: innerW, h: innerH })
        const showChip = pxW > 74 && pxH > 26
        return (
          <div
            key={sec.sector}
            className="absolute"
            style={{
              insetInlineStart: `${r.x}%`,
              top: `${(r.y / CANVAS.h) * 100}%`,
              width: `${r.w}%`,
              height: `${(r.h / CANVAS.h) * 100}%`,
              padding: 1,
            }}
          >
            <div className="relative h-full w-full overflow-hidden rounded-[5px] border border-border/50 bg-background/30">
              {/* floating sector chip — compact like finviz group labels */}
              {showChip ? (
                <div
                  className="pointer-events-none absolute start-1 top-1 z-10 flex items-center gap-1 rounded-md bg-background/85 px-1.5 py-0.5 text-[9px] font-bold text-foreground shadow-sm backdrop-blur-sm"
                  dir="auto"
                >
                  <span className="max-w-[130px] truncate">{sectorLabel(sec.sector, lang)}</span>
                  {sec.chg !== null ? (
                    <span className={`tabular ${sec.chg > 0 ? "text-positive" : sec.chg < 0 ? "text-negative" : "text-muted-foreground"}`} dir="ltr">
                      {fmtChg(sec.chg)}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {sorted.map((t, ti) => {
                const tr = rects[ti]
                if (!tr || tr.w <= 0 || tr.h <= 0) return null
                const tPxW = (tr.w / innerW) * pxW
                const tPxH = (tr.h / innerH) * pxH
                const chg = t.changePct
                // label discipline: ticker only when it truly fits at ~6.4px/char
                const tickerFits = tPxW > t.ticker.length * 6.4 + 8 && tPxH > 22
                const chgFits = tPxW > 44 && tPxH > 40
                const showLabel = tickerFits || chgFits
                const title = `${t.ticker} — ${ar && t.nameAr ? t.nameAr : t.name}${t.price !== null ? ` @ ${t.price.toFixed(2)} EGP` : ""} · ${fmtChg(chg)}`
                return (
                  <Link
                    key={t.ticker}
                    href={`/company/${encodeURIComponent(t.ticker)}`}
                    title={title}
                    aria-label={title}
                    className="group absolute flex flex-col items-center justify-center gap-px overflow-hidden rounded-[3px] transition-[filter,opacity] hover:brightness-125 hover:z-20 hover:ring-1 hover:ring-foreground/30"
                    style={{
                      insetInlineStart: `${((tr.x - 0.15) / innerW) * 100}%`,
                      top: `${((tr.y - 0.15) / innerH) * 100}%`,
                      width: `${(tr.w / innerW) * 100}%`,
                      height: `${(tr.h / innerH) * 100}%`,
                      background: changeFill(chg),
                      outline: "0.5px solid var(--background)",
                    }}
                  >
                    {showLabel ? (
                      <>
                        {tickerFits ? (
                          <span
                            className={`max-w-full truncate px-0.5 text-[10px] font-bold leading-[1.15] ${labelTone(chg)}`}
                          >
                            {t.ticker}
                          </span>
                        ) : null}
                        {chgFits ? (
                          <span className={`px-0.5 text-[9.5px] font-semibold leading-[1.1] tabular ${labelTone(chg)}`} dir="ltr">
                            {fmtChg(chg)}
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </Link>
                )
              })}
            </div>
          </div>
        )
      })}
    </>
  )
}
