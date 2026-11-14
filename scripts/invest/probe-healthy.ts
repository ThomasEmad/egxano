// Probe 4: sweep recovery depth to land RSI 45-60, rangePos 45-90, MACD>0 —
// the fresh-buy profile: dims (30, 24, 16, 20), allDimsStrong TRUE.
import { computeCloseSignal, type CloseRow } from "../../src/lib/technical/signals"
import { rsi, macd } from "../../src/lib/technical/indicators"

function rowsFrom(closes: number[], volumes: number[]): CloseRow[] {
  const out: CloseRow[] = []
  const start = new Date("2025-06-02T00:00:00Z").getTime()
  for (let i = 0; i < closes.length; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10)
    out.push({ ts: day, close: closes[i], volume: volumes[i] })
  }
  return out
}

function gen4(n: number, peakAt: number, troughAt: number, up: number, dn: number, rc: number, rcLen: number, noise = 0.25): number[] {
  const out: number[] = []
  let p = 50
  for (let i = 0; i < n; i++) {
    if (i <= peakAt) p *= i % 2 === 0 ? 1 + up / 100 : 1 - noise / 100
    else if (i <= troughAt) p *= i % 2 === 0 ? 1 - dn / 100 : 1 + noise / 200
    else p *= 1 + rc / 100
    out.push(Math.round(p * 100) / 100)
  }
  return out
}

function vols(closes: number[], upV: number, dnV: number): number[] {
  return closes.map((c, i) => (i === 0 ? 1000 : c >= closes[i - 1] ? upV : dnV))
}

function facts(closes: number[]) {
  const r = rsi(closes, 14)
  const m = macd(closes)
  const w = closes.slice(-60)
  const min = Math.min(...w), max = Math.max(...w)
  const rangePos = ((closes[closes.length - 1] - min) / (max - min)) * 100
  return { rsi: r === null ? null : Math.round(r), macdLine: m.macd === null ? null : +m.macd.toFixed(3), macdHist: m.histogram === null ? null : +m.histogram.toFixed(3), rangePos: Math.round(rangePos) }
}

function report(name: string, closes: number[], volumes: number[]) {
  const sig = computeCloseSignal(rowsFrom(closes, volumes))
  console.log(`${name} => ${JSON.stringify({
    ...facts(closes),
    signal: sig.signal, score: sig.score,
    dims: sig.dimensions.map((d) => `${d.earned}/${d.max}`).join(" "),
    reasons: sig.reasons.map((r) => r.code).slice(0, 3),
    plan: sig.tradePlan ? { rr: sig.tradePlan.riskReward, stopOk: sig.tradePlan.stop < sig.tradePlan.entryLow } : null,
  })}`)
}

console.log("=== sweep recovery modest (target: RSI 45-60, rangePos 45-90) ===")
for (const [rc, rcLen] of [[0.3, 8], [0.3, 10], [0.3, 12], [0.25, 10], [0.35, 8], [0.2, 12]] as const) {
  const c = gen4(80, 45, 80 - rcLen, 0.7, 0.4, rc, rcLen)
  report(`rc${rc} len${rcLen}`, c, vols(c, 1300, 900))
}
console.log("=== vary trough depth (dn 0.3/0.5) with rc0.3 len10 ===")
for (const dn of [0.3, 0.4, 0.5]) {
  const c = gen4(80, 45, 70, 0.7, dn, 0.3, 10)
  report(`dn${dn}`, c, vols(c, 1300, 900))
}
console.log("=== vary peak height (up 0.5/0.8) with dn0.4 rc0.3 len10 ===")
for (const up of [0.5, 0.6, 0.8]) {
  const c = gen4(80, 45, 70, up, 0.4, 0.3, 10)
  report(`up${up}`, c, vols(c, 1300, 900))
}
