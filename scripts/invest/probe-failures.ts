// One-off probe: prints the exact @5 outputs for the 3 failing test scenarios
// so the gate fix / test calibration can be decided from evidence.
import { computeCloseSignal, type CloseRow } from "../../src/lib/technical/signals"
import { buildTradePlan } from "../../src/lib/technical/trade-plan"

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
function healthyUptrend(n = 80): number[] {
  // REAL test generator
  const out: number[] = []
  let p = 40
  for (let i = 0; i < n; i++) { p *= i % 2 === 0 ? 1.005 : 0.996; out.push(Math.round(p * 100) / 100) }
  return out
}
function zigzagWithZones(): number[] {
  const out: number[] = []
  // engineered zigzag with swing pivots at 95 / 110 (see trade-plan.test.ts)
  const seg = [100, 97, 95, 97, 100, 105, 110, 105, 100, 97, 95, 97, 100, 105, 110, 107, 103, 99, 96, 98]
  for (let k = 0; k < 4; k++) out.push(...seg.map((v) => v + (k === 3 ? -2 : 0)))
  return out
}

console.log("=== A) healthy confirmed uptrend (expected buy) ===")
{
  const closes = healthyUptrend(80)
  const volumes = closes.map((c, i) => (i % 2 === 0 ? 1100 : 1000))
  const sig = computeCloseSignal(rowsFrom(closes, volumes))
  console.log(JSON.stringify({
    signal: sig.signal, score: sig.score,
    dimensions: sig.dimensions,
    reasons: sig.reasons.map((r) => r.code),
    plan: sig.tradePlan ? { stop: sig.tradePlan.stop, rr: sig.tradePlan.riskReward, entryLow: sig.tradePlan.entryLow, targetLow: sig.tradePlan.targetLow } : null,
  }, null, 1))
}

console.log("=== B) thin participation (expected hold + weak_volume_no_buy) ===")
{
  const closes = uptrendCloses(80)
  const volumes = closes.map((c, i) => (i % 3 === 2 ? 4000 : 400))
  const sig = computeCloseSignal(rowsFrom(closes, volumes))
  console.log(JSON.stringify({
    signal: sig.signal, score: sig.score,
    dimensions: sig.dimensions,
    reasons: sig.reasons.map((r) => r.code),
  }, null, 1))
}

console.log("=== C) trade-plan wide ATR sweep (expected null once RR < 1.5) ===")
{
  const closes = zigzagWithZones()
  for (const atr of [5, 5.5, 6, 6.5, 7, 8]) {
    const plan = buildTradePlan({ signal: "buy", lastClose: 100, closes, atrPct: atr })
    console.log(atr, "->", plan ? JSON.stringify({ stop: plan.stop, entryLow: plan.entryLow, entryHigh: plan.entryHigh, targetLow: plan.targetLow, rr: plan.riskReward }) : "null")
  }
}
