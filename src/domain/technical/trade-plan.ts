// =============================================================================
// EGXANO Trade Plan builder — deterministic entry / stop / target zones.
// =============================================================================
//
// تحويل القراءة الفنية الحتمية (buy / hold / sell) إلى مناطق سعرية ملموسة:
// منطقة دخول، وقف خسارة، وهدف — مثبتة على هيكل السعردعم/مقاومة + توسيع ATR.
//
// tech-signals@5 REWRITE (audit root cause #5 — mechanical plans):
//   • Stops come from STRUCTURE (nearest swing support/resistance) minus/plus
//     1.5×ATR, then a sanity band clamps the stop distance into
//     [0.5×ATR, 3.5×ATR] of the entry mid — never inside normal noise, never
//     absurdly far. The flat −4.5% chasing stop and the ±2%/8% blind clamps
//     are gone. Close-only paths (no true ATR) use the documented close-to-close
//     volatility proxy × 1.5 (daily true range typically exceeds the
//     close-to-close move because intraday extremes are excluded from σ; 1.5
//     is the neutral midpoint of the usual 1.2–1.8 band) and the plan text
//     DISCLOSES the proxy instead of claiming real ATR.
//   • Targets come from the NEXT STRUCTURAL ZONE (zones.ts supply/demand bands
//     when passed, else pivot levels) with a MEASURED-MOVE fallback (the recent
//     40-session range height projected from the entry). No mechanical 2R.
//   • RR is VALIDATED: a plan with RR < 1.5 is rejected (null) — WAIT means NO
//     plan (unchanged contract), and a buy/sell without a reachable structural
//     target means NO plan. No fabricated levels anywhere.
//   • All prices pass through roundToTick().
//
// HONESTY RULES (unchanged):
//   • الوحدة حتمية 100%: لا ذكاء اصطناعي ولا عشوائية — كل مستوى مشتق من
//     بيانات الأسعار الحقيقية بمعادلات موثقة وقابل لإعادة الحساب خطوة بخطوة.
//   • المخرجات معلوماتية فقط وليست توصية استثمارية ولا دعوة للتنفيذ.
//   • الخطة تتلغى فورًا لو السهم قفل خارج حدودها — والنص يذكر ذلك صراحة.
//   • لا توجد بيانات كافية → null — لا يُختلق مستوى أبدًا.
// =============================================================================

import { supportResistance, type Bar } from "./indicators"

export interface TradePlan {
  bias: "buy" | "sell"
  entryLow: number
  entryHigh: number
  /** entry-mid distance from the last close, percent (1dp) */
  entryPct: number
  stop: number
  /** stop distance from the ENTRY MID, percent (1dp; negative for buy) — the
   *  risk actually taken when the plan fills, so |stopPct| and targetPct tie
   *  out to riskReward instead of being measured against a price nobody paid. */
  stopPct: number
  targetLow: number
  targetHigh: number
  /** target-mid distance from the ENTRY MID, percent (1dp) — the reward per
   *  unit paid at the entry, which is the number the R/R is made of. */
  targetPct: number
  /** (target-mid − entry-mid) / (entry-mid − stop) — 2dp, validated ≥ 1.5 */
  riskReward: number
  textAr: string
  textEn: string
  /** one-line Arabic basis of where the levels came from */
  basisAr: string
  /** which structural source produced the target (additive @5) */
  targetKind?: "zone" | "pivot" | "measured_move"
}

export interface PlanZone {
  kind: "demand" | "supply"
  low: number
  high: number
}

export interface TradePlanInput {
  signal: "buy" | "hold" | "sell"
  lastClose: number
  /** ascending close-only series — pivot zones are derived from the LAST 120
   *  closes when supports/resistances are not passed (close-only bars documented
   *  precedent, same as the light close engine). */
  closes: number[]
  /** precomputed pivot levels (e.g. TechnicalSnapshot.levels) take precedence */
  supports?: { price: number }[] | null
  resistances?: { price: number }[] | null
  /** supply/demand zones (zones.ts) — the TARGET source when reachable */
  zones?: PlanZone[] | null
  /** ATR as percent of price — the real volatility input when known */
  atrPct?: number | null
  /** close-to-close daily volatility % — the documented ATR proxy on
   *  close-only paths (board); used only when atrPct is absent */
  volPct?: number | null
}

// ---- geometry constants (documented, deterministic) -------------------------
const ATR_PROXY_FACTOR = 1.5 // close-only proxy: ATR ≈ 1.5 × daily close-to-close σ
const STOP_ATR_MULT = 1.5 // stop = structural anchor ± 1.5×ATR
const STOP_MIN_ATR = 0.5 // sanity band: stop never closer than 0.5×ATR (noise)
// 2026-11-15 owner report: "وقف الخسارة بعيد جدا عن منطقة الدخول". The old
// 3.5×ATR ceiling let a 3%-daily-volatility name print a stop ~16% below its
// entry, which is not a stop — it is a different trade. 2.0×ATR is the widest
// distance that still reads as the same setup's invalidation.
const STOP_MAX_ATR = 2.0 // sanity band: stop never farther than 2.0×ATR
const MIN_RR = 1.5 // a plan paying less than 1.5R is REJECTED, not fudged
const MEASURED_WINDOW = 40 // measured-move lookback (range height projection)

const roundPct = (x: number): number => Math.round(x * 10) / 10
const roundRR = (x: number): number => Math.round(x * 100) / 100
const fmtPrice = (x: number): string => x.toFixed(2)

/**
 * EGX tick-size rounding. The official EGX tick table is price-band dependent
 * and MUST be verified against official EGX rules before tightening — 0.01 EGP
 * is the safe fine-grained default. This helper exists so a real, verified
 * tick table can be dropped in without touching the plan geometry; do NOT
 * invent a price-band table here.
 *
 * DIRECTION MATTERS (remediation 2026-11-15). Nearest-rounding every level
 * independently can make a plan look better than it is: a stop nudged 0.004
 * closer or a target nudged 0.004 further changes the printed R/R without any
 * change in the underlying analysis. Every level is therefore rounded in the
 * direction that is CONSERVATIVE for the trader:
 *   BUY  — entry UP (never fill better), stop DOWN (never tighter), target UP
 *   SELL — entry DOWN (never fill better), stop UP (never tighter), target UP
 *          (a higher sell target is farther away, i.e. less reward per unit risk)
 *   "nearest" — display-only levels where direction carries no risk meaning
 * The plan builder then RE-VALIDATES R/R on the rounded numbers, so a plan can
 * only be rejected by rounding, never silently improved by it.
 */
export type TickDirection = "nearest" | "up" | "down"

export function roundToTick(price: number, tick = 0.01, dir: TickDirection = "nearest"): number {
  if (!Number.isFinite(price) || !(tick > 0)) return price
  const steps = price / tick
  // guard float dust (e.g. 100.0000000001 / 0.01) before choosing a direction
  const snapped = Math.abs(steps - Math.round(steps)) < 1e-9 ? Math.round(steps) : steps
  const q = dir === "up" ? Math.ceil(snapped) : dir === "down" ? Math.floor(snapped) : Math.round(snapped)
  return Math.round(q * tick * 1e8) / 1e8
}

function validPrice(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x > 0
}

/** Highest price strictly below `ref` (nearest support), null when none.
 *  Exported for the watching-setup layer in signals.ts (additive: same
 *  helper, same semantics — no duplicated geometry). */
export function nearestBelow(prices: number[], ref: number): number | null {
  let best: number | null = null
  for (const p of prices) {
    if (p < ref && (best === null || p > best)) best = p
  }
  return best
}

/** Lowest price strictly above `ref` (nearest resistance), null when none.
 *  Exported for the watching-setup layer in signals.ts (additive). */
export function nearestAbove(prices: number[], ref: number): number | null {
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

/** Recent 40-session range height — the measured-move projection input.
 *  Exported for the watching-setup layer in signals.ts (additive). */
export function measuredHeight(closes: number[]): number | null {
  const win = closes.slice(-MEASURED_WINDOW).filter(validPrice)
  if (win.length < 20) return null
  const h = Math.max(...win)
  const l = Math.min(...win)
  return h > l ? h - l : null
}

/**
 * Stop sanity band: the distance from the entry mid is clamped into
 * [0.5×ATR, 2.0×ATR] (or [2%, 8%] when no volatility input exists) so the stop
 * is never inside normal noise nor absurdly far from the entry. When the clamp
 * moves the stop off its structural anchor the basis text discloses it.
 */
function bandStop(entryMid: number, rawStop: number, atrAbs: number | null, dir: "below" | "above"): number {
  const minDist = atrAbs !== null ? STOP_MIN_ATR * atrAbs : entryMid * 0.02
  const maxDist = atrAbs !== null ? STOP_MAX_ATR * atrAbs : entryMid * 0.08
  let dist = Math.abs(entryMid - rawStop)
  if (!(dist > 0)) dist = minDist
  if (dist < minDist) dist = minDist
  if (dist > maxDist) dist = maxDist
  return dir === "below" ? entryMid - dist : entryMid + dist
}

interface TargetCandidate {
  low: number
  high: number
  kind: "zone" | "pivot" | "measured_move"
}

/**
 * Build the deterministic trade plan for one signal.
 * Returns null when a plan cannot be anchored on real levels or no candidate
 * target pays ≥ 1.5R (hold → always null: WAIT means NO plan).
 */
export function buildTradePlan(p: TradePlanInput): TradePlan | null {
  const lc = p.lastClose
  if (!validPrice(lc)) return null
  if (p.signal === "hold") return null
  // EGX REALITY (2026-11-15 owner report: "صفقات بيع كتير مع ان السوق المصري
  // بيسمح بصفقات الشراء فقط"). The Egyptian Exchange has no retail
  // short-selling mechanism, so an entry/stop/target plan BELOW the market is
  // not executable by anyone reading this product. A sell read therefore stays
  // exactly what the engine says it is — a sell-pressure / risk warning (exit
  // or avoid) — and is never turned into a tradable plan. The old sell
  // geometry is removed here, not merely hidden, so no caller can surface it.
  if (p.signal === "sell") return null

  const passedSupports = (p.supports ?? []).map((z) => z?.price).filter(validPrice)
  const passedResistances = (p.resistances ?? []).map((z) => z?.price).filter(validPrice)
  const derived = deriveZones(Array.isArray(p.closes) ? p.closes : [])
  const supPrices = passedSupports.length ? passedSupports : derived.supports.map((z) => z.price)
  const resPrices = passedResistances.length ? passedResistances : derived.resistances.map((z) => z.price)

  const s1 = nearestBelow(supPrices, lc)
  const r1 = nearestAbove(resPrices, lc)
  const atrPct = typeof p.atrPct === "number" && Number.isFinite(p.atrPct) && p.atrPct > 0 ? p.atrPct : null
  const volPct = typeof p.volPct === "number" && Number.isFinite(p.volPct) && p.volPct > 0 ? p.volPct : null
  const effAtrPct = atrPct ?? (volPct !== null ? volPct * ATR_PROXY_FACTOR : null)
  const atrAbs = effAtrPct !== null ? (effAtrPct / 100) * lc : null
  const usesProxy = atrPct === null && volPct !== null
  const proxyNoteAr = usesProxy ? " (تقلب تقريبي من الإغلاقات — لا ATR حقيقي)" : ""

  // ---------------- buy — entry zone anchored on the nearest support
  if (s1 === null) return null // no structural floor → no honest buy plan
  const chasing = ((lc - s1) / s1) * 100 > 6
  const entryLowRaw = Math.max(s1 * 1.002, lc * 0.985)
  const entryHighRaw = lc * 1.004
  if (!(entryHighRaw > entryLowRaw)) return null
  const entryMidRaw = (entryLowRaw + entryHighRaw) / 2
  // stop BELOW the structural support − 1.5×ATR, sanity-banded
  const stopRaw = bandStop(entryMidRaw, s1 - (atrAbs !== null ? STOP_ATR_MULT * atrAbs : s1 * 0.02), atrAbs, "below")
  const riskDist = entryMidRaw - stopRaw
  if (!(riskDist > 0) || !(stopRaw < entryLowRaw)) return null
  // target candidates: supply zone above → resistance pivot → measured move up
  const cands: TargetCandidate[] = []
  const supplyZones = (p.zones ?? []).filter((z) => z.kind === "supply" && validPrice(z.low) && z.low > entryHighRaw).sort((a, b) => a.low - b.low)
  if (supplyZones[0]) cands.push({ low: supplyZones[0].low, high: supplyZones[0].high, kind: "zone" })
  if (r1 !== null && r1 > entryHighRaw) cands.push({ low: r1 * 0.998, high: r1 * 1.004, kind: "pivot" })
  const mm = measuredHeight(p.closes ?? [])
  if (mm !== null) cands.push({ low: entryMidRaw + mm, high: entryMidRaw + mm, kind: "measured_move" })
  let target: TargetCandidate | null = null
  for (const c of cands) {
    const mid = (c.low + c.high) / 2
    if (!(mid > entryHighRaw)) continue
    if ((mid - entryMidRaw) / riskDist >= MIN_RR) {
      target = c
      break
    }
  }
  if (!target) return null // nothing pays ≥ 1.5R → NO plan (no fabricated levels)
  // BUY conservative rounding: a HIGHER entry and a FARTHER target both
  // reduce reward, and a LOWER stop widens risk — so none of the three can
  // flatter the printed R/R. The R/R below is then re-validated on these
  // rounded numbers, so rounding can only reject a plan, never improve it.
  const entryLow = roundToTick(entryLowRaw, 0.01, "up")
  const entryHigh = roundToTick(Math.max(entryHighRaw, entryLowRaw), 0.01, "up")
  const stop = roundToTick(stopRaw, 0.01, "down")
  const targetLow = roundToTick(target.low, 0.01, "up")
  const targetHigh = roundToTick(Math.max(target.high, target.low), 0.01, "up")
  const entryMid = (entryLow + entryHigh) / 2
  const targetMid = (targetLow + targetHigh) / 2
  const rr = roundRR((targetMid - entryMid) / (entryMid - stop))
  if (!(rr >= MIN_RR) || !(stop < entryLow) || !(targetMid > entryHigh)) return null
  const entryTxt = `${fmtPrice(entryLow)}–${fmtPrice(entryHigh)}`
  const targetTxtAr = targetLow === targetHigh ? `عند ${fmtPrice(targetLow)}` : `منطقة من ${fmtPrice(targetLow)} لـ ${fmtPrice(targetHigh)}`
  const targetTxtEn = targetLow === targetHigh ? `at ${fmtPrice(targetLow)}` : `${fmtPrice(targetLow)}–${fmtPrice(targetHigh)}`
  const basisAr = chasing
    ? `دخول على التصحيح مش المطاردة — وقف هيكلي تحت ${fmtPrice(stop)} موسّع بـ 1.5×ATR${proxyNoteAr}`
    : `فوق الدعم الأقرب — وقف هيكلي تحت ${fmtPrice(stop)} موسّع بـ 1.5×ATR${proxyNoteAr}`
  return {
    bias: "buy",
    entryLow,
    entryHigh,
    entryPct: roundPct(((entryMid - lc) / lc) * 100),
    stop,
    stopPct: roundPct(((stop - entryMid) / entryMid) * 100),
    targetLow,
    targetHigh,
    targetPct: roundPct(((targetMid - entryMid) / entryMid) * 100),
    riskReward: rr,
    textAr: `منطقة الدخول من ${fmtPrice(entryLow)} لـ ${fmtPrice(entryHigh)}، وقف الخسارة تحت ${fmtPrice(stop)} — والهدف الهيكلي ${targetTxtAr}. القراءة تتلغى لو السهم قفل تحت وقف الخسارة.`,
    textEn: `Entry zone ${entryTxt}, stop below ${fmtPrice(stop)}, structural target ${targetTxtEn}. The plan is void on a close below the stop.`,
    basisAr,
    targetKind: target.kind,
  }
}
