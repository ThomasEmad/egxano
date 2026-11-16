// =============================================================================
// Signal engine v2 — per-company orchestration (PURE; DB lives in the service).
// Deterministic decision ladder per the owner's spec:
//   EXIT  — an exit condition fired (close an existing long; never a short).
//   BUY   — the best fired candidate has an honest plan and score ≥ 62.
//   NEAR  — an entry condition is pending within reach (activation ≤ 8% away)
//           with a valid provisional plan, OR the fired setup's score sits
//           below the BUY bar but the structure is real (publish near honestly).
//   WAIT  — nothing above applies (and "wait" is a legitimate answer).
// No look-ahead: everything reads the prefix passed in. Same prefix in, same
// row out — replay-safe by construction.
// =============================================================================

import { detectOpportunities, type Detection } from "./patterns"
import { nearestResistanceAbove, nearestSupportBelow, type ZoneMap } from "./levels"
import { computeMetrics, toSignalMetrics, type MetricsBundle } from "./metrics"
import { buildBuyPlan, buildNearSetup, roundToTick } from "./plan"
import { computeScore } from "./score"
import {
  BUY_SCORE_MIN,
  MIN_BARS,
  NEAR_ACTIVATION_MAX_GAP_PCT,
  OPPORTUNITY_TYPE_AR,
  OPPORTUNITY_TYPE_EN,
  SIGNALS_V2_VERSION,
  THIN_TRADED_VALUE_EGP,
  type Bar,
  type Evidence,
  type Fundamentals,
  type NearSetup,
  type OpportunityType,
  type RowQuality,
  type SignalRowV2,
  type SignalState,
  type SignalWarning,
  type TradePlanV2,
} from "./types"

export interface CompanyIdentity {
  companyId: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
  marketTier: string
}

export interface EngineInput {
  bars: Bar[]
  identity: CompanyIdentity
  /** latest fundamentals snapshot (nullable fields — absent data yields NO
   *  warning, never an invented one) */
  fundamentals?: Fundamentals | null
  /** effective EGX session date of the compute (YYYY-MM-DD) — injected, so
   *  the engine itself never touches the clock (replay passes bar dates) */
  todaySession: string
}

/** EGX Sun–Thu session distance (bounded walk, 0 when same day) — copied from
 *  the board's freshness convention so both engines count the same weeks. */
export function egxSessionsBetween(fromDay: string, toDay: string): number {
  const parse = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00.000Z`).getTime()
  const from = parse(fromDay)
  const to = parse(toDay)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0
  let count = 0
  for (let t = from + 86_400_000; t <= to && count < 30; t += 86_400_000) {
    const dow = new Date(t).getUTCDay()
    if (dow >= 0 && dow <= 4) count++
  }
  return count
}

function liquidityOf(relVol: number | null): RowQuality["liquidity"] {
  if (relVol === null) return "unknown"
  if (relVol >= 1.5) return "liquid"
  if (relVol >= 1.0) return "normal"
  return "thin"
}

/** Displayed-evidence ordering: the DETECTION's own facts lead (they are WHY
 *  the row exists), then the scorer's cited points. The structure line that
 *  carries the detection's points moves to the front with its points intact —
 *  the math is unchanged, only the reading order. */
function orderedEvidence(detection: Detection | null, scoreEvidence: Evidence[]): Evidence[] {
  if (!detection) return scoreEvidence
  const head = scoreEvidence.find((e) => e.group === "structure" && e.ar === detection.facts[0]?.ar)
  const rest = head ? scoreEvidence.filter((e) => e !== head) : scoreEvidence
  const extra: Evidence[] = detection.facts.slice(head ? 1 : 0).map((f) => ({ ar: f.ar, en: f.en, group: null }))
  return [...(head ? [head] : []), ...extra, ...rest]
}

/** Rank fired candidates: structural strength first, archetype priority second. */
function rankDetection(d: Detection): number {
  const priority: Record<string, number> = { breakout: 1.0, retest: 0.9, reversal: 0.85, bounce: 0.8, continuation: 0.75 }
  return d.strength * (priority[d.type] ?? 0.7)
}

/** Pre-entry invalidation text for a near setup. */
function preEntryInvalidation(bars: Bar[], map: ZoneMap, m: MetricsBundle, activation: number): string {
  const support = nearestSupportBelow(map, m.lastClose)
  if (support && support.high < activation) {
    return `السيناريو يُلغى قبل الدخول إذا أغلق السهم تحت دعم ${support.touches}× المختبَر (${support.high.toFixed(2)}) قبل تحقق شرط التفعيل (${activation.toFixed(2)})`
  }
  if (m.ema50 !== null && m.ema50 < activation) {
    return `السيناريو يُلغى قبل الدخول إذا أغلق السهم تحت EMA50 (${m.ema50.toFixed(2)}) قبل تحقق شرط التفعيل (${activation.toFixed(2)})`
  }
  return "السيناريو يُلغى إذا تراجع السهم أكثر من 4% تحت الإغلاق الحالي قبل تحقق شرط التفعيل"
}

/** Disclosed risks computed from DATA ONLY — the wording states what the
 *  recorded numbers show and the execution mechanics they imply; it never
 *  speculates about any party or intent (owner mandate on phrasing). */
function fundamentalsWarnings(
  f: Fundamentals | null | undefined,
  avgTradedValueEgp: number | null,
): SignalWarning[] {
  const out: SignalWarning[] = []
  if (f && typeof f.netProfitEgp === "number" && f.netProfitEgp < 0) {
    out.push({
      kind: "negative_profit",
      ar: "تنبيه: صافي ربح الشركة في أحدث قوائمه سالب",
      detailAr:
        "الإشارة الفنية هنا لا تعكس جودة الأرباح — الشركة سجلت خسارة في آخر فترة معلنة. راجع القوائم المالية ونتائج الأعمال قبل أي قرار؛ التحسن الفني فوق أساسيات خاسرة أكثر هشاشة.",
      en: "Alert: latest reported net profit is negative",
      detailEn:
        "A technical signal does not reflect earnings quality — the company booked a loss in its latest reported period. Review the financial statements before acting; technical improvement on loss-making fundamentals is more fragile.",
    })
  }
  // Valuation-multiple warnings (high P/E) were REMOVED at the owner's
  // request (2026-11-17: "تحذيرات مضاعف الربحية احذفها وسيب بس الشركات اللي
  // بتخسر") — the disclosures here stay limited to loss-making fundamentals
  // and thin liquidity.
  if (avgTradedValueEgp !== null && avgTradedValueEgp < THIN_TRADED_VALUE_EGP) {
    out.push({
      kind: "thin_liquidity",
      ar: "تنبيه سيولة: متوسط قيمة التداول اليومية منخفض جدًا",
      detailAr:
        "عدد أوامر الشراء والبيع في هذا السهم قليل — قد يستغرق تنفيذ أمر كبير وقتًا أو يتحرك السعر بعيدًا عن المستوى المعروض، والفرق بين سعر الشراء والبيع قد يكون واسعًا. استخدم أوامر بسعر محدد واختر حجم مركز يناسب هذه السيولة المحدودة.",
      en: "Liquidity alert: average daily traded value is very low",
      detailEn:
        "This stock carries few orders — a large order may take time to fill or move the price away from the displayed level, and spreads can be wide. Use limit orders and size the position to fit the thin liquidity.",
    })
  }
  return out
}

/** Post-entry invalidation per archetype (the daily close kills the scenario). */
function postEntryInvalidation(type: OpportunityType, plan: TradePlanV2): string {
  const stopTxt = `إغلاق يومي تحت وقف الخسارة ${plan.stop.toFixed(2)} يُلغي السيناريو فورًا`
  switch (type) {
    case "breakout":
      return `${stopTxt} — وفشل الاختراق يُثبت بإغلاقين متتاليين تحت قمة منطقة الاختراق (${plan.entryHigh.toFixed(2)})`
    case "retest":
      return `${stopTxt} — وإغلاق تحت قمة المنطقة المخترقة (${plan.entryHigh.toFixed(2)}) يُعتبر فشلًا لإعادة الاختبار`
    case "bounce":
      return `${stopTxt} — وإغلاق تحت قاع منطقة الدعم يُعتبر كسرًا للسيناريو`
    case "continuation":
      return `${stopTxt} — وإغلاقان متتاليان تحت EMA20 يُلغيان سيناريو الاستمرار`
    case "reversal":
      return `${stopTxt} — وإغلاق تحت EMA50 مجددًا يُلغي سيناريو الانعكاس`
    default:
      return stopTxt
  }
}

/** The main engine call — one company, one row. */
export function computeCompanySignalV2(input: EngineInput): SignalRowV2 {
  const { bars, identity, todaySession } = input
  const base: SignalRowV2 = {
    ...identity,
    state: "wait",
    type: null,
    asOf: bars.length ? bars[bars.length - 1].ts : null,
    lastClose: bars.length ? bars[bars.length - 1].close : null,
    changePct: null,
    score: null,
    scoreGroups: null,
    evidence: [],
    plan: null,
    setup: null,
    invalidationAr: null,
    metrics: null,
    quality: {
      bars: bars.length,
      ohlc: bars.length > 0 && bars.every((b) => Number.isFinite(b.open) && Number.isFinite(b.high) && Number.isFinite(b.low)),
      liquidity: "unknown",
      avgTradedValueEgp: null,
      dataAgeSessions: null,
      notesAr: [],
    },
    warnings: [],
    engine: SIGNALS_V2_VERSION,
  }
  if (bars.length >= 2) {
    const closes = bars.map((b) => b.close)
    base.changePct = Math.round(((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2]) * 1000) / 10
  }

  // ---- insufficient data → honest wait, never a confident signal
  if (bars.length < MIN_BARS) {
    base.quality.notesAr.push(`التاريخ المتاح ${bars.length} جلسة فقط — أقل من الحد الأدنى ${MIN_BARS} للقراءة`)
    return base
  }
  const m: MetricsBundle | null = computeMetrics(bars)
  if (!m) {
    base.quality.notesAr.push("تعذر حساب المؤشرات من البيانات المتاحة")
    return base
  }
  base.metrics = toSignalMetrics(m)
  base.quality.liquidity = liquidityOf(m.relVol)
  base.quality.avgTradedValueEgp = m.avgTradedValueEgp
  base.quality.dataAgeSessions = base.asOf ? egxSessionsBetween(base.asOf, todaySession) : null
  if (base.quality.dataAgeSessions !== null && base.quality.dataAgeSessions > 4) {
    base.quality.notesAr.push(`آخر جلسة مسجلة ${base.asOf} — البيانات متأخرة ${base.quality.dataAgeSessions} جلسة`)
  }
  // disclosed risks travel with the row in EVERY state (a wait row with a
  // negative profit is still a fact the user should see in the details)
  base.warnings = fundamentalsWarnings(input.fundamentals ?? null, m.avgTradedValueEgp)

  const { buyCandidates, nearCandidates, exit, map } = detectOpportunities(bars, m)

  // ---------- EXIT wins over any buy candidate (no contradictory signals) ----------
  if (exit) {
    const score = computeScore({
      bars,
      m,
      detection: exit,
      plan: null,
      map,
      quality: { bars: bars.length, ohlc: base.quality.ohlc, liquidity: base.quality.liquidity, dataAgeSessions: base.quality.dataAgeSessions },
    })
    // OWNER MANDATE (2026-11-17): a support break with a CLOSE cushion (next
    // support ≤ 3% below, or the borderline 3–4% band) is classified WAIT —
    // selling into a nearby cushion locks the loss at the worst spot. The row
    // discloses the break honestly and hands the user the activation that
    // DOES fire the exit: a daily close below the cushion level.
    if (exit.cushion?.waitInstead) {
      base.state = "wait"
      base.type = null // wait rows carry no opportunity type
      base.score = score.breakdown.total
      base.scoreGroups = score.breakdown.groups
      base.evidence = orderedEvidence(exit, score.evidence)
      const cushionFloor = exit.cushion.level !== null
        ? exit.cushion.level
        : Math.min(...bars.slice(-60).map((b) => b.low))
      base.invalidationAr = exit.cushion.level !== null
        ? `الخروج الفعلي يُفعَّل بإغلاق يومي تحت الدعم التالي (${cushionFloor.toFixed(2)}) — تحته لا بطانة قريبة`
        : `الخروج الفعلي يُفعَّل بإغلاق يومي تحت قاع آخر 60 جلسة (${cushionFloor.toFixed(2)}) — لا يوجد دعم مسجل تحته`
      base.quality.notesAr.push(
        "كسر دعم مُصنَّف انتظار (owner mandate): الدعم التالي قريب فالبيع هنا يقفل الخسارة في أسوأ مكان — راقب إغلاقات الجلسات القادمة تحت مستوى البطانة",
      )
      return base
    }
    // EXIT rows do not carry an entry plan — they close an existing long
    base.state = "exit"
    base.type = exit.type
    base.score = score.breakdown.total
    base.scoreGroups = score.breakdown.groups
    base.evidence = orderedEvidence(exit, score.evidence)
    const stopRef = nearestSupportBelow(map, m.lastClose)
    base.invalidationAr = stopRef
      ? `إغلاق يومي فوق مستوى الكسر (${exit.level.toFixed(2)}) يعيد السهم للنطاق ويلغي الحاجة للخروج`
      : "الخروج استنادًا للكسر الحالي — أعِد التقييم عند أي إغلاق فوق مستوى الكسر"
    return base
  }

  // ---------- best fired candidate ----------
  const best = buyCandidates.length ? [...buyCandidates].sort((a, b) => rankDetection(b) - rankDetection(a))[0] : null
  if (best) {
    const plan = buildBuyPlan({ anchor: m.lastClose, map, m, level: best.level, strength: best.strength })
    const score = computeScore({
      bars,
      m,
      detection: best,
      plan,
      map,
      quality: { bars: bars.length, ohlc: base.quality.ohlc, liquidity: base.quality.liquidity, dataAgeSessions: base.quality.dataAgeSessions },
    })
    if (plan && score.breakdown.total >= BUY_SCORE_MIN) {
      base.state = "buy"
      base.type = best.type
      base.score = score.breakdown.total
      base.scoreGroups = score.breakdown.groups
      base.evidence = orderedEvidence(best, score.evidence)
      base.plan = plan
      base.invalidationAr = postEntryInvalidation(best.type, plan)
      return base
    }
    // fired but not publishable as BUY → honest WAIT with disclosure. The
    // entry condition already fired, so a "near" would be meaningless (the
    // replay also showed its activation trivially sits below the close); a
    // failed BUY bar is disclosure, never a manufactured state.
    base.score = score.breakdown.total
    base.scoreGroups = score.breakdown.groups
    base.evidence = orderedEvidence(best, score.evidence)
    base.quality.notesAr.push("الإعداد البنيوي ظاهر لكن جودة القراءة أو مستوياتها لم تبلغ حد النشر — انتظار تفعيل أوضح")
    return base
  }

  // ---------- near candidates (activation pending, no fired setup) ----------
  const bestNear = nearCandidates.length ? [...nearCandidates].sort((a, b) => rankDetection(b) - rankDetection(a))[0] : null
  if (bestNear && bestNear.activation !== null) {
    const gapPct = ((bestNear.activation - m.lastClose) / m.lastClose) * 100
    if (gapPct > 0 && gapPct <= NEAR_ACTIVATION_MAX_GAP_PCT) {
      const score = computeScore({
        bars,
        m,
        detection: bestNear,
        plan: null,
        map,
        quality: { bars: bars.length, ohlc: base.quality.ohlc, liquidity: base.quality.liquidity, dataAgeSessions: base.quality.dataAgeSessions },
      })
      const setup = buildNearSetup({
        anchor: m.lastClose,
        activation: bestNear.activation,
        level: bestNear.activation,
        activationAr: `شرط التفعيل: إغلاق يومي فوق ${bestNear.activation.toFixed(2)} (قمة المنطقة المخترقة)`,
        map,
        m,
        strength: bestNear.strength,
        preEntryInvalidationAr: preEntryInvalidation(bars, map, m, bestNear.activation),
      })
      if (setup && score.breakdown.total >= 45) {
        base.state = "near"
        base.type = bestNear.type
        base.score = score.breakdown.total
        base.scoreGroups = score.breakdown.groups
        base.evidence = orderedEvidence(bestNear, score.evidence)
        base.setup = setup
        base.invalidationAr = setup.preEntryInvalidationAr
        return base
      }
    }
  }

  // ---------- pre-breakout watch: consolidating just below a tested resistance ----------
  if (!best && !bestNear) {
    const overhead = nearestResistanceAbove(map, m.lastClose)
    if (overhead && overhead.touches >= 2) {
      // the ACTIVATION is the zone TOP (a close above it) — the gap to the TOP
      // must respect the NEAR bound (the replay harness caught a zone whose
      // low was 0.2% away while its top sat 10% above — a stale "near")
      const gapToTop = ((overhead.high - m.lastClose) / m.lastClose) * 100
      const contextOk =
        (m.ema50 !== null && m.lastClose > m.ema50) ||
        (m.rsi14 !== null && m.rsi14 > 45) ||
        (m.perfM1 !== null && m.perfM1 > -3)
      if (gapToTop > 0 && gapToTop <= NEAR_ACTIVATION_MAX_GAP_PCT && contextOk) {
        const score = computeScore({
          bars,
          m,
          detection: null,
          plan: null,
          map,
          quality: { bars: bars.length, ohlc: base.quality.ohlc, liquidity: base.quality.liquidity, dataAgeSessions: base.quality.dataAgeSessions },
        })
        const activation = roundToTick(overhead.high)
        const setup = buildNearSetup({
          anchor: m.lastClose,
          activation,
          level: activation, // the stop leans on the resistance being broken
          activationAr: `شرط التفعيل: إغلاق يومي فوق قمة المقاومة ${activation.toFixed(2)} (${overhead.touches}× مختبَرة)`,
          map,
          m,
          strength: Math.min(1, 0.4 + overhead.touches * 0.05),
          preEntryInvalidationAr: preEntryInvalidation(bars, map, m, activation),
        })
        if (setup && score.breakdown.total >= 45) {
          base.state = "near"
          base.type = "breakout"
          base.score = score.breakdown.total
          base.scoreGroups = score.breakdown.groups
          base.evidence = score.evidence
          base.setup = setup
          base.invalidationAr = setup.preEntryInvalidationAr
          return base
        }
      }
    }
  }

  // ---------- wait ----------
  base.state = "wait"
  base.evidence = [
    {
      ar: "لا يوجد إعداد بنيوي قابل للنشر اليوم — لا تُصنَّع فرص عند غيابها",
      en: "No publishable structural setup today — opportunities are never manufactured",
      group: null,
    },
  ]
  return base
}

export { OPPORTUNITY_TYPE_AR, OPPORTUNITY_TYPE_EN }
export type { NearSetup, TradePlanV2 }
