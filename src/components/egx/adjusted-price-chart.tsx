"use client"

// AdjustedPriceChart — EGXANO's own daily candlestick chart over the
// corporate-action-ADJUSTED series produced by the technical engine.
//
// Why it exists: the TradingView embed shows TradingView's raw series, where a
// bonus issue / cash dividend looks like a market crash on its ex-date (CANA
// 2026-11-12 displayed −31.9% for a real ≈ +2% session). This chart renders
// the same adjusted bars every EGXANO indicator and AI report ground on, so
// the visual story matches the math. EMA20/EMA50 overlays are computed
// client-side with the SAME convention as the server engine (seed = SMA of the
// first n values, k = 2/(n+1)). Dependency-free SVG — no chart library,
// no extra payload, theme-aware via CSS variables, fixed LTR time axis.

import { useMemo, useState } from "react"

export interface ChartCandle {
  t: string // YYYY-MM-DD
  o: number
  h: number
  l: number
  c: number
}

const W = 1000
const PAD_L = 8
const PAD_R = 58
const PAD_T = 14
const PAD_B = 26

/** EMA series — identical convention to src/lib/technical/indicators.ts:
 *  seeded with the SMA of the first n values, then k = 2/(n+1) smoothing.
 *  Entries before the seed are null (classic chart alignment). */
function emaSeries(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (values.length < n) return out
  let acc = 0
  for (let i = 0; i < n; i++) acc += values[i]
  out[n - 1] = acc / n
  const k = 2 / (n + 1)
  for (let i = n; i < values.length; i++) out[i] = values[i] * k + (out[i - 1] as number) * (1 - k)
  return out
}

export function AdjustedPriceChart({
  candles,
  height = 380,
  adjustedActions = null,
}: {
  candles: ChartCandle[]
  height?: number
  adjustedActions?: number | null
}) {
  const [hover, setHover] = useState<number | null>(null)

  const view = useMemo(() => {
    const data = candles.slice(-260)
    if (data.length === 0) return null
    const plotW = W - PAD_L - PAD_R
    const plotH = height - PAD_T - PAD_B
    let min = Infinity
    let max = -Infinity
    for (const c of data) {
      if (c.l < min) min = c.l
      if (c.h > max) max = c.h
    }
    if (!(max > min)) {
      max = min * 1.01
      min = min * 0.99
    }
    const pad = (max - min) * 0.06
    min -= pad
    max += pad
    const y = (p: number) => PAD_T + ((max - p) / (max - min)) * plotH
    const step = plotW / data.length
    const x = (i: number) => PAD_L + step * (i + 0.5)
    const bodyW = Math.max(1.2, Math.min(step * 0.66, 9))

    // EMA20 + EMA50 overlays over adjusted closes — the same convention the
    // server engine uses, so the lines match the numbers below the chart.
    const closes = data.map((c) => c.c)
    const ema20 = emaSeries(closes, 20)
    const ema50 = emaSeries(closes, 50)
    const pathFor = (series: (number | null)[]): string =>
      series
        .map((v, i) => (v === null ? null : `${i === 0 || series[i - 1] === null ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`))
        .filter(Boolean)
        .join("")

    // Gridlines: 4 clean price levels between min and max.
    const ticks: number[] = []
    for (let g = 0; g <= 3; g++) ticks.push(min + ((max - min) * g) / 3)

    // X labels: ~6 evenly spaced month starts.
    const labels: { i: number; text: string }[] = []
    const monthName = (iso: string) => {
      const m = Number(iso.slice(5, 7))
      const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
      return `${names[m - 1]} ${iso.slice(2, 4)}`
    }
    const labelEvery = Math.max(1, Math.round(data.length / 6))
    for (let i = 0; i < data.length; i += labelEvery) labels.push({ i, text: monthName(data[i].t) })

    return { data, y, x, step, bodyW, ema20Path: pathFor(ema20), ema50Path: pathFor(ema50), ticks, labels, min, max }
  }, [candles, height])

  if (!view) return null
  const { data, y, x, bodyW, ema20Path, ema50Path, ticks, labels } = view
  const hovered = hover !== null && hover >= 0 && hover < data.length ? data[hover] : null

  return (
    <div dir="ltr" className="relative w-full select-none">
      {/* tiny legend for the moving-average overlays */}
      <div className="mb-1 flex items-center justify-end gap-3 px-2 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ background: "var(--primary)" }} />
          EMA20
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden className="inline-block h-0.5 w-4 rounded-full opacity-90" style={{ background: "#f59e0b" }} />
          EMA50
        </span>
      </div>
      {adjustedActions !== null && adjustedActions > 0 ? (
        <div className="absolute top-2 start-2 z-10 rounded-md border border-primary/30 bg-background/85 px-2 py-1 text-[10px] font-medium text-foreground/80 backdrop-blur">
          {`Ex-date adjusted · ${adjustedActions} corporate action${adjustedActions === 1 ? "" : "s"}`}
        </div>
      ) : null}
      {hovered ? (
        <div className="absolute top-2 end-14 z-10 rounded-md border border-border/60 bg-background/90 px-2 py-1 text-[10px] tabular text-foreground/85 backdrop-blur" dir="ltr">
          {hovered.t} · O {hovered.o.toFixed(2)} H {hovered.h.toFixed(2)} L {hovered.l.toFixed(2)} C {hovered.c.toFixed(2)}
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Daily price chart with EMA20/EMA50 overlays, adjusted for corporate actions"
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - rect.left) / rect.width) * W
          const i = Math.round((px - PAD_L) / view.step - 0.5)
          setHover(i)
        }}
      >
        {/* grid + price axis */}
        {ticks.map((p) => (
          <g key={p}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(p)} y2={y(p)} stroke="var(--border)" strokeWidth="1" strokeOpacity="0.5" />
            <text x={W - PAD_R + 6} y={y(p) + 3.5} fontSize="10" fill="var(--muted-foreground)" className="tabular">
              {p.toFixed(2)}
            </text>
          </g>
        ))}
        {/* candles */}
        {data.map((c, i) => {
          const up = c.c >= c.o
          const color = up ? "#10b981" : "#ef4444"
          const bodyTop = y(Math.max(c.o, c.c))
          const bodyH = Math.max(1, Math.abs(y(c.o) - y(c.c)))
          return (
            <g key={c.t} opacity={hover === null || hover === i ? 1 : 0.55}>
              <line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth="1" />
              <rect x={x(i) - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} rx={bodyW > 3 ? 0.8 : 0} />
            </g>
          )
        })}
        {/* EMA20 (solid, primary) + EMA50 (dashed, amber) overlays */}
        <path d={ema20Path} fill="none" stroke="var(--primary)" strokeWidth="1.4" strokeOpacity="0.85" />
        <path d={ema50Path} fill="none" stroke="#f59e0b" strokeWidth="1.2" strokeOpacity="0.9" strokeDasharray="5 3" />
        {/* last price marker */}
        {data.length > 0 ? (
          <g>
            <circle cx={x(data.length - 1)} cy={y(data[data.length - 1].c)} r="3" fill="var(--primary)" />
            <text
              x={x(data.length - 1) - 6}
              y={y(data[data.length - 1].c) - 6}
              fontSize="10"
              textAnchor="end"
              fill="var(--foreground)"
              className="tabular"
            >
              {data[data.length - 1].c.toFixed(2)}
            </text>
          </g>
        ) : null}
        {/* time axis */}
        {labels.map((l) => (
          <text key={l.i} x={x(l.i)} y={height - 8} fontSize="10" textAnchor="middle" fill="var(--muted-foreground)">
            {l.text}
          </text>
        ))}
      </svg>
    </div>
  )
}
