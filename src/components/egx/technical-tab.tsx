"use client"

// Technical analysis tab — deterministic readings over real daily price bars.
// Everything shown is computed server-side (src/lib/technical/analyze.ts) from
// stored sessions; nothing is estimated. The stance hero is rule-based
// (documented weights) and — when the engine can form one — carries a
// rule-derived trade plan over OBSERVED levels. Order of the page: honest
// disclaimer → stance + plan → the story in brief → adjusted chart → price and
// performance → indicators → market context → zones → structure → signals →
// limitations → the raw-price TradingView embed (collapsed, for comparison).

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Boxes,
  ChevronDown,
  Gauge,
  Globe,
  Info,
  Layers,
  Minus,
  Network,
  ScrollText,
  ShieldAlert,
  SquareStack,
  Target,
  TrendingDown,
  TrendingUp,
  Waves,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/client/api"
import { useI18n } from "@/lib/i18n"
import { BRAND } from "@/lib/brand"
import { TradingViewChart } from "@/components/egx/tradingview"
import { AdjustedPriceChart, type ChartCandle } from "@/components/egx/adjusted-price-chart"
// Type-only imports from the deterministic lib layer — erased at build time,
// so no server code ever reaches the client bundle.
import type { MarketContextSection } from "@/lib/technical/analyze"
import type { StructureSnapshot } from "@/lib/technical/structure"
import type { VsaSnapshot } from "@/lib/technical/vsa"
import type { ZonesSnapshot } from "@/lib/technical/zones"
import type { QualityScore } from "@/lib/technical/quality"
import { SIGNAL_META, STYLE_TAG_META, type TechStance } from "@/lib/technical/signals"

export interface TechSnapshot {
  version: string
  available: boolean
  asOf: string | null
  sessions: number
  firstSession: string | null
  lastClose: number | null
  currency: string
  sparse: boolean
  limitations: string[]
  perf: { d1: number | null; w1: number | null; m1: number | null; m3: number | null; m6: number | null; y1: number | null }
  /** EMA-first trend block (technical@4) — every reading is EMA-based;
   *  SMA values are no longer part of the payload. */
  trend: {
    ema20: number | null
    ema50: number | null
    ema200: number | null
    priceVsEma20: string | null
    priceVsEma50: string | null
    priceVsEma200: string | null
    ema20VsEma50: string | null
    ema50VsEma200: string | null
    alignment: string | null
    cross50200: string | null
    cross50200Age: number | null
  }
  momentum: {
    rsi14: number | null
    macd: { macd: number | null; signal: number | null; histogram: number | null }
    stochastic: { k: number | null; d: number | null }
  }
  volume: { obv: number | null; obvSlope20: number | null; volMa20: number | null; relVol: number | null }
  volatility: {
    atr14: number | null
    atrPct: number | null
    bollinger: { upper: number | null; middle: number | null; lower: number | null; widthPct: number | null; percentB: number | null }
    histVol20: number | null
  }
  levels: {
    supports: { price: number; touches: number; distPct: number }[]
    resistances: { price: number; touches: number; distPct: number }[]
  }
  /** Observed 60-session range: raw highs/lows of the last 60 stored sessions
   *  and where the last close sits inside that range (0 = low, 100 = high). */
  range60: { high: number | null; low: number | null; posPct: number | null; sessions: number }
  signals: { code: string; tone: "positive" | "negative" | "neutral"; severity?: "warning" | "info"; text: string; textAr: string }[]
  /** Corporate-action ex-dates the series was rebuilt across (bonus/split/
   *  cash/rights) — null/undefined when no adjustment applied. */
  adjustedActions?: number | null
  // --- Newer analysis sections (optional: older cached payloads omit them) ---
  /** Swing map + BOS/CHoCH events (src/lib/technical/structure.ts). */
  structure?: StructureSnapshot | null
  /** Removed from the engine (technical@4) — always null; typed for payload
   *  compatibility with older cached snapshots. The tab never renders it. */
  vsa?: VsaSnapshot | null
  /** Supply & demand zones (src/lib/technical/zones.ts). */
  zones?: ZonesSnapshot | null
  /** Market & sector context injected by the intelligence layer. */
  context?: MarketContextSection | null
  /** Removed from the engine (technical@4) — always null; typed for payload
   *  compatibility with older cached snapshots. The tab never renders it. */
  quality?: QualityScore | null
}

// ---------------------------------------------------------------------------
// Structural extension types — the server payload carries a rule-derived trade
// plan on the stance. Declared LOCALLY so this file compiles independently of
// the server integration; integration aligns the shapes.
// ---------------------------------------------------------------------------

/** Rule-derived trade plan attached to the stance by the server (structural). */
interface TradePlanFields {
  bias: "buy" | "sell"
  entryLow: number
  entryHigh: number
  entryPct: number
  stop: number
  stopPct: number
  targetLow: number
  targetHigh: number
  targetPct: number
  riskReward: number | string
  textAr: string
  textEn: string
  basisAr: string
}

type StanceWithPlan = TechStance & { tradePlan?: TradePlanFields | null }

/** The market board's close-only read for the same ticker (from the technical
 * route) — powers the sync strip that keeps the company tab and /signals
 * visibly telling the same story. */
interface BoardSignal {
  signal: "buy" | "hold" | "sell"
  score: number
  asOf: string | null
}

const PERF_LABELS: Array<{ key: keyof TechSnapshot["perf"]; ar: string; en: string }> = [
  { key: "d1", ar: "يوم", en: "1D" },
  { key: "w1", ar: "أسبوع", en: "1W" },
  { key: "m1", ar: "شهر", en: "1M" },
  { key: "m3", ar: "٣ أشهر", en: "3M" },
  { key: "m6", ar: "٦ أشهر", en: "6M" },
  { key: "y1", ar: "سنة", en: "1Y" },
]

function pctColor(v: number | null): string {
  if (v === null) return "text-muted-foreground"
  return v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-muted-foreground"
}

function pctStr(v: number | null): string {
  if (v === null) return "—"
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`
}

function fmtN(v: number | null, digits = 2): string {
  return v === null || !Number.isFinite(v) ? "—" : v.toFixed(digits)
}

/** Day change % from the last two DISTINCT sessions of the adjusted series. */
function sessionChangePct(candles: ChartCandle[]): number | null {
  if (candles.length < 2) return null
  const last = candles[candles.length - 1]
  let prev: ChartCandle | null = null
  for (let i = candles.length - 2; i >= 0; i--) {
    if (candles[i].t !== last.t) {
      prev = candles[i]
      break
    }
  }
  if (!prev || !(prev.c > 0)) return null
  return ((last.c - prev.c) / prev.c) * 100
}

/** Signed % chip with a direction icon — used for the recorded day change. */
function DayChangeChip({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground">—</span>
  const Icon = pct > 0 ? ArrowUpRight : pct < 0 ? ArrowDownRight : Minus
  const cls = pct > 0 ? "text-positive" : pct < 0 ? "text-negative" : "text-muted-foreground"
  return (
    <span className={`inline-flex items-center gap-0.5 text-sm font-bold tabular ${cls}`} dir="ltr">
      <Icon className="h-4 w-4" aria-hidden />
      {pctStr(pct)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Disclaimer banner — always the FIRST element of the tab. Factual wording.
// ---------------------------------------------------------------------------

function DisclaimerBanner({ ar }: { ar: boolean }) {
  return (
    <div
      role="note"
      className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <p className="flex-1">
        {ar
          ? "التحليل الفني هنا لأغراض معلوماتية وتعليمية فقط — مش توصية بشراء أو بيع أي سهم. الأرقام محسوبة على أسعار معدّلة لإجراءات الشركات، والقرار النهائي قرارك وحدك."
          : "The technical analysis here is for informational and educational purposes only — it is not a recommendation to buy or sell any stock. Figures are computed on prices adjusted for corporate actions, and the final decision is yours alone."}
        {" "}
        <Link
          href="/disclaimer"
          className="mx-1 inline-flex items-center gap-0.5 whitespace-nowrap font-semibold underline underline-offset-4 transition-opacity hover:opacity-80"
        >
          {ar ? "اقرأ الإخلاء الكامل" : "Read the full disclaimer"}
          <ArrowUpRight className="h-3 w-3" aria-hidden />
        </Link>
        <span className="sr-only">{ar ? BRAND.notAdviceAr : BRAND.notAdviceEn}</span>
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Technical stance — the rule-based synthesis hero (score gauge / read /
// dimension bars / trade plan). The desk-note summary.
// ---------------------------------------------------------------------------

const STANCE_CLS: Record<string, { badge: string; bar: string; stroke: string; text: string }> = {
  buy: {
    badge: "border-positive/40 bg-positive/10 text-positive",
    bar: "bg-positive",
    stroke: "stroke-positive",
    text: "text-positive",
  },
  hold: {
    badge: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    bar: "bg-amber-500",
    stroke: "stroke-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
  sell: {
    badge: "border-negative/40 bg-negative/10 text-negative",
    bar: "bg-negative",
    stroke: "stroke-negative",
    text: "text-negative",
  },
}

const DIM_LABELS: Record<TechStance["dimensions"][number]["key"], { ar: string; en: string }> = {
  trend: { ar: "الاتجاه", en: "Trend" },
  momentum: { ar: "الزخم", en: "Momentum" },
  volume: { ar: "الحجم", en: "Volume" },
  risk: { ar: "المخاطرة", en: "Risk" },
}

/** Circular 0-100 score gauge. Null score → honest "weak data" disc. */
function ScoreGauge({ score, strokeCls, textCls }: { score: number | null; strokeCls: string; textCls: string }) {
  const { lang } = useI18n()
  const ar = lang === "ar"
  if (score === null || !Number.isFinite(score)) {
    return (
      <div className="flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-full border border-dashed border-border/60 px-2 text-center">
        <span className="text-[10px] leading-tight text-muted-foreground">{ar ? "بيانات غير كافية" : "Weak data"}</span>
      </div>
    )
  }
  const clamped = Math.min(100, Math.max(0, score))
  const R = 34
  const C = 2 * Math.PI * R
  return (
    <div className="relative h-24 w-24 shrink-0" role="img" aria-label={ar ? `الدرجة ${score} من 100` : `Score ${score} of 100`}>
      <svg viewBox="0 0 88 88" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="44" cy="44" r={R} fill="none" strokeWidth="8" className="stroke-muted" />
        <circle
          cx="44"
          cy="44"
          r={R}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          className={strokeCls}
          strokeDasharray={`${((clamped / 100) * C).toFixed(1)} ${C.toFixed(1)}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-bold leading-none tabular ${textCls}`} dir="ltr">
          {score}
        </span>
        <span className="mt-0.5 text-[10px] text-muted-foreground" dir="ltr">/100</span>
      </div>
    </div>
  )
}

/**
 * Rule-derived trade plan — three colored zones over OBSERVED levels.
 * Rendered only when the server attached a plan; every figure comes straight
 * from the payload and missing numbers render as "—", never as estimates.
 */
function TradePlanBlock({ plan, ar }: { plan: TradePlanFields; ar: boolean }) {
  const fmt = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : "—")
  const pctTxt = (v: number): string => (Number.isFinite(v) ? `(${v > 0 ? "+" : ""}${v.toFixed(2)}%)` : "(—)")
  const rr = plan.riskReward === null || plan.riskReward === undefined ? "—" : String(plan.riskReward)
  return (
    <div className="space-y-2.5 rounded-xl border border-border/60 bg-muted/10 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold">
          <Target className="h-3.5 w-3.5 text-primary" aria-hidden />
          {ar ? "خطة الصفقة القواعدية" : "Rule-based trade plan"}
        </span>
        <Badge variant="outline" className={plan.bias === "buy" ? STANCE_CLS.buy.badge : STANCE_CLS.sell.badge}>
          {ar ? SIGNAL_META[plan.bias].ar : SIGNAL_META[plan.bias].en}
        </Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {/* entry — blue */}
        <div className="rounded-lg border border-blue-500/40 bg-blue-500/5 px-3 py-2.5">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
            {plan.bias === "buy" ? <TrendingUp className="h-3 w-3" aria-hidden /> : <TrendingDown className="h-3 w-3" aria-hidden />}
            {ar ? "منطقة الدخول" : "Entry zone"}
          </p>
          <p className="mt-1 text-sm font-bold tabular" dir="ltr">
            {fmt(plan.entryLow)} – {fmt(plan.entryHigh)}
          </p>
        </div>
        {/* target — green */}
        <div className="rounded-lg border border-positive/40 bg-positive/5 px-3 py-2.5">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-positive">
            <Target className="h-3 w-3" aria-hidden />
            {ar ? "الهدف — منطقة الخروج" : "Target — exit zone"}
          </p>
          <p className="mt-1 text-sm font-bold tabular" dir="ltr">
            {fmt(plan.targetLow)} – {fmt(plan.targetHigh)}
          </p>
          <p className="tnum text-[10px] text-muted-foreground" dir="ltr">{pctTxt(plan.targetPct)}</p>
        </div>
        {/* stop — red */}
        <div className="rounded-lg border border-negative/40 bg-negative/5 px-3 py-2.5">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-negative">
            <ShieldAlert className="h-3 w-3" aria-hidden />
            {ar ? "وقف الخسارة" : "Stop loss"}
          </p>
          <p className="mt-1 text-sm font-bold tabular" dir="ltr">{fmt(plan.stop)}</p>
          <p className="tnum text-[10px] text-muted-foreground" dir="ltr">{pctTxt(plan.stopPct)}</p>
        </div>
      </div>

      <p className="text-xs">
        <span className="font-medium">{ar ? "المخاطرة/العائد: " : "Risk/reward: "}</span>
        <span className="tnum font-bold" dir="ltr">{rr}</span>
      </p>

      {plan.textAr || plan.textEn ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{ar ? plan.textAr : plan.textEn}</p>
      ) : null}

      {ar && plan.basisAr ? (
        <p className="text-[10px] leading-relaxed text-muted-foreground">{ar ? `الأساس: ${plan.basisAr}` : plan.basisAr}</p>
      ) : null}

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {ar
          ? "المناطق مبنية على مستويات مرصودة في السلسلة المعدّلة — وليست توصية."
          : "Zones derive from observed levels on the adjusted series — not advice."}
      </p>
    </div>
  )
}

function StanceCard({ stance, verdict, pos, neg, boardSignal, ar }: { stance: StanceWithPlan; verdict: string; pos: number; neg: number; boardSignal?: BoardSignal | null; ar: boolean }) {
  const cls = stance.signal ? STANCE_CLS[stance.signal] : null
  const plan = stance.tradePlan ?? null
  return (
    <Card className="p-0">
      <CardHeader className="px-5 pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <Gauge className="h-3.5 w-3.5 text-primary" aria-hidden />
            {ar ? "الخلاصة الفنية" : "Technical stance"}
          </span>
          {stance.signal && cls ? (
            <Badge variant="outline" className={cls.badge}>
              {ar ? SIGNAL_META[stance.signal].ar : SIGNAL_META[stance.signal].en}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-border/40 text-muted-foreground/70">{ar ? "بيانات غير كافية" : "Weak data"}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-5 pb-5">
        {/* score gauge + dimension bars */}
        <div className="flex flex-wrap items-center gap-5">
          <ScoreGauge score={stance.score} strokeCls={cls?.stroke ?? "stroke-primary"} textCls={cls?.text ?? ""} />
          {stance.score !== null ? (
            <div className="grid min-w-[220px] flex-1 gap-1.5">
              {stance.dimensions.map((d) => {
                const pct = d.max > 0 ? Math.round((d.earned / d.max) * 100) : 0
                return (
                  <div key={d.key} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-[11px] text-muted-foreground">{ar ? DIM_LABELS[d.key].ar : DIM_LABELS[d.key].en}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full rounded-full ${stance.signal && STANCE_CLS[stance.signal] ? STANCE_CLS[stance.signal].bar : "bg-primary"}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-14 shrink-0 text-end text-[10px] tabular text-muted-foreground" dir="ltr">{d.earned}/{d.max}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            stance.limitations[0] ? (
              <p className="min-w-[220px] flex-1 text-xs leading-relaxed text-muted-foreground">{stance.limitations[0]}</p>
            ) : null
          )}
        </div>

        {/* client-composed verdict sentence (counts of pre-flagged signals) */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          <p className="text-xs font-medium">{verdict}</p>
          <span className="text-[11px] text-muted-foreground">
            · {ar ? `${pos} إشارة إيجابية / ${neg} سلبية` : `${pos} positive / ${neg} negative signals`}
          </span>
        </div>

        {/* why this read — the top evidence lines the engine actually used,
            tone-colored; the detailed section stays honest about its inputs */}
        {stance.reasons.length > 0 ? (
          <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5">
            <p className="text-xs font-semibold">{ar ? "ليه القرار ده؟" : "Why this read?"}</p>
            {stance.reasons.map((r) => (
              <div key={r.code} className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${r.tone === "positive" ? "bg-positive" : r.tone === "negative" ? "bg-negative" : "bg-muted-foreground/60"}`}
                  aria-hidden
                />
                <span>{ar ? r.ar : r.en}</span>
              </div>
            ))}
          </div>
        ) : null}

        {/* sync strip — the market board and this tab must tell the same story;
            when their read differs, the reason is stated instead of hiding it. */}
        {boardSignal?.signal ? (
          boardSignal.signal === stance.signal ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-positive/25 bg-positive/5 px-3 py-1.5">
              <span className="text-[11px] font-medium text-positive">
                {ar
                  ? `متزامنة مع لوحة الإشارات الفنية: ${SIGNAL_META[boardSignal.signal].ar} (${boardSignal.score}/100) — نفس القراءة من زاويتين.`
                  : `In sync with the signals board: ${SIGNAL_META[boardSignal.signal].en} (${boardSignal.score}/100).`}
              </span>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-1.5">
              <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                {ar
                  ? `لوحة الإشارات الفنية (اللي بتحسب على الإغلاقات اليومية بس) بتقرا هنا: ${SIGNAL_META[boardSignal.signal].ar} (${boardSignal.score}/100). القراءة التفصيلية دي أشمل لأنها بتشوف الستوكاستيك و ATR والهيكل كمان — اختلاف الزاوية طبيعي والكلمة الأساسية هي أقرب قراءة للبيانات الكاملة.`
                  : `The signals board (close-only math) reads: ${SIGNAL_META[boardSignal.signal].en} (${boardSignal.score}/100). This detailed read is broader — Stochastic, ATR and structure — so a different angle is expected.`}
              </p>
            </div>
          )
        ) : null}

        {/* trade plan — prominent when the engine can form one */}
        {plan ? (
          <TradePlanBlock plan={plan} ar={ar} />
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {ar ? "مفيش منطقة دخول واضحة دلوقتي — القراءة استنتاجية والانتظار أفضل." : "No clear entry zone right now — the read is inconclusive and waiting is better."}
          </p>
        )}

        {stance.styleFits.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">{ar ? "مناسب لأنماط:" : "Fits styles:"}</span>
            {stance.styleFits.map((f) => (
              <Badge key={f.tag} variant="secondary" className="text-[10px]">
                {ar ? STYLE_TAG_META[f.tag].ar : STYLE_TAG_META[f.tag].en}
                <span className="ms-1 tabular opacity-70">{f.earned}/{f.total}</span>
              </Badge>
            ))}
          </div>
        ) : null}

        {stance.limitations.length > 0 && stance.score !== null ? (
          <p className="text-[10px] leading-relaxed text-muted-foreground">{ar ? "حدود: " : "Limits: "}{stance.limitations.join(" · ")}</p>
        ) : null}

        <p className="text-[10px] text-muted-foreground">
          {ar
            ? "قراءة قواعدية حتمية بأوزان معلنة (اتجاه 35 / زخم 30 / حجم 20 / مخاطرة 15) من الأسعار المسجلة — ليست توصية استثمارية ولا سعرًا مستهدفًا."
            : "A deterministic rule-based read with disclosed weights (trend 35 / momentum 30 / volume 20 / risk 15) over recorded prices — not investment advice and not a price target."}
        </p>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// "القصة في سطور" — client-composed story bullets (null-safe; a bullet simply
// does not render when its input is missing). No number is invented here.
// ---------------------------------------------------------------------------

type StoryTone = "positive" | "negative" | "amber" | "neutral" | "primary"

const STORY_DOT: Record<StoryTone, string> = {
  positive: "bg-positive",
  negative: "bg-negative",
  amber: "bg-amber-500",
  neutral: "bg-muted-foreground",
  primary: "bg-primary",
}

function StoryList({ snap, stance, ar }: { snap: TechSnapshot; stance: StanceWithPlan | undefined; ar: boolean }) {
  const bullets: { tone: StoryTone; text: string }[] = []

  // 1) the first stance reason — the line that moved the score
  const reason0 = stance?.reasons?.[0]
  if (reason0) {
    bullets.push({
      tone: reason0.tone === "positive" ? "positive" : reason0.tone === "negative" ? "negative" : "neutral",
      text: ar ? reason0.ar : reason0.en,
    })
  }

  // 2) short/medium structure sentence
  const st = snap.structure
  if (st?.available) {
    const label = (s: "uptrend" | "downtrend" | "range" | null): string =>
      s === "uptrend" ? (ar ? "صاعد" : "uptrend")
        : s === "downtrend" ? (ar ? "هابط" : "downtrend")
          : s === "range" ? (ar ? "عرضي" : "ranging")
            : (ar ? "غير محدد" : "unclear")
    if (st.trend.short !== null || st.trend.medium !== null) {
      const short = label(st.trend.short)
      const medium = label(st.trend.medium)
      bullets.push({
        tone: st.trend.short === "uptrend" ? "positive" : st.trend.short === "downtrend" ? "negative" : "neutral",
        text: ar ? `الهيكل قصير المدى ${short} والمتوسط ${medium}.` : `Short-term structure is ${short} and the medium term is ${medium}.`,
      })
    }
  }

  // 3) + 4) nearest demand / supply zones (nearest by distance from last close)
  const zones = snap.zones?.available ? (snap.zones.zones ?? []) : []
  const nearest = (kind: "demand" | "supply") =>
    zones
      .filter((z) => z.kind === kind)
      .sort((a, b) => Math.abs(a.distPct) - Math.abs(b.distPct))[0] ?? null
  const demand = nearest("demand")
  const supply = nearest("supply")
  if (demand) {
    bullets.push({
      tone: "positive",
      text: ar
        ? `أقرب منطقة طلب عند ${demand.low.toFixed(2)}–${demand.high.toFixed(2)} (${pctStr(demand.distPct)}).`
        : `Nearest demand zone at ${demand.low.toFixed(2)}–${demand.high.toFixed(2)} (${pctStr(demand.distPct)}).`,
    })
  }
  if (supply) {
    bullets.push({
      tone: "negative",
      text: ar
        ? `أقرب منطقة عرض عند ${supply.low.toFixed(2)}–${supply.high.toFixed(2)} (${pctStr(supply.distPct)}).`
        : `Nearest supply zone at ${supply.low.toFixed(2)}–${supply.high.toFixed(2)} (${pctStr(supply.distPct)}).`,
    })
  }

  // 5) RSI sentence
  const rsi = snap.momentum.rsi14
  if (rsi !== null && Number.isFinite(rsi)) {
    const zone = rsi >= 70 ? (ar ? "تشبع شرائي" : "overbought") : rsi <= 30 ? (ar ? "تشبع بيعي" : "oversold") : (ar ? "منطقة محايدة" : "neutral")
    bullets.push({
      tone: rsi >= 70 ? "amber" : rsi <= 30 ? "amber" : "neutral",
      text: ar
        ? `مؤشر القوة النسبية ${rsi.toFixed(1)} — ${zone}.`
        : `RSI(14) at ${rsi.toFixed(1)} — ${zone}.`,
    })
  }

  // 6) 60-session range position — skipped: the full-snapshot stance carries no
  //    rangePos60 metric, and the tab never invents one.

  if (bullets.length === 0) return null
  return (
    <Card className="p-0">
      <CardHeader className="px-5 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ScrollText className="h-3.5 w-3.5 text-primary" aria-hidden />
          {ar ? "القصة في سطور" : "The story in brief"}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <ol className="space-y-1.5">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${STORY_DOT[b.tone]}`} aria-hidden />
              <span className="flex-1">{b.text}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[10px] text-muted-foreground">
          {ar ? "قراءة تجميعية من الأقسام التفصيلية في هذه الصفحة." : "A composed summary of the detailed sections on this page."}
        </p>
      </CardContent>
    </Card>
  )
}

function AlignmentChip({ value, ar }: { value: string | null; ar: boolean }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>
  const up = value.includes("up")
  const down = value.includes("down")
  const label = ar
    ? up
      ? "اتجاه صاعد مرصوف"
      : down
        ? "اتجاه هابط مرصوف"
        : "بلا اتجاه واضح"
    : up
      ? "Aligned uptrend"
      : down
        ? "Aligned downtrend"
        : "Mixed / no alignment"
  return (
    <Badge variant="outline" className={up ? "border-positive/40 text-positive" : down ? "border-negative/40 text-negative" : ""}>
      {label}
    </Badge>
  )
}

/** RSI horizontal gauge with 30/70 zones marked. */
function RsiGauge({ rsi }: { rsi: number | null }) {
  const { lang } = useI18n()
  const ar = lang === "ar"
  if (rsi === null) return <p className="text-xs text-muted-foreground">—</p>
  const clamped = Math.min(100, Math.max(0, rsi))
  const zone =
    rsi >= 70 ? (ar ? "تشبع شرائي" : "Overbought") : rsi <= 30 ? (ar ? "تشبع بيعي" : "Oversold") : ar ? "منطقة محايدة" : "Neutral zone"
  return (
    <div className="space-y-1.5">
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-gradient-to-r from-negative/60 via-muted to-positive/60">
        <div
          className="absolute top-1/2 h-4 w-1.5 -translate-y-1/2 rounded-full bg-foreground shadow"
          style={{ insetInlineStart: `calc(${clamped}% - 3px)` }}
          aria-hidden
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground" dir="ltr">
        <span>0</span>
        <span>30</span>
        <span>70</span>
        <span>100</span>
      </div>
      <p className="text-xs font-medium">
        RSI(14): <span className="tabular">{rsi.toFixed(1)}</span>{" "}
        <span className="text-muted-foreground">· {zone}</span>
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Market & sector context strip — injected by the market-intelligence layer.
// Rendered only when the section is actually available; absent → nothing.
// Breadth chips use the EMA fields injected by the intelligence enrichment
// (aboveEma20/50/200). When enrichment has not run yet, the chips simply do
// not render — SMA data is never relabelled as EMA.
// ---------------------------------------------------------------------------

function MarketContextStrip({ ctx, ar }: { ctx: MarketContextSection; ar: boolean }) {
  const b = ctx.breadth
  const sector = ctx.sector
  const ema20 = ctx.aboveEma20
  const ema50 = ctx.aboveEma50
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/60 bg-muted/10 px-4 py-3">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Globe className="h-3.5 w-3.5 text-primary" aria-hidden />
        {ar ? "سياق السوق والقطاع" : "Market & sector context"}
      </span>
      {ctx.marketRegime !== null || ctx.marketRegimeAr !== null ? (
        <Badge variant="outline" className="border-primary/40 bg-primary/5 text-primary">
          {ar ? (ctx.marketRegimeAr ?? ctx.marketRegime) : (ctx.marketRegime ?? ctx.marketRegimeAr)}
        </Badge>
      ) : null}
      {ctx.marketPulse !== null ? (
        <span className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{ar ? "نبض السوق" : "Pulse"}</span>
          <span className="relative inline-block h-1.5 w-16 overflow-hidden rounded-full bg-muted align-middle">
            <span
              className="absolute inset-y-0 start-0 rounded-full bg-primary"
              style={{ width: `${Math.min(100, Math.max(0, ctx.marketPulse))}%` }}
            />
          </span>
          <span className="tnum font-bold" dir="ltr">{Math.round(ctx.marketPulse)}</span>
        </span>
      ) : null}
      {b ? (
        <span className="tnum text-xs" dir="ltr">
          <span className="font-bold text-positive">{b.advancing}</span>
          <span className="text-muted-foreground"> / </span>
          <span className="font-bold text-negative">{b.declining}</span>
          {b.unchanged > 0 ? <span className="text-muted-foreground"> / {b.unchanged}</span> : null}
        </span>
      ) : null}
      {ema20 !== null ? (
        <span className="text-[11px] text-muted-foreground">
          {ar ? "فوق EMA20" : "above EMA20"} <span className="tnum" dir="ltr">{ema20.toFixed(0)}%</span>
        </span>
      ) : null}
      {ema50 !== null ? (
        <span className="text-[11px] text-muted-foreground">
          {ar ? "فوق EMA50" : "above EMA50"} <span className="tnum" dir="ltr">{ema50.toFixed(0)}%</span>
        </span>
      ) : null}
      {sector ? (
        <span className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium">{sector.name ?? (ar ? "القطاع" : "Sector")}</span>
          <span className={`tnum font-bold ${pctColor(sector.dayChangePct)}`} dir="ltr">{pctStr(sector.dayChangePct)}</span>
          {sector.turnoverSharePct !== null ? (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {ar ? "حصة من القيمة المتداولة" : "traded-value share"}
              <span className="tnum" dir="ltr">{sector.turnoverSharePct.toFixed(1)}%</span>
              {sector.turnoverShareDelta5d !== null ? (
                <>
                  <span>({ar ? "5ج" : "5d"}</span>
                  <span className={`tnum ${pctColor(sector.turnoverShareDelta5d)}`} dir="ltr">
                    {sector.turnoverShareDelta5d > 0 ? "+" : ""}{sector.turnoverShareDelta5d.toFixed(1)}
                  </span>
                  <span>)</span>
                </>
              ) : null}
            </span>
          ) : null}
        </span>
      ) : null}
      {ctx.relVolRankPct !== null ? (
        <span className="text-[11px] text-muted-foreground">
          {ar
            ? `أعلى من ${ctx.relVolRankPct}% من السوق في الحجم النسبي`
            : `above ${ctx.relVolRankPct}% of the market on relative volume`}
        </span>
      ) : null}
      {ctx.asOf ? (
        <span className="tnum ms-auto text-[10px] text-muted-foreground" dir="ltr">{ctx.asOf}</span>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Market structure — multi-timeframe chips, BOS/CHoCH events, key levels.
// ---------------------------------------------------------------------------

const TREND_CHIP_META: Record<"uptrend" | "downtrend" | "range", { ar: string; en: string; cls: string }> = {
  uptrend: { ar: "صاعد", en: "Uptrend", cls: "border-positive/40 bg-positive/10 text-positive" },
  downtrend: { ar: "هابط", en: "Downtrend", cls: "border-negative/40 bg-negative/10 text-negative" },
  range: { ar: "عرضي", en: "Range", cls: "border-border/60 bg-muted/30 text-muted-foreground" },
}

function TrendStateChip({ state, ar }: { state: "uptrend" | "downtrend" | "range" | null; ar: boolean }) {
  if (!state) {
    return <Badge variant="outline" className="border-border/40 text-muted-foreground/70">{ar ? "غير متاح" : "n/a"}</Badge>
  }
  const meta = TREND_CHIP_META[state]
  return <Badge variant="outline" className={meta.cls}>{ar ? meta.ar : meta.en}</Badge>
}

const KEY_LEVEL_ROLE_AR: Record<string, string> = {
  "highest recent high": "أعلى قمة حديثة",
  "recent lower high": "قمة أدنى حديثة",
  "recent higher low": "قاع أعلى حديث",
  "recent lower low": "قاع أدنى حديث",
  "swing level": "قمة أو قاع محوري",
}

function StructureSection({ structure, ar }: { structure: StructureSnapshot | null | undefined; ar: boolean }) {
  if (!structure) return null
  return (
    <Card className="p-0">
      <CardHeader className="px-5 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Network className="h-3.5 w-3.5 text-primary" aria-hidden />
          {ar ? "هيكل السوق" : "Market structure"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-5 pb-5">
        {!structure.available ? (
          <p className="text-xs text-muted-foreground">
            {structure.reason ?? (ar ? "تحليل الهيكل غير متاح لهذه البيانات." : "Structure analysis unavailable for this data.")}
          </p>
        ) : (
          <>
            {/* Multi-timeframe trend chips + consistency note */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {(
                [
                  ["short", "قصير", "Short"],
                  ["medium", "متوسط", "Medium"],
                  ["long", "طويل", "Long"],
                ] as const
              ).map(([key, arLabel, enLabel]) => (
                <span key={key} className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">{ar ? arLabel : enLabel}</span>
                  <TrendStateChip state={structure.trend[key]} ar={ar} />
                </span>
              ))}
              {structure.trend.consistency ? (
                <span className="text-[11px] text-muted-foreground">
                  {structure.trend.consistency === "aligned_bullish"
                    ? ar ? "· الأطر الزمنية متسقة على الصعود" : "· timeframes align bullish"
                    : structure.trend.consistency === "aligned_bearish"
                      ? ar ? "· الأطر الزمنية متسقة على الهبوط" : "· timeframes align bearish"
                      : ar ? "· الأطر الزمنية متضاربة في الاتجاه" : "· timeframes disagree on direction"}
                </span>
              ) : null}
            </div>
            {!ar && structure.trend.basis ? (
              <p className="text-[10px] text-muted-foreground" dir="ltr">{structure.trend.basis}</p>
            ) : null}

            {/* Structural events (most recent first) */}
            {structure.events.length > 0 ? (
              <div className="space-y-1.5">
                {structure.events.map((e, i) => (
                  <div
                    key={`${e.code}-${e.brokenAt}-${i}`}
                    className={`flex flex-wrap items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                      e.invalidated
                        ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
                        : e.direction === "bullish"
                          ? "border-positive/30 bg-positive/5 text-positive"
                          : "border-negative/30 bg-negative/5 text-negative"
                    }`}
                  >
                    <Badge variant="outline" className="shrink-0 bg-background/50 font-bold">
                      {e.code === "CHOCH" ? "CHoCH" : "BOS"}
                    </Badge>
                    <span className="min-w-0 flex-1 font-medium text-foreground">{ar ? e.textAr : e.text}</span>
                    <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {e.volumeSupported !== null ? (
                        <span
                          className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
                            e.volumeSupported ? "border-positive/40 text-positive" : "border-amber-500/40 text-amber-600 dark:text-amber-400"
                          }`}
                        >
                          {e.volumeSupported
                            ? ar
                              ? `الحجم داعم${e.volumeRatio !== null ? ` ${e.volumeRatio.toFixed(1)}×` : ""}`
                              : `volume-backed${e.volumeRatio !== null ? ` ${e.volumeRatio.toFixed(1)}×` : ""}`
                            : ar
                              ? `حجم ضعيف${e.volumeRatio !== null ? ` ${e.volumeRatio.toFixed(1)}×` : ""}`
                              : `weak volume${e.volumeRatio !== null ? ` ${e.volumeRatio.toFixed(1)}×` : ""}`}
                        </span>
                      ) : null}
                      {e.invalidated ? (
                        <span className="flex items-center gap-1 text-[10px] font-semibold">
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          {ar
                            ? `أُبطل لاحقاً${e.invalidatedAt ? ` (${e.invalidatedAt})` : ""}`
                            : `invalidated later${e.invalidatedAt ? ` (${e.invalidatedAt})` : ""}`}
                        </span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {ar ? "لا أحداث هيكلية مؤهلة في النافذة المحفوظة." : "No qualifying structural events in the retained window."}
              </p>
            )}

            {/* Key structural levels mini-table */}
            {structure.keyLevels.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-border/50">
                <table className="w-full min-w-[320px] text-[11px]">
                  <thead>
                    <tr className="bg-muted/30 text-muted-foreground">
                      <th className="px-2.5 py-1.5 text-start font-medium">{ar ? "السعر" : "Price"}</th>
                      <th className="px-2.5 py-1.5 text-start font-medium">{ar ? "المسافة" : "Distance"}</th>
                      <th className="px-2.5 py-1.5 text-start font-medium">{ar ? "الدور" : "Role"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {structure.keyLevels.map((l, i) => (
                      <tr key={`${l.ts}-${l.price}-${i}`} className="border-t border-border/40">
                        <td className="px-2.5 py-1.5">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`inline-block h-2 w-2 shrink-0 rounded-full ${l.kind === "swing_high" ? "bg-negative" : "bg-positive"}`}
                              aria-hidden
                            />
                            <span className="tnum font-bold" dir="ltr">{l.price.toFixed(2)}</span>
                          </span>
                        </td>
                        <td className="tnum px-2.5 py-1.5 text-muted-foreground" dir="ltr">
                          {l.distPct > 0 ? "+" : ""}{l.distPct.toFixed(1)}%
                        </td>
                        <td className="px-2.5 py-1.5 text-muted-foreground">{ar ? (KEY_LEVEL_ROLE_AR[l.role] ?? l.role) : l.role}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {structure.limitations.length > 0 ? (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {ar ? "حدود: " : "Limitations: "}
                {structure.limitations.join(" · ")}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Supply & demand zones — kind-colored cards with a quality meter and an
// honest usage hint per zone kind.
// ---------------------------------------------------------------------------

function ZonesSection({ zones, ar }: { zones: ZonesSnapshot | null | undefined; ar: boolean }) {
  if (!zones) return null
  return (
    <Card className="p-0">
      <CardHeader className="px-5 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <SquareStack className="h-3.5 w-3.5 text-primary" aria-hidden />
          {ar ? "مناطق العرض والطلب" : "Supply & demand zones"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-5 pb-5">
        {!zones.available ? (
          zones.reason ? <p className="text-xs text-muted-foreground">{zones.reason}</p> : null
        ) : zones.zones.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {ar ? "لا توجد مناطق مؤهلة في النافذة المحفوظة." : "No qualified zones in the retained window."}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {zones.zones.map((z, i) => (
              <div
                key={`${z.kind}-${z.low}-${z.formedAt}-${i}`}
                className={`rounded-lg border p-3 text-xs ${z.kind === "demand" ? "border-positive/30 bg-positive/5" : "border-negative/30 bg-negative/5"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className={z.kind === "demand" ? "border-positive/40 text-positive" : "border-negative/40 text-negative"}>
                    {z.kind === "demand" ? (ar ? "طلب" : "Demand") : (ar ? "عرض" : "Supply")}
                  </Badge>
                  <span className="tnum text-[11px] text-muted-foreground" dir="ltr">
                    {z.distPct > 0 ? "+" : ""}{z.distPct.toFixed(1)}%
                  </span>
                </div>
                <p className="tnum mt-1.5 text-sm font-bold" dir="ltr">
                  {z.low.toFixed(2)} – {z.high.toFixed(2)}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="relative inline-block h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className={`absolute inset-y-0 start-0 rounded-full ${z.kind === "demand" ? "bg-positive" : "bg-negative"}`}
                      style={{ width: `${Math.min(100, Math.max(0, z.quality))}%` }}
                    />
                  </span>
                  <span className="tnum text-[10px] text-muted-foreground" dir="ltr">{Math.round(z.quality)}/100</span>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {ar ? "الجودة" : "Quality"} · <span className="tnum">{z.tests}×</span> {ar ? "اختبار" : "tests"}
                </p>
                <p className="mt-1 font-medium">
                  {z.kind === "demand"
                    ? <span className="text-positive">{ar ? "تناسب انتظار منطقة الدخول" : "A reasonable zone to wait for an entry"}</span>
                    : <span className="text-negative">{ar ? "منطقة أخذ أرباح محتملة" : "Potential profit-taking zone"}</span>}
                </p>
                <p className="mt-1.5 leading-relaxed">{ar ? z.textAr : z.text}</p>
              </div>
            ))}
          </div>
        )}
        {zones.available && zones.limitations.length > 0 ? (
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            {ar ? "حدود: " : "Limitations: "}
            {zones.limitations.join(" · ")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

export function TechnicalTab({ companyId, ticker }: { companyId: string; ticker?: string | null }) {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const { data, isLoading, isError } = useQuery({
    queryKey: ["company-technical", companyId],
    queryFn: () => api.companyTechnical(companyId),
    staleTime: 120_000,
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
        </div>
      </div>
    )
  }

  const snap = data?.snapshot
  // Adjusted daily candles from the same server pass that computes the
  // indicators — the chart and the numbers can never disagree.
  const candles = ((data?.candles ?? []) as ChartCandle[]).filter(
    (c) => c && typeof c.t === "string" && [c.o, c.h, c.l, c.c].every((v) => Number.isFinite(v) && v > 0),
  )
  if (isError || !snap) {
    return (
      <div className="space-y-4">
        <DisclaimerBanner ar={ar} />
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {ar ? "تعذر تحميل التحليل الفني الآن — أعد المحاولة." : "Technical analysis could not be loaded — try again."}
        </Card>
      </div>
    )
  }

  if (!snap.available || snap.lastClose === null) {
    return (
      <div className="space-y-4">
        <DisclaimerBanner ar={ar} />
        {ticker ? (
          <Card className="overflow-hidden p-0">
            <CardContent className="p-0">
              {/* TradingView is the single chart source (no platform price storage) */}
              <TradingViewChart ticker={ticker} height={420} />
            </CardContent>
          </Card>
        ) : null}
        <Card className="p-6 text-center">
          <BarChart3 className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {ar
              ? "لا يوجد تاريخ أسعار يومي مخزن لهذه الشركة بعد — المؤشرات المحسوبة تظهر تلقائياً عند توفر بيانات الجلسات. الشارت أعلاه من TradingView (عرض فقط)."
              : "No daily price history stored for this company yet — the calculated indicators appear automatically once sessions exist. The chart above is TradingView (display only)."}
          </p>
        </Card>
      </div>
    )
  }

  const pos = snap.signals.filter((s) => s.tone === "positive").length
  const neg = snap.signals.filter((s) => s.tone === "negative").length
  const verdict =
    pos - neg >= 2 ? (ar ? "الصورة الفنية تميل للإيجابي" : "Technical picture leans positive")
    : neg - pos >= 2 ? (ar ? "الصورة الفنية تميل للسلبي" : "Technical picture leans negative")
    : pos + neg > 0 ? (ar ? "إشارات متضاربة — السوق في انتظار حاسم" : "Mixed signals — the market is undecided")
    : ar ? "لا إشارات فنية بارزة الآن" : "No notable technical signals right now"

  // Day change from the last two DISTINCT sessions of the ADJUSTED series.
  const dayPct = sessionChangePct(candles)
  const stance = (data.stance ?? undefined) as StanceWithPlan | undefined
  const tr = snap.trend
  const emaRows = [
    { label: "EMA 20", v: tr.ema20 ?? null },
    { label: "EMA 50", v: tr.ema50 ?? null },
    { label: "EMA 200", v: tr.ema200 ?? null },
  ]

  return (
    <div className="space-y-4">
      {/* a. honest disclaimer — always first */}
      <DisclaimerBanner ar={ar} />

      {/* b. rule-based stance hero with the trade plan */}
      {stance ? <StanceCard stance={stance} verdict={verdict} pos={pos} neg={neg} boardSignal={(data as { boardSignal?: BoardSignal | null }).boardSignal ?? null} ar={ar} /> : null}

      {/* c. the story in brief */}
      <StoryList snap={snap} stance={stance} ar={ar} />

      {/* d. EGXANO's own chart over the corporate-action-ADJUSTED series with
          EMA20/EMA50 overlays — the same bars every number below is computed
          from, so a bonus/cash ex-date never reads as a market crash. */}
      {candles.length > 1 ? (
        <Card className="overflow-hidden p-0">
          <CardContent className="px-2 py-3 sm:px-3">
            <AdjustedPriceChart candles={candles} height={360} adjustedActions={snap.adjustedActions ?? null} />
          </CardContent>
        </Card>
      ) : null}

      {/* e. header + performance strip (day change from the adjusted series) */}
      <Card className="p-0">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {ar ? "آخر سعر مسجل" : "Last recorded price"}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                <p className="text-2xl font-bold tabular" dir="ltr">
                  {snap.lastClose.toFixed(2)}{" "}
                  <span className="text-sm font-medium text-muted-foreground">
                    {ar && snap.currency === "EGP" ? "جنيه" : snap.currency}
                  </span>
                </p>
                <span className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">{ar ? "التغير" : "Change"}</span>
                  <DayChangeChip pct={dayPct} />
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {ar ? `${snap.sessions} جلسة مسجلة · حتى ` : `${snap.sessions} sessions · as of `}
                <span dir="ltr">{snap.asOf ?? "—"}</span>
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                {ar
                  ? "التغير محسوب من آخر جلستين في السلسلة المعدّلة لإجراءات الشركات."
                  : "Day change computed from the last two sessions of the corporate-action-adjusted series."}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {PERF_LABELS.map((p) => {
                const v = snap.perf[p.key]
                return (
                  <div key={p.key} className="rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1.5 text-center">
                    <p className="text-[9px] text-muted-foreground">{ar ? p.ar : p.en}</p>
                    <p className={`text-xs font-bold tabular ${pctColor(v)}`} dir="ltr">
                      {pctStr(v)}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* f. indicators grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Trend — EMA rows; null → honest "insufficient data" */}
        <Card className="p-0">
          <CardHeader className="px-5 pb-2">
            <CardTitle className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <Layers className="h-3.5 w-3.5 text-primary" aria-hidden />
                {ar ? "الاتجاه والمتوسطات" : "Trend & moving averages"}
              </span>
              <AlignmentChip value={snap.trend.alignment} ar={ar} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-5 pb-5">
            {emaRows.map((row) => {
              const has = row.v !== null && Number.isFinite(row.v)
              const vsPct =
                has && snap.lastClose !== null && (row.v as number) > 0
                  ? ((snap.lastClose - (row.v as number)) / (row.v as number)) * 100
                  : null
              return (
                <div key={row.label} className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-xs">
                  <span className="font-medium">{row.label}</span>
                  {has ? (
                    <>
                      <span className="tabular" dir="ltr">{(row.v as number).toFixed(2)}</span>
                      {vsPct !== null ? (
                        <span className={`tabular ${pctColor(vsPct)}`} dir="ltr">{pctStr(vsPct)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">{ar ? "بيانات غير كافية" : "Insufficient data"}</span>
                  )}
                </div>
              )
            })}
            {snap.trend.cross50200 ? (
              <p className="text-[11px] text-muted-foreground">
                {ar ? "تقاطع 50/200: " : "50/200 cross: "}
                <span className={snap.trend.cross50200 === "golden" ? "font-semibold text-positive" : "font-semibold text-negative"}>
                  {snap.trend.cross50200 === "golden" ? (ar ? "ذهبي" : "golden") : (ar ? "سفلي" : "death")}
                </span>
                {snap.trend.cross50200Age !== null
                  ? ar ? ` قبل ${snap.trend.cross50200Age} جلسة.` : ` · ${snap.trend.cross50200Age} sessions ago.`
                  : ""}
              </p>
            ) : null}
            <p className="text-[10px] text-muted-foreground">
              {ar ? "النسبة = آخر إغلاق مسجل مقابل المتوسط." : "Percentage = last recorded close versus the average."}
            </p>
          </CardContent>
        </Card>

        {/* Momentum */}
        <Card className="p-0">
          <CardHeader className="px-5 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Gauge className="h-3.5 w-3.5 text-primary" aria-hidden />
              {ar ? "الزخم" : "Momentum"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-5 pb-5">
            <RsiGauge rsi={snap.momentum.rsi14} />
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-muted/30 px-2 py-1.5">
                <p className="text-[9px] text-muted-foreground">MACD</p>
                <p className="tabular font-semibold" dir="ltr">{fmtN(snap.momentum.macd.macd)}</p>
              </div>
              <div className="rounded-lg bg-muted/30 px-2 py-1.5">
                <p className="text-[9px] text-muted-foreground">{ar ? "الإشارة" : "Signal"}</p>
                <p className="tabular font-semibold" dir="ltr">{fmtN(snap.momentum.macd.signal)}</p>
              </div>
              <div className="rounded-lg bg-muted/30 px-2 py-1.5">
                <p className="text-[9px] text-muted-foreground">{ar ? "الهيستوجرام" : "Histogram"}</p>
                <p className={`tabular font-semibold ${pctColor(snap.momentum.macd.histogram)}`} dir="ltr">
                  {fmtN(snap.momentum.macd.histogram)}
                </p>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Stochastic %K/<span dir="ltr">%D</span>: <span className="tabular" dir="ltr">{fmtN(snap.momentum.stochastic.k)} / {fmtN(snap.momentum.stochastic.d)}</span>
            </p>
          </CardContent>
        </Card>

        {/* Support & resistance */}
        <Card className="p-0">
          <CardHeader className="px-5 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Boxes className="h-3.5 w-3.5 text-primary" aria-hidden />
              {ar ? "الدعم والمقاومة" : "Support & resistance"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-5 pb-5">
            {snap.levels.resistances.length === 0 && snap.levels.supports.length === 0 ? (
              <p className="text-xs text-muted-foreground">{ar ? "لا مستويات كافية لتحديدها." : "Not enough history to define zones."}</p>
            ) : null}
            {snap.levels.resistances.slice(0, 3).map((r) => (
              <div key={`r-${r.price}`} className="flex items-center justify-between rounded-lg border border-negative/25 bg-negative/5 px-3 py-2 text-xs">
                <span className="font-medium text-negative">{ar ? "مقاومة" : "Resistance"}</span>
                <span className="tabular font-bold" dir="ltr">{r.price.toFixed(2)}</span>
                <span className="text-[10px] text-muted-foreground">
                  {r.distPct > 0 ? "+" : ""}{r.distPct.toFixed(1)}% · {r.touches}×
                </span>
              </div>
            ))}
            {snap.levels.supports.slice(0, 3).map((s) => (
              <div key={`s-${s.price}`} className="flex items-center justify-between rounded-lg border border-positive/25 bg-positive/5 px-3 py-2 text-xs">
                <span className="font-medium text-positive">{ar ? "دعم" : "Support"}</span>
                <span className="tabular font-bold" dir="ltr">{s.price.toFixed(2)}</span>
                <span className="text-[10px] text-muted-foreground">
                  {s.distPct > 0 ? "+" : ""}{s.distPct.toFixed(1)}% · {s.touches}×
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* g. market & sector context (injected by the intelligence layer; absent → nothing) */}
      {snap.context?.available ? <MarketContextStrip ctx={snap.context} ar={ar} /> : null}

      {/* h. supply & demand zones */}
      <ZonesSection zones={snap.zones} ar={ar} />

      {/* i. market structure — swings, multi-timeframe chips, BOS/CHoCH, key levels */}
      <StructureSection structure={snap.structure} ar={ar} />

      {/* j. pre-flagged signals */}
      {snap.signals.length > 0 ? (
        <Card className="p-0">
          <CardHeader className="px-5 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Waves className="h-3.5 w-3.5 text-primary" aria-hidden />
              {ar ? "إشارات فنية مرصودة" : "Flagged technical signals"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 px-5 pb-5">
            {snap.signals.map((s) => (
              <div
                key={s.code}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                  s.tone === "positive"
                    ? "border-positive/30 bg-positive/5 text-positive"
                    : s.tone === "negative"
                      ? "border-negative/30 bg-negative/5 text-negative"
                      : "border-border/60 bg-muted/20 text-muted-foreground"
                }`}
              >
                {s.tone === "positive" ? (
                  <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                ) : s.tone === "negative" ? (
                  <ArrowDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                ) : (
                  <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
                <span>{ar ? s.textAr : s.text}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* k. data limitations + the one-line disclaimer */}
      {snap.limitations.length > 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {ar ? "حدود البيانات: " : "Data limitations: "}
          {snap.limitations.join(" · ")}
        </p>
      ) : null}
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {ar
          ? "التحليل الفني هنا قواعدي حتمي من أسعار معدّلة لإجراءات الشركات — لأغراض معلوماتية وتعليمية فقط وليس توصية استثمارية."
          : "The technical read here is deterministic and rule-based over corporate-action-adjusted prices — informational and educational only, not investment advice."}
      </p>

      {/* l. TradingView embed — collapsed by default, for comparison only.
          TradingView draws the RAW series, so on a company with recent
          corporate actions its chart shows the mechanical ex-date drop; the
          note makes the difference explicit instead of silently contradicting
          the adjusted numbers. */}
      {ticker ? (
        <details className="group overflow-hidden rounded-xl border border-border/60 bg-card">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5 text-primary" aria-hidden />
              {ar ? "شارت TradingView — للمقارنة (أسعار خام)" : "TradingView chart — for comparison (raw prices)"}
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="border-t border-border/60">
            {(snap.adjustedActions ?? 0) > 0 ? (
              <p className="border-b border-border/60 bg-muted/40 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
                {ar
                  ? "ملحوظة: شارت TradingView أدناه يعرض الأسعار الخام — فيبدو هابطًا شكليًا يوم توزيع الأسهم المجانية أو الأرباح النقدية. الرسم والمؤشرات في EGXANO أعلاه محسوبة على الأسعار المعدلة."
                  : "Note: the TradingView chart below draws RAW prices — it shows a mechanical drop on bonus/cash ex-dates. EGXANO's chart and indicators above use ex-date-adjusted prices."}
              </p>
            ) : null}
            <TradingViewChart ticker={ticker} height={420} />
          </div>
        </details>
      ) : null}
    </div>
  )
}
