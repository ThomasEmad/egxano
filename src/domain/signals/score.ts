// =============================================================================
// Signal engine v2 — additive, interpretable scoring (PURE).
// Five groups with FIXED maxima (trend 25 / momentum 20 / volume 15 /
// structure 25 / quality 15 = 100). Every point is traceable to one Evidence
// item published on the row — the score IS the cited facts, not a black box.
// Deliberately NOT a conjunctive gate: weak evidence COSTS points instead of
// vetoing the whole opportunity — so buy opportunities appear whenever the
// cited evidence genuinely adds up, and never because thresholds were stacked.
// =============================================================================

import type { Detection } from "./patterns"
import { overheadRoomPct, type ZoneMap } from "./levels"
import type { MetricsBundle } from "./metrics"
import { round2 } from "./metrics"
import type { Bar, Evidence, ScoreBreakdown, ScoreGroup, TradePlanV2 } from "./types"
import { SCORE_GROUP_MAX } from "./types"

export interface ScoreInput {
  bars: Bar[]
  m: MetricsBundle
  detection: Detection | null
  plan: TradePlanV2 | null
  map: ZoneMap
  quality: { bars: number; ohlc: boolean; liquidity: "liquid" | "normal" | "thin" | "unknown"; dataAgeSessions: number | null }
}

export interface ScoreResult {
  breakdown: ScoreBreakdown
  evidence: Evidence[]
}

interface GroupAcc {
  group: ScoreGroup
  points: number
  ev: Evidence[]
}

function add(acc: GroupAcc[], group: ScoreGroup, points: number, ar: string, en: string): void {
  if (points <= 0) {
    acc.push({ group, points: 0, ev: [{ ar, en, group, points: 0 }] })
    return
  }
  acc.push({ group, points: round2(points), ev: [{ ar, en, group, points: round2(points) }] })
}

export function computeScore(input: ScoreInput): ScoreResult {
  const { m, detection, plan, map, quality } = input
  const acc: GroupAcc[] = []

  // ---------------- TREND (max 25) ----------------
  if (m.ema50 !== null && m.lastClose > m.ema50) {
    add(acc, "trend", 8, `الإغلاق فوق EMA50 (${m.ema50.toFixed(2)})`, `Close above EMA50 (${m.ema50.toFixed(2)})`)
  } else if (m.ema50 !== null) {
    add(acc, "trend", 0, `الإغلاق تحت EMA50 (${m.ema50.toFixed(2)})`, `Close below EMA50 (${m.ema50.toFixed(2)})`)
  } else {
    add(acc, "trend", 0, "EMA50 غير متاح (تاريخ قصير)", "EMA50 unavailable (short history)")
  }
  if (m.ema20 !== null && m.ema50 !== null && m.ema20 > m.ema50) {
    add(acc, "trend", 6, `EMA20 (${m.ema20.toFixed(2)}) فوق EMA50`, `EMA20 (${m.ema20.toFixed(2)}) above EMA50`)
  }
  if (m.ema20 !== null && m.ema20Prev !== null && m.ema20 > m.ema20Prev) {
    add(acc, "trend", 4, "ميل EMA20 صاعد (آخر 5 جلسات)", "EMA20 slope up (last 5 sessions)")
  }
  if (m.hhHl) {
    if (m.hhHl.hh && m.hhHl.hl) add(acc, "trend", 7, "قمم وقيعان صاعدة (HH/HL)", "Higher highs & higher lows")
    else if (m.hhHl.hl) add(acc, "trend", 3, "قيعان صاعدة", "Higher lows")
    else if (m.hhHl.hh) add(acc, "trend", 3, "قمم أعلى", "Higher highs")
    else add(acc, "trend", 0, "البنية غير صاعدة (قمم/قيعان أدنى)", "Structure not rising")
  }

  // ---------------- MOMENTUM (max 20) ----------------
  if (m.rsi14 !== null) {
    if (m.rsi14 >= 45 && m.rsi14 <= 70) {
      add(acc, "momentum", 6, `RSI ${m.rsi14.toFixed(0)} في نطاق صحي`, `RSI ${m.rsi14.toFixed(0)} in a healthy band`)
    } else if (m.rsi14 > 70) {
      add(acc, "momentum", 2, `RSI ${m.rsi14.toFixed(0)} منطقة تشبع — الزخم قوي لكن ممتد`, `RSI ${m.rsi14.toFixed(0)} overbought — strong but extended`)
    } else {
      add(acc, "momentum", 0, `RSI ${m.rsi14.toFixed(0)} ضعيف`, `RSI ${m.rsi14.toFixed(0)} weak`)
    }
  } else {
    add(acc, "momentum", 0, "RSI غير متاح", "RSI unavailable")
  }
  if (m.macdHist !== null && m.macdHist > 0) {
    add(acc, "momentum", 5, "هيستوجرام MACD موجب", "MACD histogram positive")
  }
  if (m.macdHist !== null && m.macdHistPrev !== null && m.macdHist > m.macdHistPrev) {
    add(acc, "momentum", 4, "هيستوجرام MACD متزايد", "MACD histogram rising")
  }
  if (m.perfM1 !== null && m.perfM1 > 0) {
    add(acc, "momentum", 5, `أداء الشهر ${m.perfM1.toFixed(1)}% موجب`, `1-month performance ${m.perfM1.toFixed(1)}% positive`)
  }

  // ---------------- VOLUME (max 15) ----------------
  // Calibration (2026-11-21 reviewer pass): 2× the 20-session mean IS strong
  // participation and the scale now says so — the old top bucket started at
  // 1.5×/+8, so a normal liquid name at 1.1–1.4× scored the same as near-spike
  // volume and the group read as miscalibrated ("COMI 4/15").
  if (m.relVol !== null) {
    if (m.relVol >= 2.0) add(acc, "volume", 10, `حجم اليوم ${m.relVol.toFixed(2)}× المتوسط — مشاركة قوية جدًا (ضعف المتوسط أو أكثر)`, `Volume ${m.relVol.toFixed(2)}× the mean — very strong participation (2× average or more)`)
    else if (m.relVol >= 1.5) add(acc, "volume", 8, `حجم اليوم ${m.relVol.toFixed(2)}× المتوسط — مشاركة قوية`, `Volume ${m.relVol.toFixed(2)}× the mean — strong participation`)
    else if (m.relVol >= 1.2) add(acc, "volume", 6, `حجم اليوم ${m.relVol.toFixed(2)}× المتوسط — مشاركة فوق الطبيعي`, `Volume ${m.relVol.toFixed(2)}× the mean — above-normal participation`)
    else if (m.relVol >= 1.0) add(acc, "volume", 4, `حجم اليوم ${m.relVol.toFixed(2)}× المتوسط — مشاركة طبيعية`, `Volume ${m.relVol.toFixed(2)}× the mean — normal participation`)
    else add(acc, "volume", 0, `حجم اليوم ${m.relVol.toFixed(2)}× المتوسط — مشاركة ضعيفة`, `Volume ${m.relVol.toFixed(2)}× the mean — weak participation`)
  } else {
    add(acc, "volume", 0, "بيانات الحجم غير متاحة لهذا السهم", "Volume data unavailable for this stock")
  }
  // up-day volume dominance over the last 10 sessions (accumulation proxy):
  // more volume on up-closes than down-closes is quiet buying pressure.
  {
    let up = 0
    let down = 0
    let counted = 0
    for (let i = Math.max(1, input.bars.length - 10); i < input.bars.length; i++) {
      const v = input.bars[i].volume
      if (v === null || !Number.isFinite(v) || v <= 0) continue
      if (input.bars[i].close > input.bars[i - 1].close) up += v
      else if (input.bars[i].close < input.bars[i - 1].close) down += v
      counted++
    }
    if (counted >= 5 && up > 0) {
      if (up > down) add(acc, "volume", 4, "حجم التداول في جلسات الصعود أكبر من جلسات الهبوط (تراكم هادئ)", "Up-session volume exceeds down-session volume (quiet accumulation)")
      else add(acc, "volume", 0, "حجم جلسات الهبوط يفوق جلسات الصعود", "Down-session volume exceeds up-session volume")
    }
  }

  // ---------------- STRUCTURE (max 25) ----------------
  if (detection) {
    add(acc, "structure", Math.round(detection.strength * 10 * 10) / 10, detection.facts[0]?.ar ?? "إعداد بنيوي", detection.facts[0]?.en ?? "Structural setup")
  }
  const room = overheadRoomPct(map, m.lastClose)
  if (room === null) {
    add(acc, "structure", 6, "لا توجد مقاومة أعلى مسجلة — مساحة صعود مفتوحة", "No recorded resistance above — open room")
  } else if (room >= 8) {
    add(acc, "structure", 8, `مساحة فوق السهم ${room.toFixed(1)}% حتى أقرب مقاومة`, `${room.toFixed(1)}% room to the nearest resistance`)
  } else if (room >= 4) {
    add(acc, "structure", 5, `مساحة فوق السهم ${room.toFixed(1)}% حتى أقرب مقاومة`, `${room.toFixed(1)}% room to the nearest resistance`)
  } else {
    add(acc, "structure", 1, `أقرب مقاومة قريبة (${room.toFixed(1)}% فوق) — العائد المطلوب محدود`, `Nearest resistance close (${room.toFixed(1)}% above) — limited room`)
  }
  if (plan) {
    if (plan.riskReward >= 2) add(acc, "structure", 7, `عائد/مخاطرة ${plan.riskReward.toFixed(2)} — ممتاز`, `Risk/reward ${plan.riskReward.toFixed(2)} — excellent`)
    else if (plan.riskReward >= 1.5) add(acc, "structure", 5, `عائد/مخاطرة ${plan.riskReward.toFixed(2)} — جيد`, `Risk/reward ${plan.riskReward.toFixed(2)} — good`)
    else add(acc, "structure", 3, `عائد/مخاطرة ${plan.riskReward.toFixed(2)} — مقبول`, `Risk/reward ${plan.riskReward.toFixed(2)} — acceptable`)
  }

  // ---------------- QUALITY (max 15) ----------------
  if (quality.bars >= 120) add(acc, "quality", 5, `${quality.bars} جلسة تاريخ — قراءة موثوقة`, `${quality.bars} sessions of history — reliable read`)
  else if (quality.bars >= 60) add(acc, "quality", 3, `${quality.bars} جلسة تاريخ — كافية للقراءة`, `${quality.bars} sessions — sufficient`)
  else add(acc, "quality", 0, `${quality.bars} جلسة فقط — التاريخ قصير`, `Only ${quality.bars} sessions — short history`)
  if (quality.ohlc) add(acc, "quality", 3, "بيانات شموع كاملة (افتتاح/أعلى/أدنى) — مستويات دقيقة", "Full OHLC anatomy — precise levels")
  if (quality.liquidity === "liquid") add(acc, "quality", 4, "سيولة نشطة اليوم", "Active liquidity today")
  else if (quality.liquidity === "normal") add(acc, "quality", 3, "سيولة طبيعية", "Normal liquidity")
  else if (quality.liquidity === "thin") add(acc, "quality", 1, "سيولة ضعيفة اليوم — حجم التنفيذ قد يتأثر", "Thin liquidity — execution size may suffer")
  else add(acc, "quality", 2, "بيانات السيولة غير متاحة", "Liquidity data unavailable")
  if (quality.dataAgeSessions !== null) {
    if (quality.dataAgeSessions === 0) add(acc, "quality", 3, "بيانات اليوم — محدثة", "Today's data — fresh")
    else if (quality.dataAgeSessions <= 2) add(acc, "quality", 2, `البيانات متأخرة ${quality.dataAgeSessions} جلسة`, `Data is ${quality.dataAgeSessions} sessions old`)
    else add(acc, "quality", 0, `البيانات متأخرة ${quality.dataAgeSessions}+ جلسة — القراءة قديمة`, `Data is ${quality.dataAgeSessions}+ sessions old — stale read`)
  }

  // ---------------- aggregate with group caps ----------------
  const groups: Record<ScoreGroup, number> = { trend: 0, momentum: 0, volume: 0, structure: 0, quality: 0 }
  const evidence: Evidence[] = []
  for (const g of ["trend", "momentum", "volume", "structure", "quality"] as ScoreGroup[]) {
    const rows = acc.filter((a) => a.group === g)
    const raw = rows.reduce((s, a) => s + a.points, 0)
    groups[g] = round2(Math.min(raw, SCORE_GROUP_MAX[g]))
    for (const r of rows) evidence.push(...r.ev)
  }
  const total = round2(Object.values(groups).reduce((s, v) => s + v, 0))
  return { breakdown: { total, groups }, evidence }
}
