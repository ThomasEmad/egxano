// =============================================================================
// Signal engine v2 — pattern detectors (PURE).
// Five buy archetypes + two exit conditions, each evaluated on the LAST
// session of the passed prefix. Each detector returns strength 0..1 and its
// facts; the engine picks the best candidate and the scorer adds the points.
// These are EVIDENCE-based detectors, deliberately NOT conjunctive gates:
// a detector fires on its own structure; the score decides publishability.
// =============================================================================

import { buildZoneMap, nearestResistanceAbove, nearestSupportBelow, type PriceZone, type ZoneMap } from "./levels"
import type { MetricsBundle } from "./metrics"
import { EXIT_SUPPORT_CUSHION_EXIT_PCT, EXIT_SUPPORT_CUSHION_WAIT_PCT, type Bar, type OpportunityType } from "./types"

export interface Detection {
  type: OpportunityType
  /** structural strength 0..1 (how clean the archetype fired) */
  strength: number
  /** cited facts (Arabic + English) — published as evidence verbatim */
  facts: { ar: string; en: string }[]
  /** the structural level this setup hinges on (activation / zone ref) */
  level: number
  /** for near setups: the close-based activation level */
  activation: number | null
  /** OWNER MANDATE (2026-11-17) — the support-break cushion verdict, set ONLY
   *  on exit_support detections. When `waitInstead`, the engine classifies the
   *  row WAIT instead of EXIT: the next support sits right under the price
   *  (gap ≤ 3%) or the gap is borderline (3–4%). */
  cushion?: {
    waitInstead: boolean
    /** nearest edge of the next support below the broken one (null = none) */
    level: number | null
    /** % from the last close down to that level (null = no support below) */
    gapPct: number | null
    /** 3% < gap < 4% — borderline: wait, but tighten the mental stop */
    borderline: boolean
  }
}

function pct(x: number, y: number): number {
  return (x / y) * 100
}

// ---------------------------------------------------------------------------
// BREAKOUT — close crossed a multi-touch resistance zone with participation
// ---------------------------------------------------------------------------
export function detectBreakout(bars: Bar[], map: ZoneMap, m: MetricsBundle): Detection | null {
  const last = bars[bars.length - 1]
  const prev = bars[bars.length - 2]
  if (m.atr14 === null || m.atr14 <= 0) return null
  // find the zone the close just crossed (its top is below the close, the
  // PREVIOUS close was below the zone low — a genuine cross, not a re-test).
  // buildZoneMap marks a zone broken on the SAME crossing day (its break scan
  // includes the last bar), so a fresh same-day break IS the breakout — an
  // OLDER break belongs to the retest archetype instead.
  const crossed = map.zones.filter(
    (z) =>
      z.kind === "resistance" &&
      (!z.broken || z.brokenTs === last.ts) &&
      z.touches >= 2 &&
      z.low > prev.close &&
      last.close > z.high,
  )
  const zone = crossed.sort((a, b) => b.touches - a.touches)[0]
  if (!zone) return null
  const facts: { ar: string; en: string }[] = []
  facts.push({
    ar: `إغلاق اليوم (${last.close.toFixed(2)}) اخترق منطقة مقاومة ${zone.touches}× مختبَرة (${zone.low.toFixed(2)}–${zone.high.toFixed(2)})`,
    en: `Close ${last.close.toFixed(2)} crossed a ${zone.touches}-touch resistance zone (${zone.low.toFixed(2)}–${zone.high.toFixed(2)})`,
  })
  let strength = 0.5 + Math.min(0.3, (zone.touches - 2) * 0.1) // more touches = stronger level broken
  const marginAtr = (last.close - zone.high) / m.atr14
  if (marginAtr >= 0.25) {
    strength += 0.15
    facts.push({ ar: `الإغلاق فوق قمة المنطقة بهامش ${marginAtr.toFixed(2)}× ATR`, en: `Close is ${marginAtr.toFixed(2)}×ATR above the zone top` })
  }
  const volOk = m.relVol !== null && m.relVol >= 1.2
  if (volOk) {
    strength += 0.2
    // disclose the REAL baseline size — the mean is over as many PRIOR
    // sessions as actually carry usable volume (≤ 20), not always 20
    const baseN = m.relVolBaseN
    facts.push({
      ar: `حجم اليوم ${m.relVol!.toFixed(2)}× ${baseN !== null ? `متوسط ${baseN} جلسة` : "متوسط 20 جلسة"} يؤكد الاختراق`,
      en: `Session volume ${m.relVol!.toFixed(2)}× ${baseN !== null ? `the ${baseN}-session mean` : "the 20-day mean"} confirms the break`,
    })
  } else if (m.relVol === null) {
    facts.push({ ar: "بيانات الحجم غير متاحة للسهم — الاختراق بلا تأكيد حجم", en: "No volume data — the break lacks volume confirmation" })
  } else {
    facts.push({ ar: `حجم اليوم ${m.relVol.toFixed(2)}× أقل من 1.2× — تأكيد الحجم ضعيف`, en: `Volume ${m.relVol.toFixed(2)}× is below 1.2× — weak confirmation` })
  }
  if (last.close > last.open && (last.high - last.close) < (last.close - last.open)) {
    strength += 0.1
    facts.push({ ar: "شمعة إغلاق قوية (جسم صاعد والإغلاق قرب القمة)", en: "Strong bullish close near the bar high" })
  }
  return { type: "breakout", strength: Math.min(1, strength), facts, level: zone.high, activation: null }
}

// ---------------------------------------------------------------------------
// RETEST — pullback to a recently-broken resistance that now holds as support
// ---------------------------------------------------------------------------
export function detectRetest(bars: Bar[], map: ZoneMap, m: MetricsBundle): Detection | null {
  const last = bars[bars.length - 1]
  const broken = map.zones
    .filter((z) => z.kind === "resistance" && z.broken && z.brokenTs !== undefined)
    .sort((a, b) => (b.brokenTs ?? "").localeCompare(a.brokenTs ?? ""))
  const RECENT_WINDOW = 20 // sessions since the break for it to be a retest
  const breakIdxLimit = bars.length - RECENT_WINDOW
  for (const z of broken) {
    const breakIdx = bars.findIndex((b) => b.ts === z.brokenTs)
    if (breakIdx < 0 || breakIdx < breakIdxLimit) continue
    // at least one close above the zone after the break (the "held above" leg)
    const aboveAfter = bars.slice(breakIdx + 1).some((b) => b.close > z.high)
    if (!aboveAfter) continue
    // TODAY: price dipped into the zone band and closed back above its top
    const touched = last.low <= z.high && last.low >= z.low - (m.atr14 ?? 0) * 0.5
    const holds = last.close > z.high
    if (touched && holds) {
      const facts = [
        {
          ar: `السهم اخترق مقاومة ${z.touches}× مختبَرة (${z.low.toFixed(2)}–${z.high.toFixed(2)}) ثم عاد اليوم لإعادة اختبارها وأغلق فوقها (${last.close.toFixed(2)})`,
          en: `Price broke the ${z.touches}-touch resistance (${z.low.toFixed(2)}–${z.high.toFixed(2)}), retested it today and closed back above (${last.close.toFixed(2)})`,
        },
        { ar: "المنطقة المخترقة تحولت لدعم — إعادة الاختبار نجحت", en: "The broken zone flipped to support — the retest held" },
      ]
      let strength = 0.6
      if (m.relVol !== null && m.relVol >= 1.1) {
        strength += 0.15
        facts.push({ ar: `حجم اليوم ${m.relVol.toFixed(2)}× يدعم صحة الاختبار`, en: `Volume ${m.relVol.toFixed(2)}× supports the retest` })
      }
      return { type: "retest", strength, facts, level: z.high, activation: null }
    }
    // pullback IN PROGRESS toward the zone → near setup (activation: a close
    // back above the zone top is already true; here activation = holding the zone)
    const nearGap = pct(z.high - last.close, last.close)
    if (nearGap > 0 && nearGap <= 6) {
      return {
        type: "retest",
        strength: 0.5,
        facts: [
          {
            ar: `السهم قريب من منطقة إعادة الاختبار (${z.low.toFixed(2)}–${z.high.toFixed(2)}) بعد اختراق سابق — تفاعلها القادم يحدد السيناريو`,
            en: `Price is approaching the retest zone (${z.low.toFixed(2)}–${z.high.toFixed(2)}) after the earlier break`,
          },
        ],
        level: z.high,
        activation: z.high,
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// BOUNCE — rejection off a tested support zone
// ---------------------------------------------------------------------------
export function detectBounce(bars: Bar[], map: ZoneMap, m: MetricsBundle): Detection | null {
  const last = bars[bars.length - 1]
  if (m.atr14 === null || m.atr14 <= 0) return null
  const atr = m.atr14
  const below = map.zones.filter((z) => z.kind === "support" && z.touches >= 2 && z.high < last.close)
  // the session's low must have dipped INTO the zone (within half ATR of its top)
  const touched = below
    .filter((z) => last.low <= z.high + atr * 0.25 && last.low >= z.low - atr * 0.5)
    .sort((a, b) => b.touches - a.touches)[0]
  if (!touched) return null
  const body = last.close - last.open
  const lowerWick = Math.min(last.open, last.close) - last.low
  const upperWick = last.high - Math.max(last.open, last.close)
  const rejected = last.close > touched.high && lowerWick > 0 && lowerWick > upperWick * 0.8
  if (!rejected) return null
  const facts = [
    {
      ar: `ارتداد واضح من دعم ${touched.touches}× مختبَر (${touched.low.toFixed(2)}–${touched.high.toFixed(2)}) — الذيل السفلي (${lowerWick.toFixed(2)}) يعكس شراء عند المستوى`,
      en: `Clear rejection off a ${touched.touches}-touch support (${touched.low.toFixed(2)}–${touched.high.toFixed(2)}) — the lower wick shows buying at the level`,
    },
  ]
  let strength = 0.5 + Math.min(0.3, (touched.touches - 2) * 0.1)
  if (body > 0) {
    strength += 0.1
    facts.push({ ar: `إغلاق أعلى من الافتتاح (${last.open.toFixed(2)} → ${last.close.toFixed(2)})`, en: `Close above the open (${last.open.toFixed(2)} → ${last.close.toFixed(2)})` })
  }
  if (m.rsi14 !== null && m.rsi14 < 55 && m.rsi14 > 25) {
    strength += 0.1
    facts.push({ ar: `RSI ${m.rsi14.toFixed(0)} في منطقة محايدة/متشائمة — هامش تصاعدي أمام المؤشر`, en: `RSI ${m.rsi14.toFixed(0)} leaves room before overbought` })
  }
  if (m.relVol !== null && m.relVol >= 1.2) {
    strength += 0.15
    facts.push({ ar: `حجم اليوم ${m.relVol.toFixed(2)}× يؤكد نشاط المشترين عند الدعم`, en: `Volume ${m.relVol.toFixed(2)}× confirms buyers at the level` })
  }
  return { type: "bounce", strength: Math.min(1, strength), facts, level: touched.high, activation: null }
}

// ---------------------------------------------------------------------------
// CONTINUATION — pullback ending inside an intact uptrend
// ---------------------------------------------------------------------------
export function detectContinuation(bars: Bar[], map: ZoneMap, m: MetricsBundle): Detection | null {
  const last = bars[bars.length - 1]
  if (m.ema20 === null || m.ema50 === null) return null
  const uptrend = last.close > m.ema50 && m.ema20 > m.ema50
  if (!uptrend) return null
  // pullback = a lower close INTO yesterday (the pullback leg); today closes
  // back up above yesterday's close — resumption day (resumed below)
  const n = bars.length
  if (n < 6) return null
  const downLeg = bars[n - 3].close > bars[n - 2].close
  const resumed = last.close > prevOpenClose(bars) && last.close > m.ema20 * 0.985
  if (!downLeg || !resumed) return null
  const facts = [
    {
      ar: `اتجاه صاعد سليم (EMA20 ${m.ema20.toFixed(2)} فوق EMA50 ${m.ema50.toFixed(2)}) مع انتهاء تصحيح قصير واستئناف الصعود اليوم`,
      en: `Intact uptrend (EMA20 ${m.ema20.toFixed(2)} > EMA50 ${m.ema50.toFixed(2)}) with the pullback ending and resumption today`,
    },
  ]
  let strength = 0.45
  if (m.hhHl?.hh && m.hhHl.hl) {
    strength += 0.2
    facts.push({ ar: "بنية قمم وقيعان صاعدة (HH/HL) على آخر 20 جلسة", en: "Higher-highs/higher-lows structure over the last 20 sessions" })
  }
  if (m.ema20Prev !== null && m.ema20 > m.ema20Prev) {
    strength += 0.1
    facts.push({ ar: "ميل EMA20 صاعد", en: "EMA20 slope is up" })
  }
  if (m.macdHist !== null && m.macdHistPrev !== null && m.macdHist > m.macdHistPrev && m.macdHist > 0) {
    strength += 0.1
    facts.push({ ar: "هيستوجرام MACD موجب ومتزايد", en: "MACD histogram positive and rising" })
  }
  const room = nearestResistanceAbove(map, last.close)
  if (room) {
    const gap = pct(room.low - last.close, last.close)
    facts.push({ ar: `أقرب مقاومة فوقه عند ${room.low.toFixed(2)} (${gap.toFixed(1)}% مساحة)`, en: `Nearest resistance at ${room.low.toFixed(2)} (${gap.toFixed(1)}% room)` })
  }
  return { type: "continuation", strength: Math.min(1, strength), facts, level: m.ema20, activation: null }
}

// ---------------------------------------------------------------------------
// REVERSAL — confirmed change of character
// ---------------------------------------------------------------------------
export function detectReversal(bars: Bar[], map: ZoneMap, m: MetricsBundle): Detection | null {
  const last = bars[bars.length - 1]
  const prev = bars[bars.length - 2]
  if (m.ema50 === null || m.atr14 === null) return null
  const n = bars.length
  if (n < 70) return null
  const ema50SeriesNow = m.ema50
  // cross above EMA50 from below within the last few sessions
  const wasBelow = bars.slice(-6, -1).some((b) => b.close < ema50SeriesNow * 0.99)
  const nowAbove = last.close > ema50SeriesNow
  const cross = wasBelow && nowAbove
  // double bottom: two lows within tolerance, neckline crossed
  const lows = bars.slice(-40).map((b, i, arr) => ({ b, i: n - 40 + i }))
  let doubleBottom: { facts: { ar: string; en: string }[]; strength: number } | null = null
  if (lows.length >= 10) {
    const sortedLows = [...lows].sort((a, b) => a.b.low - b.b.low)
    const l1 = sortedLows[0]
    const tol = (m.atr14 ?? l1.b.low * 0.02) * 0.8
    const l2 = sortedLows.find((x) => x !== l1 && x.i > l1.i + 4 && Math.abs(x.b.low - l1.b.low) <= tol)
    if (l2) {
      const between = lows.filter((x) => x.i > l1.i && x.i < l2.i)
      const neck = between.length ? Math.max(...between.map((x) => x.b.high)) : 0
      if (neck > 0 && last.close > neck && prev.close <= neck) {
        doubleBottom = {
          facts: [
            {
              ar: `كسر قاع مزدوج (${l1.b.low.toFixed(2)} و ${l2.b.low.toFixed(2)}) فوق خط العنق ${neck.toFixed(2)} — نموذج انعكاس مكتمل`,
              en: `Double bottom (${l1.b.low.toFixed(2)} & ${l2.b.low.toFixed(2)}) broke the neckline ${neck.toFixed(2)} — completed reversal`,
            },
          ],
          strength: 0.65,
        }
      }
    }
  }
  if (cross) {
    const facts = [
      {
        ar: `إغلاق فوق EMA50 (${m.ema50.toFixed(2)}) بعد جلسات تحته — تحول بنيوي مؤكد`,
        en: `Close above EMA50 (${m.ema50.toFixed(2)}) after sessions below — confirmed change of character`,
      },
    ]
    let strength = 0.5
    if (m.relVol !== null && m.relVol >= 1.3) {
      strength += 0.2
      facts.push({ ar: `حجم اليوم ${m.relVol.toFixed(2)}× يمنح الكسر مصداقية`, en: `Volume ${m.relVol.toFixed(2)}× lends the cross credibility` })
    }
    if (m.macdHist !== null && m.macdHist > 0) {
      strength += 0.1
      facts.push({ ar: "MACD تحول لموجب", en: "MACD flipped positive" })
    }
    if (m.rsi14 !== null && m.rsi14 > 50) {
      strength += 0.1
      facts.push({ ar: `RSI ${m.rsi14.toFixed(0)} فوق 50`, en: `RSI ${m.rsi14.toFixed(0)} back above 50` })
    }
    return { type: "reversal", strength: Math.min(1, strength), facts, level: m.ema50, activation: null }
  }
  if (doubleBottom) {
    return { type: "reversal", strength: doubleBottom.strength, facts: doubleBottom.facts, level: m.ema50, activation: null }
  }
  return null
}

// ---------------------------------------------------------------------------
// EXIT — support breakdown or trend break (close a LONG, never a short)
// ---------------------------------------------------------------------------
export function detectExit(bars: Bar[], map: ZoneMap, m: MetricsBundle): Detection | null {
  const last = bars[bars.length - 1]
  if (m.atr14 === null || m.atr14 <= 0) return null
  const n = bars.length
  if (n < 70 || m.ema20 === null || m.ema50 === null) return null
  const ema50 = m.ema50
  const ema20 = m.ema20

  // (1) close below a multi-touch support with participation
  const belowZones = map.zones.filter((z) => z.kind === "support" && z.touches >= 2 && last.close < z.low && bars[n - 2].close >= z.low)
  if (belowZones.length) {
    const z = belowZones.sort((a, b) => b.touches - a.touches)[0]
    const volFactor = m.relVol !== null && m.relVol >= 1.2

    // OWNER MANDATE (2026-11-17) — the cushion rule: measure the gap from the
    // LIVE CLOSE down to the NEXT support zone below it, via the SAME helper
    // the position review uses (readCushion → nearestSupportBelow) — so the
    // board row and the position review can never disagree again. Measuring
    // from the close (not "any zone under the broken one") also skips shelves
    // the close has already fallen THROUGH — a zone the price sits below can
    // not cushion anything. A close cushion (≤3%) means selling here locks
    // the loss at the worst spot → WAIT; an open field or a far cushion
    // (≥4%) → EXIT fires. The gap is measured to the zone's nearest edge
    // (its high) — the first place a bounce could form. (A support below the
    // close can't produce a negative gap; clamp for safety anyway.)
    const next = nearestSupportBelow(map, last.close)
    const gapRaw = next ? ((last.close - next.high) / last.close) * 100 : null
    const gapPct = gapRaw !== null && gapRaw < 0 ? 0 : gapRaw
    const waitInstead = gapPct !== null && gapPct < EXIT_SUPPORT_CUSHION_EXIT_PCT
    // borderline ONLY inside the (3%, 4%) band — a far cushion (≥4%) is a clean exit
    const borderline = waitInstead && gapPct !== null && gapPct > EXIT_SUPPORT_CUSHION_WAIT_PCT
    const cushionFacts: { ar: string; en: string }[] = []
    if (waitInstead && next && gapPct !== null) {
      cushionFacts.push({
        ar: `لكن الدعم التالي (${next.high.toFixed(2)}–${next.low.toFixed(2)}) يبعد فقط ${gapPct.toFixed(1)}٪ عن السعر — بطانة قريبة تحدّ الهبوط، فالتصنيف انتظار ومتابعة وليس بيعًا فوريًا`,
        en: `But the next support (${next.high.toFixed(2)}–${next.low.toFixed(2)}) sits only ${gapPct.toFixed(1)}% below — a close cushion limits the downside, so the break is classified WAIT, not an immediate sell`,
      })
      if (borderline) {
        cushionFacts.push({
          ar: `الفرق في المنطقة الحدّية بين 3٪ و4٪ — انتظار بوقف ذهني أضيق عند ${next.low.toFixed(2)}`,
          en: `The gap sits in the borderline 3–4% band — wait with a tighter mental stop at ${next.low.toFixed(2)}`,
        })
      }
    } else {
      cushionFacts.push(
        next && gapPct !== null
          ? {
              ar: `الدعم التالي (${next.high.toFixed(2)}) يبعد ${gapPct.toFixed(1)}٪ تحت السعر — لا بطانة قريبة تحمي السعر، فمساحة الهبوط مفتوحة`,
              en: `The next support (${next.high.toFixed(2)}) is ${gapPct.toFixed(1)}% below — no close cushion, downside room is open`,
            }
          : {
              ar: "لا يوجد دعم مسجل تحت الكسر — مساحة الهبوط مفتوحة بلا بطانة",
              en: "No recorded support below the break — downside room is open with no cushion",
            },
      )
    }

    return {
      type: "exit_support",
      strength: volFactor ? 0.8 : 0.55,
      facts: [
        {
          ar: `إغلاق اليوم (${last.close.toFixed(2)}) كسر دعم ${z.touches}× مختبَر (${z.low.toFixed(2)}–${z.high.toFixed(2)}) — سيناريو الخروج من مركز شراء`,
          en: `Today's close (${last.close.toFixed(2)}) broke a ${z.touches}-touch support (${z.low.toFixed(2)}–${z.high.toFixed(2)}) — exit scenario for an open long`,
        },
        ...cushionFacts,
        ...(volFactor ? [{ ar: `الحجم ${m.relVol!.toFixed(2)}× يؤكد الكسر`, en: `Volume ${m.relVol!.toFixed(2)}× confirms the break` }] : []),
        { ar: "هذه إشارة لإغلاق مركز قائم — ليست دعوة للبيع على المكشوف (غير متاح في EGX)", en: "This closes an existing long — not a short-selling call (unavailable on EGX)" },
      ],
      level: z.low,
      activation: null,
      cushion: {
        waitInstead,
        level: next ? next.high : null,
        gapPct,
        borderline,
      },
    }
  }

  // (2) trend break: price closes below EMA50 with EMA20 already below EMA50
  const wasAbove = bars.slice(-12, -1).filter((b) => b.close > ema50).length >= 8
  const nowBelow = last.close < ema50 && ema20 < ema50
  if (wasAbove && nowBelow) {
    return {
      type: "exit_trend",
      strength: 0.6,
      facts: [
        {
          ar: `إغلاق تحت EMA50 (${ema50.toFixed(2)}) وEMA20 تحت EMA50 — الاتجاه الصاعد انكسر بعد ${bars.slice(-12, -1).filter((b) => b.close > ema50).length} جلسات فوقه`,
          en: `Close below EMA50 (${ema50.toFixed(2)}) with EMA20 under EMA50 — the uptrend broke`,
        },
        { ar: "هذه إشارة لإغلاق مركز شراء قائم — ليست فرصة بيع هبوطي", en: "Closes an existing long — not a short opportunity" },
      ],
      level: m.ema50,
      activation: null,
    }
  }
  return null
}

function prevOpenClose(bars: Bar[]): number {
  return bars[bars.length - 2].close
}

/** Run every detector on the last session and split the candidates:
 *  fired (entry condition already met) vs near (activation pending). */
export function detectOpportunities(bars: Bar[], m: MetricsBundle): { buyCandidates: Detection[]; nearCandidates: Detection[]; exit: Detection | null; map: ZoneMap } {
  const map = buildZoneMap(bars)
  const buyCandidates: Detection[] = []
  const nearCandidates: Detection[] = []
  const b1 = detectBreakout(bars, map, m)
  if (b1) buyCandidates.push(b1)
  const b2 = detectRetest(bars, map, m)
  if (b2) {
    if (b2.activation === null) {
      if (!buyCandidates.some((d) => d.type === "breakout")) buyCandidates.push(b2)
    } else {
      nearCandidates.push(b2)
    }
  }
  const b3 = detectBounce(bars, map, m)
  if (b3) buyCandidates.push(b3)
  const b4 = detectContinuation(bars, map, m)
  if (b4) buyCandidates.push(b4)
  const b5 = detectReversal(bars, map, m)
  if (b5) buyCandidates.push(b5)
  const exit = detectExit(bars, map, m)
  return { buyCandidates, nearCandidates, exit, map }
}

export type { PriceZone, ZoneMap }
