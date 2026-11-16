// =============================================================================
// حلل سهمي (Position Review) — the decision engine (PURE).
// Owner feature (2026-11-17): the user enters their AVERAGE BUY PRICE; the
// engine answers ONE question — احتفظ ولا أنتظر ولا أخرج؟ — and shows its
// full work: every reason in the friend's voice, every support and
// resistance, and the complete technical reading.
//
// Decision ladder (deterministic, no hidden weighting):
//   1. A multi-touch support broke on the LAST session → the OWNER cushion
//      rule decides: next support ≥4% below (or none) → exit; ≤3% → wait
//      (selling into a close cushion locks the loss at the worst spot);
//      3–4% → wait, borderline, tighter mental stop.
//   2. Otherwise the engine-v2 row says exit (trend break) → exit.
//   3. In profit → hold, with the trailing line drawn at the nearest support.
//   4. At a loss → protect the remaining capital: a broken trend with no
//      close cushion → exit; anything else → wait with the line in the sand.
// Nothing here is investment advice — every output says what it IS.
// =============================================================================

import { nearestSupportBelow, type PriceZone, type ZoneMap } from "@/lib/signals/levels"
import {
  EXIT_SUPPORT_CUSHION_EXIT_PCT,
  EXIT_SUPPORT_CUSHION_WAIT_PCT,
  type Bar,
  type SignalRowV2,
} from "@/lib/signals/types"
import { POSITION_DECISION_AR, type LevelLine, type PositionDecision, type PositionReview, type TechnicalSnapshot } from "./types"

export interface ReviewInput {
  row: SignalRowV2
  bars: Bar[]
  map: ZoneMap
  avgBuyPrice: number
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

export function reviewPosition(input: ReviewInput): PositionReview {
  const { row, bars, map, avgBuyPrice } = input
  const close = row.lastClose ?? (bars.length ? bars[bars.length - 1].close : 0)
  const mt = row.metrics
  const pnlPerShare = close - avgBuyPrice
  const pnlPct = avgBuyPrice > 0 ? (pnlPerShare / avgBuyPrice) * 100 : 0
  const cushion = readCushion(bars, map)
  const { supports, resistances } = levelLines(map, close, avgBuyPrice)
  const nearestSupportBelowClose = supports.find((s) => s.high < close) ?? null
  const trendAr = trendTextAr(close, mt?.ema20 ?? null, mt?.ema50 ?? null)

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

  const warningsAr = [
    ...row.warnings.map((w) => w.detailAr),
    ...row.quality.notesAr,
  ]

  const reasonsAr: string[] = []
  const engine = row.engine
  let decision: PositionDecision
  let headlineAr: string
  let invalidationAr: string

  const openFieldAr = cushion.cushionLevel === null
    ? "ومفيش أي دعم مسجل تحته — يعني الهبوط لسه فاضي"
    : `والدعم التالي تحته (${fmt(cushion.cushionLevel)}) بعيد ${pct1(cushion.cushionGapPct ?? 0)}`

  // ---------- 1) support broke on the last session → the cushion rule decides
  if (cushion.brokeLastSession && cushion.farCushion) {
    decision = "exit"
    headlineAr = `الكسر حصل ومفيش بطانة قريبة تحت السعر — الخروج هنا إدارة مخاطر مش هيزنة`
    invalidationAr = `السيناريو يرجع فيه فقط بإغلاق يومي فوق مستوى الكسر (${fmt(cushion.brokenZone!.low)})`
    reasonsAr.push(
      `بص بصراحة: إغلاق النهاردة (${fmt(close)}) كسر دعم ${cushion.brokenZone!.touches}× مختبَر (${fmt(cushion.brokenZone!.low)}–${fmt(cushion.brokenZone!.high)}) — ده مش تذبذب، ده هيكل اتكسر.`,
      openFieldAr + " — يعني مفيش حاجة قريبة تمسك السعر لو السوق نزل أكتر.",
      `مركزك اتفتح بمتوسط ${fmt(avgBuyPrice)} والسعر دلوقتي ${fmt(close)} يعني ${pnlPct >= 0 ? "رابح" : "خاسر"} ${pct1(pnlPct)} (${pnlPerShare >= 0 ? "+" : ""}${fmt(pnlPerShare)} جنيه/سهم) — الخروج هنا بيحفظ اللي فاضل بدل ما نستنى المفاجآت.`,
      "قاعدة البيع على الكسر بتشتغل بس لما الدعم اللي تحت يكون بعيد — وهنا هو بعيد فعلًا، فالقرار خروج.",
      "الخروج مش فشل ولا اعتراف بغلطة — ده الفرق بين المتداول والمشبِط: بنقفل الخسارة الصغيرة قبل ما تبقى كبيرة.",
    )
    return {
      decision, decisionAr: POSITION_DECISION_AR[decision], headlineAr,
      avgBuyPrice, lastClose: close, pnlPct: Math.round(pnlPct * 10) / 10, pnlPerShare: Math.round(pnlPerShare * 100) / 100,
      reasonsAr, supports, resistances,
      levelsBasisAr: "المستويات من قيعان وقمم حقيقية متكررة (pivot zones) من بيانات التداول نفسها — مفيش مستوى مُختلق ولا نسب جاهزة.",
      invalidationAr, warningsAr, snapshot, engine,
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
    reasonsAr.push(
      `وضعك محسوب: متوسط شراء ${fmt(avgBuyPrice)} وسعر النهاردة ${fmt(close)} — ${pnlPct >= 0 ? "رابح" : "خاسر"} ${pct1(pnlPct)} (${pnlPerShare >= 0 ? "+" : ""}${fmt(pnlPerShare)} جنيه/سهم).`,
      `الصدمة: إغلاق النهاردة كسر دعم ${cushion.brokenZone!.touches}× مختبَر (${fmt(cushion.brokenZone!.low)}–${fmt(cushion.brokenZone!.high)}).`,
      `بس — وقاعدة البورصة اللي اتفقنا عليها: مش أي كسر يعني بيع فورًا. الدعم اللي تحت (${fmt(cushion.cushionLevel ?? 0)}) لسه على بعد ${pct1(cushion.cushionGapPct ?? 0)} بس — يعني الهبوط المتبقي محدود والسوق هياخد قراره قريب جدًا من هنا.`,
      cushion.borderline
        ? "الفرق في المنطقة الحدّية (بين 3٪ و4٪): انتظار مع وقف ذهني أضيق عند البطانة نفسها — لو كسرتها بإغلاق، الخروج بلا نقاش."
        : "البيع دلوقتي معناه إنك بتسلم السهم عند أول باب قبل ما يبان لو فيه مرتد — استنى الإغلاقات: دعم قريب بيمتص الضغط غالبًا.",
      "المراقبة بسيطة: كل إغلاق يومي تحت " + fmt(cushion.cushionLevel ?? 0) + " = ساعتها نخرج فورًا من غير نقاش. أي إغلاق فوق مستوى الكسر الأصلي (" + fmt(cushion.brokenZone!.low) + ") يلغي سيناريو الخروج خالص.",
    )
    return {
      decision, decisionAr: POSITION_DECISION_AR[decision], headlineAr,
      avgBuyPrice, lastClose: close, pnlPct: Math.round(pnlPct * 10) / 10, pnlPerShare: Math.round(pnlPerShare * 100) / 100,
      reasonsAr, supports, resistances,
      levelsBasisAr: "المستويات من قيعان وقمم حقيقية متكررة (pivot zones) من بيانات التداول نفسها — مفيش مستوى مُختلق ولا نسب جاهزة.",
      invalidationAr, warningsAr, snapshot, engine,
    }
  }

  // ---------- 3) engine-v2 says exit (trend break path) → exit
  if (row.state === "exit") {
    decision = "exit"
    headlineAr = "الاتجاه نفسه اتكسر — ده مش وقت المبادرة، ده وقت حماية اللي فاضل"
    invalidationAr = `السيناريو يرجع فيه بإغلاق يومي فوق EMA50 (${mt?.ema50 ? fmt(mt.ema50) : "المتوسط"}) مع ترتيب صعودي تاني`
    reasonsAr.push(
      `حسبت لك الوضع: متوسط شراء ${fmt(avgBuyPrice)} وسعر النهاردة ${fmt(close)} — ${pnlPct >= 0 ? "رابح" : "خاسر"} ${pct1(pnlPct)} (${pnlPerShare >= 0 ? "+" : ""}${fmt(pnlPerShare)} جنيه/سهم).`,
      `الاتجاه العام: ${trendAr} — والمحرك الفني سلّم الإشارة "خروج" (${row.type ? row.type : "trend break"}).`,
      "كسر الاتجاه مختلف عن كسر دعم عابر: هنا البنية الزمنية نفسها بتتغير، والأسهم اللي بتكسر EMA50 بترتيب سلبي بتكمل ضعف غالبًا.",
      `الخروج هنا بيحمي الرصيد: أفضل وقت للرجوع هو لما يرجع السهم فوق متوسطاته ويثبت — والموقع هيقولك لحظتها.`,
    )
    return {
      decision, decisionAr: POSITION_DECISION_AR[decision], headlineAr,
      avgBuyPrice, lastClose: close, pnlPct: Math.round(pnlPct * 10) / 10, pnlPerShare: Math.round(pnlPerShare * 100) / 100,
      reasonsAr, supports, resistances,
      levelsBasisAr: "المستويات من قيعان وقمم حقيقية متكررة (pivot zones) من بيانات التداول نفسها — مفيش مستوى مُختلق ولا نسب جاهزة.",
      invalidationAr, warningsAr, snapshot, engine,
    }
  }

  // ---------- 4) in profit → hold with the trailing line drawn
  if (pnlPct >= 0) {
    decision = "hold"
    const supLine = nearestSupportBelowClose
    headlineAr = supLine
      ? `إنت رابح ${pct1(pnlPct)} والسهم واقف فوق دعمه — احتفظ، ورسمت لك خط الخروج تحت`
      : `إنت رابح ${pct1(pnlPct)} — احتفظ بس مفيش دعم واضح تحت، فخلي عينك على السوق`
    invalidationAr = supLine
      ? `أي إغلاق يومي تحت أقرب دعم (${fmt(supLine.high)}) يقلب القرار لمراجعة فورية`
      : "مفيش دعم مسجل تحت السعر — راجع القرار عند أي إغلاق تحت قاع آخر 60 جلسة"
    reasonsAr.push(
      `الأساسي أولًا: متوسطك ${fmt(avgBuyPrice)} والسعر ${fmt(close)} — يعني إنت +${pct1(pnlPct)} (${pnlPerShare >= 0 ? "+" : ""}${fmt(pnlPerShare)} جنيه/سهم). المركز مش في منطقة خطر.`,
      `القراءة الفنية: ${trendAr}${mt?.rsi14 ? ` وRSI ${fmt(mt.rsi14)} (${mt.rsi14 > 70 ? "منطقة تشبع شرائي — متصدقش إن الصعود مستحيل يتوقف، خد أرباح جزئية لو عاجلك" : mt.rsi14 < 30 ? "منطقة تشبع بيعي — أرضية محتملة" : "منطقة متوازنة"})` : ""}.`,
      supLine
        ? `خط الدفاع: أقرب دعم تحتك (${fmt(supLine.high)}–${fmt(supLine.low)})، ${supLine.touches}× مختبَر، على بعد ${pct1(Math.abs(supLine.distFromPricePct))} — طالما السعر فوقه، القصة سليمة.`
        : "ملاحظة أمانة: مفيش دعم مسجل تحت السعر الحالي — الرحلة صاعدة بلا بطانة، فلو عاجلك الربح خد جزء منه.",
      resistances.length
        ? `الحلم فوق: أقرب مقاومة عند ${fmt(resistances[0].low)}–${fmt(resistances[0].high)} على بعد ${pct1(resistances[0].distFromPricePct)} — دي أول منطقة تستحق تاخد فيها قرار أرباح جزئي.`
        : "مفيش مقاومة مسجلة فوق — السهم في فضاء مفتوح، بس خد بالك إن الفضاء المفتوح بيقطع بسرعة.",
      "الخلاصة بصوت واضح: احتفظ. البيع يبقى قرار لما يفلخط الدفاع، مش لما القلق يعلو.",
    )
    return {
      decision, decisionAr: POSITION_DECISION_AR[decision], headlineAr,
      avgBuyPrice, lastClose: close, pnlPct: Math.round(pnlPct * 10) / 10, pnlPerShare: Math.round(pnlPerShare * 100) / 100,
      reasonsAr, supports, resistances,
      levelsBasisAr: "المستويات من قيعان وقمم حقيقية متكررة (pivot zones) من بيانات التداول نفسها — مفيش مستوى مُختلق ولا نسب جاهزة.",
      invalidationAr, warningsAr, snapshot, engine,
    }
  }

  // ---------- 5) at a loss → protect the remaining capital
  const trendBroken = (mt?.ema20 ?? null) !== null && (mt?.ema50 ?? null) !== null && (mt!.ema20 as number) < (mt!.ema50 as number) && close < (mt!.ema50 as number)
  const supLine = nearestSupportBelowClose
  const closeCushion = supLine !== null && Math.abs(supLine.distFromPricePct) <= EXIT_SUPPORT_CUSHION_WAIT_PCT
  if (trendBroken && !closeCushion) {
    decision = "exit"
    headlineAr = "إنت تحت الماء والاتجاه اتكسر — الخسارة الصغيرة دلوقتي أفضل من الكبيرة بعدين"
    invalidationAr = `السيناريو يرجع فيه بإغلاق يومي فوق EMA50 (${mt?.ema50 ? fmt(mt.ema50) : "المتوسط"})`
    reasonsAr.push(
      `الصريح الموجع: متوسطك ${fmt(avgBuyPrice)} والسعر دلوقتي ${fmt(close)} — خسارة ${pct1(pnlPct)} (${fmt(pnlPerShare)} جنيه/سهم).`,
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
    invalidationAr = supLine
      ? `أي إغلاق يومي تحت ${fmt(supLine.high)} يقلب القرار لخروج فوري`
      : "أي إغلاق يومي تحت قاع آخر 60 جلسة يقلب القرار لخروج فوري"
    reasonsAr.push(
      `الوضع: متوسطك ${fmt(avgBuyPrice)} والسعر ${fmt(close)} — خسارة ${pct1(pnlPct)} (${fmt(pnlPerShare)} جنيه/سهم). القرار دلوقتي بيتاخد بالأرقام مش بالأمل.`,
      `الاتجاه: ${trendAr}${row.score !== null ? ` ودرجة المحرك ${row.score}/100 (${row.state === "near" ? "إعداد قريب من التفعيل" : "لا فرصة مناسبة دلوقتي"})` : ""}.`,
      supLine
        ? `أرضية اللعبة: أقرب دعم تحت السعر (${fmt(supLine.high)}–${fmt(supLine.low)}) على بعد ${pct1(Math.abs(supLine.distFromPricePct))}${closeCushion ? " — قريب جدًا فالبيع هنا بيقفل الخسارة عند أدنى نقطة، والسوق هيحسم قريب" : " — طالما واقف فوقه، الاحتفاظ المشروط منطقي"}.`
        : "أرضية اللعبة: مفيش دعم مسجل تحت السعر الحالي — الخط الفاصل الوحيد هو قاع آخر 60 جلسة، وخليه تنبيه آلي مش قرار مزاج.",
      trendBroken
        ? "الاتجاه العام ضعيف بس الدعم القريب هو اللي بيمسك المركز — كسبنا وقت، مش أكتر: أي كسر للبطانة يعني خروج."
        : "الهيكل لسه ماسك: السعر تحت متوسطك بس مش تحت بنية الدعم — بنستنى إما الارتداد أو الكسر، والاتنين واضحين.",
      "سلامة نفسك قبل السهم: حط التنبيه عند خط الإلغاء اللي تحت وخلي القرار آلي — القرارات اللي بتتاخد في ساعة الصفر هي الأغلط.",
    )
  }

  return {
    decision, decisionAr: POSITION_DECISION_AR[decision], headlineAr,
    avgBuyPrice, lastClose: close, pnlPct: Math.round(pnlPct * 10) / 10, pnlPerShare: Math.round(pnlPerShare * 100) / 100,
    reasonsAr, supports, resistances,
    levelsBasisAr: "المستويات من قيعان وقمم حقيقية متكررة (pivot zones) من بيانات التداول نفسها — مفيش مستوى مُختلق ولا نسب جاهزة.",
    invalidationAr, warningsAr, snapshot, engine,
  }
}
