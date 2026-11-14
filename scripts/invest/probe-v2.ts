// One-off probe: prints the exact @5 outputs the updated tests will pin.
import { computeCloseSignal, computeStanceFromSnapshot, applyHysteresis, type CloseRow } from "../../src/lib/technical/signals"
import { assembleBundle } from "../../src/lib/technical/analyze"
import { buildTradePlan, roundToTick } from "../../src/lib/technical/trade-plan"
import type { Bar } from "../../src/lib/technical/indicators"

function rowsFrom(closes: number[], volumes: number[] | null = null): CloseRow[] {
  const out: CloseRow[] = []
  const start = new Date("2025-06-02T00:00:00Z").getTime()
  for (let i = 0; i < closes.length; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10)
    out.push({ ts: day, close: closes[i], volume: volumes ? volumes[i] : 1000 + (i % 5) * 50 })
  }
  return out
}
function uptrendCloses(n = 80): number[] {
  const out: number[] = []
  let p = 50
  for (let i = 0; i < n; i++) { p *= i % 3 === 2 ? 0.992 : 1.01; out.push(Math.round(p * 100) / 100) }
  return out
}
function downtrendCloses(n = 80): number[] {
  const out: number[] = []
  let p = 78
  for (let i = 0; i < 6; i++) { out.push(Math.round(p * 100) / 100); p *= 1.005 }
  out.push(82)
  p = 80.5
  for (let i = 7; i < n; i++) { p *= 0.995; out.push(Math.round(p * 100) / 100) }
  return out
}
function flatCloses(n = 80): number[] {
  const out: number[] = []
  let p = 100
  for (let i = 0; i < n; i++) { p *= i % 2 === 0 ? 1.008 : 0.992; out.push(Math.round(p * 100) / 100) }
  return out
}
function bundleBars(closes: number[]): Bar[] {
  return closes.map((c, i) => ({
    ts: new Date(new Date("2025-06-02T00:00:00Z").getTime() + i * 86_400_000).toISOString().slice(0, 10),
    open: c * 0.995, high: c * 1.01, low: c * 0.985, close: c, volume: 1000 + (i % 7) * 80,
  }))
}
function zigzagWithZones(): number[] {
  const out: number[] = []
  for (let i = 0; i < 12; i++) out.push(100)
  out.push(97, 95, 97, 100)
  for (let i = 1; i <= 8; i++) out.push(100 + i * 1.25)
  out.push(111, 113, 115, 113, 111, 110)
  out.push(108.34, 106.67, 105, 103.34, 101.67, 100)
  return out
}
function chasingCloses(): number[] {
  const out: number[] = []
  for (let i = 0; i < 6; i++) out.push(95)
  out.push(92)
  for (let i = 0; i < 6; i++) out.push(95)
  for (let i = 1; i <= 14; i++) out.push(95 + i * (25 / 14))
  return out
}

const up = computeCloseSignal(rowsFrom(uptrendCloses(80), uptrendCloses(80).map((_, i) => 1000 + i * 5)))
console.log("UP:", up.signal, up.score, JSON.stringify(up.dimensions), "plan:", up.tradePlan ? `${up.tradePlan.entryLow}-${up.tradePlan.entryHigh} stop ${up.tradePlan.stop} tgt ${up.tradePlan.targetLow}-${up.tradePlan.targetHigh} rr ${up.tradePlan.riskReward} basis ${up.tradePlan.basisAr}` : null, "reasons:", up.reasons.map(r => r.code).join(","), "styles:", up.styleFits.map(f => f.tag).join(","))

const down = computeCloseSignal(rowsFrom(downtrendCloses(80), downtrendCloses(80).map((_, i) => 1200 - i * 5)))
console.log("DOWN:", down.signal, down.score, JSON.stringify(down.dimensions), "plan:", down.tradePlan ? `${down.tradePlan.bias} stop ${down.tradePlan.stop} tgt ${down.tradePlan.targetLow}` : null, "reasons:", down.reasons.map(r => r.code).join(","))

const flat = computeCloseSignal(rowsFrom(flatCloses()))
console.log("FLAT:", flat.signal, flat.score, JSON.stringify(flat.dimensions))

const mid = computeCloseSignal(rowsFrom(uptrendCloses(40)))
console.log("MID40:", mid.signal, mid.score, JSON.stringify(mid.dimensions))
const weak17 = computeCloseSignal(rowsFrom(uptrendCloses(17)))
console.log("WEAK17:", weak17.signal, weak17.score, weak17.limitations.join(" | "))

const bundle = assembleBundle(bundleBars(uptrendCloses(80)))
const stance = computeStanceFromSnapshot(bundle.snapshot)
console.log("SNAP-TRAIL:", stance.signal, stance.score, JSON.stringify(stance.dimensions.find(d => d.key === "trend")), "trailLen:", bundle.snapshot.trail?.length, "reasons:", stance.reasons.map(r => r.code).join(","))

const empty = assembleBundle([]).snapshot
const strongSnap = { ...empty, available: true, sessions: 250, lastClose: 110, perf: { ...empty.perf, d1: 1.5 }, trend: { ema20: 107, ema50: 100, ema200: 90, priceVsEma20: "above", priceVsEma50: "above", priceVsEma200: "above", ema20VsEma50: "above", ema50VsEma200: "above", alignment: "aligned_uptrend", cross50200: "golden", cross50200Age: 30 }, momentum: { rsi14: 55, macd: { macd: 2, signal: 1, histogram: 1 }, stochastic: { k: 60, d: 40 } }, volume: { obv: 1, obvSlope20: 500, volMa20: 1000, relVol: 2.5, volumeWindow: 20 }, volatility: { atr14: 2.7, atrPct: 2.5, bollinger: { upper: null, middle: null, lower: null, widthPct: null, percentB: null }, histVol20: null }, levels: { supports: [], resistances: [] } } as Parameters<typeof computeStanceFromSnapshot>[0]
const s1 = computeStanceFromSnapshot(strongSnap)
console.log("STRONG-SNAP:", s1.signal, s1.score, JSON.stringify(s1.dimensions))

const gatedSnap = { ...strongSnap, volume: { obv: 1, obvSlope20: 500, volMa20: 1000, relVol: 1.0, volumeWindow: 20 } } as Parameters<typeof computeStanceFromSnapshot>[0]
const s2 = computeStanceFromSnapshot(gatedSnap)
console.log("GATED-SNAP:", s2.signal, s2.score)

// trade plan probes
const p1 = buildTradePlan({ signal: "buy", lastClose: 100, closes: zigzagWithZones(), atrPct: null })
console.log("PLAN-ZIG:", p1 ? JSON.stringify({ e: [p1.entryLow, p1.entryHigh], stop: p1.stop, t: [p1.targetLow, p1.targetHigh], rr: p1.riskReward, basis: p1.basisAr, kind: p1.targetKind }) : null)
const p2 = buildTradePlan({ signal: "buy", lastClose: 120, closes: chasingCloses(), volPct: 3 })
console.log("PLAN-CHASE(volPct3):", p2 ? JSON.stringify({ e: [p2.entryLow, p2.entryHigh], stop: p2.stop, stopPct: p2.stopPct, t: [p2.targetLow, p2.targetHigh], rr: p2.riskReward, kind: p2.targetKind }) : null)
const p3 = buildTradePlan({ signal: "sell", lastClose: 100, closes: [], supports: [{ price: 94 }], resistances: [{ price: 106 }], atrPct: null })
console.log("PLAN-SELL:", p3 ? JSON.stringify({ e: [p3.entryLow, p3.entryHigh], stop: p3.stop, t: [p3.targetLow, p3.targetHigh], rr: p3.riskReward }) : null)
const p4 = buildTradePlan({ signal: "buy", lastClose: 101.2, closes: [], supports: [{ price: 97.35 }], resistances: [{ price: 112.47 }], atrPct: null })
console.log("PLAN-ROUND:", p4 ? [p4.entryLow, p4.entryHigh, p4.stop, p4.targetLow, p4.targetHigh, p4.riskReward].join(" ") : null)
// tight stop sanity: support very close to entry mid → stop clamped to 0.5×ATR
const p5 = buildTradePlan({ signal: "buy", lastClose: 100.5, closes: [], supports: [{ price: 100.2 }], atrPct: 3 })
console.log("PLAN-TIGHTSTOP:", p5 ? JSON.stringify({ stop: p5.stop, stopPct: p5.stopPct }) : null)
console.log("TICK:", roundToTick(123.456), roundToTick(123.4549))
// hysteresis quick probe: construct reads
const reads = [
  { ts: "d1", signal: "buy" as const, score: 70, changePct: 1, structural: false, dims: [], facts: null },
  { ts: "d2", signal: "hold" as const, score: 58, changePct: 0.5, structural: false, dims: [], facts: null },
  { ts: "d3", signal: "hold" as const, score: 58, changePct: 0.2, structural: false, dims: [], facts: null },
]
console.log("HYST:", JSON.stringify(applyHysteresis(reads)))
