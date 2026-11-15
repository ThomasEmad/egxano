// =============================================================================
// Signal engine v2 — trade plan builder (PURE).
// THE MATH CONTRACT (unit-tested, the exact bug class the owner reported):
//   BUY  : stop < entryLow ≤ entryHigh ≤ close-band, target1 > close,
//          target2 > target1, RR = (T1 − entryMid) / (entryMid − stop).
//   NEAR : the provisional plan is built AT the activation price (never at a
//          stale anchor) and must satisfy the same invariants, else the setup
//          is dropped — no dead geometry is ever published.
// Levels come from REAL structure: zones from levels.ts + ATR for stop
// offsets. No flat-percentage stops, no fabricated measured moves.
// =============================================================================

import { nearestResistanceAbove, type ZoneMap } from "./levels"
import type { MetricsBundle } from "./metrics"
import { round2 } from "./metrics"
import type { TradePlanV2 } from "./types"

export interface PlanContext {
  /** live close the plan is anchored on (lastClose, or activation for NEAR) */
  anchor: number
  map: ZoneMap
  m: MetricsBundle
  /** entry band offset context (the archetype's structural level) */
  level: number
  /** detection strength (feeds how much ATR margin the stop gets) */
  strength: number
}

/** Round to an EGX-friendly tick: ≥100 → 0.05, ≥10 → 0.01, else 0.01. */
export function roundToTick(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return price
  if (price >= 100) return Math.round(price * 20) / 20
  return Math.round(price * 100) / 100
}

/**
 * Build a BUY plan. Returns null when no honest plan exists at this anchor —
 * the caller must NOT invent levels (no plan ≠ a worse plan).
 */
export function buildBuyPlan(ctx: PlanContext): TradePlanV2 | null {
  const { anchor, map, m, level } = ctx
  if (!Number.isFinite(anchor) || anchor <= 0) return null
  if (m.atr14 === null || m.atr14 <= 0) return null
  const atr = m.atr14

  // ---- entry band: today's close is the executable reference. The band is
  // the structural level's influence on WHERE, but never far from the market:
  // entry = [anchor − 0.35×ATR, anchor] — a limit-buy band around the live price.
  const entryHigh = roundToTick(anchor)
  const entryLow = roundToTick(Math.max(entryHigh - atr * 0.35, entryHigh * 0.97))
  if (entryLow <= 0 || entryLow > entryHigh) return null

  // ---- stop: below the structure that the setup depends on.
  // For a breakout/retest: below the broken zone top (the level becomes support).
  // For a bounce: below the support zone low.
  // For continuation/reversal: below the anchor by a structure-aware ATR offset.
  let stopRaw: number
  let stopBasisAr: string
  if (level > 0 && level < anchor) {
    // the structural level sits below the price (a support we can lean on)
    stopRaw = Math.min(level - atr * 0.5, anchor - atr)
    stopBasisAr = `تحت المستوى البنيوي ${level.toFixed(2)} بهامش نصف ATR — وقف على مستوى فني واضح`
  } else {
    stopRaw = anchor - atr * (1.1 + 0.4 * ctx.strength)
    stopBasisAr = `تحت الإغلاق بهامش ATR يتغير مع قوة الإعداد (${(1.1 + 0.4 * ctx.strength).toFixed(1)}×) — لا وقف نسبة ثابتة`
  }
  const stop = roundToTick(Math.min(stopRaw, entryLow * 0.99))
  if (stop <= 0 || stop >= entryLow) return null // hard invariant

  // ---- target 1: the nearest real resistance above; else a measured ATR move.
  // MUST be above the live close (the VLMRA invariant) — else no honest target.
  const t1Cand = nearestResistanceAbove(map, Math.max(anchor, entryHigh))
  let target1: number
  let target1BasisAr: string
  const minT1 = anchor + atr * 0.6 // an honest first target at minimum
  if (t1Cand && t1Cand.low > Math.max(entryHigh, minT1)) {
    target1 = roundToTick((t1Cand.low + t1Cand.high) / 2)
    target1BasisAr = `منطقة مقاومة ${t1Cand.touches}× مختبَرة (${t1Cand.low.toFixed(2)}–${t1Cand.high.toFixed(2)})`
  } else {
    target1 = roundToTick(anchor + atr * 1.6)
    target1BasisAr = `حركة مقاسة بمقدار 1.6× ATR من الإغلاق (لا توجد مقاومة أعلى مسجلة)`
  }
  if (target1 <= entryHigh || target1 <= anchor) return null // the published invariant

  // ---- target 2: the next resistance above T1 when it gives ≥ 0.6×ATR more.
  let target2: number | null = null
  let target2BasisAr: string | null = null
  if (t1Cand) {
    const above = map.zones.filter((z) => z.kind === "resistance" && !z.broken && z.low > target1 + atr * 0.6)
    const next = above[0]
    if (next) {
      target2 = roundToTick((next.low + next.high) / 2)
      target2BasisAr = `منطقة المقاومة التالية ${next.touches}× مختبَرة (${next.low.toFixed(2)}–${next.high.toFixed(2)})`
    }
  }
  if (target2 !== null && target2 <= target1) {
    target2 = null
    target2BasisAr = null
  }

  // ---- RR on the entry mid (exact math, rounded for display)
  const entryMid = (entryLow + entryHigh) / 2
  const risk = entryMid - stop
  const reward = target1 - entryMid
  if (risk <= 0 || reward <= 0) return null
  const riskReward = round2(reward / risk)
  if (riskReward < 1.2) return null // not a trade — no plan published rather than a bad one

  return {
    side: "buy",
    entryLow,
    entryHigh,
    stop,
    target1,
    target2,
    riskReward,
    target1BasisAr,
    target2BasisAr,
    stopBasisAr,
  }
}

/**
 * Build the NEAR setup: provisional plan computed AT the activation price.
 * The provisional RR must clear the floor at the ACTIVATION entry, or the
 * setup is dropped (returns null) — a near with dead levels is not published.
 */
export function buildNearSetup(args: {
  anchor: number // current live close
  activation: number // the close-based trigger level
  /** the structural level the stop leans on (the zone the activation breaks) */
  level: number
  activationAr: string
  map: ZoneMap
  m: MetricsBundle
  strength: number
  preEntryInvalidationAr: string
}): import("./types").NearSetup | null {
  const { anchor, activation, level, map, m, strength } = args
  if (!Number.isFinite(activation) || activation <= anchor * 0.5) return null
  // provisional plan anchored at the activation price (the entry the trigger
  // would produce) — validated with the SAME builder, same invariants
  const provisional = buildBuyPlan({
    anchor: activation,
    map,
    m,
    level,
    strength,
  })
  if (!provisional) return null
  return {
    activation: roundToTick(activation),
    activationAr: args.activationAr,
    activationGapPct: Math.round(((activation - anchor) / anchor) * 1000) / 10,
    provisional,
    preEntryInvalidationAr: args.preEntryInvalidationAr,
  }
}
