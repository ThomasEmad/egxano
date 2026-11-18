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
//
//   OWNER UPDATE (2026-11-17): a gain ≥ +6% (PROFIT_TAKE_MIN_PCT) turns BOTH
//   red-exit branches — the far-cushion break (1) and the engine trend break
//   (3) — into a GREEN partial take-profit ("take_profit"): the snapshot's
//   own posture picks the sizing (bearish → secure 50–75% now, keep 25–50%;
//   bullish → secure 20–40%, the rest rides) and the runner trails a
//   CLOSE-BASED line (the effective support, else EMA50 under the price).
//   A PROFITABLE position never gets a full red exit; below +6% or at a
//   loss the red exit stands unchanged.
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
import { buildMarketContext, type MarketContext } from "./market-context"

/** OWNER MANDATE (2026-11-17): at −20% or deeper, selling locks a loss whose
 *  recovery math turns brutal — the default verdict becomes انتظار للارتداد
 *  and the exit is replanned into the 20–25% loss band. */
export const DEEP_LOSS_PCT = 20

/** OWNER UPDATE (2026-11-17): at a gain of +6% or more, the red-exit branches
 *  (broken far-cushion support / engine trend break) collapse into a GREEN
 *  partial take-profit — securing part of the gain beats a full exit while
 *  the position is still in profit. Below +6% (or at any loss) the red exit
 *  stands unchanged. */
export const PROFIT_TAKE_MIN_PCT = 6

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
  // BUG FIX (2026-11-18, OCPH «اكتوبر فارما»): the map's `kind` is the zone's
  // historical pivot ORIGIN (a swing-high cluster stays "resistance" forever),
  // so a base ceiling the price rallied 2× above was still surfaced as
  // «أقرب مقاومة» at −52٪ UNDER the live close. A zone may only be shown as
  // resistance while it is fully ABOVE the close (z.low > close) — anything
  // the close has left below it is history / structural support. Zones the
  // close sits inside (low ≤ close ≤ high) keep their historical kind but are
  // never surfaced here: the market is testing them right now. The map's own
  // current-position label (positionKind) carries the same rule for queries.
  const resistances = map.zones.filter((z) => z.kind === "resistance" && z.low > close).map(toLine).sort((a, b) => a.low - b.low)
  return { supports, resistances }
}

const fmt = (x: number) => x.toFixed(2)
const pct1 = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}٪`
/** 1-decimal percent WITHOUT a sign — for unsigned quantities like the close's
 *  location inside its own range or a wick's share of the day's range. */
const pctPlain = (x: number) => `${x.toFixed(1)}٪`
/** 1-decimal ×multiple — for volume class bounds, ATR stretch and candle body. */
const mult1 = (x: number) => `${x.toFixed(1)}×`

// =============================================================================
// OWNER MANDATE (2026-11-18) — the veteran's voice. «اسلوب تحليل السهم في قسم
// حلل سهمي محتاج يتطور ويبقى متعلم تحليل فني أكتر، ويبقى كأنه إنسان مليان من
// الخبرات والتجارب من البورصة — مش مجرد محرك متعلم شوية مؤشرات ودعوم ومقاومات
// وبس». veteranLinesAr reads the MarketContext — the candle's anatomy, the
// volume character, the stretch off the averages, the traps — and speaks AT
// MOST 2 lines in the voice of someone who has lived EGX cycles: honest,
// never commanding, never boilerplate. Every line fires ONLY on its own data
// trigger and cites real numbers from the context (2-decimal levels,
// 1-decimal ٪ percents, ×multiples). An honestly-null context (thin data)
// keeps the veteran silent: [] → zero change to today's output.
//
// PRIORITY LADDER — when several triggers fire, traps speak before
// confirmations and the tape speaks before structure:
//   1. spike volume ON the break (exit branches) — real liquidity pull?
//   2. bearish momentum divergence (hold/take-profit) — the trap at the top
//   3. bullish momentum divergence (deep loss / cushion wait) — early-turn hint
//   4. spike volume closing at the top (hold/take-profit) — real buying
//   5. dry-volume rally at the range top (hold) — the hollow climb
//   6. dry volume at the range bottom (loss waits) — no capitulation yet
//   7. long upper wick after the rally (hold/take-profit) — sold above
//   8. long lower wick (loss waits) — someone actually bought down there
//   9. down gap ≥ 2٪ (any branch) — the open is not the verdict
//  10. up gap ≥ 2٪ closing near the low (any branch) — distribution over the gap
//  11. stretch off EMA20 ≥ 2.5× ATR (hold/take-profit) — the tired place
//  12. 15+ sessions above EMA20 (hold) — a mid-life trend
//  13. weak ADX (cushion wait) — a directionless market re-tests
//  14. strong ADX (exit branches) — the downtrend has muscles
//  15. the named candle pattern, read against THIS branch's meaning
//  16. the VSA note pass-through (already a complete sentence) — filler
// =============================================================================

export type VeteranBranch = "deepLoss" | "farCushionExit" | "cushionWait" | "engineExit" | "takeProfit" | "hold"

export interface VeteranOpts {
  branch: VeteranBranch
  avgBuyPrice: number
  close: number
  trendAr: string
}

/** Which meaning group the branch belongs to, for the pattern lines:
 *  profit rides (hold / take-profit), loss waits (deep loss / cushion wait),
 *  and red exits (far-cushion / engine trend break). */
function veteranGroup(b: VeteranBranch): "profit" | "loss" | "exit" {
  if (b === "hold" || b === "takeProfit") return "profit"
  if (b === "deepLoss" || b === "cushionWait") return "loss"
  return "exit"
}

/** The pattern's meaning vs the surrounding trend — candlestick.ts itself
 *  gates every pattern by trend, and the veteran says it out loud: a pattern
 *  that agrees with the trend is confirmed by it; one that fights it needs
 *  a stronger close to matter. */
function patternEchoAr(tone: "bull" | "bear" | "neutral", trendAr: string): string {
  const up = trendAr.startsWith("صاعد")
  const down = trendAr.startsWith("هابط")
  if (tone === "neutral") return down ? "والاتجاه المحيط هابط فالترجيح يميل للهبوط" : up ? "والاتجاه المحيط صاعد فالترجيح يميل للصعود" : ""
  if (tone === "bull") return down ? "والاتجاه المحيط هابط فبيحتاج تأكيد أقوى بالإغلاق" : up ? "والاتجاه المحيط صاعد فبيأكد المعنى" : ""
  return up ? "والاتجاه المحيط صاعد فبيحتاج تأكيد أقوى بالإغلاق" : down ? "والاتجاه المحيط هابط فبيأكد المعنى" : ""
}

/** The named candle pattern, read against THIS branch's meaning — the same
 *  shape means different things at a top, at a bottom and on a break. */
function patternLineAr(pattern: string, branch: VeteranBranch, close: number, trendAr: string): string {
  const at = `عند ${fmt(close)}`
  const isDoji = pattern.includes("دوجي")
  const isInvertedHammer = !isDoji && pattern.includes("مطرقة") && pattern.includes("مقلوبة")
  const isHammer = !isDoji && !isInvertedHammer && pattern.includes("مطرقة")
  const isHangingMan = !isDoji && pattern.includes("مشنوق")
  const isShootingStar = !isDoji && pattern.includes("نجمة مطلقة")
  const isMorningStar = !isDoji && pattern.includes("نجمة الصباح")
  const isEveningStar = !isDoji && pattern.includes("نجمة المساء")
  const isEngulfingBear = !isDoji && (pattern.includes("ابتلاع") || pattern.includes("احتوائية")) && (pattern.includes("هابط") || pattern.includes("هابطة"))
  const isEngulfingBull = !isDoji && (pattern.includes("ابتلاع") || pattern.includes("احتوائية")) && (pattern.includes("صاعد") || pattern.includes("صاعدة"))
  const isCrows = !isDoji && pattern.includes("غربان")
  const isSoldiers = !isDoji && pattern.includes("جنود")
  const g = veteranGroup(branch)
  let tone: "bull" | "bear" | "neutral" = "bull"
  let base: string
  if (isDoji) {
    tone = "neutral"
    base = g === "profit"
      ? `دوجي ${at} — الافتتاح والإغلاق تلاحقوا: تردد في منطقة أرباح معناه إن القرار معلق بين الطرفين، ومن تجارب السوق بيجي قبل انعطاف أو استراحة`
      : g === "loss"
        ? `دوجي ${at} بعد النزول — أول تجمد في البيع ممكن يكون بادئ، بس الدوجي لوحده مش إشارة: بتأكده بالإغلاق الجاي`
        : `دوجي ${at} على الكسر — تردد مش قرار: السوق بيقيس الحسم، والإغلاقات الجاية هي اللي بتقول`
  } else if (isEveningStar) {
    tone = "bear"
    base = g === "profit"
      ? `نجمة المساء اكتملت ${at} — ثلاث شموع بتقول إن القوة وصلت آخر أنفاسها: من أنماط الانعطاف الكلاسيكية اللي الخبرة بتقول خُد عليها حذر بدري`
      : `نجمة المساء ${at} — نمط انعطاف هابط حتى هنا، والتأكيد بإغلاق تحت قاع النمط`
  } else if (isMorningStar) {
    tone = "bull"
    base = g === "loss"
      ? `نجمة الصباح اكتملت ${at} — ثلاث شموع بترسم أول محاولة قاع حقيقية: بتتأكد بإغلاق فوق منتصف الشمعة الأولى، مش بالحماس`
      : `نجمة الصباح ${at} — نمط انعطاف صاعد بيتأكد بالإغلاقات الجاية`
  } else if (isShootingStar) {
    tone = "bear"
    base = g === "profit"
      ? `نجمة مطلقة ${at} — الارتفاع اتقفل بعيد عن القمة: حد باع فوق بجد، ودي من أشكال التوقف اللي بتيجي قبل التوزيع`
      : `نجمة مطلقة ${at} — الرفض فوق لسه بيقول إن البيع مسيطر، والارتداد لسه محتاج إثبات بالإغلاق`
  } else if (isInvertedHammer) {
    tone = "bull"
    base = g === "loss"
      ? `مطرقة مقلوبة ${at} — محاولة ارتداد أولى قُتلت فوق: تحتاج إغلاق صاعد بعدها عشان تتحول لعلامة قاع، من غيره بتفضل محاولة`
      : `مطرقة مقلوبة ${at} — الصعود لقى مبيعات فوق؛ مش إشارة خروج لوحدها بس بتقيس حرارة القمة`
  } else if (isHammer) {
    tone = "bull"
    base = g === "profit"
      ? `مطرقة ${at} وسط الصعود — الطلب لسه بيقدح من تحت، بس مطرقة قرب القمة بتتقرأ بحذر: التأكيد بالإغلاق الجاي`
      : g === "loss"
        ? `مطرقة ${at} — الذيل الطويل تحت معناه إن البيع لقى شراء حقيقي؛ من تجارب السوق دي أول علامة ارتداد، لكنها بتتأكد بإغلاق فوق قمة المطرقة مش بالشكل`
        : `مطرقة ${at} على الكسر — من تجارب السوق المطرقة جوه هبوط بتخلق ارتداد يوم وترجع تكسر: الحكم يفضل للإغلاقات مش للشكل`
  } else if (isHangingMan) {
    tone = "bear"
    base = g === "profit"
      ? `الرجل المشنوقة ${at} — شكل بيع عند القمة بيقول إن الزخم بيتوقف: من الأشكال اللي بتسبق التوزيع، والتأكيد بإغلاق تحت قاعها`
      : `الرجل المشنوقة ${at} — شكل تحذيري حتى في الهبوط: أي ارتداد بيع لسه محتاج إثبات بالإغلاق`
  } else if (isEngulfingBear) {
    tone = "bear"
    base = g === "profit"
      ? `ابتلاع هابط ${at} — الشمعة الحمرا بلعت شمعة الصعود اللي قبلها بالكامل: سلوك بيحصل قبل التوزيع، والتأكيد بإغلاق تحت قاع الابتلاع`
      : g === "loss"
        ? `ابتلاع هابط ${at} — البيع استعاد السيطرة بالكامل في جلسة واحدة: من التجربة ده بيبقى استمرار مش تردد`
        : `ابتلاع هابط ${at} مع الكسر — البيع واخد الجلسة كلها: تأكيد إضافي للخروج مش عكسه`
  } else if (isEngulfingBull) {
    tone = "bull"
    base = g === "loss"
      ? `ابتلاع صاعد ${at} — شمعة خضرا بلعت شمعة النزول بالكامل: الطلبات من تحت وصلت لحجم بيغطي البيع؛ بتتأكد بالإغلاق الجاي مش بالشكل`
      : g === "profit"
        ? `ابتلاع صاعد ${at} — الشراء استعاد السيطرة في جلسة واحدة: قوة بتأيد الاحتفاظ، والحكم يفضل بالإغلاق`
        : `ابتلاع صاعد ${at} على الكسر — جلسة مقاومة واحدة مش إنقاذ: من تجارب السوق بتاخد تأكيد إغلاقين قبل ما تغير القصة`
  } else if (isCrows) {
    tone = "bear"
    base = g === "profit"
      ? `ثلاثة غربان سود ${at} — ثلاث إغلاقات هابطة متتالية بأجسام قوية: زخم بيعي متواصل، ودي الصورة اللي ما بتحتاجش تفسير كتير`
      : g === "loss"
        ? `ثلاثة غربان سود ${at} — البيع لسه ماشي بأجسام قوية: مفيش علامة تعب في الشموع نفسها لسه`
        : `ثلاثة غربان سود ${at} — الزخم البيعي متواصل: بتأكد منطق الخروج`
  } else if (isSoldiers) {
    tone = "bull"
    base = g === "loss"
      ? `ثلاثة جنود بيض ${at} — ثلاث إغلاقات صاعدة بأجسام قوية: أول شراء حقيقي متواصل من تحت، والاعتماد بالإغلاق مش بالأمل`
      : g === "profit"
        ? `ثلاثة جنود بيض ${at} — زخم شرائي متواصل بأجسام قوية: القوة دي بالتجربة بتكمل لحد ما تتعطل بشمعة رفض`
        : `ثلاثة جنود بيض ${at} بعد الكسر — جلسات مقاومة متواصلة: ده اللي بيخلي الكسر يتعاد تقييمه بالإغلاقات الجاية`
  } else {
    tone = "neutral"
    base = `الشمعة الأخيرة رسمت نمط «${pattern}» ${at} — النمط بيتقرأ مع المكان اللي حصل فيه، والإغلاق الجاي هو اللي يأكده`
  }
  const echo = patternEchoAr(tone, trendAr)
  return `${base}${echo ? `، ${echo}` : ""}.`
}

/** The veteran's reading of the LAST session, in his own words. Pure; AT MOST
 *  2 lines; [] on an honestly-null context (the narrative never invents data,
 *  and the volume-class bounds 2.5× / 0.7× are the MarketContext's own
 *  documented thresholds, not invented values). */
export function veteranLinesAr(ctx: MarketContext, opts: VeteranOpts): string[] {
  const b = opts.branch
  const lines: string[] = []
  const add = (s: string | null | undefined) => {
    if (s && lines.length < 2) lines.push(s)
  }

  // 1) spike volume ON the break — the exit branches' doctrine moment: is
  // this the makers' fake break, or a real liquidity pull?
  if ((b === "farCushionExit" || b === "engineExit") && ctx.volCharacter === "spike") {
    add(`أنا شايف في الشمعة فوليوم Spike فوق 2.5× من المتوسط${ctx.bodyVsAtr !== null ? ` وبجسم ${mult1(ctx.bodyVsAtr)} ATR` : ""} نازل مع الكسر نفسه — من تجارب السوق ده سحب سيولة حقيقي مش كسر كاذب، والكسور اللي بتيجي بالفوليوم ده نادرًا ما بترجع بسرعة.`)
  }
  // 2) bearish momentum divergence while riding a profit — the trap at the top
  if ((b === "hold" || b === "takeProfit") && ctx.divergence === "bearish") {
    add(`انحراف سلبي على الزخم: السعر عمل أعلى عند ${fmt(opts.close)} والقوة ما لحقته — من الأماكن اللي الخبراء بيقولوا فيها: خُد شيئًا وشوف، والانحراف بيثبت بالإغلاق مش بالأمل.`)
  }
  // 3) bullish momentum divergence inside a loss — the early-turn hint
  if ((b === "deepLoss" || b === "cushionWait") && ctx.divergence === "bullish") {
    add(`انحراف إيجابي على الزخم عند إغلاق ${fmt(opts.close)} — ده أول حاجة بتظهر قبل التحول في تجارب السوق، بس بيأكد نفسه بالإغلاقات مش بالأمل، فنستنيه جلسة ورا جلسة.`)
  }
  // 4) spike volume closing at the top — real buying pressure, not a flick
  if ((b === "hold" || b === "takeProfit") && ctx.volCharacter === "spike" && ctx.closeLocationPct !== null && ctx.closeLocationPct >= 70) {
    add(`فوليوم Spike فوق 2.5× من المتوسط${ctx.bodyVsAtr !== null ? ` وبجسم ${mult1(ctx.bodyVsAtr)} ATR` : ""}، والإغلاق قرب قمة المدى (${pctPlain(ctx.closeLocationPct)} من المدى) — ده شراء حقيقي فوق مش رفلة صنّاع، والقوة دي بالتجربة بتكمل جلسات مش يوم واحد.`)
  }
  // 5) the hollow climb: dry volume into the range top / a multi-day streak
  if (b === "hold" && ctx.volCharacter === "dry" && (ctx.nearRangeTop === true || (ctx.streakUp ?? 0) >= 3)) {
    const streak = ctx.streakUp !== null && ctx.streakUp >= 3 ? ` وبعد ${ctx.streakUp} جلسات صاعدة متواصلة` : ""
    const top = ctx.nearRangeTop === true ? " والسعر ولّس على قمة مدى 60 جلسة" : ""
    add(`صعود بفوليوم جاف (أقل من 0.7× من المتوسط)${streak}${top} — من تجارب السوق الصعود بلا فوليوم هش، وأول بايع حقيقي بيلقي السقف مفتوح.`)
  }
  // 6) dry volume at the range bottom — the sellers haven't panicked yet
  if ((b === "deepLoss" || b === "cushionWait") && ctx.volCharacter === "dry" && ctx.nearRangeBottom === true) {
    const streak = ctx.streakDown !== null && ctx.streakDown >= 3 ? ` بعد ${ctx.streakDown} جلسات نزول متواصلة` : ""
    add(`فوليوم جاف عند قاع المدى (أقل من 0.7×)${streak} — البايعين لسه ما وصلوش لمرحلة الذعر، وده تأكيد لمنطق الانتظار بلا وعود: القاع بيثبت بالفوليوم مش بالأمل.`)
  }
  // 7) a long upper wick after the rally / at the range top — sold above
  if ((b === "hold" || b === "takeProfit") && ctx.upperShadowPct !== null && ctx.upperShadowPct >= 45 && (ctx.nearRangeTop === true || (ctx.streakUp ?? 0) >= 3)) {
    add(`ظل علوي طويل (${pctPlain(ctx.upperShadowPct)} من مدى اليوم) بعد الصعود — حد باع فوق بجد: الصنّاع بيتذكروا السقف، ومن تجارب السوق الظل ده بيتكرر قبل أي توقف أو ارتداد.`)
  }
  // 8) a long lower wick — someone actually bought down there
  if ((b === "deepLoss" || b === "cushionWait") && ctx.lowerShadowPct !== null && ctx.lowerShadowPct >= 45) {
    add(`ظل سفلي طويل (${pctPlain(ctx.lowerShadowPct)} من مدى اليوم) — حد اشترى من تحت فعلًا والدعم اتختب وارتد، ودي الصورة اللي بتدعم الانتظار مش البيع في القاع.`)
  }
  // 9) the session opened with a real down gap — the close is the judge
  if (ctx.gapPct !== null && ctx.gapPct <= -2) {
    add(`فجوة نزول ${Math.abs(ctx.gapPct).toFixed(1)}٪ فاتحة الشمعة — الجلسة بدأت بخسارة من إغلاق أمس، ومن تجارب السوق الفجوة دي بتحكي عن عرض غايب أو خبر، فالإغلاق هو الحكم مش الافتتاح.`)
  }
  // 10) opened high, closed near the low — distribution over the gap
  if (ctx.gapPct !== null && ctx.gapPct >= 2 && ctx.closeLocationPct !== null && ctx.closeLocationPct <= 30) {
    add(`فتح أعلى بـ ${pct1(ctx.gapPct)} وسدّ قرب القاع (${pctPlain(ctx.closeLocationPct)} من المدى) — ده توزيع فوق الفجوة مش قوة: حد استخدم الافتتاح العالي عشان يبيع.`)
  }
  // 11) stretched too far off EMA20 — the tired place
  if ((b === "hold" || b === "takeProfit") && ctx.emaStretch20Atr !== null && ctx.emaStretch20Atr >= 2.5) {
    add(`التمدد عن EMA20 وصل ${mult1(ctx.emaStretch20Atr)} ATR — من تجارب السوق ده مكان ارتداد للخط أو توقف أنفاس، مش مكان للاندفاع.`)
  }
  // 12) a mid-life trend: 15+ sessions above EMA20 without a close under it
  if (b === "hold" && ctx.daysAboveEma20 !== null && ctx.daysAboveEma20 >= 15) {
    add(`${ctx.daysAboveEma20} جلسة فوق EMA20 بدون إغلاق تحتها — الاتجاه في منتصف العمر، وكسره يومًا ما هيكون حدثًا مش ضجيجًا؛ لحد ما ييجي، الاحتفاظ ليه أرضية.`)
  }
  // 13) a directionless market: breaks here re-test before they decide
  if (b === "cushionWait" && ctx.adxStrength === "weak" && ctx.adx !== null) {
    add(`ADX عند ${ctx.adx.toFixed(1)} — سوق بلا اتجاه حقيقي، والكسور اللي بتحصل هنا بتعيد اختبار المستوى غالبًا قبل ما تحسم.`)
  }
  // 14) the downtrend has muscles — countering it needs proof, not hope
  if ((b === "farCushionExit" || b === "engineExit") && ctx.adxStrength === "strong" && ctx.adx !== null) {
    add(`الاتجاه الهابط عنده عضلات (ADX عند ${ctx.adx.toFixed(1)}) — العكس هنا بيحتاج دليل أقوى من أمل، والأمل مش خطة.`)
  }
  // 15) the named candle pattern, tied to THIS branch's meaning
  if (ctx.candlePatternAr) {
    add(patternLineAr(ctx.candlePatternAr, b, opts.close, opts.trendAr))
  }
  // 16) the VSA note — already a complete sentence; the filler slot
  add(ctx.vsaNoteAr)
  return lines
}

/** The compounding-recovery math, owner-mandated: selling at a loss means the
 *  NEXT stock must climb (avgBuy/close − 1) to break even. */
export function recoveryNeededPct(avgBuyPrice: number, currentPrice: number): number {
  return ((avgBuyPrice / currentPrice - 1) * 100)
}

function recoveryReasonAr(pnlPct: number, recoveryPct: number): string {
  // Extreme losses make the compounding math meaningless to print — a −99.9٪
  // position would demand +999,899٪ recovery (owner story-suite finding
  // 2026-11-18: the old line printed that absurd number verbatim).
  if (recoveryPct > 500) {
    return `الخسارة دي عمقها بيخلي التعويض في سهم واحد شبه مستحيل رياضيًا — الرقم المطلوب للتعويض بيكبر لحد ما يفقد معاهده العملية، فالأولوية هنا لحماية اللي فاضل مش التعويض.`
  }
  return `لو بعت دلوقتي بخسارة ${pct1(pnlPct)}، محتاج إن أي سهم تاني تعمل فيه ${pct1(recoveryPct)} عشان تعوّض وترجع لنقطة البداية — ودي رياضيات مش رأي.`
}

/** OWNER RULE (2026-11-18): a support more than 15% below the close, or one
 *  touched only once, is NOT a trusted floor — EGX makers paint single-touch
 *  lows all the time to grab liquidity. The practical support becomes EMA20,
 *  the dynamic line the market actually respects. Falls back to the raw zone
 *  (flagged as weak) when no EMA20 sits below the close. */
export const NEAR_SUPPORT_MAX_GAP_PCT = 15

/** OWNER RULE (2026-11-18, OCPH «اكتوبر فارما» bug): a profit-taking target is
 *  measured against the OWNER'S AVERAGE BUY PRICE, never against the live
 *  close — it must sit at least this far ABOVE the average to be worth a
 *  partial-exit decision at all. A "resistance" under (or barely over) the
 *  cost basis is not a profit target; it is noise or history. */
export const PROFIT_TARGET_MIN_GAP_PCT = 6

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

/** The snapshot's own posture read (2026-11-17 owner rule): bearish = the
 *  close is below EMA50, or the EMA20<EMA50 negative order is on; bullish =
 *  riding above the moving averages. With no EMA50 history there is no
 *  confirmed bullish structure, so the protective (bigger partial) read
 *  applies. */
function isBearishPosture(close: number, ema20: number | null, ema50: number | null): boolean {
  if (ema50 === null) return true
  if (close < ema50) return true
  return ema20 !== null && ema20 < ema50
}

/** The close-based trailing line for a take-profit runner: the certified
 *  effective support when one exists, else the EMA50 sitting UNDER the price
 *  (an EMA50 above the close can't be a "close below ends it" line), else
 *  EMA20 under the price. null → the 60-session-low fallback wording. */
function trailingLine(
  effSupport: EffectiveSupport | null,
  ema20: number | null,
  ema50: number | null,
  close: number,
): { level: number; basisAr: string } | null {
  if (effSupport) return { level: effSupport.level, basisAr: effSupport.basisAr }
  if (ema50 !== null && ema50 < close) return { level: ema50, basisAr: `EMA50 عند ${fmt(ema50)} — المتوسط اللي الاتجاه بيتقاس عليه` }
  if (ema20 !== null && ema20 < close) return { level: ema20, basisAr: `EMA20 عند ${fmt(ema20)} — الخط الديناميكي اللي السوق بيحترمه` }
  return null
}

/** The partial take-profit plan: the sizing numbers first, then the trailing
 *  line, then the rationale — thinking WITH the user, never an order. The %
 *  ranges are the owner's own doctrine (2026-11-17): bearish 50–75٪ off now
 *  with a 25–50٪ runner; bullish 20–40٪ off with the rest riding. */
function takeProfitPlanAr(bearish: boolean, close: number, trail: { level: number } | null): string {
  const sizingAr = bearish
    ? `جني أرباح على 50–75٪ من المركز دلوقتي عند سعر ${fmt(close)}، وسيب 25–50٪ شغالة`
    : `جني أرباح على 20–40٪ من قيمة المركز دلوقتي عند سعر ${fmt(close)}، وسيب الباقي شغال بنفس التعرض`
  const lineAr = trail
    ? `الجزء المتبقي بيتتبع بخط بالإغلاق تحت ${fmt(trail.level)}`
    : "الجزء المتبقي بيتتبع بخط بالإغلاق تحت قاع آخر 60 جلسة"
  const rationaleAr = bearish
    ? "تأمين الجزء الأكبر مع ترتيب سلبي أريح من خروج كامل من سهم لسه رابح فيه"
    : "جني جزء من الربح مش شك في السهم — ده الحفاظ على السيولة والانضباط، والباقي شايل نفس التعرض"
  return `أنا بفكر معاك كده: ${sizingAr} — ${lineAr}، وأي إغلاق يومي تحت الخط ده بينهي الجزء المتبقي (الحكم بالإغلاق مش باللمسة). ${rationaleAr}.`
}

export function reviewPosition(input: ReviewInput): PositionReview {
  const { row, bars, map, avgBuyPrice } = input
  const close = row.lastClose ?? (bars.length ? bars[bars.length - 1].close : 0)
  const mt = row.metrics
  const pnlPerShare = close - avgBuyPrice
  const pnlPct = avgBuyPrice > 0 ? (pnlPerShare / avgBuyPrice) * 100 : 0
  const cushion = readCushion(bars, map)
  // OWNER MANDATE (2026-11-18): the veteran's input layer — every field is
  // honestly null when the data cannot support it, so the narrative degrades
  // to ZERO change ([]) until the context pass produces real values.
  const ctx = buildMarketContext(bars, mt)
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
    // the veteran's reading, appended after the recovery math — silent ([])
    // when the context is honestly null
    reasonsAr.push(...veteranLinesAr(ctx, { branch: "deepLoss", avgBuyPrice, close, trendAr }))
    return {
      decision, decisionAr: POSITION_DECISION_AR[decision], headlineAr,
      avgBuyPrice, lastClose: close, pnlPct: Math.round(pnlPct * 10) / 10, pnlPerShare: Math.round(pnlPerShare * 100) / 100,
      recoveryPct, reasonsAr, planAr, question, closingAr,
      supports, resistances, levelsBasisAr, invalidationAr, warningsAr, snapshot, engine: row.engine,
    }
  }

  // ---------- 1) support broke on the last session → the cushion rule decides
  if (cushion.brokeLastSession && cushion.farCushion) {
    reasonsAr.push(
      `بص بصراحة: إغلاق النهاردة (${fmt(close)}) كسر دعم ${cushion.brokenZone!.touches}× مختبَر (${fmt(cushion.brokenZone!.low)}–${fmt(cushion.brokenZone!.high)}) — ده مش تذبذب، ده هيكل اتكسر.`,
      openFieldAr + " — يعني مفيش حاجة قريبة تمسك السعر لو السوق نزل أكتر.",
      `مركزك اتفتح بمتوسط ${fmt(avgBuyPrice)} والسعر دلوقتي ${fmt(close)} يعني ${pnlPct >= 0 ? "رابح" : "خاسر"} ${pct1(pnlPct)} (${pnlPerShare >= 0 ? "+" : ""}${fmt(pnlPerShare)} جنيه/سهم)${pnlPct < 0 ? ` — و${recoveryReasonAr(pnlPct, recoveryPct ?? 0).toLowerCase()}` : ""}.`,
    )
    if (pnlPct >= PROFIT_TAKE_MIN_PCT) {
      // the 2026-11-17 owner rule: a PROFITABLE position never gets the red
      // exit — the break becomes a partial take-profit with a trailing runner
      decision = "take_profit"
      const bearish = isBearishPosture(close, mt?.ema20 ?? null, mt?.ema50 ?? null)
      const trail = trailingLine(effSupport, mt?.ema20 ?? null, mt?.ema50 ?? null, close)
      headlineAr = bearish
        ? `إنت رابح ${pct1(pnlPct)} بس الكسر حصل والترتيب التقني سلبي — أنا بفكر معاك في تأمين الجزء الأكبر من الربح وسيب جزء صغير بيتابع الإغلاق`
        : `إنت رابح ${pct1(pnlPct)} بس الكسر حصل والهيكل لسه فوق متوسطاته — أنا بفكر معاك في جني جزء صغير من الربح، والباقي بيفضل في الصعود`
      planAr = takeProfitPlanAr(bearish, close, trail)
      invalidationAr = trail
        ? `خط إلغاء الجزء المتبقي: الإغلاق اليومي تحت ${fmt(trail.level)} بينهي الجزء المتبقي — الحكم بالإغلاق مش باللمسة، لأن الصنّاع بيعملوا كسور كاذبة تحت المستويات`
        : "خط إلغاء الجزء المتبقي: الإغلاق اليومي تحت قاع آخر 60 جلسة بينهي الجزء المتبقي — الحكم بالإغلاق مش باللمسة"
      reasonsAr.push(
        `النقطة اللي ممكن متشوفهاش من جو الربح: الربح فوق ${PROFIT_TAKE_MIN_PCT}٪ مع كسر دعم = سيولة بتخرج من السهم حتى لو إنت رابح — الخزنة بتتحمى بجزء مش بالكل.`,
        `القراءة الفنية: ${trendAr} — ${bearish ? "الترتيب سلبي، فتأمين الجزء الأكبر منطقي وأريح من خروج كامل من سهم لسه رابح فيه" : "الهيكل لسه فوق المتوسطات، فالجني يكون جزئي والجزء الأكبر بيفضل شغال"}.`,
        trail
          ? `خط تتبع الجزء المتبقي: ${trail.basisAr} — الإلغاء بالإغلاق اليومي تحته، مش باللمسة: الكسور الكاذبة تحت المستويات حاجة معروفة في السوق المصري.`
          : "خط تتبع الجزء المتبقي: قاع آخر 60 جلسة — الإلغاء بالإغلاق اليومي تحته، مش باللمسة.",
      )
      reasonsAr.push(...veteranLinesAr(ctx, { branch: "takeProfit", avgBuyPrice, close, trendAr }))
    } else {
      decision = "exit"
      headlineAr = `الكسر حصل ومفيش بطانة قريبة تحت السعر — الخروج هنا إدارة مخاطر مش هيزنة`
      invalidationAr = `السيناريو يرجع فيه فقط بإغلاق يومي فوق مستوى الكسر (${fmt(cushion.brokenZone!.low)})`
      reasonsAr.push(
        "قاعدة البيع على الكسر بتشتغل بس لما الدعم اللي تحت يكون بعيد — وهنا هو بعيد فعلًا، فالقرار خروج.",
        "الخروج مش فشل ولا اعتراف بغلطة — ده الفرق بين المتداول اللي عنده خطة والمتداول اللي بيمسك بيديه من غير خطة: بنقفل الخسارة الصغيرة قبل ما تبقى كبيرة.",
      )
      reasonsAr.push(...veteranLinesAr(ctx, { branch: "farCushionExit", avgBuyPrice, close, trendAr }))
    }
    return {
      decision, decisionAr: POSITION_DECISION_AR[decision], headlineAr,
      avgBuyPrice, lastClose: close, pnlPct: Math.round(pnlPct * 10) / 10, pnlPerShare: Math.round(pnlPerShare * 100) / 100,
      recoveryPct, reasonsAr, planAr, question: null, closingAr,
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
    reasonsAr.push(...veteranLinesAr(ctx, { branch: "cushionWait", avgBuyPrice, close, trendAr }))
    return {
      decision, decisionAr: POSITION_DECISION_AR[decision], headlineAr,
      avgBuyPrice, lastClose: close, pnlPct: Math.round(pnlPct * 10) / 10, pnlPerShare: Math.round(pnlPerShare * 100) / 100,
      recoveryPct, reasonsAr, planAr, question: null, closingAr,
      supports, resistances, levelsBasisAr, invalidationAr, warningsAr, snapshot, engine: row.engine,
    }
  }

  // ---------- 3) engine-v2 says exit (trend break path) — red exit below
  // +6% of gain, green partial take-profit above it (2026-11-17 owner rule)
  if (row.state === "exit") {
    reasonsAr.push(
      `حسبت لك الوضع: متوسط شراء ${fmt(avgBuyPrice)} وسعر النهاردة ${fmt(close)} — ${pnlPct >= 0 ? "رابح" : "خاسر"} ${pct1(pnlPct)} (${pnlPerShare >= 0 ? "+" : ""}${fmt(pnlPerShare)} جنيه/سهم).`,
      `الاتجاه العام: ${trendAr} — والمحرك الفني سلّم الإشارة "خروج".`,
    )
    if (pnlPct >= PROFIT_TAKE_MIN_PCT) {
      decision = "take_profit"
      const bearish = isBearishPosture(close, mt?.ema20 ?? null, mt?.ema50 ?? null)
      const trail = trailingLine(effSupport, mt?.ema20 ?? null, mt?.ema50 ?? null, close)
      headlineAr = bearish
        ? `إنت رابح ${pct1(pnlPct)} بس المحرك سلّم إشارة خروج — أنا بفكر معاك في تأمين الجزء الأكبر من الربح وسيب جزء صغير بيتابع الإغلاق`
        : `إنت رابح ${pct1(pnlPct)} والمحرك بيحذر رغم إن الهيكل لسه فوق متوسطاته — أنا بفكر معاك في جني جزء صغير من الربح، والباقي بيفضل في الصعود`
      planAr = takeProfitPlanAr(bearish, close, trail)
      invalidationAr = trail
        ? `خط إلغاء الجزء المتبقي: الإغلاق اليومي تحت ${fmt(trail.level)} بينهي الجزء المتبقي — الحكم بالإغلاق مش باللمسة، لأن الصنّاع بيعملوا كسور كاذبة تحت المستويات`
        : "خط إلغاء الجزء المتبقي: الإغلاق اليومي تحت قاع آخر 60 جلسة بينهي الجزء المتبقي — الحكم بالإغلاق مش باللمسة"
      reasonsAr.push(
        `النقطة اللي ممكن متشوفهاش من جو الربح: الربح فوق ${PROFIT_TAKE_MIN_PCT}٪ مع إشارة خروج من المحرك = سيولة بتخرج من السهم حتى لو إنت رابح — الخزنة بتتحمى بجزء مش بالكل.`,
        `القراءة الفنية: ${trendAr} — ${bearish ? "الترتيب سلبي، فتأمين الجزء الأكبر منطقي وأريح من خروج كامل من سهم لسه رابح فيه" : "الهيكل لسه فوق المتوسطات، فالجني يكون جزئي والجزء الأكبر بيفضل شغال"}.`,
        trail
          ? `خط تتبع الجزء المتبقي: ${trail.basisAr} — الإلغاء بالإغلاق اليومي تحته، مش باللمسة: الكسور الكاذبة تحت المستويات حاجة معروفة في السوق المصري.`
          : "خط تتبع الجزء المتبقي: قاع آخر 60 جلسة — الإلغاء بالإغلاق اليومي تحته، مش باللمسة.",
        "كسر الاتجاه مختلف عن كسر دعم عابر: هنا البنية الزمنية نفسها بتتغير — عشان كده الجني جزئي مش احتفاظ كامل، والجزء المتبقي بيتقفل بالإغلاق تحت خط التتبع.",
      )
      reasonsAr.push(...veteranLinesAr(ctx, { branch: "takeProfit", avgBuyPrice, close, trendAr }))
    } else {
      decision = "exit"
      headlineAr = "الاتجاه نفسه اتكسر — ده مش وقت المبادرة، ده وقت حماية اللي فاضل"
      invalidationAr = `السيناريو يرجع فيه بإغلاق يومي فوق EMA50 (${mt?.ema50 ? fmt(mt.ema50) : "المتوسط"}) مع ترتيب صعودي تاني`
      reasonsAr.push(
        "كسر الاتجاه مختلف عن كسر دعم عابر: هنا البنية الزمنية نفسها بتتغير، والأسهم اللي بتكسر EMA50 بترتيب سلبي بتكمل ضعف غالبًا.",
        `الخروج هنا بيحمي الرصيد: أفضل وقت للرجوع هو لما يرجع السهم فوق متوسطاته ويثبت — والموقع هيقولك لحظتها.`,
      )
      if (pnlPct < 0) reasonsAr.push(recoveryReasonAr(pnlPct, recoveryPct ?? 0))
      reasonsAr.push(...veteranLinesAr(ctx, { branch: "engineExit", avgBuyPrice, close, trendAr }))
    }
    return {
      decision, decisionAr: POSITION_DECISION_AR[decision], headlineAr,
      avgBuyPrice, lastClose: close, pnlPct: Math.round(pnlPct * 10) / 10, pnlPerShare: Math.round(pnlPerShare * 100) / 100,
      recoveryPct, reasonsAr, planAr, question: null, closingAr,
      supports, resistances, levelsBasisAr, invalidationAr, warningsAr, snapshot, engine: row.engine,
    }
  }

  // ---------- 4) in profit → hold with the trailing line drawn
  if (pnlPct >= 0) {
    decision = "hold"
    const supLine = effSupport
    // OWNER FIX (2026-11-18, OCPH «اكتوبر فارما»): the old line printed the
    // nearest map zone as «أقرب مقاومة» even when it sat ~52٪ UNDER the close
    // (an old base ceiling the rally had already turned into history). The
    // profit-taking zone must be (i) fully above the last close — the
    // resistances list is already close-guarded in levelLines — (ii) above
    // the owner's average, and (iii) at least PROFIT_TARGET_MIN_GAP_PCT above
    // the average, measured to the zone's ENTRY edge (its low): the first
    // price a partial exit actually executes at, never a price-vs-zone gap.
    const minTargetLevel = avgBuyPrice * (1 + PROFIT_TARGET_MIN_GAP_PCT / 100)
    const profitTarget = resistances.find((r) => r.low > avgBuyPrice && r.low >= minTargetLevel) ?? null
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
      profitTarget
        ? `الحلم فوق: أول منطقة تستحق قرار أرباح جزئي عند ${fmt(profitTarget.low)}–${fmt(profitTarget.high)} على بعد ${pct1(Math.round(((profitTarget.low - avgBuyPrice) / avgBuyPrice) * 1000) / 10)} من متوسطك.`
        : `الحلم فوق: مفيش مقاومة مسجلة فوق متوسطك بـ ${PROFIT_TARGET_MIN_GAP_PCT}٪ أو أكثر في نافذة البيانات — السهم في أرض جديدة، والأرباح الجزئية هنا بيتقررها خط المتوسطات (EMA20/EMA50) مش سقف قديم`,
      "الخلاصة بصوت واضح: احتفظ. البيع يبقى قرار لما يفلخط الدفاع، مش لما القلق يعلو.",
    )
    reasonsAr.push(...veteranLinesAr(ctx, { branch: "hold", avgBuyPrice, close, trendAr }))
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
    reasonsAr.push(...veteranLinesAr(ctx, { branch: "engineExit", avgBuyPrice, close, trendAr }))
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
    reasonsAr.push(...veteranLinesAr(ctx, { branch: "cushionWait", avgBuyPrice, close, trendAr }))
  }

  return {
    decision, decisionAr: POSITION_DECISION_AR[decision], headlineAr,
    avgBuyPrice, lastClose: close, pnlPct: Math.round(pnlPct * 10) / 10, pnlPerShare: Math.round(pnlPerShare * 100) / 100,
    recoveryPct, reasonsAr, planAr, question: null, closingAr,
    supports, resistances, levelsBasisAr, invalidationAr, warningsAr, snapshot, engine: row.engine,
  }
}
