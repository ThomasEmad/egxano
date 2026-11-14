// Grid-search the synthetic uptrend cadence so A(t)="buy" and crash-B(t)!="buy".
import { computeCloseSignal } from "../../.cache/engine-baseline/signals"

function buildSeries(n: number, crashAt: number | null, upEvery: number, up: number, down: number): { ts: string; close: number; volume: number }[] {
  const rows: { ts: string; close: number; volume: number }[] = []
  let close = 100
  for (let i = 0; i < n; i++) {
    if (crashAt !== null && i === crashAt) close = close * 0.85
    else close = i % upEvery === upEvery - 1 ? close * (1 - down) : close * (1 + up)
    const d = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000)
    rows.push({ ts: d.toISOString().slice(0, 10), close: Math.round(close * 100) / 100, volume: 1_000_000 + (i % 7) * 90_000 })
  }
  return rows
}

const combos: [number, number, number][] = [
  [3, 0.005, 0.004], [3, 0.004, 0.003], [4, 0.004, 0.003], [3, 0.006, 0.005],
  [2, 0.004, 0.003], [3, 0.003, 0.002], [4, 0.003, 0.002], [5, 0.004, 0.003],
]
for (const [upEvery, up, down] of combos) {
  const rows = buildSeries(101, null, upEvery, up, down)
  const a = computeCloseSignal(rows.slice(0, 100))
  const rowsCrash = buildSeries(101, 100, upEvery, up, down)
  const b = computeCloseSignal(rowsCrash)
  console.log(
    `every=${upEvery} up=${up} down=${down} -> A: ${a.signal} ${a.score} (rsi=${a.metrics.rsi14?.toFixed(1)} relVol=${a.metrics.relVol?.toFixed(2)} plan=${a.tradePlan ? a.tradePlan.bias : "null"}) | B: ${b.signal} ${b.score}`,
  )
}
