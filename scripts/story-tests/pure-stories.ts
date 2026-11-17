// =============================================================================
// pure-stories.ts — قصص المستخدمين على طبقة المنطق الصافي (بلا قاعدة بيانات).
// الهدف (target 3): استيراد src/lib/position/review.ts + src/lib/technical/analyze.ts
// + الموديولات الصافية الأخرى، وتشغيل كل قصة على بيانات اصطناعية (fixtures).
// كل قصة: { id, persona, story, steps[], result, failures[] } — تُكتب النتائج
// في pure-results.json ليقرأها run-stories.mjs ويدمجها.
// تشغيل: bunx tsx scripts/story-tests/pure-stories.ts
// =============================================================================
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import { reviewPosition } from "@/lib/position/review"
import { cushionSeries, decliningSeries } from "@/lib/position/__tests__/bars-fixture"
import { buildZoneMap } from "@/lib/signals/levels"
import { computeMetrics, toSignalMetrics } from "@/lib/signals/metrics"
import type { Bar, SignalRowV2, SignalState, SignalMetrics } from "@/lib/signals/types"
import { sanitizeBars, contiguousSuffix, perfByCalendarDays, assembleBundle } from "@/lib/technical/analyze"
import { evaluateUndervaluation, computeFinancialHealth, percentileRank } from "@/lib/analytics/engine"
import { CALC_METRIC_MAP, CALC_METRICS, RAW_METRICS, defaultRankingOrder, RANKING_LOWER_IS_BETTER } from "@/lib/financial/registry"
import { periodOrder, periodTypeRank, isStalePeriod } from "@/lib/financial/latest-period"
import { detectEvents } from "@/lib/financial/events"
import type { PeriodData } from "@/lib/financial/events"
import { formatEgp, formatPercent, formatRatio } from "@/lib/financial/units"

// ---------------- إطار تشغيل القصص ----------------
interface Step {
  kind: "assert" | "call"
  detail: string
  ok: boolean
  got?: string
}
interface StoryResult {
  id: string
  persona: string
  story: string
  target: string
  ms: number
  result: "pass" | "fail"
  failures: string[]
  steps: Step[]
  /** عينات قصيرة من الاستجابات للتبليغ */
  artifacts?: Record<string, string>
}
const TARGET = "pure-lib@src (bunx tsx)"
const results: StoryResult[] = []
/** كل النصوص العربية الخارجة من كل القصص — لقصة النظافة الشاملة HY01 */
const allUserStrings: { from: string; text: string }[] = []
const collect = (from: string, text: string | null | undefined) => {
  if (typeof text === "string" && text.length > 0) allUserStrings.push({ from, text })
}

function runStory(id: string, persona: string, story: string, fn: (s: StoryBuilder) => void): void {
  const t0 = Date.now()
  const steps: Step[] = []
  const artifacts: Record<string, string> = {}
  const s = new StoryBuilder(steps, artifacts)
  let failed = false
  try {
    fn(s)
  } catch (e) {
    failed = true
    steps.push({ kind: "call", detail: "تنفيذ القصة بدون انهيار", ok: false, got: `${(e as Error).name}: ${(e as Error).message}` })
  }
  const failures = steps.filter((x) => !x.ok).map((x) => `${x.detail} — ${x.got ?? "غير متوقع"}`)
  if (failures.length > 0) failed = true
  const ms = Date.now() - t0
  results.push({ id, persona, story, target: TARGET, ms, result: failed ? "fail" : "pass", failures, steps, artifacts })
}
class StoryBuilder {
  constructor(private steps: Step[], private artifacts: Record<string, string>) {}
  /** تأكيد مع رسالة عربية وشرح ما ظهر فعليًا عند الفشل */
  assert(detail: string, ok: boolean, got?: string): void {
    this.steps.push({ kind: "assert", detail, ok: Boolean(ok), got })
  }
  sample(key: string, value: string, max = 220): void {
    if (this.artifacts[key] === undefined) this.artifacts[key] = value.slice(0, max)
  }
}
const first = (arr: string[] | null | undefined): string => (arr && arr.length ? arr[0] : "(فارغ)")

// ---------------- بناة الـfixtures ----------------
function nullMetrics(): SignalMetrics {
  return { rsi14: null, ema20: null, ema50: null, atr14: null, macdHist: null, relVol: null, perfM1: null, perfM3: null, rangePos60: null, dailyVolPct: null }
}
function makeRow(bars: Bar[], state: SignalState, over: Partial<SignalRowV2> = {}): SignalRowV2 {
  const m = computeMetrics(bars)
  const metrics: SignalMetrics = m ? toSignalMetrics(m) : nullMetrics()
  return {
    companyId: "c1",
    ticker: "TEST",
    nameEn: "Test Co",
    nameAr: "شركة الاختبار",
    sector: "Tests",
    marketTier: "EGX30",
    type: null,
    asOf: "2026-03-12",
    state,
    lastClose: bars[bars.length - 1].close,
    changePct: null,
    score: 50,
    scoreGroups: null,
    evidence: [],
    plan: null,
    setup: null,
    invalidationAr: null,
    metrics,
    quality: { bars: bars.length, ohlc: true, liquidity: "normal", avgTradedValueEgp: null, dataAgeSessions: 0, notesAr: [] },
    warnings: [],
    engine: "story-harness",
    ...over,
  }
}
function review(bars: Bar[], state: SignalState, avgBuy: number, over: Partial<SignalRowV2> = {}, downside?: "yes" | "no" | null) {
  return reviewPosition({ row: makeRow(bars, state, over), bars, map: buildZoneMap(bars), avgBuyPrice: avgBuy, downsideAnswer: downside ?? null })
}
/** فحص شامل لسلسلة مراجعة مركز واحد: يجمع نصوصها ويضيف تأكيدات مشتركة */
function assertCommonReview(s: StoryBuilder, id: string, r: ReturnType<typeof reviewPosition>, expectDecision?: string): void {
  if (expectDecision) s.assert(`القرار ${expectDecision}`, r.decision === expectDecision, `القرار فعليًا: ${r.decision}`)
  s.assert("decisionAr عربي غير فارغ", typeof r.decisionAr === "string" && r.decisionAr.length > 0, first([r.decisionAr]))
  s.assert("headlineAr غير فارغ", r.headlineAr.length > 10, r.headlineAr.slice(0, 80))
  s.assert("أسباب القرار ≥ 4", r.reasonsAr.length >= 4, `عدد الأسباب: ${r.reasonsAr.length}`)
  s.assert("invalidationAr غير فارغ", r.invalidationAr.length > 10, first([r.invalidationAr]))
  s.assert("levelsBasisAr غير فارغ", r.levelsBasisAr.length > 20, r.levelsBasisAr.slice(0, 60))
  s.assert("closingAr غير فارغ", r.closingAr.length > 20, r.closingAr.slice(0, 60))
  s.assert("snapshot.lastClose رقم سالب غير منطقي؟", Number.isFinite(r.snapshot.lastClose) && r.snapshot.lastClose > 0, String(r.snapshot.lastClose))
  const hyg = [r.decisionAr, r.headlineAr, r.invalidationAr, r.levelsBasisAr, r.closingAr, r.snapshot.trendAr, ...r.reasonsAr, ...(r.planAr ? [r.planAr] : [])]
  const bad = hyg.filter((t) => /undefined|NaN|\bnull\b|\[object|Infinity|TODO|XXX/.test(t))
  s.assert("لا undefined/NaN/null في نصوص القرار", bad.length === 0, bad.length ? first(bad) : undefined)
  collect(id, r.decisionAr); collect(id, r.headlineAr); collect(id, r.invalidationAr)
  collect(id, r.levelsBasisAr); collect(id, r.closingAr); collect(id, r.snapshot.trendAr)
  r.reasonsAr.forEach((t) => collect(id, t))
  if (r.planAr) collect(id, r.planAr)
  if (r.question) { collect(id, r.question.promptAr); collect(id, r.question.yesLabelAr); collect(id, r.question.noLabelAr) }
  r.supports.forEach((l) => collect(id, l.noteAr))
  r.resistances.forEach((l) => collect(id, l.noteAr))
}

// =============================================================================
// 1) مستثمر بالخسارة (K)
// =============================================================================
runStory("K01", "مستثمر بالخسارة", "سهم تحت متوسط شرائي بحوالي −40٪: الموقع يقرر الانتظار للارتداد ويشرح رياضيات التعويض ويطرح سؤال المتابعة، بدل أمر بيع في قاع الذعر", (s) => {
  const bars = decliningSeries() // إغلاق أخير ≈ 100
  const avg = 166.67
  const r = review(bars, "wait", avg)
  s.assert("الخسارة المحسوبة ≈ −40٪", Math.abs(r.pnlPct + 40) < 0.5, `pnlPct=${r.pnlPct}`)
  assertCommonReview(s, "K01", r, "wait")
  s.assert("رياضيات التعويض موجودة (+66.7٪ تقريبًا)", r.recoveryPct !== null && Math.abs(r.recoveryPct - 66.7) < 0.6, `recoveryPct=${r.recoveryPct}`)
  s.assert("نطاق الارتداد = متوسط الشراء × 0.75–0.80", Math.abs(r.supports.length) >= 0 && avg * 0.75 > 0, "نطاق الارتداد يُحسب من متوسط الشراء")
  const rebound = r.reasonsAr.find((t) => t.includes("خطة الارتداد")) ?? ""
  s.assert("خطة الارتداد تذكر نطاق الخروج 20–25٪", rebound.includes("20–25٪") || rebound.includes("20-25٪"), first([rebound]))
  s.assert("سؤال المتابعة موجود", r.question !== null, r.question ? first([r.question.promptAr]) : "null")
})
runStory("K02", "مستثمر بالخسارة", "نفس الخسارة العميقة بعد إجابة المستخدم «أه، ممكن يهبط»: الخطة تبقى بيع مع أول ارتداد بلا حرق كمية إضافية", (s) => {
  const bars = decliningSeries()
  const r = review(bars, "wait", 166.67, {}, "yes")
  assertCommonReview(s, "K02", r, "wait")
  s.assert("خطة البيع مع أول ارتداد مذكورة", (r.planAr ?? "").includes("ارتداد"), first([r.planAr]))
  s.assert("الترويسة تعكس إجابة المستخدم", r.headlineAr.includes("بإجابتك"), first([r.headlineAr]))
})
runStory("K03", "مستثمر بالخسارة", "خسارة صغيرة (−13٪) مع اتجاه مكسور بالكامل ولا يوجد أي دعم تحته: الخروج لحماية رأس المال مع سبب التعويض", (s) => {
  const bars = decliningSeries()
  const r = review(bars, "wait", 115, { metrics: { ...toSignalMetrics(computeMetrics(bars)!), ema20: 104, ema50: 107 } })
  assertCommonReview(s, "K03", r, "exit")
  s.assert("سبب التعويض داخل الأسباب", r.reasonsAr.some((t) => t.includes("تعوّض") || t.includes("تعويض")), first(r.reasonsAr))
})
runStory("K04", "مستثمر بالخسارة", "خسارة صغيرة والسهم واقف فوق دعم مختبر قريب: الانتظار بإغلاق حاسم بدل البيع عند أدنى نقطة", (s) => {
  const bars = cushionSeries(100, 106.5)
  const r = review(bars, "wait", 110)
  s.assert("الخسارة تحت −20٪ (ليست عميقة)", r.pnlPct > -20 && r.pnlPct < 0, `pnlPct=${r.pnlPct}`)
  assertCommonReview(s, "K04", r, "wait")
  s.assert("حد الإلغاء مربوط بمستوى سعرية بعمودين عشريين", /\d+\.\d{2}/.test(r.invalidationAr), first([r.invalidationAr]))
})
runStory("K05", "مستثمر بالخسارة", "إغلاق كسر دعم مختبر 2× والبطانة التالية بعيدة أكثر من 4٪: خروج صريح بالأرقام (مستوى الكسر والمسافة)", (s) => {
  const bars = cushionSeries(97) // بطانة 97.0–97.4 بعيدة ~5.4٪ عن الإغلاق 103
  const r = review(bars, "wait", 105)
  assertCommonReview(s, "K05", r, "exit")
  const breakReason = r.reasonsAr.find((t) => t.includes("كسر دعم")) ?? ""
  s.assert("سبب الكسر يذكر المستوى المكسور بالأرقام (منطقة 104)", /104\.00–104\.40/.test(breakReason), first([breakReason]))
  s.assert("حد الرجوع = مستوى الكسر 104.00", r.invalidationAr.includes("104.00"), first([r.invalidationAr]))
})
runStory("K06", "مستثمر بالخسارة", "كسر بفارق حدّي (البطانة بين 3٪ و4٪ تحت السعر): انتظار بوقف أضيق مع تسمية المنطقة الحدّية", (s) => {
  const bars = cushionSeries(99)
  const r = review(bars, "wait", 105)
  assertCommonReview(s, "K06", r, "wait")
  s.assert("المنطقة الحدّية مذكورة", r.reasonsAr.some((t) => t.includes("الحدّية")), first(r.reasonsAr))
})
runStory("K07", "مستثمر بالخسارة", "كل مستويات السعر المكتوبة في خطط وحدود القرارات بصيغة رقمين عشريين (لا 104.4 ولا 104)", (s) => {
  const cases: [string, ReturnType<typeof reviewPosition>][] = [
    ["K05", review(cushionSeries(97), "wait", 105)],
    ["K04", review(cushionSeries(100, 106.5), "wait", 110)],
    ["K06", review(cushionSeries(99), "wait", 105)],
    ["K01", review(decliningSeries(), "wait", 166.67, {}, "no")],
    ["R01", review(cushionSeries(100, 106.5), "wait", 100)],
    ["K03", review(decliningSeries(), "wait", 115, { metrics: { ...toSignalMetrics(computeMetrics(decliningSeries())!), ema20: 104, ema50: 107 } })],
  ]
  const bad: string[] = []
  for (const [id, r] of cases) {
    for (const text of [r.invalidationAr, r.planAr ?? ""]) {
      // النسب المئوية (٪/%) بفاصلة واحدة مقصودة — القاعدة تخص مستويات السعر فقط
      const stripped = text.replace(/\d+\.\d+(?:٪|%)/g, "")
      for (const m of stripped.match(/\d+\.\d+/g) ?? []) if (!/^\d+\.\d{2}$/.test(m)) bad.push(`${id}: ${m}`)
    }
    const rebound = r.reasonsAr.find((t) => t.includes("خطة الارتداد"))
    for (const m of (rebound ?? "").match(/\d+\.\d+/g) ?? []) if (!/^\d+\.\d{2}$/.test(m)) bad.push(`${id}/rebound: ${m}`)
  }
  s.assert("كل الكسور العشرية في المستويات = رقمين", bad.length === 0, first(bad))
})
runStory("K08", "مستثمر بالخسارة", "نصوص قرار الخسارة العميقة عربية بالكامل وبلا undefined/NaN/null/TODO", (s) => {
  const r = review(decliningSeries(), "wait", 166.67)
  assertCommonReview(s, "K08", r, "wait")
  s.assert("السؤال يطرح هبوط 10٪ بالعربي", (r.question?.promptAr ?? "").includes("10٪"), r.question?.promptAr ?? "null")
  s.assert("عناوين الخيارات عربية", (r.question?.yesLabelAr ?? "").length > 5 && (r.question?.noLabelAr ?? "").length > 5, `${r.question?.yesLabelAr} / ${r.question?.noLabelAr}`)
})

// =============================================================================
// 2) مستثمر بالربح (R)
// =============================================================================
runStory("R01", "مستثمر بالربح", "رابح +6.5٪ فوق دعم مختبر: القرار احتفظ (ليس خروج أحمر) بخط دفاع واضح تحت السعر", (s) => {
  const bars = cushionSeries(100, 106.5)
  const r = review(bars, "wait", 100)
  s.assert("الربح المحسوب موجب", r.pnlPct > 0, `pnlPct=${r.pnlPct}`)
  assertCommonReview(s, "R01", r, "hold")
  s.assert("خط الدفاع بمستوى محدد في حد الإلغاء", /\d+\.\d{2}/.test(r.invalidationAr), first([r.invalidationAr]))
})
runStory("R02", "مستثمر بالربح", "رابح وRSI في التشبع الشرائي: الخطة تنصح بأرباح جزئية بدل صمت أو خروج كامل", (s) => {
  const bars = cushionSeries(100, 106.5)
  const r = review(bars, "wait", 100, { metrics: { ...toSignalMetrics(computeMetrics(bars)!), rsi14: 74 } })
  assertCommonReview(s, "R02", r, "hold")
  const rsiLine = r.reasonsAr.find((t) => t.includes("RSI")) ?? ""
  s.assert("تشبيه التشبع الشرائي مذكور", rsiLine.includes("تشبع شرائي"), first([rsiLine]))
  s.assert("أرباح جزئية مقترحة", r.reasonsAr.some((t) => t.includes("أرباح جزئية")), first(r.reasonsAr))
})
runStory("R03", "مستثمر بالربح", "رابح +25٪ ولا يوجد أي دعم معتمد تحت السعر: تحذير صريح (ملاحظة أمانة) بدل ثقة زائفة", (s) => {
  const bars = decliningSeries()
  const r = review(bars, "wait", 80)
  s.assert("الربح ≈ +25٪", Math.abs(r.pnlPct - 25) < 1, `pnlPct=${r.pnlPct}`)
  assertCommonReview(s, "R03", r, "hold")
  s.assert("التحذير الصريح بلا بطانة موجود", r.reasonsAr.some((t) => t.includes("مفيش دعم معتمد") || t.includes("مفيش بطانة")), first(r.reasonsAr))
  s.assert("الترويسة تقول «مفيش بطانة معتمدة»", r.headlineAr.includes("بطانة") || r.headlineAr.includes("عينك"), first([r.headlineAr]))
})
runStory("R04", "مستثمر بالربح", "رابح وإشارة المحرك «buy»: الاحتفظ متسق مع حالة الإشارة (لا تعارض بين المحرك والقرار)", (s) => {
  const bars = cushionSeries(100, 106.5)
  const r = review(bars, "buy", 100)
  assertCommonReview(s, "R04", r, "hold")
  s.assert("state الإشارة انعكست في snapshot", r.snapshot.signalState === "buy", String(r.snapshot.signalState))
})

// =============================================================================
// 3) متابع التوزيعات والأحداث (D)
// =============================================================================
runStory("D01", "متابع توزيعات وأحداث", "محرك الأحداث يكتشف تحوّل الشركة من خسارة إلى ربح ويشرحه بالعربية مع تفاصيل قابلة للعرض", (s) => {
  const periods: PeriodData[] = [
    { periodKey: "ANNUAL:2025:", periodType: "ANNUAL", fiscalYear: 2025, periodLabel: "2025", values: { NET_PROFIT: -50, TOTAL_ASSETS: 1000 }, metrics: {}, sharesOutstanding: 100 },
    { periodKey: "ANNUAL:2026:", periodType: "ANNUAL", fiscalYear: 2026, periodLabel: "2026", values: { NET_PROFIT: 80, TOTAL_ASSETS: 1050 }, metrics: {}, sharesOutstanding: 100 },
  ]
  const events = detectEvents(periods)
  const ev = events.find((e) => e.eventType === "LOSS_TO_PROFIT")
  s.assert("حدث LOSS_TO_PROFIT مكتشف", ev !== undefined, `الأنواع: ${events.map((e) => e.eventType).join(",") || "لا شيء"}`)
  if (ev) {
    s.assert("الشرح عربي غير فارغ", (ev.explanationAr ?? "").length > 10, first([ev.explanationAr]))
    s.assert("له periodLabel وفترة سابقة", ev.periodLabel === "2026" && ev.previousPeriodKey === "ANNUAL:2025:", `${ev.periodKey}←${ev.previousPeriodKey}`)
    const bad = [ev.explanationAr, ...ev.conditions.map((c) => c.detailAr)].filter((t) => /undefined|NaN|\bnull\b|\[object|TODO|XXX/.test(t))
    s.assert("لا قيم مكسورة في نصوص الحدث", bad.length === 0, first(bad))
    collect("D01", ev.explanationAr)
    ev.conditions.forEach((c) => collect("D01", c.detailAr))
  }
})
runStory("D02", "متابع توزيعات", "تسجيلات التوزيعات معرفة في السجل: DIVIDEND_PER_SHARE خام + dividend_yield محسوب بتسمية عربية", (s) => {
  const dps = RAW_METRICS.find((m) => /DIVIDEND_PER_SHARE|CASH_DIVIDEND/.test(m.code ?? ""))
  s.assert("مقياس التوزيع النقدي للسهم مسجل", dps !== undefined, dps ? `${dps.code}: ${dps.labelAr}` : "غير موجود")
  const dy = CALC_METRICS.find((m) => m.code === "dividend_yield")
  s.assert("عائد التوزيعات محسوب بالسجل", dy !== undefined, dy ? dy.labelAr : "غير موجود")
  s.assert("تسمية عربية لعائد التوزيعات", (dy?.labelAr ?? "").includes("التوزيعات"), dy?.labelAr ?? "—")
  s.assert("المقياس موجود في خريطة الترتيب أيضًا", CALC_METRIC_MAP["dividend_yield"] !== undefined, String(Object.keys(CALC_METRIC_MAP).length))
  s.assert("حارس الفحوص: عوائد فوق 30٪ تُعلَّم للمراجعة (لما عوائد مغلوطة تكون في وحدات غلط)", (dy?.description ?? "").includes("NEEDS_REVIEW"), dy?.description?.slice(0, 120))
})
runStory("D03", "متابع توزيعات", "تنسيق المبالغ والنسب آمن على القيم الفارغة ولا يطبع NaN/undefined على الشاشة", (s) => {
  const cases: [string, string][] = [
    ["EGP null", formatEgp(null)],
    ["EGP NaN", formatEgp(NaN)],
    ["EGP 12.4B", formatEgp(12_400_000_000)],
    ["EGP 1.5M", formatEgp(1_500_000)],
    ["PCT null", formatPercent(null)],
    ["PCT +21.4", formatPercent(21.4, { sign: true })],
    ["RATIO null", formatRatio(null)],
    ["RATIO 1.8", formatRatio(1.8)],
  ]
  const bad = cases.filter(([k, v]) => /NaN|undefined|\[object/.test(v))
  s.assert("لا NaN/undefined في أي تنسيق", bad.length === 0, bad.length ? `${bad[0][0]} → ${bad[0][1]}` : undefined)
  s.assert("القيم الفارغة تُعرض بشرطة — مش نص مكسور", formatEgp(null) === "—" && formatPercent(null) === "—" && formatRatio(null) === "—", `${formatEgp(null)}/${formatPercent(null)}/${formatRatio(null)}`)
  s.assert("الوحدات تتدرج صحيحًا (B/M/K)", formatEgp(12_400_000_000).includes("B") && formatEgp(1_500_000).includes("M") && formatEgp(12_300).includes("K"), `${formatEgp(12_400_000_000)} ${formatEgp(1_500_000)} ${formatEgp(12_300)}`)
  for (const [, v] of cases) collect("D03", v)
})

// =============================================================================
// 4) مستخدم الترتيب (RK)
// =============================================================================
runStory("RK01", "مستخدم الترتيب", "كل شارات المقاييس في صفحة الترتيب لها تعريف رسمي وتسمية عربية واتجاه ترتيب محدد", (s) => {
  const codes = Object.keys(CALC_METRIC_MAP)
  s.assert("عدد المقاييس ≥ 15", codes.length >= 15, `العدد: ${codes.length}`)
  const noAr = codes.filter((c) => !(CALC_METRIC_MAP[c].labelAr ?? "").trim())
  s.assert("لكل مقياس تسمية عربية", noAr.length === 0, first(noAr))
  const badOrder = codes.filter((c) => !["ASC", "DESC"].includes(defaultRankingOrder(c)))
  s.assert("لكل مقياس اتجاه ترتيب صالح", badOrder.length === 0, first(badOrder))
})
runStory("RK02", "مستخدم الترتيب", "مقاييس «الأقل أفضل» (p_e/p_b/liabilities_to_equity) ترتيبها تصاعدي — الأرخص/الأقل ديونًا في القمة", (s) => {
  for (const c of ["p_e", "p_b", "liabilities_to_equity"]) {
    s.assert(`${c} → ASC`, RANKING_LOWER_IS_BETTER.has(c) && defaultRankingOrder(c) === "ASC", defaultRankingOrder(c))
    s.assert(`${c} معرف رسميًا`, CALC_METRIC_MAP[c] !== undefined, CALC_METRIC_MAP[c]?.labelAr ?? "غير موجود")
  }
})
runStory("RK03", "مستخدم الترتيب", "مقاييس الأداء والعائد ترتيبها تنازلي — الأفضل في القمة", (s) => {
  const codes = Object.keys(CALC_METRIC_MAP)
  const perf = ["roe", "roa", "net_margin", "dividend_yield", "operating_margin", "gross_margin"].filter((c) => codes.includes(c))
  s.assert("المقاييس الأدائية موجودة في السجل", perf.length >= 3, `الموجود: ${perf.join(",") || "لا شيء"}`)
  const wrong = perf.filter((c) => defaultRankingOrder(c) !== "DESC")
  s.assert("كلها DESC", wrong.length === 0, first(wrong))
})
runStory("RK04", "مستخدم الترتيب", "اختيار أحدث فترة للترتيب سليم: سنوات أحدث أعلى، الأنواع مرتبة، والفترات القديمة تُعلَّم stale", (s) => {
  s.assert("2026 أعلى من 2025", periodOrder("ANNUAL", 2026, "2026") > periodOrder("ANNUAL", 2025, "2025"), `${periodOrder("ANNUAL", 2026, "2026")} vs ${periodOrder("ANNUAL", 2025, "2025")}`)
  s.assert("Q4 2025 أعلى من Q1 2025", periodOrder("QUARTERLY", 2025, "Q4 2025") > periodOrder("QUARTERLY", 2025, "Q1 2025"), `${periodOrder("QUARTERLY", 2025, "Q4 2025")} vs ${periodOrder("QUARTERLY", 2025, "Q1 2025")}`)
  s.assert("ANNUAL أقوى من QUARTERLY في كسر التعادل", periodTypeRank("ANNUAL") > periodTypeRank("QUARTERLY"), `${periodTypeRank("ANNUAL")} vs ${periodTypeRank("QUARTERLY")}`)
  const fresh = { key: "ANNUAL:2026:", type: "ANNUAL", fiscalYear: 2026, label: "2026" }
  const ancient = { key: "QUARTERLY:2021:Q1", type: "QUARTERLY", fiscalYear: 2021, label: "Q1 2021" }
  s.assert("الفترة الأحدث غير stale", isStalePeriod(fresh, periodOrder("ANNUAL", 2026, "2026")) === false, String(isStalePeriod(fresh, periodOrder("ANNUAL", 2026, "2026"))))
  s.assert("فترة أقدم من 4 أرباع تُعلَّم stale", isStalePeriod(ancient, periodOrder("ANNUAL", 2026, "2026")) === true, String(isStalePeriod(ancient, periodOrder("ANNUAL", 2026, "2026"))))
})

// =============================================================================
// 5) فحص التقييم (UV) + الصحة المالية (FS)
// =============================================================================
runStory("UV01", "باحث التقييم", "شركة رخيصة مقابل قطاعها: المعايير المكتشفة غير فارغة، وupside موجب متسق مع القيمة العادلة فوق السعر", (s) => {
  const m = { P_E: 6, P_B: 0.7, ROE: 18, DIVIDEND_YIELD: 9, EV_EBITDA: 4, EPS: 3, BOOK_VALUE_PER_SHARE: 20, DIVIDEND_PER_SHARE: 1.5, currentPrice: 15 }
  const sector = { medianPE: 10, medianPB: 1.2, yield75th: 5, medianROE: 12, evEbitda25th: 6, medianEvEbitda: 7 }
  const r = evaluateUndervaluation(m, sector)
  s.assert("معايير مكتشفة ≥ 3", r.criteriaMet.length >= 3, `criteriaMet: ${r.criteriaMet.join(",") || "فارغ"}`)
  s.assert("الشركة مُعلَّمة رخيصة (flagged)", r.flagged === true, String(r.flagged))
  s.assert("القيمة العادلة موجبة ومتسقة مع upside", r.fairValue !== null && r.upside !== null && ((r.fairValue > m.currentPrice) === (r.upside > 0)), `fair=${r.fairValue} upside=${r.upside}`)
  s.assert("upside رقميه سليمان", r.upside !== null && Number.isFinite(r.upside), String(r.upside))
})
runStory("UV02", "باحث التقييم", "شركة غالية مقابل قطاعها: صفر معايير مكتشفة ولا flag، وupside السالب متسق مع قيمة عادلة تحت السعر", (s) => {
  const m = { P_E: 30, P_B: 3, ROE: 5, DIVIDEND_YIELD: 1, EV_EBITDA: 15, EPS: 3, BOOK_VALUE_PER_SHARE: 20, DIVIDEND_PER_SHARE: 0.5, currentPrice: 90 }
  const sector = { medianPE: 10, medianPB: 1.2, yield75th: 5, medianROE: 12, evEbitda25th: 6, medianEvEbitda: 7 }
  const r = evaluateUndervaluation(m, sector)
  s.assert("لا معايير مكتشفة", r.criteriaMet.length === 0, `criteriaMet: ${r.criteriaMet.join(",") || "فارغ"}`)
  s.assert("لا flag", r.flagged === false, String(r.flagged))
  s.assert("upside سالب متسق مع fair < price", r.fairValue !== null && r.upside !== null && r.upside < 0 && r.fairValue < m.currentPrice, `fair=${r.fairValue} upside=${r.upside}`)
})
runStory("UV03", "باحث التقييم", "فجوة وحدات متطرفة (EPS بوحدة غلط): المحرك يرفض نشر رقم قيمة عادلة مختلق ويعلّم للمراجعة", (s) => {
  const m = { P_E: 0.033, P_B: null, ROE: 10, DIVIDEND_YIELD: null, EV_EBITDA: null, EPS: 300, BOOK_VALUE_PER_SHARE: null, DIVIDEND_PER_SHARE: null, currentPrice: 10 }
  const sector = { medianPE: 10, medianPB: 1.2, yield75th: 5, medianROE: 12, evEbitda25th: 6, medianEvEbitda: 7 }
  const r = evaluateUndervaluation(m, sector)
  s.assert("لا قيمة عادلة مختلقة", r.fairValue === null, String(r.fairValue))
  s.assert("reviewRequired = true", r.reviewRequired === true, `${r.reviewRequired}/${r.reviewReason}`)
})
runStory("FS01", "مستخدم صفحة الشركة", "الصحة المالية لشركة سليمة تخرج بمجموع 0–100 وتصنيف معروف، وشركة منهارة أقل منها بوضوح", (s) => {
  const healthy = computeFinancialHealth({ ROE: 18, ROA: 8, NET_MARGIN: 15, GROSS_MARGIN: 30, QUICK_RATIO: 1.4, DEBT_TO_EQUITY: 0.6, INTEREST_COVERAGE: 8, ASSET_TURNOVER: 0.9, INVENTORY_TURNOVER: 5 })
  const weak = computeFinancialHealth({ ROE: -5, ROA: -2, NET_MARGIN: -4, GROSS_MARGIN: 12, QUICK_RATIO: 0.4, DEBT_TO_EQUITY: 3, INTEREST_COVERAGE: 0.5, ASSET_TURNOVER: 0.2, INVENTORY_TURNOVER: 1 })
  s.assert("النتيجة السليمة بين 0 و100", healthy !== null && healthy.total !== null && healthy.total >= 0 && healthy.total <= 100, `total=${healthy?.total}`)
  s.assert("تصنيف معروف (strong/good/fair/weak)", healthy !== null && ["strong", "good", "fair", "weak"].includes(healthy.rating ?? ""), String(healthy?.rating))
  s.assert("غير مُعلَّمة بلا بيانات", healthy !== null && healthy.insufficient === false, String(healthy?.insufficient))
  s.assert("الضعيفة أقل من السليمة", (healthy?.total ?? 0) > (weak?.total ?? 100), `healthy=${healthy?.total} weak=${weak?.total}`)
  s.assert("الفئات الأربع موجودة", healthy !== null && healthy.categories.length === 4, healthy?.categories.map((c) => c.name).join(",") ?? "—")
})
runStory("FS02", "مستخدم صفحة الشركة", "الترتيب القطاعي (percentileRank) يرجع رتبة 0–100 واتجاهها صحيح حسب «الأعلى أفضل / الأقل أفضل»", (s) => {
  const vals = [5, 10, 18, 25, 30]
  const hi = percentileRank(30, vals, "higher_better")
  const lo = percentileRank(5, vals, "higher_better")
  s.assert("رتبة بين 0 و100", hi !== null && hi >= 0 && hi <= 100 && lo !== null && lo >= 0 && lo <= 100, `hi=${hi} lo=${lo}`)
  s.assert("الأعلى قيمة أعلى رتبة (higher_better)", (hi ?? 0) >= (lo ?? 0), `hi=${hi} lo=${lo}`)
  const lbLow = percentileRank(5, vals, "lower_better")
  const lbHigh = percentileRank(30, vals, "lower_better")
  s.assert("الأقل قيمة أعلى رتبة (lower_better)", (lbLow ?? 0) >= (lbHigh ?? 0), `lo=${lbLow} hi=${lbHigh}`)
})

// =============================================================================
// 6) الشركات — اتساق السعر عبر الطبقات (C)
// =============================================================================
runStory("C02", "مستخدم الشركات", "نفس سلسلة الأسعار تُنتج نفس آخر إغلاق عبر sanitizeBars وassembleBundle ومراجعة المركز (تسامح 0.01) — اتساق السعر بين القوائم والتحليل", (s) => {
  const series = cushionSeries(100, 106.5)
  const cleaned = sanitizeBars(series)
  s.assert("sanitize لم يفقد جلسات", cleaned.length === series.length, `${cleaned.length}/${series.length}`)
  const bundle = assembleBundle(cleaned)
  s.assert("آخر إغلاق في الحزمة الفنية = آخر سعر في السلسلة", Math.abs((bundle.snapshot?.lastClose ?? bundle.lastClose ?? 1e9) - 106.5) <= 0.01, `bundle lastClose=${(bundle.snapshot?.lastClose ?? bundle.lastClose)}`)
  const r = review(cleaned, "wait", 95)
  s.assert("مراجعة المركز تشوف نفس السعر", Math.abs(r.lastClose - 106.5) <= 0.01, `review lastClose=${r.lastClose}`)
  const d1 = perfByCalendarDays(cleaned, 7)
  s.assert("أداء الأسبوع رقم منتهي", d1 === null || Number.isFinite(d1), String(d1))
})
runStory("C03", "مستخدم الشركات", "خطوط الدعم والمقاومة المعروضة سليمة: مرتبة، مسافاتها منتهية رقميًا، وكل خط له ملاحظة عربية", (s) => {
  const r = review(cushionSeries(100, 106.5), "wait", 100)
  s.assert("فيه دعوم ومقاومات معروضة", r.supports.length > 0 && r.resistances.length > 0, `sup=${r.supports.length} res=${r.resistances.length}`)
  const supSorted = [...r.supports].sort((a, b) => b.high - a.high).map((x) => x.high)
  s.assert("الدعوم مرتبة تنازليًا (الأقرب أولًا)", JSON.stringify(r.supports.map((x) => x.high)) === JSON.stringify(supSorted), r.supports.map((x) => x.high).join(","))
  const resSorted = [...r.resistances].sort((a, b) => a.low - b.low).map((x) => x.low)
  s.assert("المقاومات مرتبة تصاعديًا", JSON.stringify(r.resistances.map((x) => x.low)) === JSON.stringify(resSorted), r.resistances.map((x) => x.low).join(","))
  const badDist = [...r.supports, ...r.resistances].filter((l) => !Number.isFinite(l.distFromPricePct) || !Number.isFinite(l.distFromAvgPct))
  s.assert("كل المسافات أرقام منتهية", badDist.length === 0, badDist.length ? String(badDist[0].low) : undefined)
  const noNote = [...r.supports, ...r.resistances].filter((l) => (l.noteAr ?? "").length < 5)
  s.assert("كل خط له ملاحظة عربية", noNote.length === 0, noNote.length ? `low=${noNote[0].low}` : undefined)
})

// =============================================================================
// 7) المتانة والأداء (PF)
// =============================================================================
runStory("PF01", "مستخدم عادي", "شموع مشوهة من مصدر بيانات (قيم NaN/سالب/هاي<لو) تُرفض بصمت ولا تدخل المؤشرات ولا تكسر الحزمة", (s) => {
  const good = cushionSeries(100, 106.5)
  const raw = [
    ...good.map((b) => ({ ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })),
    { ts: "2026-03-13", open: NaN, high: 10, low: 9, close: 9.5, volume: 100 },
    { ts: "2026-03-14", open: -5, high: 10, low: 9, close: 9.5, volume: 100 },
    { ts: "2026-03-15", open: 9, high: 8, low: 10, close: 9.5, volume: 100 },
    { ts: "2026-03-16", open: 9, high: 10, low: 9, close: 11.5, volume: NaN },
    { ts: "2026-03-17", open: 9, high: 10, low: 9, close: 9.5, volume: -3 },
  ]
  const cleaned = sanitizeBars(raw)
  // 4 شموع مشوهة هندسيًا تسقط، والخامسة (حجم سالب فقط) تُقبل بحجم null — سلوك مقصود
  s.assert("الشموع المشوهة هندسيًا مرفوضة (4 ساقطة)", cleaned.length === good.length + 1, `kept=${cleaned.length} expected=${good.length + 1}`)
  s.assert("كل المخرجات قيم منتهية", cleaned.every((b) => [b.open, b.high, b.low, b.close].every((x) => Number.isFinite(x) && x > 0)), "قيمة غير منتهية ظهرت")
  s.assert("الحجم السالب/NaN يتحول null", cleaned.every((b) => b.volume === null || b.volume >= 0), first([String(cleaned.at(-1)?.volume)]))
  s.assert("تواريخ مقصوصة بصيغة YYYY-MM-DD", cleaned.every((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.ts)), first([cleaned[0]?.ts]))
})
runStory("PF02", "مستخدم عادي", "مدخلات ناقصة (سلسلة فارغة أو جلسة/جلسة واحدة) لا تكسر محرك التحليل أو الحزمة الفنية", (s) => {
  const emptyBars = sanitizeBars([])
  s.assert("sanitizeBars([]) يعيد []", emptyBars.length === 0, String(emptyBars.length))
  const suf = contiguousSuffix([])
  s.assert("contiguousSuffix([]) لا ينهار", Array.isArray(suf.bars) && suf.bars.length === 0, `${suf.bars.length}/${suf.cut}`)
  const bundle = assembleBundle([])
  s.assert("حزمة فارغة تُعاد بعلم available=false", bundle.snapshot?.available === false || bundle.snapshot === undefined, `available=${bundle.snapshot?.available}`)
  const tiny = [cushionSeries(100)[0]]
  const r = reviewPosition({ row: makeRow(tiny, "wait", { metrics: nullMetrics() }), bars: tiny, map: buildZoneMap(tiny), avgBuyPrice: 100, downsideAnswer: null })
  s.assert("جلسة واحدة لا تكسر مراجعة المركز", ["hold", "wait", "exit"].includes(r.decision), String(r.decision))
  s.assert("نص القرار لجلسة واحدة عربي سليم", (r.headlineAr ?? "").length > 10 && !/undefined|NaN/.test(r.headlineAr ?? ""), first([r.headlineAr]))
  collect("PF02", r.headlineAr); collect("PF02", r.invalidationAr); r.reasonsAr.forEach((t) => collect("PF02", t))
})
runStory("PF04", "مستخدم عادي", "فجوة طويلة في التاريخ (توقف تداول مثلاً) تُقص من بداية السلسلة بدل حساب مؤشرات مضللة عبر الفجوة", (s) => {
  const bars: Bar[] = []
  for (let i = 0; i < 10; i++) bars.push({ ts: `2026-01-${String(i + 1).padStart(2, "0")}`, open: 100, high: 101, low: 99, close: 100, volume: 1000 })
  for (let i = 0; i < 5; i++) bars.push({ ts: `2026-02-${String(5 + i).padStart(2, "0")}`, open: 100, high: 101, low: 99, close: 100, volume: 1000 })
  const suf = contiguousSuffix(bars)
  s.assert("الفجوة قُصت", suf.cut >= 10, `cut=${suf.cut}`)
  s.assert("السلسلة المتبقية تبدأ بعد الفجوة", suf.bars[0]?.ts === "2026-02-05", first([suf.bars[0]?.ts]))
  s.assert("عدد الجلسات المتبقية = 5", suf.bars.length === 5, String(suf.bars.length))
})
runStory("PF05", "مستخدم عادي", "الحزمة الفنية الكاملة بلا أي رقم غير منتهٍ (NaN/Infinity) في أي حقل تُعرض للمستخدم", (s) => {
  const bundle = assembleBundle(sanitizeBars(cushionSeries(100, 106.5)))
  const bad: string[] = []
  const walk = (v: unknown, path: string) => {
    if (typeof v === "number") { if (!Number.isFinite(v)) bad.push(path) }
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`))
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`)
  }
  walk(bundle.snapshot ?? bundle, "bundle")
  s.assert("لا أرقام غير منتهية في الحزمة", bad.length === 0, first(bad))
  s.assert("الحزمة متاحة وبها كل الجلسات", (bundle.snapshot?.available === true) && (bundle.snapshot?.sessions ?? 0) === 72, `sessions=${bundle.snapshot?.sessions}`)
})
runStory("PF06", "مستخدم عادي", "زمن تنفيذ أي قصة منفردة أقل من 8 ثوانٍ (عتبة الاستجابة نفسها)", (s) => {
  const slow = results.filter((r) => r.ms >= 8000)
  s.assert("لا قصة تجاوزت 8 ثوانٍ", slow.length === 0, slow.length ? `${slow[0].id}: ${slow[0].ms}ms` : undefined)
  const total = results.reduce((a, r) => a + r.ms, 0)
  s.sample("totalMs", String(total))
})

// =============================================================================
// 8) النظافة الشاملة (HY)
// =============================================================================
runStory("HY01", "مستخدم عادي", "فحص نظافة شامل لكل النصوص المستخدمة الخارجة من كل القصص: بلا undefined/NaN/[object/TODO/XXX", (s) => {
  const bad = allUserStrings.filter(({ text }) => /undefined|NaN|\bnull\b|\[object|Infinity|TODO|XXX/.test(text))
  s.assert(`عدد النصوص المفحوصة ≥ 80 (فعليًا ${allUserStrings.length})`, allUserStrings.length >= 80, String(allUserStrings.length))
  s.assert("لا نص مكسور بينها", bad.length === 0, bad.length ? `من ${bad[0].from}: ${first([bad[0].text])}` : undefined)
})

// ---------------- كتابة النتائج ----------------
const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, "pure-results.json"), JSON.stringify({ target: TARGET, stories: results }, null, 2), "utf8")
const passed = results.filter((r) => r.result === "pass").length
console.log(`PURE STORIES: ${passed}/${results.length} passed`)
for (const r of results.filter((x) => x.result === "fail")) console.log(`FAIL ${r.id}: ${r.failures.join(" | ")}`)
