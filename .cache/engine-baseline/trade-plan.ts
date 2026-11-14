// =============================================================================
// EGXANO Trade Plan builder — deterministic entry / stop / target zones.
// =============================================================================
//
// تحويل القراءة الفنية الحتمية (buy / hold / sell) إلى مناطق سعرية ملموسة:
// منطقة دخول، وقف خسارة، وهدف — مثبتة على أقرب دعم/مقاومة وتقلب ATR.
//
// HONESTY RULES:
//   • الوحدة حتمية 100%: لا ذكاء اصطناعي ولا عشوائية — كل مستوى مشتق من
//     بيانات الأسعار الحقيقية بمعادلات موثقة (نفس محرك الدعوم/المقاومات
//     في indicators.ts) وقابل لإعادة الحساب خطوة بخطوة.
//   • المخرجات معلوماتية فقط وليست توصية استثمارية ولا دعوة للتنفيذ —
//     القرار النهائي ومسؤوليته على المستخدم.
//   • الخطة تتلغي فورًا لو السهم قفل خارج حدودها (تحت وقف الخسارة في
//     القراءة الشرائية / فوقه في القراءة البيعية) — والنص يذكر ذلك صراحة.
//   • لا توجد بيانات كافية → null (مثلاً: قراءة بيع من غير مقاومة قابلة
//     للاستخدام) — لا يُختلق مستوى أبدًا.
// =============================================================================

import { supportResistance, type Bar } from "./indicators"

export interface TradePlan {
  bias: "buy" | "sell"
  entryLow: number
  entryHigh: number
  /** entry-mid distance from the last close, percent (1dp) */
  entryPct: number
  stop: number
  /** stop distance from the last close, percent (1dp; negative for buy) */
  stopPct: number
  targetLow: number
  targetHigh: number
  /** target-mid distance from the last close, percent (1dp) */
  targetPct: number
  /** (target-mid − entry-mid) / (entry-mid − stop) — 2dp */
  riskReward: number
  textAr: string
  textEn: string
  /** one-line Arabic basis of where the levels came from */
  basisAr: string
}

export interface TradePlanInput {
  signal: "buy" | "hold" | "sell"
  lastClose: number
  /** ascending close-only series — zones are derived from the LAST 120 closes
   *  when supports/resistances are not passed (close-only bars documented
   *  precedent, same as the light close engine). */
  closes: number[]
  /** precomputed zones (e.g. TechnicalSnapshot.levels) take precedence */
  supports?: { price: number }[] | null
  resistances?: { price: number }[] | null
  /** ATR as percent of price — widens the stop; null keeps the defaults */
  atrPct?: number | null
}

const roundPrice = (x: number): number => Math.round(x * 100) / 100
const roundPct = (x: number): number => Math.round(x * 10) / 10
const roundRR = (x: number): number => Math.round(x * 100) / 100
const fmtPrice = (x: number): string => x.toFixed(2)

function validPrice(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x > 0
}

/** Highest price strictly below `ref` (nearest support), null when none. */
function nearestBelow(prices: number[], ref: number): number | null {
  let best: number | null = null
  for (const p of prices) {
    if (p < ref && (best === null || p > best)) best = p
  }
  return best
}

/** Lowest price strictly above `ref` (nearest resistance), null when none. */
function nearestAbove(prices: number[], ref: number): number | null {
  let best: number | null = null
  for (const p of prices) {
    if (p > ref && (best === null || p < best)) best = p
  }
  return best
}

/**
 * Derive support/resistance from closes only (last 120 sessions): close-only
 * flat bars through the SAME swing-pivot clustering the full bundle uses.
 * Flat bars yield pivots only at real swing turns — deterministic and honest.
 */
function deriveZones(closes: number[]): { supports: { price: number }[]; resistances: { price: number }[] } {
  const win = closes.slice(-120).filter(validPrice)
  if (win.length < 11) return { supports: [], resistances: [] }
  const bars: Bar[] = win.map((c, i) => ({
    ts: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10),
    open: c,
    high: c,
    low: c,
    close: c,
    volume: null,
  }))
  const z = supportResistance(bars, 5, 1.5, 4)
  return {
    supports: z.supports.map((s) => ({ price: s.price })),
    resistances: z.resistances.map((s) => ({ price: s.price })),
  }
}

/**
 * Build the deterministic trade plan for one signal.
 * Returns null when a plan cannot be anchored on real levels (hold, or a sell
 * with no usable resistance above the close) — the board then shows a neutral
 * "no clear entry zone" line instead of fabricated numbers.
 */
export function buildTradePlan(p: TradePlanInput): TradePlan | null {
  const lc = p.lastClose
  if (!validPrice(lc)) return null
  if (p.signal === "hold") return null

  const passedSupports = (p.supports ?? []).map((z) => z?.price).filter(validPrice)
  const passedResistances = (p.resistances ?? []).map((z) => z?.price).filter(validPrice)
  const derived = deriveZones(Array.isArray(p.closes) ? p.closes : [])
  const supPrices = passedSupports.length ? passedSupports : derived.supports.map((z) => z.price)
  const resPrices = passedResistances.length ? passedResistances : derived.resistances.map((z) => z.price)

  const s1 = nearestBelow(supPrices, lc)
  const r1 = nearestAbove(resPrices, lc)
  const atrPct = typeof p.atrPct === "number" && Number.isFinite(p.atrPct) && p.atrPct > 0 ? p.atrPct : null

  // ---------------- sell — exit / re-entry guidance below the nearest resistance
  if (p.signal === "sell") {
    if (r1 === null) return null // no usable resistance → no honest sell plan
    const entryLowRaw = lc * 0.995
    const entryHighRaw = Math.min(r1, lc * 1.02)
    const stopRaw = Math.min(r1 * 1.01, lc * 1.04)
    const targetRaw = s1 ?? lc * 0.93
    const entryMidRaw = (entryLowRaw + entryHighRaw) / 2
    const stopDist = stopRaw - entryMidRaw
    const rewardDist = entryMidRaw - targetRaw
    if (!(stopDist > 0) || !(rewardDist > 0)) return null
    const entryLow = roundPrice(entryLowRaw)
    const entryHigh = roundPrice(Math.max(entryHighRaw, entryLowRaw))
    const stop = roundPrice(stopRaw)
    const target = roundPrice(targetRaw)
    return {
      bias: "sell",
      entryLow,
      entryHigh,
      entryPct: roundPct(((entryMidRaw - lc) / lc) * 100),
      stop,
      stopPct: roundPct(((stopRaw - lc) / lc) * 100),
      targetLow: target,
      targetHigh: target,
      targetPct: roundPct(((targetRaw - lc) / lc) * 100),
      riskReward: roundRR(rewardDist / stopDist),
      textAr: `ضغط بيعي واضح — المنطقة دي مناسبة للخروج أو الانتظار، والهدف الأول للدعم اللي تحت عند ${fmtPrice(target)}. القراءة تتلغي لو السهم قفل فوق ${fmtPrice(stop)}.`,
      textEn: `Clear sell pressure — this zone suits exiting or waiting, with the first target at the ${fmtPrice(target)} support. The read is void on a close above ${fmtPrice(stop)}.`,
      basisAr: "تحت المقاومة الأقرب — خروج أو انتظار",
    }
  }

  // ---------------- buy — entry zone anchored on the nearest support
  const chasing = s1 === null || ((lc - s1) / s1) * 100 > 6
  let entryLowRaw: number
  let entryHighRaw: number
  let stopRaw: number
  let basisAr: string
  if (chasing) {
    // price ran >6% above the nearest support — wait for a pullback entry
    entryLowRaw = lc * 0.985
    entryHighRaw = lc * 1.004
    stopRaw = atrPct !== null && atrPct > 4 ? lc * (1 - 2 * (atrPct / 100) * 1.2) : lc * 0.955
    basisAr = "دخول على التصحيح مش المطاردة"
  } else {
    entryLowRaw = Math.max(s1! * 1.002, lc * 0.985)
    entryHighRaw = lc * 1.004
    const buf = Math.max(0.02, ((atrPct ?? 2) / 100) * 1.2)
    stopRaw = s1! * (1 - buf)
    basisAr = "فوق الدعم الأقرب"
  }
  const entryMidRaw = (entryLowRaw + entryHighRaw) / 2
  let stopDist = entryMidRaw - stopRaw
  if (!(stopDist > 0) || !(stopRaw < entryLowRaw)) return null
  if (!chasing) {
    // cap the stop distance between 2% and 8% of the entry mid
    const distPct = stopDist / entryMidRaw
    if (distPct < 0.02) {
      stopRaw = entryMidRaw * 0.98
      stopDist = entryMidRaw * 0.02
    } else if (distPct > 0.08) {
      stopRaw = entryMidRaw * 0.92
      stopDist = entryMidRaw * 0.08
    }
  }

  let targetLowRaw: number
  let targetHighRaw: number
  if (r1 !== null && (r1 - entryMidRaw) / stopDist >= 1) {
    // the nearest resistance pays at least 1R — aim at its zone
    targetLowRaw = r1 * 0.998
    targetHighRaw = r1 * 1.004
  } else {
    // otherwise the 2R rule: target = entry mid + 2 × risk
    const t = entryMidRaw + 2 * stopDist
    targetLowRaw = t
    targetHighRaw = t
  }
  const targetMidRaw = (targetLowRaw + targetHighRaw) / 2
  const rewardDist = targetMidRaw - entryMidRaw
  if (!(rewardDist > 0)) return null

  const entryLow = roundPrice(entryLowRaw)
  const entryHigh = roundPrice(Math.max(entryHighRaw, entryLowRaw))
  const stop = roundPrice(stopRaw)
  const targetLow = roundPrice(targetLowRaw)
  const targetHigh = roundPrice(Math.max(targetHighRaw, targetLowRaw))
  const entryTxt = `${fmtPrice(entryLow)}–${fmtPrice(entryHigh)}`
  const targetTxtAr = targetLow === targetHigh ? `عند ${fmtPrice(targetLow)}` : `منطقة من ${fmtPrice(targetLow)} لـ ${fmtPrice(targetHigh)}`
  const targetTxtEn = targetLow === targetHigh ? `at ${fmtPrice(targetLow)}` : `${fmtPrice(targetLow)}–${fmtPrice(targetHigh)}`

  return {
    bias: "buy",
    entryLow,
    entryHigh,
    entryPct: roundPct(((entryMidRaw - lc) / lc) * 100),
    stop,
    stopPct: roundPct(((stopRaw - lc) / lc) * 100),
    targetLow,
    targetHigh,
    targetPct: roundPct(((targetMidRaw - lc) / lc) * 100),
    riskReward: roundRR(rewardDist / stopDist),
    textAr: `منطقة الدخول من ${fmtPrice(entryLow)} لـ ${fmtPrice(entryHigh)}، وقف الخسارة تحت ${fmtPrice(stop)} — والهدف ${targetTxtAr}. القراءة تتلغي لو السهم قفل تحت وقف الخسارة.`,
    textEn: `Entry zone ${entryTxt}, stop below ${fmtPrice(stop)}, target ${targetTxtEn}. The plan is void on a close below the stop.`,
    basisAr,
  }
}
