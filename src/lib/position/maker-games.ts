// =============================================================================
// maker-games.ts — لعبة الصنّاع (the 100-year EGX maker playbook). PURE.
// Zero runtime imports (types only) — it can never cycle with review.ts.
//
// OWNER MANDATE (2026-11-18, «خبرة 100 سنة»): «عايزه كأنه خبرة 100 سنة في
// السوق المصري وعارف كل ألعاب صنّاع السوق وخططهم، ويكون عارف سياق السوق
// كويس». Each detector RECOGNIZES one maker game from real evidence on the
// tape (bars + zone map + MarketContext + the whole-market section), names
// the maker's PLAN behind the move, and gives the safe response — numbers
// cited, thinking aloud («إيد الصنّاع…»), never commanding.
//
// LINE ANATOMY: GAME NAME (the market's own name for it) + THE MAKER'S PLAN
// (why the move exists) + THE SAFE RESPONSE (what the evidence says to
// watch — close-based, «الإغلاق هو الحكم مش اللمسة»).
// HONESTY: every detector skips silently when its evidence is missing — a
// maker game guessed from thin data is worse than silence, and no dollar/FX/
// news reading exists in the data, so none is ever spoken here.
//
// DETECTORS (in the playbook's own order G1→G6; at most MAKER_MAX_LINES=2):
//   G1 «الكسر الكاذب لجمع السيولة» — a trusted support (≥ 2 touches, the same
//      trust rule readCushion applies) was closed BELOW inside the last
//      MAKER_BREAK_WINDOW sessions, and the LATEST close is back above the
//      zone's low. The recovery is the verdict: a break that reverts within a
//      session or two was liquidity collection, not a trend break.
//   G2 «اللمس تحت وإغلاق فوق» — a long lower tail (lowerShadowPct ≥ 45, the
//      MarketContext's own documented long-wick bound) with the close back
//      above the nearest support low. When the bars can verify the tail
//      actually pierced below the support low, the line says the sweep
//      outright; when they can't, it claims only the rejection + the close.
//   G3 «السهم المقفول بالسعر» — FROZEN_MIN_SESSIONS+ trailing sessions whose
//      (high−low)/close spread stayed ≤ FROZEN_RANGE_MAX_PCT: one hand
//      boxing the price or a state of alert; zero liquidity means no real
//      market right now, and any move out of the lock is a volume surprise.
//   G4 «اختبار الكسر» — a trusted support closed below inside the last
//      MAKER_BREAK_WINDOW sessions (including the last one) and the latest
//      close sits within ±RETEST_NEAR_PCT of the broken level: the retest is
//      the courtroom — volume under the level confirms; holding above on dry
//      volume flips the roles.
//   G5 «القوة النسبية ضد السوق» — the stock's day change (close vs prevClose)
//      against the sector's day change from the whole-market section:
//      ≥ RS_PP_MIN pp while the sector is red → money choosing the stock
//      against its sector; ≤ −RS_PP_MIN pp while the sector is green →
//      hidden selling under the sector's green cover (the most dangerous
//      selling on the tape).
//   G6 «السهم تحت أمطار السوق» — whole-market breadth declining ≥
//      BREADTH_DECLINE_RATIO × advancing while the stock's day change is ≥ 0
//      on the hold branch: protection being bought, not coincidence.
// =============================================================================

import type { Bar } from "@/lib/signals/types"
import type { PriceZone, ZoneMap } from "@/lib/signals/levels"
import type { MarketContextSection } from "@/lib/technical/analyze"
import type { MarketContext } from "./market-context"
import type { CushionRead, VeteranBranch } from "./review"

/** At most two maker games per report — the loudest traps, not a catalog. */
export const MAKER_MAX_LINES = 2

/** A maker game is read only on a TRUSTED zone (≥ 2 distinct pivots) —
 *  single-touch lows are paint, the review's own doctrine. */
const MAKER_MIN_TOUCHES = 2

/** A break older than this window is history, not today's game (the G1 line
 *  itself says it: «الكسر اللي بيرجع في جلسة أو اتنين»). */
const MAKER_BREAK_WINDOW = 3

/** (high−low)/close ≤ 0.2٪ = a locked tape («السهم المقفول بالسعر»). */
const FROZEN_RANGE_MAX_PCT = 0.2
/** The lock must have held this many trailing sessions before it is a game. */
const FROZEN_MIN_SESSIONS = 3

/** Retest proximity: the close within ±1٪ of the broken level = the retest
 *  is live. */
const RETEST_NEAR_PCT = 1

/** Long-lower-tail bound — mirrors the MarketContext's own documented long
 *  wick share (the veteran ladder's slot 8 uses the same 45٪ bound). */
const LOWER_SHADOW_MIN_PCT = 45

/** Relative-strength gap vs the sector, in percentage points. */
const RS_PP_MIN = 1.5

/** Whole-market breadth: declining ≥ 2× advancing = a wide sell-off day. */
const BREADTH_DECLINE_RATIO = 2

/** Whole-market share of tickers above EMA20: ≤ 15٪ = bottoms regime
 *  («فرص جمع لا تواري»), ≥ 85٪ = tops regime. */
const QUIET_MARKET_MAX_ABOVE_EMA20 = 15
const CROWDED_MARKET_MIN_ABOVE_EMA20 = 85

// ---- tiny local formatters (mirror review.ts/market-lexicon.ts style;
// local copies — this module stays free of any runtime edge) ----
/** 2-decimal level, e.g. 104.00 */
const fmt = (x: number) => x.toFixed(2)
/** 1-decimal signed percent — for day changes and relative-strength gaps. */
const pct1 = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}٪`
/** 1-decimal percent WITHOUT a sign — for unsigned quantities like a wick's
 *  share of the range or a distance from a level. */
const pctPlain = (x: number) => `${x.toFixed(1)}٪`
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x)

/** Arabic session count: جلسة واحدة / جلستين / {n} جلسات. */
function sessionsAr(n: number): string {
  if (n === 1) return "جلسة واحدة"
  if (n === 2) return "جلستين"
  return `${n} جلسات`
}

/** The mandate's options bag. Extended beyond the base mandate exactly where
 *  the detectors need it: `bars` (mandated addition — G3's freeze is computed
 *  off the raw series, and G2 verifies the tail's pierce), `map` (G1/G4 read
 *  trusted support zones off the zone map), and `mctx` (G5/G6 read the
 *  whole-market section the service now passes). */
export interface MakerOpts {
  branch: VeteranBranch
  avgBuyPrice: number
  close: number
  trendAr: string
  /** the review's own cushion read — its brokenZone (low/high/touches/kind,
   *  readCushion's ≥ 2-touch rule) joins the G1/G4 candidate set; the break's
   *  RECENCY is derived from the bars themselves, which covers more than the
   *  last-session-only `brokeLastSession` flag (G4's window is 3 sessions) */
  cushion: CushionRead | null
  /** the nearest support's LOW edge under the close (null = none known) */
  nearestSupportLow: number | null
  prevClose: number | null
  bars: Bar[]
  map: ZoneMap | null
  /** the whole-market intelligence section — null/undefined when the service
   *  has none (G5/G6 then stay silent, never invented) */
  mctx: MarketContextSection | null | undefined
}

/** Trusted support zones for the break games: multi-touch supports off the
 *  map, plus the cushion's own broken zone when present (deduped by edges). */
function trustedSupportZones(map: ZoneMap | null, cushion: CushionRead | null): PriceZone[] {
  const zones: PriceZone[] = []
  const push = (z: PriceZone | null) => {
    if (!z || z.kind !== "support" || (z.touches ?? 0) < MAKER_MIN_TOUCHES) return
    if (!zones.some((x) => x.low === z.low && x.high === z.high)) zones.push(z)
  }
  if (map) for (const z of map.zones) push(z)
  push(cushion?.brokenZone ?? null)
  return zones
}

/** The LATEST index inside the trailing `window` sessions whose close sat
 *  below the zone's low (−1 = no such close). Non-finite closes never count. */
function lastCloseBelowIdx(bars: Bar[], z: PriceZone, window: number): number {
  const n = bars.length
  for (let i = n - 1; i >= Math.max(0, n - window); i--) {
    const c = bars[i]?.close
    if (fin(c) && c < z.low) return i
  }
  return -1
}

/** The trailing frozen stretch: how many consecutive trailing sessions kept
 *  (high−low)/close ≤ FROZEN_RANGE_MAX_PCT, and the largest spread among them
 *  (the honest upper bound the line quotes). null under FROZEN_MIN_SESSIONS. */
function frozenStretch(bars: Bar[]): { sessions: number; maxSpreadPct: number } | null {
  let sessions = 0
  let maxSpread = 0
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i]
    if (!b || !fin(b.high) || !fin(b.low) || !fin(b.close) || b.close <= 0 || b.high < b.low) break
    const spreadPct = ((b.high - b.low) / b.close) * 100
    if (spreadPct > FROZEN_RANGE_MAX_PCT) break
    sessions++
    if (spreadPct > maxSpread) maxSpread = spreadPct
  }
  return sessions >= FROZEN_MIN_SESSIONS ? { sessions, maxSpreadPct: maxSpread } : null
}

/** The stock's own day change (close vs prevClose), % — null without both. */
function stockDayChangePct(close: number, prevClose: number | null): number | null {
  if (!fin(close) || !fin(prevClose) || prevClose <= 0) return null
  return ((close - prevClose) / prevClose) * 100
}

/** Deterministic pick among qualifying zones: most touches first, then the
 *  one nearest the close. */
function pickZone(zones: PriceZone[], close: number): PriceZone | null {
  if (!zones.length) return null
  return [...zones].sort((a, b) => b.touches - a.touches || Math.abs(close - a.low) - Math.abs(close - b.low))[0] ?? null
}

/**
 * The maker-game pass — at most MAKER_MAX_LINES lines, in the playbook's own
 * order G1→G6, each line = game + plan + safe response. Skips silently on
 * missing evidence.
 */
export function makerGamesAr(ctx: MarketContext, opts: MakerOpts): string[] {
  const lines: string[] = []
  const add = (s: string) => {
    if (lines.length < MAKER_MAX_LINES) lines.push(s)
  }
  const { close, prevClose, mctx, bars, map, cushion } = opts
  const lastBar = bars.length ? bars[bars.length - 1] : null

  // ---- G1 «الكسر الكاذب لجمع السيولة»: closed below a trusted support inside
  // the window, and the LATEST close is back above the zone's low — the
  // recovery itself is the verdict (a live break — the close still under the
  // zone — never qualifies).
  if (fin(close) && lastBar !== null && fin(lastBar.close) && lastBar.close > 0 && bars.length >= 2) {
    const zones = trustedSupportZones(map, cushion).filter((z) => {
      const j = lastCloseBelowIdx(bars, z, MAKER_BREAK_WINDOW)
      return j >= 0 && j <= bars.length - 2 && lastBar.close >= z.low
    })
    const z = pickZone(zones, close)
    if (z) {
      const j = lastCloseBelowIdx(bars, z, MAKER_BREAK_WINDOW)
      const back = bars.length - 1 - j
      add(
        `إيد الصنّاع هنا واضحة — «الكسر الكاذب لجمع السيولة»: نزّلت الإغلاق تحت الدعم (${fmt(z.low)}–${fmt(z.high)}) من ${sessionsAr(back)} ورجّعته فوقه تاني عند ${fmt(close)} — زي ما بيتقال في السوق، الكسر اللي بيرجع في جلسة أو اتنين مش كسر اتجاه، ده جمع سيولة من بيع الخايفين؛ والإغلاق فوق الخط (${fmt(z.low)}) هو الحكم مش اللمسة.`,
      )
    }
  }

  // ---- G2 «اللمس تحت وإغلاق فوق»: a long lower tail with the close back
  // above the nearest support low. The tail's pierce below the support low is
  // claimed only when the bars can verify it; otherwise just rejection+close.
  if (
    ctx.lowerShadowPct !== null &&
    fin(ctx.lowerShadowPct) &&
    ctx.lowerShadowPct >= LOWER_SHADOW_MIN_PCT &&
    opts.nearestSupportLow !== null &&
    fin(opts.nearestSupportLow) &&
    fin(close) &&
    close > opts.nearestSupportLow
  ) {
    const ls = ctx.lowerShadowPct
    const supLow = opts.nearestSupportLow
    const pierced = lastBar !== null && fin(lastBar.low) && lastBar.low < supLow
    add(
      pierced
        ? `«اللمس تحت وإغلاق فوق»: ذيل سفلي طويل (${pctPlain(ls)} من مدى اليوم) نازل تحت الدعم (${fmt(supLow)}) والإغلاق راجع فوقه عند ${fmt(close)} — ده مسح للستوبات المتكدسة تحت الدعم وفشل حقيقي للكسر: اللمسة تحت مش قرار، والإغلاق فوق الخط هو اللي استلم الدعم تاني.`
        : `ذيل سفلي طويل (${pctPlain(ls)} من مدى اليوم) والإغلاق فوق الدعم (${fmt(supLow)}) عند ${fmt(close)} — الرفض تحت واضح والاستلام حصل بالإغلاق: اللمسة تحت مش قرار، والإغلاق هو اللي بيقول الكلمة.`,
    )
  }

  // ---- G3 «السهم المقفول بالسعر»: a locked tape — one hand boxing the price.
  if (bars.length >= FROZEN_MIN_SESSIONS) {
    const frozen = frozenStretch(bars)
    if (frozen) {
      add(
        `سهم متجمد بالسعر على ${sessionsAr(frozen.sessions)} — المدى اليومي ما عدّاش ${pctPlain(frozen.maxSpreadPct)} من السعر (${fmt(close)}) — «السهم المقفول بالسعر» زي ما بيتقال في السوق: يد واحدة حاجزة أو استنفار، والسيولة الصفر معناها مافيش سوق حقيقي حاليًا؛ وأي حركة تطلع من القفل بتبقى مفاجأة بفوليوم — فوق أو تحت، ومحدش يعرف قبلها.`,
      )
    }
  }

  // ---- G4 «اختبار الكسر»: a trusted support closed below inside the window
  // (the live break counts) and the close sits within ±RETEST_NEAR_PCT of the
  // broken level — the retest is the courtroom.
  if (fin(close) && close > 0) {
    const zones = trustedSupportZones(map, cushion).filter((z) => {
      if (lastCloseBelowIdx(bars, z, MAKER_BREAK_WINDOW) < 0) return false
      const dist = (Math.abs(close - z.low) / close) * 100
      return dist <= RETEST_NEAR_PCT
    })
    const z = pickZone(zones, close)
    if (z) {
      const dist = (Math.abs(close - z.low) / close) * 100
      add(
        `اختبار الكسر: الدعم المكسور (${fmt(z.low)}–${fmt(z.high)}) على بُعد ${pctPlain(dist)} بس من الإغلاق (${fmt(close)}) — الكسر حصل في آخر الجلسات القريبة، وده بالظبط مكان «اختبار الكسر»: اختبار بفوليوم تحت المستوى = تأكيد الكسر، وصمود فوقه بفوليوم جاف = قلب أدوار؛ الاختبار هو المحكمة، مش الشمعة اللي كسرت.`,
      )
    }
  }

  // ---- G5 «القوة النسبية ضد السوق»: the stock's day change against its
  // sector's day change (the whole-market section) — strength against a red
  // sector, or hidden selling under a green one.
  const stockDay = stockDayChangePct(close, prevClose)
  const sectorDay = mctx?.sector?.dayChangePct ?? null
  if (stockDay !== null && sectorDay !== null && fin(sectorDay)) {
    const pp = stockDay - sectorDay
    if (pp >= RS_PP_MIN && sectorDay < 0) {
      add(
        `قوة نسبية ضد السوق: السهم ${pct1(stockDay)} والقطاع ${pct1(sectorDay)} (فرق ${pct1(pp)}) — السهم شايل نفسه والقطاع بينزّل — فلوس بتختاره تحديًا للسوق (قوة نسبية)، ودي من أقوى البطاقات اللي سهم ممكن يمشي بيها ضد تيار قطاعه؛ والقوة النسبية بيثبتها الإغلاق مش الجلسة الواحدة.`,
      )
    } else if (pp <= -RS_PP_MIN && sectorDay > 0) {
      add(
        `بيع مستتر تحت غطاء السوق الأخضر: السهم ${pct1(stockDay)} والقطاع ${pct1(sectorDay)} (فرق ${pct1(pp)}) — أخطر بيع في السوق هو اللي بيحصل وقطاعك أخضر، لأن الغطاء بيخبيه عن العين؛ ضعف ضد التيار مش معاه، واللي بيتابع الفرد يوميًا بس هو اللي بيشوفه.`,
      )
    }
  }

  // ---- G6 «السهم تحت أمطار السوق»: a wide sell-off day (breadth declining ≥
  // 2× advancing) while the stock held ≥ 0 — on the hold branch, where the
  // holding verdict is actually being made.
  const b = mctx?.breadth ?? null
  if (opts.branch === "hold" && b && fin(b.advancing) && fin(b.declining) && b.declining > 0 && b.declining >= BREADTH_DECLINE_RATIO * b.advancing && stockDay !== null && stockDay >= 0) {
    add(
      `السوق كله بيصبّ (${b.declining} هابط مقابل ${b.advancing} صاعد) والسهم ماسك عند ${fmt(close)} — الثبات في يوم زي ده حماية بتتشترى، مش صدفة؛ السهم اللي بيرفض ينزل مع سوق كله وراه إيد بتشترى تحت.`,
    )
  }

  return lines
}

/** The branch-tailored implication inside the market map — one clause per
 *  branch, embedded regime when the map has one. */
function marketImplicationAr(branch: VeteranBranch, regimeAr: string | null): string {
  switch (branch) {
    case "hold":
      return `الاحتفاظ في بيئة كهذه${regimeAr ? ` (${regimeAr})` : ""} معناه متابعة إغلاقات السوق زي إغلاقات السهم بالظبط`
    case "takeProfit":
      return "الجني الجزئي هنا بيأمّن الربح قبل ما بيئة السوق تقلب أدوارها"
    case "farCushionExit":
    case "engineExit":
      return "الخروج هنا ماشي مع اتجاه السوق العام — عكس التيار بيحتاج دليل أقوى"
    case "cushionWait":
      return "الانتظار هنا منطقي، بس الحسم مرهون بإغلاقات جاية وسط سوق بيحسم اتجاهه"
    case "deepLoss":
      return "الانتظار للارتداد في بيئة كهذه محسوب — والارتداد بيبدأ لما اتساع السوق يهدى الأول"
  }
}

/**
 * «خريطة السوق النهاردة» — ONE line max: the whole-market read the service
 * passes (regime + breadth + the company's sector day change + where the
 * market's EMA20 share puts the day) + the branch-tailored implication.
 * All null/missing → [] (a map with nothing on it is no map). When the map
 * is PARTIAL (a core input missing) and the section carries limitations, the
 * first limitation is quoted honestly («حدود الخريطة: …») — a partial map
 * must say what it cannot see.
 */
/** OWNER DOCTRINE (2026-11-18, CRST review): the intelligence snapshot carries
 *  sector names in the feed's English (e.g. "Construction") — an Arabic review
 *  must not mix scripts inside one sentence. Substring matching so feed-label
 *  variants still land; a name the lexicon doesn't know stays honestly
 *  in English rather than being translated badly. */
const SECTOR_AR: ReadonlyArray<readonly [string, string]> = [
  ["Construction", "مقاولات وتشييد"],
  ["Real Estate", "عقاري"],
  ["Bank", "بنوك"],
  ["Financial", "خدمات مالية"],
  ["Investment", "استثمار"],
  ["Insurance", "تأمين"],
  ["Technology", "تكنولوجيا"],
  ["Communication", "اتصالات"],
  ["Telecom", "اتصالات"],
  ["Consumer", "سلع استهلاكية"],
  ["Materials", "مواد أساسية"],
  ["Resources", "مواد أساسية"],
  ["Industrial", "صناعة"],
  ["Energy", "طاقة"],
  ["Petrol", "بترول"],
  ["Utility", "مرافق"],
  ["Health", "رعاية صحية"],
  ["Pharma", "أدوية"],
  ["Chemical", "كيماويات"],
  ["Cement", "أسمنت"],
  ["Food", "أغذية"],
  ["Beverage", "مشروبات"],
  ["Holding", "قابضات"],
  ["Textile", "غزل وملابس"],
  ["Apparel", "ملابس"],
  ["Tourism", "سياحة"],
  ["Hotel", "فندقة"],
  ["Transport", "نقل"],
  ["Media", "إعلام"],
  ["Publishing", "إعلام ونشر"],
  ["Mining", "تعدين"],
  ["Education", "تعليم"],
  ["Navigation", "ملاحة"],
  ["Freight", "نقل"],
]
const sectorAr = (name: string): string => {
  for (const [needle, ar] of SECTOR_AR) if (name.includes(needle)) return ar
  return name
}

export function marketMapAr(
  mctx: MarketContextSection | null | undefined,
  opts: { close: number; branch: VeteranBranch },
): string[] {
  if (!mctx || !mctx.available) return []
  const clauses: string[] = []
  const regimeAr = mctx.marketRegimeAr && mctx.marketRegimeAr.trim() !== "" ? mctx.marketRegimeAr : null
  if (regimeAr) clauses.push(regimeAr)
  const b = mctx.breadth
  if (b && fin(b.advancing) && fin(b.declining)) {
    const ratio = b.ratio !== null && fin(b.ratio) ? ` (نسبة ${b.ratio})` : ""
    clauses.push(`الاتساع ${b.advancing} صاعد مقابل ${b.declining} هابط${ratio}`)
  }
  const s = mctx.sector
  if (s && s.dayChangePct !== null && fin(s.dayChangePct)) {
    clauses.push(`القطاع${s.name ? ` (${sectorAr(s.name)})` : ""} عند ${pct1(s.dayChangePct)}`)
  }
  const above = mctx.aboveEma20
  if (above !== null && fin(above)) {
    if (above <= QUIET_MARKET_MAX_ABOVE_EMA20) {
      clauses.push(`والمقيم فوق EMA20 في السوق كله ${pctPlain(above)} بس — بيئة قيعان: السوق كله تحت متوسطاته — فرص جمع لا تواري`)
    } else if (above >= CROWDED_MARKET_MIN_ABOVE_EMA20) {
      clauses.push(`والمقيم فوق EMA20 في السوق كله ${pctPlain(above)} — بيئة قمم: كل السوق فوق متوسطاته — الأرباح هنا بتتاخد بأعصاب`)
    } else {
      clauses.push(`والمقيم فوق EMA20 في السوق كله ${pctPlain(above)} — لا قيعان متطرفة ولا قمم: السوق في المنتصف`)
    }
  }
  if (!clauses.length) return []
  clauses.push(marketImplicationAr(opts.branch, regimeAr))
  const partial = regimeAr === null || !b || !fin(b.advancing) || !fin(b.declining) || !s || s.dayChangePct === null || !fin(s.dayChangePct)
  const limitClause = partial && mctx.limitations.length > 0 ? ` — حدود الخريطة: ${mctx.limitations[0]}` : ""
  return [`خريطة السوق النهاردة: ${clauses.join(" — ")}${limitClause}.`]
}
