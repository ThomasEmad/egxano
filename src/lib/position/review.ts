// =============================================================================
// حلل سهمي (Position Review) — the decision engine (PURE).
// Owner feature (2026-11-17): the user enters their AVERAGE BUY PRICE; the
// engine answers ONE question — احتفظ ولا أنتظر ولا أخرج؟ — and shows its
// full work: every reason in the friend's voice, every support and
// resistance, and the complete technical reading.
//
// Decision ladder (deterministic, no hidden weighting):
//   0. DEEP LOSS (pnl ≤ −20%) — owner mandate: selling a −50% position needs
//      +100% on ANOTHER stock to recover; −25% needs +33.3%; −20% needs +25%.
//      The deep-loss regime REPLACES any exit verdict with انتظار + the
//      recovery math + the rebound-exit plan (exit inside the 20–25% loss
//      band on a bounce) + the follow-up question "هل شايف هبوط 10% كمان؟"
//      (yes → plan selling on the first rebound; no → waiting is reasonable).
//   1. A multi-touch support broke on the LAST session → the OWNER cushion
//      rule decides: next support ≥4% below (or none) → exit; ≤3% → wait
//      (selling into a close cushion locks the loss at the worst spot);
//      3–4% → wait, borderline, tighter mental stop.
//   2. Otherwise the engine-v2 row says exit (trend break) → exit.
//   3. In profit → hold, with the trailing line drawn at the nearest support.
//   4. Small loss (above −20%) → broken trend with no close cushion → exit;
//      anything else → wait with the line in the sand.
// Nothing here is investment advice — closingAr says it on every report.
// =============================================================================

import { nearestSupportBelow, type PriceZone, type ZoneMap } from "@/lib/signals/levels"
import {
  EXIT_SUPPORT_CUSHION_EXIT_PCT,
  EXIT_SUPPORT_CUSHION_WAIT_PCT,
  type Bar,
  type SignalRowV2,
} from "@/lib/signals/types"
import { POSITION_DECISION_AR, type LevelLine, type PositionDecision, type PositionReview, type ReviewQuestion, type TechnicalSnapshot } from "./types"

/** OWNER MANDATE (2026-11-17): at −20% or deeper, selling locks a loss whose
 *  recovery math turns brutal — the default verdict becomes انتظار للارتداد
 *  and the exit is replanned into the 20–25% loss band. */
export const DEEP_LOSS_PCT = 20

export interface ReviewInput {
  row: SignalRowV2
  bars: Bar[]
  map: ZoneMap
  avgBuyPrice: number
  /** the user's answer to the deep-loss follow-up question (client-side echo;
   *  null on the first analysis) */
  downsideAnswer?: "yes" | "no" | null
}

/** The support-break + cushion reading, recomputed here so the position view
 *  never depends on string-matching the row's evidence. Mirrors the rule in
 *  patterns.ts detectExit() exactly (same constants, same geometry). */
export interface CushionRead {
  brokeLastSession: boolean
  brokenZone: PriceZone | null
  /** nearest support edge below the live close (null = none) */
  cushionLevel: number | null
  /** % from the live close down to the cushion (null = none) */
  cushionGapPct: number | null
  /** gap ≥ 4% or no cushion at all → the break demands an exit */
  farCushion: boolean
  /** 3% < gap < 4% — borderline: wait, tighter stop */
  borderline: boolean
}

export function readCushion(bars: Bar[], map: ZoneMap): CushionRead {
  const n = bars.length
  const last = bars[n - 1]
  const brokenZones = map.zones.filter(
    (z) => z.kind === "support" && z.touches >= 2 && last.close < z.low && n >= 2 && bars[n - 2].close >= z.low,
  )
  const brokenZone = brokenZones.length ? brokenZones.sort((a, b) => b.touches - a.touches)[0] : null
  const next = nearestSupportBelow(map, last.close)
  // nearestSupportBelow picks the closest zone fully below the close — but if
  // the close plunged THROUGH a zone, that zone's high sits above the close
  // and no longer qualifies; the rule still reads the next one below.
  const cushionLevel = next ? next.high : null
  const cushionGapPct = next ? ((last.close - next.high) / last.close) * 100 : null
  const farCushion = brokenZone !== null && (cushionLevel === null || cushionGapPct === null || cushionGapPct >= EXIT_SUPPORT_CUSHION_EXIT_PCT)
  const borderline = brokenZone !== null && cushionGapPct !== null && cushionGapPct > EXIT_SUPPORT_CUSHION_WAIT_PCT
  return { brokeLastSession: brokenZone !== null, brokenZone, cushionLevel, cushionGapPct, farCushion, borderline }
}

function trendTextAr(close: number, ema20: number | null, ema50: number | null): string {
  if (ema50 === null) return "لا يوجد تاريخ كافٍ لقراءة الاتجاه"
  const above50 = close > ema50
  const stack = ema20 !== null ? ema20 > ema50 : null
  if (above50 && stack) return "صاعد — السعر فوق EMA50 وEMA20 فوق EMA50 (ترتيب صحي)"
  if (above50) return "فوق EMA50 لكن EMA20 لم تؤكد بعد"
  if (!above50 && stack === false) return "هابط — السعر تحت EMA50 وEMA20 تحت EMA50 (ترتيب سلبي)"
  return "متذبذب — السعر تحت EMA50 بدون كسر ترتيب كامل"
}

function zoneNoteAr(z: PriceZone): string {
  if (z.kind === "support") {
    const t = z.touches >= 2 ? `دعم ${z.touches}× مختبَر` : "دعم بلمسة واحدة"
    return `${t} — آخر لمسة ${z.lastTouchTs}`
  }
  if (z.broken) return `مقاومة اخترقها الإغلاق (${z.brokenTs ?? "-"}) — بقت مرجع للارتداد والاختبار`
  const t = z.touches >= 2 ? `مقاومة ${z.touches}× مختبَرة` : "مقاومة بلمسة واحدة"
  return `${t} — آخر لمسة ${z.lastTouchTs}`
}

function levelLines(map: ZoneMap, close: number, avgBuy: number): { supports: LevelLine[]; resistances: LevelLine[] } {
  const mid = (z: PriceZone) => (z.low + z.high) / 2
  const toLine = (z: PriceZone): LevelLine => {
    const m = mid(z)
    return {
      kind: z.kind,
      low: z.low,
      high: z.high,
      touches: z.touches,
      broken: z.broken,
      lastTouchTs: z.lastTouchTs,
      distFromPricePct: Math.round(((m - close) / close) * 1000) / 10,
      distFromAvgPct: Math.round(((m - avgBuy) / avgBuy) * 1000) / 10,
      noteAr: zoneNoteAr(z),
    }
  }
  const supports = map.zones.filter((z) => z.kind === "support").map(toLine).sort((a, b) => b.high - a.high)
  const resistances = map.zones.filter((z) => z.kind === "resistance").map(toLine).sort((a, b) => a.low - b.low)
  return { supports, resistances }
}

const fmt = (x: number) => x.toFixed(2)
const pct1 = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}٪`

/** The compounding-recovery math, owner-mandated: selling at a loss means the
 *  NEXT stock must climb (avgBuy/close − 1) to break even. */
export function recoveryNeededPct(avgBuyPrice: number, currentPrice: number): number {
  return ((avgBuyPrice / currentPrice - 1) * 100)
}

function recoveryReasonAr(pnlPct: number, recoveryPct: number): string {
  return `لو بعت دلوقتي بخسارة ${pct1(pnlPct)}، محتاج إن أي سهم تاني تعمل فيه ${pct1(recoveryPct)} عشان تعوّض وترجع لنقطة البداية — ودي رياضيات مش رأي.`
}

/** OWNER RULE (2026-11-18): a support more than 15% below the close, or one
 *  touched only once, is NOT a trusted floor — EGX makers paint single-touch
 *  lows all the time to grab liquidity. The practical support becomes EMA20,
 *  the dynamic line the market actually respects. Falls back to the raw zone
 *  (flagged as weak) when no EMA20 sits below the close. */
export const NEAR_SUPPORT_MAX_GAP_PCT = 15

export interface EffectiveSupport {
  kind: "zone" | "ema20"
  /** the line the user watches (zone high edge, or the EMA20 value) */
  level: number
  low?: number
  high?: number
  touches?: number
  gapPct: number
  basisAr: string
}

export function pickEffectiveSupport(supports: LevelLine[], close: number, ema20: number | null): EffectiveSupport | null {
  const nearest = supports.find((s) => s.high < close) ?? null
  if (nearest !== null && nearest.touches >= 2 && Math.abs(nearest.distFromPricePct) <= NEAR_SUPPORT_MAX_GAP_PCT) {
    return {
      kind: "zone",
      level: nearest.high,
      low: nearest.low,
      high: nearest.high,
      touches: nearest.touches,
      gapPct: Math.abs(nearest.distFromPricePct),
      basisAr: `دعم ${nearest.touches}× مختبَر (${fmt(nearest.low)}–${fmt(nearest.high)}) على بعد ${pct1(Math.abs(nearest.distFromPricePct))}`,
    }
  }
  if (ema20 !== null && ema20 < close) {
    const why = nearest === null
      ? "مفيش دعم مسجل تحت السعر"
      : nearest.touches < 2
        ? `أقرب دعم مسجل اتلمس مرة واحدة بس (${fmt(nearest.low)}–${fmt(nearest.high)}) — لمسة واحدة مش دعم`
        : `أقرب دعم مسجل بعيد ${pct1(Math.abs(nearest.distFromPricePct))} — مسافة طويلة جدًا`
    return {
      kind: "ema20",
      level: ema20,
      gapPct: ((close - ema20) / close) * 100,
      basisAr: `${why} — فالبطانة العملية هي EMA20 عند ${fmt(ema20)}، الخط الديناميكي اللي السوق بيحترمه فعلًا`,
    }
  }
  if (nearest) {
    // nothing better exists — use the raw zone but flag its weakness honestly
    return {
      kind: "zone",
      level: nearest.high,
      low: nearest.low,
      high: nearest.high,
      touches: nearest.touches,
      gapPct: Math.abs(nearest.distFromPricePct),
      basisAr: `أقرب دعم (${fmt(nearest.low)}–${fmt(nearest.high)}) — ضعيف (${nearest.touches < 2 ? "لمسة واحدة بس" : `بعيد ${pct1(Math.abs(nearest.distFromPricePct))}`}) فاختفاه مش دليل أمان`,
    }
  }
  return null
}

function deepLossQuestionAr(): ReviewQuestion {
  return {
    promptAr: "سؤال بحاول أفكر معاك فيه: هل شايف إن السهم ممكن يهبط 10٪ كمان من السعر الحالي؟",
    yesLabelAr: "أه، ممكن يهبط",
    noLabelAr: "لا، مش متوقع هبوط إضافي",
    yesOutcomeAr:
      "اختيارك (متوقع هبوط إضافي): الخطة تبقى بيع مع أول ارتداد — مش في قاع الذعر. أول جلسة قوية بتفتح وتصعد، ابدأ التخفيف وخرج بالباقي بدل ما تستنى قاع أعمق.",
    noOutcomeAr:
      "اختيارك (مفيش هبوط إضافي متوقع): يبقى الانتظار للارتداد قرار منطقي — بس تابع الفرد جيدًا على الشاشة كل يوم، وخرج في نطاق الخسارة 20–25٪ بلا تردد لما يوصلك، والحكم بالإغلاق الفعلي مش باللمسة.",
    answeredAr: null,
  }
}

export function reviewPosition(input: ReviewInput): PositionReview {
  const { row, bars, map, avgBuyPrice } = input
  const close = row.lastClose ?? (bars.length ? bars[bars.length - 1].close : 0)
  const mt = row.metrics
  const pnlPerShare = close - avgBuyPrice
  const pnlPct = avgBuyPrice > 0 ? (pnlPerShare / avgBuyPrice) * 100 : 0
  const cushion = readCushion(bars, map)
  const { supports, resistances } = levelLines(map, close, avgBuyPrice)
  const nearestSupportBelowClose = supports.find((s) => s.high < close) ?? null
  // owner rule: far (>15%) or single-touch supports are replaced by EMA20 as
  // the practical floor — used for every stop/trailing line shown to the user
  const effSupport = pickEffectiveSupport(supports, close, mt?.ema20 ?? null)
  const trendAr = trendTextAr(close, mt?.ema20 ?? null, mt?.ema50 ?? null)
  const deepLoss = pnlPct <= -DEEP_LOSS_PCT
  const recoveryPct = pnlPct < 0 ? Math.round(recoveryNeededPct(avgBuyPrice, close) * 10) / 10 : null
  // the 20–25% loss-band exit zone, owner mandate: the price levels whose
  // recovery pulls the loss back to 20% (avg×0.80) and 25% (avg×0.75)
  const reboundZoneLow = avgBuyPrice * 0.75
  const reboundZoneHigh = avgBuyPrice * 0.8

  const snapshot: TechnicalSnapshot = {
    lastClose: close,
    rsi14: mt?.rsi14 ?? null,
    ema20: mt?.ema20 ?? null,
    ema50: mt?.ema50 ?? null,
    trendAr,
    relVol: mt?.relVol ?? null,
    rangePos60: mt?.rangePos60 ?? null,
    atr14: mt?.atr14 ?? null,
    signalState: row.state,
    signalScore: row.score,
    bars: bars.length,
    asOf: row.asOf,
  }

  const warningsAr = [...row.warnings.map((w) => w.detailAr), ...row.quality.notesAr]
  const levelsBasisAr = "المستويات من قيعان وقمم حقيقية متكررة (pivot zones) من بيانات التداول نفسها — مفيش مستوى مُختلق ولا نسب جاهزة."
  const closingAr = "أنا بفكر معاك بصوت عالي وأعرضلك الأرقام — ده تحليل مش قرار مؤكد، والقرار النهائي بيدك وحدك."
  const reasonsAr: string[] = []
  let decision: PositionDecision
  let headlineAr: string
  let invalidationAr: string
  let planAr: string | null = null
  let question: ReviewQuestion | null = null

  const openFieldAr = cushion.cushionLevel === null
    ? "ومفيش أي دعم مسجل تحته — يعني الهبوط لسه فاضي"
    : `والدعم التالي تحته (${fmt(cushion.cushionLevel)}) بعيد ${pct1(cushion.cushionGapPct ?? 0)}`
  const breakFactAr = cushion.brokeLastSession && cushion.brokenZone
    ? `التقنية بصراحة: إغلاق النهاردة (${fmt(close)}) كسر دعم ${cushion.brokenZone.touches}× مختبَر (${fmt(cushion.brokenZone.low)}–${fmt(cushion.brokenZone.high)}) — هيكل اتكسر فعلًا`
    : `التقنية بصراحة: ${trendAr}`
  const trendFactAr = mt?.ema20 !== null && mt?.ema50 !== null && mt!.ema20! < mt!.ema50! && close < mt!.ema50!
    ? `الاتجاه: ${trendAr} — السعر تحت متوسطاته بالترتيب السلبي`
    : `الاتجاه: ${trendAr}`

  // ---------- 0) DEEP LOSS — the owner's compounding-math regime. Any exit
  // verdict collapses into انتظار للارتداد + recovery math + the question.
  if (deepLoss) {
    decision = "wait"
    const q = deepLossQuestionAr()
    if (input.downsideAnswer === "yes") {
      headlineAr = `بإجابتك (شايف هبوط إضافي): الخطة بيع مع أول ارتداد — مش في قاع الذعر`
      planAr = q.yesOutcomeAr
    } else if (input.downsideAnswer === "no") {
      headlineAr = `بإجابتك (مفيش هبوط إضافي متوقع): الانتظار للارتداد منطقي — بخط إلغاء واضح`
      planAr = q.noOutcomeAr
    } else {
      headlineAr = `خسارتك ${pct1(pnlPct)} — البيع دلوقتي بيحولها لخسارة محققة وبيحتاج ${pct1(recoveryPct ?? 0)} تعويض في أي سهم تاني — الانتظار للارتداد هو الأنسب`
      planAr = null
    }
    invalidationAr = cushion.cushionLevel !== null
      ? `حد الانتظار اللي هتفرج عليه معايا: الإغلاق اليومي تحت البطانة (${fmt(cushion.cushionLevel)}) — لحظتها بننتقل من الانتظار إلى تخفيف تدريجي، لأن الانتظار له حد مش أبدية`
      : effSupport
        ? `حد الانتظار اللي هتفرج عليه معايا: الإغلاق اليومي تحت ${fmt(effSupport.level)} — ساعتها بنعيد الحساب ونفكر في التخفيف`
        : "حد الانتظار اللي هتفرج عليه معايا: إغلاق يومي تحت قاع آخر 60 جلسة — ساعتها بنعيد الحساب ونفكر في التخفيف"
    reasonsAr.push(
      `الصريح الموجع أولًا: متوسط شراءك ${fmt(avgBuyPrice)} والسعر دلوقتي ${fmt(close)} — يعني إنت تحت الماء ${pct1(pnlPct)} (${fmt(pnlPerShare)} جنيه/سهم).`,
      recoveryReasonAr(pnlPct, recoveryPct ?? 0),
      `وعشان حجم الصورة يبان: خسارة 20٪ تحتاج +25٪ للتعويض، وخسارة 25٪ تحتاج +33٪، وخسارة 50٪ تحتاج +100٪ — كل ما الخسارة بتتعمق، التعويض بيتضاعف. عشان كده البيع بخسارة كبيرة دلوقتي صعب جدًا، والانتظار للارتداد هو الحل الأنسب.`,
      breakFactAr + "، " + trendFactAr + ".",
      openFieldAr + " — فمفيش بيع عشوائي، ومفيش انتظار من غير متابعة يومية للفرد على الشاشة.",
      `خطة الارتداد (owner mandate): لما السعر يرتد للنطاق ${fmt(reboundZoneLow)}–${fmt(reboundZoneHigh)} تكون خسارتك في حدود 20–25٪ وساعتها الخروج بيكون قرار منظم مش هروب${
        close >= reboundZoneLow && close <= reboundZoneHigh ? " — وإنت أصلًا جوه النطاق ده دلوقتي، فأي قوة إضافية خد فيها قرار التخفيف" : ""
      }.`,
    )
    question = { ...q, answeredAr: input.downsideAnswer === "yes" ? q.yesOutcomeAr : input.downsideAnswer === "no" ? q.noOutcomeAr : null }
    return {
      decision, decisionAr: POSITION_DECISION_AR[decision], headlineAr,
      avgBuyPrice, lastClose: close, pnlPct: Math.round(pnlPct * 10) / 10, pnlPerShare: Math.round(pnlPerShare * 100) / 100,
      recoveryPct, reasonsAr, planAr, question, closingAr,
      supports, resistances, levelsBasisAr, invalidationAr, warningsAr, snapshot, engine: row.engine,
    }
  }

  // ---------- 1) support broke on the last session → the cushion rule decides
  if (cushion.brokeLastSession && cushion.farCushion) {
    decision = "exit"
    headlineAr = `الكسر حصل ومفيش بطانة قريبة تحت السعر — الخروج هنا إدارة مخاطر مش هيزنة`
    invalidationAr = `السيناريو يرجع فيه فقط بإغلاق يومي فوق مستوى الكسر (${fmt(cushion.brokenZone!.low)})`
    reasonsAr.push(
      `بص بصراحة: إغلاق النهاردة (${fmt(close)}) كسر دعم ${cushion.brokenZone!.touches}× مختبَر (${fmt(cushion.brokenZone!.low)}–${fmt(cushion.brokenZone!.high)}) — ده مش تذبذب، ده هيكل اتكسر.`,
      openFieldAr + " — يعني مفيش حاجة قريبة تمسك السعر لو السوق نزل أكتر.",
      `مركزك اتفتح بمتوسط ${fmt(avgBuyPrice)} والسعر دلوقتي ${fmt(close)} يعني ${pnlPct >= 0 ? "رابح" : "خاسر"} ${pct1(pnlPct)} (${pnlPerShare >= 0 ? "+" : ""}${fmt(pnlPerShare)} جنيه/سهم)${pnlPct < 0 ? ` — و${recoveryReasonAr(pnlPct, recoveryPct ?? 0).toLowerCase()}` : ""}.`,
      "قاعدة البيع على الكسر بتشتغل بس لما الدعم اللي تحت يكون بعيد — وهنا هو بعيد فعلًا، فالقرار خروج.",
      "الخروج مش فشل ولا اعتراف بغلطة — ده الفرق بين المتداول والمشبِط: بنقفل الخسارة الصغيرة قبل ما تبقى كبيرة.",
    )
    return {
      decision, decisionAr: POSITION_DECISION_AR[decision], headlineAr,
      avgBuyPrice, lastClose: close, pnlPct: Math.round(pnlPct * 10) / 10, pnlPerShare: Math.round(pnlPerShare * 100) / 100,
      recoveryPct, reasonsAr, planAr: null, question: null, closingAr,
      supports, resistances, levelsBasisAr, invalidationAr, warningsAr, snapshot, engine: row.engine,
    }
  }

  // ---------- 2) support broke but a close cushion sits right under → wait
  if (cushion.brokeLastSession) {
    decision = "wait"
    headlineAr = cushion.borderline
      ? `الكسر حصل بس الفرق حدّي — انتظر بوقف أضيق، وبياع مؤجل`
      : `الكسر حصل بس الدعم اللي تحته قريب جدًا — البيع هنا بيقفل الخسارة في أسوأ مكان`
    invalidationAr = cushion.cushionLevel !== null
      ? `الخروج الفعلي يُفعَّل بإغلاق يومي تحت البطانة (${fmt(cushion.cushionLevel)}) — تحتها مفيش دعم قريب`
      : "الخروج الفعلي عند أي إغلاق يحطم قاع آخر 60 جلسة"
    planAr = `أنا بفكر معاك كده: راقب إغلاقات الجلسات القادمة — الإغلاق تحت ${fmt(cushion.cushionLevel ?? 0)} بيرجّح سيناريو الخروج، والإغلاق فوق مستوى الكسر الأصلي (${fmt(cushion.brokenZone!.low)}) بيرجّح إن الكسر كان كاذب ويقرّب من إلغاء السيناريو ده خالص.`
    reasonsAr.push(
      `وضعك محسوب: متوسط شراء ${fmt(avgBuyPrice)} وسعر النهاردة ${fmt(close)} — ${pnlPct >= 0 ? "رابح" : "خاسر"} ${pct1(pnlPct)} (${pnlPerShare >= 0 ? "+" : ""}${fmt(pnlPerShare)} جنيه/سهم).`,
      `الصدمة: إغلاق النهاردة كسر دعم ${cushion.brokenZone!.touches}× مختبَر (${fmt(cushion.brokenZone!.low)}–${fmt(cushion.brokenZone!.high)}).`,
      `بس — وقاعدة البورصة اللي اتفقنا عليها: مش أي كسر يعني بيع فورًا. الدعم اللي تحت (${fmt(cushion.cushionLevel ?? 0)}) لسه على بعد ${pct1(cushion.cushionGapPct ?? 0)} بس — يعني الهبوط المتبقي محدود والسوق هياخد قراره قريب جدًا من هنا.`,
      cushion.borderline
        ? "الفرق في المنطقة الحدّية (بين 3٪ و4٪): انتظار مع وقف ذهني أضيق عند البطانة نفسها — ولو كسرتها بإغلاق، دي إشارة تقيلة نتعامل معاها بجدية."
        : "البيع دلوقتي معناه إنك بتسلم السهم عند أول باب قبل ما يبان لو فيه مرتد — استنى الإغلاقات: دعم قريب بيمتص الضغط غالبًا.",
    )
    if (pnlPct < 0) reasonsAr.push(recoveryReasonAr(pnlPct, recoveryPct ?? 0))
    return {
      decision, decisionAr: POSITION_DECISION_AR[decision], headlineAr,
      avgBuyPrice, lastClose: close, pnlPct: Math.round(pnlPct * 10) / 10, pnlPerShare: Math.round(pnlPerShare * 100) / 100,
      recoveryPct, reasonsAr, planAr, question: null, closingAr,
      supports, resistances, levelsBasisAr, invalidationAr, warningsAr, snapshot, engine: row.engine,
    }
  }

  // ---------- 3) engine-v2 says exit (trend break path) → exit
  if (row.state === "exit") {
    decision = "exit"
    headlineAr = "الاتجاه نفسه اتكسر — ده مش وقت المبادرة، ده وقت حماية اللي فاضل"
    invalidationAr = `السيناريو يرجع فيه بإغلاق يومي فوق EMA50 (${mt?.ema50 ? fmt(mt.ema50) : "المتوسط"}) مع ترتيب صعودي تاني`
    reasonsAr.push(
      `حسبت لك الوضع: متوسط شراء ${fmt(avgBuyPrice)} وسعر النهاردة ${fmt(close)} — ${pnlPct >= 0 ? "رابح" : "خاسر"} ${pct1(pnlPct)} (${pnlPerShare >= 0 ? "+" : ""}${fmt(pnlPerShare)} جنيه/سهم).`,
      `الاتجاه العام: ${trendAr} — والمحرك الفني سلّم الإشارة "خروج".`,
      "كسر الاتجاه مختلف عن كسر دعم عابر: هنا البنية الزمنية نفسها بتتغير، والأسهم اللي بتكسر EMA50 بترتيب سلبي بتكمل ضعف غالبًا.",
      `الخروج هنا بيحمي الرصيد: أفضل وقت للرجوع هو لما يرجع السهم فوق متوسطاته ويثبت — والموقع هيقولك لحظتها.`,
    )
    if (pnlPct < 0) reasonsAr.push(recoveryReasonAr(pnlPct, recoveryPct ?? 0))
    return {
      decision, decisionAr: POSITION_DECISION_AR[decision], headlineAr,
      avgBuyPrice, lastClose: close, pnlPct: Math.round(pnlPct * 10) / 10, pnlPerShare: Math.round(pnlPerShare * 100) / 100,
      recoveryPct, reasonsAr, planAr: null, question: null, closingAr,
      supports, resistances, levelsBasisAr, invalidationAr, warningsAr, snapshot, engine: row.engine,
    }
  }

  // ---------- 4) in profit → hold with the trailing line drawn
  if (pnlPct >= 0) {
    decision = "hold"
    const supLine = effSupport
    headlineAr = supLine
      ? `إنت رابح ${pct1(pnlPct)} والسهم واقف فوق خط دفاعه — احتفظ، ورسمت لك الخط تحت`
      : `إنت رابح ${pct1(pnlPct)} — احتفظ بس مفيش بطانة معتمدة تحت، فخلي عينك على الشاشة`
    invalidationAr = supLine
      ? `الخط اللي هتفرج عليه معايا: الإغلاق تحت ${fmt(supLine.level)} — ساعتها بس نفتح الملف من الأول. مش أي لمسة تحته: الصنّاع بيعملوا كسور كاذبة كتير في السوق المصري، والإغلاق الفعلي هو اللي بيقول الكلمة الأخيرة`
      : "مفيش بطانة معتمدة تحت السعر — فأي إغلاق تحت قاع آخر 60 جلسة يستحق معايا إعادة نظر كاملة"
    planAr = supLine ? `الفكرة اللي بنشتغل عليها: طالما الإغلاقات واقفة فوق ${fmt(supLine.level)}، مفيش إشارة تقنية تبرر حركة — ولو جلسة قفلت تحته، متتحركش في ثانية اللقطة: استنى الإغلاق، وبين الحكم بالإغلاق والحجم بنعرف هل ده كسر حقيقي ولا كاذب.` : null
    reasonsAr.push(
      `الأساسي أولًا: متوسطك ${fmt(avgBuyPrice)} والسعر ${fmt(close)} — يعني إنت ${pct1(pnlPct)} (${pnlPerShare >= 0 ? "+" : ""}${fmt(pnlPerShare)} جنيه/سهم). المركز مش في منطقة خطر.`,
      `القراءة الفنية: ${trendAr}${mt?.rsi14 ? ` وRSI ${fmt(mt.rsi14)} (${mt.rsi14 > 70 ? "منطقة تشبع شرائي — متصدقش إن الصعود مستحيل يتوقف، خد أرباح جزئية لو عاجلك" : mt.rsi14 < 30 ? "منطقة تشبع بيعي — أرضية محتملة" : "منطقة متوازنة"})` : ""}.`,
      supLine
        ? `خط الدفاع: ${supLine.basisAr} — طالما السعر فوقه بالإغلاق، القصة سليمة.`
        : "ملاحظة أمانة: مفيش دعم معتمد تحت السعر الحالي — الرحلة صاعدة بلا بطانة، فلو عاجلك الربح خد جزء منه.",
      resistances.length
        ? `الحلم فوق: أقرب مقاومة عند ${fmt(resistances[0].low)}–${fmt(resistances[0].high)} على بعد ${pct1(resistances[0].distFromPricePct)} — دي أول منطقة تستحق قرار أرباح جزئي.`
        : "مفيش مقاومة مسجلة فوق — السهم في فضاء مفتوح، بس خد بالك إن الفضاء المفتوح بيقطع بسرعة.",
      "الخلاصة بصوت واضح: احتفظ. البيع يبقى قرار لما يفلخط الدفاع، مش لما القلق يعلو.",
    )
    return {
      decision, decisionAr: POSITION_DECISION_AR[decision], headlineAr,
      avgBuyPrice, lastClose: close, pnlPct: Math.round(pnlPct * 10) / 10, pnlPerShare: Math.round(pnlPerShare * 100) / 100,
      recoveryPct, reasonsAr, planAr, question: null, closingAr,
      supports, resistances, levelsBasisAr, invalidationAr, warningsAr, snapshot, engine: row.engine,
    }
  }

  // ---------- 5) small loss (above −20%) → protect the remaining capital
  const trendBroken = (mt?.ema20 ?? null) !== null && (mt?.ema50 ?? null) !== null && mt!.ema20! < mt!.ema50! && close < mt!.ema50!
  // the cushion decision rule stays zone-based (owner constants); the DISPLAY
  // floor and the stop line follow the effective-support rule (EMA20 fallback)
  const supZone = nearestSupportBelowClose
  const closeCushion = supZone !== null && Math.abs(supZone.distFromPricePct) <= EXIT_SUPPORT_CUSHION_WAIT_PCT
  if (trendBroken && !closeCushion) {
    decision = "exit"
    headlineAr = "إنت تحت الماء والاتجاه اتكسر — الخسارة الصغيرة دلوقتي أفضل من الكبيرة بعدين"
    invalidationAr = `السيناريو يرجع فيه بإغلاق يومي فوق EMA50 (${mt?.ema50 ? fmt(mt.ema50) : "المتوسط"})`
    reasonsAr.push(
      `الصريح الموجع: متوسطك ${fmt(avgBuyPrice)} والسعر دلوقتي ${fmt(close)} — خسارة ${pct1(pnlPct)} (${fmt(pnlPerShare)} جنيه/سهم).`,
      recoveryReasonAr(pnlPct, recoveryPct ?? 0),
      `الاتجاه: ${trendAr} — السعر تحت متوسطاته بالترتيب السلبي، وده وضع بيكمل ضعف في أغلب الحالات.`,
      openFieldAr + " — يعني مفيش أرضية قريبة تقولك «استنى هنا».",
      "قاعدتنا الثابتة: مفيش استثمار اسمه «هيرجع» من غير دليل فني. الدليل دلوقتي بيقول عكس كده، فبنقلل التعرض.",
      "لما يرجع ويثبت فوق متوسطاته، الموقع هيرصد ده وترجع تراجع الدخول تاني بعين صافية.",
    )
  } else {
    decision = "wait"
    headlineAr = closeCushion
      ? "إنت خاسر بس السعر لاسك على دعم قريب — انتظر بإغلاق واحد يحسم"
      : "إنت خاسر بس البنية لسه مكسورة جزئيًا — انتظر بإطار واضح مش بالعاطفة"
    invalidationAr = effSupport
      ? `الإشارة اللي بنتظرها مع بعض: إغلاق يومي تحت ${fmt(effSupport.level)} — لحظتها بنعيد التفكير في الخروج جدًا، لأن الحكم بالإغلاق مش باللمسة واللمسة ممكن تكون كسر كاذب`
      : "الإشارة اللي بنتظرها مع بعض: إغلاق يومي تحت قاع آخر 60 جلسة — لحظتها بنعيد التفكير في الخروج جدًا"
    planAr = effSupport
      ? `خليني أوضحلك نقطة ممكن متشوفهاش من النظرة الأولى: ${effSupport.basisAr}. يعني السعر لسه في منطقة فيها وقت للتفكير — لو جلسة جاية قفلت تحت ${fmt(effSupport.level)}، ده اللي بيرجّح استمرار الهبوط وبيخلي التخفيف أريح من انتظار مفتوح؛ ولو ثابت فوقه بالإغلاق، فمتابعة الفرد يوميًا على الشاشة كفاية — مفيش قرار مسبق ولا ردة فعل على اللمسات.`
      : "النقطة اللي تستحق متابعتك على الشاشة هي القاع الأخير: كسره بإغلاق بيرجّح اكتمال الهبوط، وثباته بيرجّح إن الانتظار لسه مشروع — والقرار في الحالتين بين يديك."
    reasonsAr.push(
      `الوضع: متوسطك ${fmt(avgBuyPrice)} والسعر ${fmt(close)} — خسارة ${pct1(pnlPct)} (${fmt(pnlPerShare)} جنيه/سهم). القرار دلوقتي بيتاخد بالأرقام مش بالأمل.`,
      recoveryReasonAr(pnlPct, recoveryPct ?? 0),
      `الاتجاه: ${trendAr}${row.score !== null ? ` ودرجة المحرك ${row.score}/100 (${row.state === "near" ? "إعداد قريب من التفعيل" : "لا فرصة مناسبة دلوقتي"})` : ""}.`,
      effSupport
        ? `أرضية اللعبة: ${effSupport.basisAr}${closeCushion ? " — قريب جدًا فالبيع هنا بيقفل الخسارة عند أدنى نقطة، والسوق هيحسم قريب" : " — طالما السعر واقف فوقه بالإغلاق، الاحتفاظ المشروط منطقي"}.`
        : "أرضية اللعبة: مفيش دعم معتمد تحت السعر الحالي — الخط الفاصل الوحيد هو قاع آخر 60 جلسة، ومتابعتك للفرد لازم تكون يومية على الشاشة.",
      trendBroken
        ? "الاتجاه العام ضعيف بس الدعم القريب هو اللي بيمسك المركز — كسبنا وقت، مش أكتر: أي كسر للبطانة يعني خروج."
        : "الهيكل لسه ماسك: السعر تحت متوسطك بس مش تحت بنية الدعم — بنستنى إما الارتداد أو الكسر، والاتنين واضحين.",
      "قاعدة السوق المصري: الستوب الآلي بيوقّعك في الكسور الكاذبة — الصنّاع بيكسروا المستويات لمرة واحدة عشان يجمعوا السيولة ويرجّعوا السعر، فمتابعة الفرد جيدًا على الشاشة هي الحماية الحقيقية، والحكم على أي كسر يكون بالإغلاق الفعلي والحجم قبل أي حركة.",
    )
  }

  return {
    decision, decisionAr: POSITION_DECISION_AR[decision], headlineAr,
    avgBuyPrice, lastClose: close, pnlPct: Math.round(pnlPct * 10) / 10, pnlPerShare: Math.round(pnlPerShare * 100) / 100,
    recoveryPct, reasonsAr, planAr, question: null, closingAr,
    supports, resistances, levelsBasisAr, invalidationAr, warningsAr, snapshot, engine: row.engine,
  }
}
