"use client"

// AdjustedPriceChart — EGXANO's own daily candlestick chart over the
// corporate-action-ADJUSTED series produced by the technical engine.
//
// Why it exists: the TradingView embed shows TradingView's raw series, where a
// bonus issue / cash dividend looks like a market crash on its ex-date (CANA
// 2026-11-12 displayed −31.9% for a real ≈ +2% session). This chart renders
// the same adjusted bars every EGXANO indicator and AI report ground on, so
// the visual story matches the math. Dependency-free SVG — no chart library,
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

    // SMA20 overlay over adjusted closes — the same window the indicators use.
    const sma: (number | null)[] = []
    for (let i = 0; i < data.length; i++) {
      if (i < 19) {
        sma.push(null)
        continue
      }
      let s = 0
      for (let k = i - 19; k <= i; k++) s += data[k].c
      sma.push(s / 20)
    }
    const smaPath = sma
      .map((v, i) => (v === null ? null : `${i === 0 || sma[i - 1] === null ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`))
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

    return { data, y, x, step, bodyW, smaPath, ticks, labels, min, max }
  }, [candles, height])

  if (!view) return null
  const { data, y, x, bodyW, smaPath, ticks, labels } = view
  const hovered = hover !== null && hover >= 0 && hover < data.length ? data[hover] : null

  return (
    <div dir="ltr" className="relative w-full select-none">
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
        aria-label="Daily price chart, adjusted for corporate actions"
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
        {/* SMA20 */}
        <path d={smaPath} fill="none" stroke="var(--primary)" strokeWidth="1.4" strokeOpacity="0.85" />
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
