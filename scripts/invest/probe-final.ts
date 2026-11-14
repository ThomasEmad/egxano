// Probe 5: final calibration — A) fresh buy with healthyUptrend generator,
// B) thin-participation variant of the SAME price → weak_volume_no_buy,
// C) trade-plan RR rejection with the REAL test zigzag helper.
import { computeCloseSignal, type CloseRow } from "../../src/lib/technical/signals"
import { buildTradePlan } from "../../src/lib/technical/trade-plan"

function rowsFrom(closes: number[], volumes: number[]): CloseRow[] {
  const out: CloseRow[] = []
  const start = new Date("2025-06-02T00:00:00Z").getTime()
  for (let i = 0; i < closes.length; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10)
    out.push({ ts: day, close: closes[i], volume: volumes[i] })
  }
  return out
}

/** healthy uptrend: rally → local peak → pullback → modest recovery that stays
 *  below the peak: RSI back in 45-60, close mid-range, MACD positive — every
 *  dimension reaches its decision bar → a genuine fresh buy read. */
function healthyUptrend(n = 80): number[] {
  const out: number[] = []
  let p = 50
  for (let i = 0; i < n; i++) {
    if (i <= 45) p *= i % 2 === 0 ? 1.006 : 0.9975 // rally with noise
    else if (i <= 70) p *= i % 2 === 0 ? 0.996 : 1.00125 // pullback
    else p *= 1.003 // modest recovery, stays below the rally peak
    out.push(Math.round(p * 100) / 100)
  }
  return out
}

function vols(closes: number[], upV: number, dnV: number): number[] {
  return closes.map((c, i) => (i === 0 ? 1000 : c >= closes[i - 1] ? upV : dnV))
}

// zigzagWithZones — verbatim from trade-plan.test.ts
function zigzagWithZones(): number[] {
  const out: number[] = []
  for (let i = 0; i < 12; i++) out.push(100)
  out.push(97, 95, 97, 100)
  for (let i = 1; i <= 8; i++) out.push(100 + i * 1.25)
  out.push(111, 113, 115, 113, 111, 110)
  out.push(108.34, 106.67, 105, 103.34, 101.67, 100)
  return out
}

console.log("=== A) healthy uptrend, up-session volume dominant ===")
{
  const c = healthyUptrend(80)
  const v = vols(c, 1300, 900)
  const sig = computeCloseSignal(rowsFrom(c, v))
  console.log(JSON.stringify({ signal: sig.signal, score: sig.score, dims: sig.dimensions, reasons: sig.reasons.map((r) => r.code), plan: sig.tradePlan && { bias: sig.tradePlan.bias, entryLow: sig.tradePlan.entryLow, stop: sig.tradePlan.stop, rr: sig.tradePlan.riskReward } }))
}

console.log("=== B) same price, distribution volumes (thin ups, heavy downs) ===")
{
  const c = healthyUptrend(80)
  const v = vols(c, 400, 4000)
  const sig = computeCloseSignal(rowsFrom(c, v))
  console.log(JSON.stringify({ signal: sig.signal, score: sig.score, dims: sig.dimensions, reasons: sig.reasons.map((r) => r.code), r0ar: sig.reasons[0]?.ar }))
}

console.log("=== C) trade-plan wide ATR sweep (real zigzag) ===")
{
  const c = zigzagWithZones()
  for (const atr of [5, 6, 6.5, 7]) {
    const plan = buildTradePlan({ signal: "buy", lastClose: 100, closes: c, atrPct: atr })
    console.log(atr, "->", plan ? JSON.stringify({ stop: plan.stop, entryLow: plan.entryLow, entryHigh: plan.entryHigh, targetLow: plan.targetLow, rr: plan.riskReward }) : "null")
  }
}
