// =============================================================================
// Opportunity Target Ladder — honest structural walk above/below the entry.
// =============================================================================
// opportunity-targets@1 — consumes a resistance-map@1 map and walks the REAL
// obstacle path from the caller's entry zone, one rung per structural level.
// Deterministic only; no AI, no randomness, no probability claims.
//
// HONEST GEOMETRY RULES (owner directive — v2 recalibration):
//   R1 CONSERVATIVE EDGE ONLY, THEN STEP BACK FROM THE WALL. A buy rung takes
//      the supply band's LOWER edge, a sell rung the demand band's UPPER edge —
//      then the OWNER'S PRE-WALL BUFFER prints the target 0.5% BEFORE the wall
//      (buy: edge×(1−0.5%) rounded DOWN, sell: edge×(1+0.5%) rounded UP) — you
//      do not sell INTO the wall, you exit just before it. The rounding
//      direction always makes the printed reward HARDER, never flattered.
//      Every printed price passes roundToTick (the trade-plan.ts convention).
//   R2 MEANINGFUL ZONES ONLY. A rung must sit on a zone with
//      strength >= MIN_TARGET_STRENGTH (20) or touches >= MIN_TARGET_TOUCHES
//      (2) — one stale single-touch band is not a target. The gate is fixed
//      and documented; the ladder never cherry-picks.
//   R3′ STRONG-WALL ANCHORING (owner directive, replaces the v1 never-skip):
//      T1 anchors to the NEAREST STRONG zone beyond the entry band
//      (strength >= STRONG_TARGET_STRENGTH). Weaker near shelves are skipped
//      BY DESIGN — a soft shelf the stock can clear inside one session is not
//      a target (owner's example: a 100 EGP stock with a weak 103/104 wall
//      walks to the NEXT real wall). The number of skipped weak zones is
//      disclosed in whyAr; HORIZON_PCT stays the caller's lens and filters
//      nothing here.
//   R3″ LAST-PRICE ANCHORING (2026-11-15 owner bug report — "الهدف الأول 13.21
//      والسهم سعره 24.47"): a target the price has ALREADY passed is not a
//      target — it is support. Every rung sits beyond the CURRENT LAST CLOSE
//      as well as the entry band (buy: zone.low > max(entryHigh, lastClose);
//      sell: zone.high < min(entryLow, lastClose)), and the measured-move
//      projection must clear the last close in the trade's direction or the
//      ladder prints nothing. A stale plan entry can no longer drag the whole
//      ladder under/over the market price.
//   R4 T2 = next STRONGER rung beyond T1 (zone strength >= T1's, or the major
//      confirmed swing high/low) at least SEPARATION_PCT (2%) beyond T1's
//      printed price — a rung 0.5% past T1 is the same level, not a rung. The
//      major extreme may not sit inside the band already used by the previous
//      rung (that would re-print the same ceiling as a farther target).
//   R5 T3 ONLY ON STRUCTURAL JUSTIFICATION (spec-mandated gate): a DOMINANT
//      zone (strength >= T3_MIN_STRENGTH = 60) beyond T2 at >= 2% separation,
//      or the major confirmed swing extreme clearly above/below T2. A merely
//      meaningful (20-59) zone beyond T2 does NOT justify a third rung — the
//      ladder honestly stops at T2 rather than manufacturing a farther number.
//   R6 MEASURED-MOVE FALLBACK (kind "measured_move", strength null): ONLY when
//      the map offers NO STRONG zone beyond the entry band at all — strong
//      zones always take precedence over projections. The projection mirrors
//      trade-plan.ts: the recent 40-session range height applied to the entry
//      MID (needs >= 20 valid sessions in the window; a zero-height window
//      projects nothing), and whyAr discloses the projection basis verbatim.
//      After a measured T1 there are no T2/T3: structure said nothing beyond
//      the entry, so the ladder will not invent rungs past a projection.
//   R7 ARABIC EVIDENCE. Every whyAr cites the zone's real fields (touch
//      count, last-touch age in sessions, rejection wicks, failed breakouts,
//      volume ratio, band bounds), the pre-wall buffer, and any skipped weak
//      shelves — never a generic template, never a probability.
// =============================================================================

import type { ResistanceMap, ResistanceZone } from "./resistance-map"
import { strengthAt } from "./resistance-map"
import { roundToTick, type TickDirection } from "./trade-plan"

export const OPPORTUNITY_TARGETS_VERSION = "opportunity-targets@3"

/** Every rung rule, in one place (see header R1′-R6). */
export const TARGET_RULES = {
  /** Caller's eligibility lens only — NOT a filter in this module (R3′). */
  HORIZON_PCT: 5,
  /** R2: minimum zone strength for a meaningful rung */
  MIN_TARGET_STRENGTH: 20,
  /** R2: ...or minimum touch count for a meaningful rung */
  MIN_TARGET_TOUCHES: 2,
  /** R3′ (owner directive): minimum zone strength for a STRONG wall — T1
   *  anchors to the nearest strong zone; weaker near shelves are skipped */
  STRONG_TARGET_STRENGTH: 45,
  /** R1′ (owner directive "قبلها بنص %"): every wall rung prints 0.5% BEFORE
   *  the wall — you exit before the rejection zone, never into it */
  PREWALL_BUFFER_PCT: 0.5,
  /** R4/R5: minimum separation between consecutive rungs (percent) */
  SEPARATION_PCT: 2,
  /** R5: zone strength that justifies a T3 ("dominant") */
  T3_MIN_STRENGTH: 60,
  /** measured-move window (mirror of resistance-map MEASURED_WINDOW) */
  MEASURED_WINDOW_SESSIONS: 40,
} as const

export type TargetKind = "zone" | "major_high" | "measured_move"

export interface LadderTarget {
  label: "T1" | "T2" | "T3"
  /** conservative edge, tick-rounded "up" (R1) */
  price: number
  kind: TargetKind
  /** the zone's strength; the containing band's strength for a major extreme;
   *  null for a measured-move projection (no zone evidence exists) */
  strength: number | null
  /** Arabic rationale citing the actual computed evidence (R7) */
  whyAr: string
}

export interface TargetLadder {
  version: string
  side: "buy" | "sell"
  /** rungs in path order: T1 < T2 < T3 for buys, T1 > T2 > T3 for sells */
  targets: LadderTarget[]
}

type RoundToTick = (price: number, tick?: number, dir?: TickDirection) => number

function validPrice(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x > 0
}

/** R2 meaningfulness gate — fixed, documented, never cherry-picked. */
function meaningful(z: ResistanceZone): boolean {
  return z.strength >= TARGET_RULES.MIN_TARGET_STRENGTH || z.touches >= TARGET_RULES.MIN_TARGET_TOUCHES
}

/**
 * R1′ pre-wall print (owner directive "الهدف قبل الجدار بنص %"): the rung
 * prints 0.5% BEFORE the wall — buys take edge×(1−buf) rounded DOWN, sells
 * edge×(1+buf) rounded UP; the rounding direction always makes the printed
 * reward HARDER, never flattered (R1).
 */
function wallPrint(edge: number, isBuy: boolean, tick: RoundToTick): number {
  const buf = TARGET_RULES.PREWALL_BUFFER_PCT / 100
  const raw = isBuy ? edge * (1 - buf) : edge * (1 + buf)
  return tick(raw, 0.01, isBuy ? "down" : "up")
}

// ---------------------------------------------------------------- Arabic notes

/** Arabic session-count noun: 1 جلسة واحدة / 2 جلستين / n جلسات. */
function sessionsAr(n: number): string {
  if (n === 1) return "جلسة واحدة"
  if (n === 2) return "جلستين"
  return `${n} جلسات`
}

/** Arabic zone-count noun: 1 منطقة واحدة / 2 منطقتين / n مناطق. */
function zonesAr(n: number): string {
  if (n === 1) return "منطقة واحدة"
  if (n === 2) return "منطقتين"
  return `${n} مناطق`
}

function zoneWhyAr(
  labelAr: string,
  z: ResistanceZone,
  side: "buy" | "sell",
  price: number,
  skippedWeak = 0,
): string {
  const isBuy = side === "buy"
  const kindAr = isBuy ? "منطقة عرض" : "منطقة طلب"
  const pressureAr = isBuy ? "ضغط بيعي" : "ضغط شرائي"
  const edgeAr = isBuy ? "الحافة السفلى" : "الحافة العليا"
  const wickAr = isBuy ? "بذيول عليا واضحة" : "بذيول سفلى واضحة"
  const parts: string[] = [
    `${labelAr} عند ${price} — مطبوع قبل ${edgeAr} ل${kindAr} (الجدار من ${z.low} إلى ${z.high}) بفاصل ${TARGET_RULES.PREWALL_BUFFER_PCT}%، سبق أن ظهر عندها ${pressureAr} في ${sessionsAr(z.touches)}، آخرها ${sessionsAr(z.lastTouchAgeSessions)} مضت`,
  ]
  if (skippedWeak > 0)
    parts.push(
      `وبعد تخطي ${zonesAr(skippedWeak)} أضعف قربها (قوة كل منها دون ${TARGET_RULES.STRONG_TARGET_STRENGTH}) لكونها قابلة للعبور في جلسة واحدة`,
    )
  if (z.rejectionSessions > 0) parts.push(`${z.rejectionSessions} منها ${wickAr}`)
  if (z.failedBreakouts > 0) parts.push(`وصمدت أمام ${z.failedBreakouts} محاولة ${isBuy ? "اختراق" : "كسر"} فاشلة`)
  if (z.touchVolRatio !== null && z.touchVolRatio >= 1.5) parts.push(`وحجم التداول عند اللمسات بلغ ${z.touchVolRatio} ضعف وسط السلسلة`)
  return parts.join("، ") + "."
}

function extremeWhyAr(
  labelAr: string,
  side: "buy" | "sell",
  price: number,
  ts: string,
  strength: number | null,
  sessions: number,
): string {
  const kindAr = side === "buy" ? "القمة" : "القاع"
  const strengthAr = strength === null ? "" : ` (قوة المنطقة الحاضنة ${strength}/100)،`
  const extremeAr = side === "buy" ? "أعلى قمة مؤكدة" : "أعمق قاع مؤكد"
  return `${labelAr} عند ${price} — ${kindAr} الهيكلية المؤكدة بتاريخ ${ts}${strengthAr} وهي ${extremeAr} في نافذة التحليل البالغة ${sessions} جلسة صالحة.`
}

function measuredWhyAr(labelAr: string, side: "buy" | "sell", price: number, low: number, high: number, sessions: number): string {
  const dirAr = side === "buy" ? "فوق منتصف منطقة الدخول" : "تحت منتصف منطقة الدخول"
  return `${labelAr} عند ${price} — إسقاط محسوب لمدى آخر ${sessions} جلسة (من ${low} إلى ${high}) ${dirAr}، لعدم وجود أي منطقة عرض/طلب حقيقية ${side === "buy" ? "فوق" : "تحت"} الدخول في الخريطة؛ هذا إسقاط مدى وليس مستوى هيكلي مُختبر.`
}

// ---------------------------------------------------------------- ladder walk

/**
 * Build the structural target ladder for one side.
 * Returns null when no honest rung exists (an unavailable map, invalid entry
 * inputs, or — after R6 — nothing real to project). Never fabricates a level.
 * `roundToTickFn` defaults to the trade-plan.ts tick helper; tests may inject
 * a coarser tick to pin the rounding direction.
 */
export function buildTargetLadder(
  map: ResistanceMap,
  side: "buy" | "sell",
  entryLow: number,
  entryHigh: number,
  lastClose: number,
  roundToTickFn: RoundToTick = roundToTick,
): TargetLadder | null {
  if (!map || map.version !== "resistance-map@1" || !map.available) return null
  if (!validPrice(entryLow) || !validPrice(entryHigh) || !validPrice(lastClose)) return null
  if (entryHigh < entryLow) return null
  if (typeof roundToTickFn !== "function") return null
  const tick = roundToTickFn // injected (tests may pass a coarser tick)
  const isBuy = side === "buy"

  // ---- T1: the NEAREST STRONG zone beyond the entry band AND the last close
  // ---- (R2 floor + R3′ + R3″): a level the price already trades past is
  // ---- support, never a target.
  // Weaker near shelves are skipped BY DESIGN (owner directive): a soft shelf
  // clearable inside one session is not a target; the skip count is disclosed.
  const beyondEntry = map.zones
    .filter((z) => (isBuy ? z.kind === "supply" && z.low > entryHigh && z.low > lastClose : z.kind === "demand" && z.high < entryLow && z.high < lastClose))
    .sort((a, b) => (isBuy ? a.low - b.low : b.high - a.high) || b.strength - a.strength)
  const t1zone = beyondEntry.find((z) => z.strength >= TARGET_RULES.STRONG_TARGET_STRENGTH) ?? null
  const skippedWeak = t1zone ? beyondEntry.indexOf(t1zone) : 0

  const targets: LadderTarget[] = []
  const usedExtremes = new Set<string>()
  const sep = TARGET_RULES.SEPARATION_PCT / 100

  if (t1zone) {
    const edge = isBuy ? t1zone.low : t1zone.high
    const price = wallPrint(edge, isBuy, tick)
    targets.push({
      label: "T1",
      price,
      kind: "zone",
      strength: t1zone.strength,
      whyAr: zoneWhyAr("الهدف الأول", t1zone, side, price, skippedWeak),
    })
  } else {
    // ---- R6 measured-move fallback: STRONG zones ALWAYS take precedence ----
    // R3″: the projection must clear the LAST CLOSE in the trade's direction —
    // a projected rung the price has already reached is not a target.
    const m = map.measured
    if (m.height === null || !(m.height > 0) || m.low === null || m.high === null) return null
    const mid = (entryLow + entryHigh) / 2
    const raw = isBuy ? mid + m.height : mid - m.height
    if (isBuy ? !(raw > lastClose) : !(raw < lastClose)) return null
    const price = tick(raw, 0.01, "up")
    targets.push({
      label: "T1",
      price,
      kind: "measured_move",
      strength: null,
      whyAr: measuredWhyAr("الهدف الأول", side, price, m.low, m.high, m.sessions),
    })
    return { version: OPPORTUNITY_TARGETS_VERSION, side, targets } // R6: no rungs past a projection
  }

  const t1zoneRef = t1zone
  const t1Price = targets[0].price
  const usedZones = new Set<ResistanceZone>([t1zoneRef])

  // ---- T2: next STRONGER rung beyond T1 at >= separation (R4) ----
  const t2From = t1Price * (1 + (isBuy ? sep : -sep))
  const zoneCands2 = beyondEntry
    .filter(
      (z) =>
        !usedZones.has(z) &&
        meaningful(z) &&
        z.strength >= t1zoneRef.strength &&
        // strictly beyond the T1 band too — a rung may never overlap the band
        // already consumed by the previous rung (same level ≠ a farther rung)
        (isBuy ? z.low > t1zoneRef.high : z.high < t1zoneRef.low) &&
        (isBuy ? z.low > t1Price && z.low >= t2From : z.high < t1Price && z.high <= t2From),
    )
    .sort((a, b) => (isBuy ? a.low - b.low : b.high - a.high))
  const t2zone = zoneCands2[0]

  const extreme = isBuy ? map.extremes.majorHigh : map.extremes.majorLow
  const usedBand = t1zoneRef
  const t2Extreme =
    extreme &&
    (isBuy ? extreme.price >= t2From && extreme.price > usedBand.high : extreme.price <= t2From && extreme.price < usedBand.low)
      ? extreme
      : null

  let t2: LadderTarget | null = null
  let t2zoneRef: ResistanceZone | null = null
  if (t2zone && (!t2Extreme || (isBuy ? t2zone.low <= t2Extreme.price : t2zone.high >= t2Extreme.price))) {
    // nearest wins; a tie goes to the real band (R4 tie-break)
    const edge = isBuy ? t2zone.low : t2zone.high
    const price = wallPrint(edge, isBuy, tick)
    t2 = { label: "T2", price, kind: "zone", strength: t2zone.strength, whyAr: zoneWhyAr("الهدف الثاني", t2zone, side, price) }
    t2zoneRef = t2zone
  } else if (t2Extreme) {
    const price = wallPrint(t2Extreme.price, isBuy, tick)
    const strength = strengthAt(map, isBuy ? "supply" : "demand", t2Extreme.price)
    t2 = {
      label: "T2",
      price,
      kind: "major_high",
      strength,
      whyAr: extremeWhyAr("الهدف الثاني", side, price, t2Extreme.ts, strength, map.sessions),
    }
    usedExtremes.add(side === "buy" ? "majorHigh" : "majorLow")
  }
  if (!t2) return { version: OPPORTUNITY_TARGETS_VERSION, side, targets }
  targets.push(t2)
  if (t2zoneRef) usedZones.add(t2zoneRef)

  // ---- T3: structural justification only (R5) ----
  const t3From = t2.price * (1 + (isBuy ? sep : -sep))
  const zoneCands3 = map.zones
    .filter(
      (z) =>
        !usedZones.has(z) &&
        z.kind === (isBuy ? "supply" : "demand") &&
        z.strength >= TARGET_RULES.T3_MIN_STRENGTH &&
        // strictly beyond the T2 band when T2 was a zone (same rule as T2)
        (!t2zoneRef || (isBuy ? z.low > t2zoneRef.high : z.high < t2zoneRef.low)) &&
        (isBuy ? z.low > t2.price && z.low >= t3From : z.high < t2.price && z.high <= t3From),
    )
    .sort((a, b) => (isBuy ? a.low - b.low : b.high - a.high))
  const t3zone = zoneCands3[0]

  const extremeKey = isBuy ? "majorHigh" : "majorLow"
  const t3Extreme =
    extreme &&
    !usedExtremes.has(extremeKey) &&
    (isBuy ? extreme.price >= t3From && (!t2zoneRef || extreme.price > t2zoneRef.high) : extreme.price <= t3From && (!t2zoneRef || extreme.price < t2zoneRef.low))
      ? extreme
      : null

  if (t3zone && (!t3Extreme || (isBuy ? t3zone.low <= t3Extreme.price : t3zone.high >= t3Extreme.price))) {
    const edge = isBuy ? t3zone.low : t3zone.high
    const price = wallPrint(edge, isBuy, tick)
    targets.push({ label: "T3", price, kind: "zone", strength: t3zone.strength, whyAr: zoneWhyAr("الهدف الثالث", t3zone, side, price) })
  } else if (t3Extreme) {
    const price = wallPrint(t3Extreme.price, isBuy, tick)
    const strength = strengthAt(map, isBuy ? "supply" : "demand", t3Extreme.price)
    targets.push({
      label: "T3",
      price,
      kind: "major_high",
      strength,
      whyAr: extremeWhyAr("الهدف الثالث", side, price, t3Extreme.ts, strength, map.sessions),
    })
  }
  // R5: neither candidate justifies a third rung — the ladder stops at T2.

  return { version: OPPORTUNITY_TARGETS_VERSION, side, targets }
}
