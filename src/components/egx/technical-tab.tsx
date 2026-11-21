"use client"

// Technical analysis tab — deterministic readings over real daily price bars.
// Everything shown is computed server-side (src/lib/technical/analyze.ts for
// the data sections, src/lib/signals/* for the unified reading) from stored
// sessions; nothing is estimated. ONE analysis, one engine: the stance hero
// reads the unified tech-signals@7 row (the same row the /signals board
// publishes) and the vision below it is the EMA-first narrative built by
// src/lib/technical/stance-narrative.ts — the EMA20/EMA50 pair is the
// backbone of the reading, static S/R are reference signs only. The legacy
// v1 stance card, the old opportunity-layer card and the pre-flagged old
// engine signals dump were REMOVED (2026-11-17 owner mandate: «تخليلين —
// واحد بالأسلوب الجديد وواحد بالمحرك القديم — ده احذفه»). Order of the page:
// honest disclaimer → stance + EMA-first vision → adjusted chart → price and
// performance → indicators → market context → zones → structure →
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
  SquareStack,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/client/api"
import { useI18n } from "@/lib/i18n"
import { sectorLabel } from "@/lib/sectors"
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
import { OPPORTUNITY_TYPE_AR, OPPORTUNITY_TYPE_EN, SCORE_GROUP_AR, SCORE_GROUP_MAX, type ScoreGroup, type SignalRowV2 } from "@/lib/signals/types"
import { EvidenceList, LevelStrip, V2_STATE_META, WarningsStrip } from "./signal-v2-bits"
import { buildStanceVision, type StanceVision } from "@/lib/technical/stance-narrative"

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
// The stance hero reads ONLY the unified engine row (tech-signals@7) — the
// same row the /signals board publishes. The legacy v1 stance payload
// (`stance`), the old opportunity-layer card and the old engine's flagged
// signals were removed from this tab (2026-11-17 owner mandate) so the page
// can never show two readings of the same stock from two engines.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// V2StanceCard — THE stance hero (tech-signals@7), the SAME row the /signals
// board publishes. One engine, one score, one plan — the company tab and the
// market board can never disagree again. There is no legacy fallback card:
// when the unified row is unavailable the tab shows an honest note below.
// ---------------------------------------------------------------------------

function V2StanceCard({ row, ar }: { row: SignalRowV2; ar: boolean }) {
  const meta = V2_STATE_META[row.state]
  const tone = row.state === "buy" ? STANCE_CLS.buy : row.state === "exit" ? STANCE_CLS.sell : STANCE_CLS.hold
  const groups = row.scoreGroups
  const isExit = row.state === "exit"
  return (
    <Card className="p-0">
      <CardHeader className="px-5 pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <Gauge className="h-3.5 w-3.5 text-primary" aria-hidden />
            {ar ? "الخلاصة الفنية" : "Technical stance"}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.chipCls}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dotCls}`} />
            {ar ? meta.ar : meta.en}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-5 pb-5">
        {/* score gauge + the five documented groups (trend 25 / momentum 20 /
            volume 15 / structure 25 / quality 15 — the engine's own math) */}
        <div className="flex flex-wrap items-center gap-5">
          <ScoreGauge score={row.score} strokeCls={tone.stroke} textCls={tone.text} />
          {row.score !== null && groups ? (
            <div className="grid min-w-[220px] flex-1 gap-1.5">
              {(Object.keys(SCORE_GROUP_MAX) as ScoreGroup[]).map((g) => {
                const max = SCORE_GROUP_MAX[g]
                const earned = groups[g]
                const pct = max > 0 ? Math.round((earned / max) * 100) : 0
                return (
                  <div key={g} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-[11px] text-muted-foreground">{ar ? SCORE_GROUP_AR[g] : g}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-14 shrink-0 text-end text-[10px] tabular text-muted-foreground" dir="ltr">
                      {earned}/{max}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            row.quality.notesAr[0] ? (
              <p className="min-w-[220px] flex-1 text-xs leading-relaxed text-muted-foreground">{row.quality.notesAr[0]}</p>
            ) : null
          )}
        </div>

        {/* detection type + reading date + engine version */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {row.type ? <Badge variant="outline">{ar ? OPPORTUNITY_TYPE_AR[row.type] : OPPORTUNITY_TYPE_EN[row.type]}</Badge> : null}
          {row.asOf ? <span>{ar ? "آخر جلسة" : "as of"} <span className="tabular">{row.asOf}</span></span> : null}
          <Badge variant="outline" className="text-[10px]">{row.engine}</Badge>
        </div>

        {/* why this read — the same evidence lines the board cites */}
        {row.evidence.length > 0 ? (
          <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5">
            <p className="text-xs font-semibold">{ar ? "ليه القرار ده؟" : "Why this read?"}</p>
            <EvidenceList items={row.evidence} ar={ar} />
          </div>
        ) : null}

        {/* plan / setup / exit — identical block to the board's */}
        {row.plan ? (
          <LevelStrip plan={row.plan} ar={ar} />
        ) : row.setup ? (
          <div className="space-y-2">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
              <p className="text-xs font-semibold">{ar ? row.setup.activationAr : `Activation: a daily close above ${row.setup.activation.toFixed(2)}`}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {ar ? "المستويات أدناه تقديرية وتُحسب عند سعر التفعيل نفسه." : "Levels below are provisional, computed AT the activation price."}
              </p>
            </div>
            <LevelStrip plan={row.setup.provisional} provisional={true} ar={ar} />
          </div>
        ) : isExit ? (
          <div className="rounded-md border border-negative/30 bg-negative/5 px-3 py-2 text-sm text-negative">
            {ar ? "إغلاق مركز شراء قائم — ليست دعوة للبيع على المكشوف (غير متاح في EGX)." : "Close an existing long — not a short-selling call (unavailable on EGX)."}
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {ar ? "لا يوجد إعداد بنيوي قابل للنشر اليوم — لا تُصنَّع فرص عند غيابها." : "No publishable structural setup today — opportunities are never manufactured."}
          </p>
        )}

        {row.invalidationAr ? (
          <div className="rounded-md border border-negative/30 bg-negative/5 px-3 py-2 text-xs leading-relaxed text-negative">{row.invalidationAr}</div>
        ) : null}

        {(row.warnings?.length ?? 0) > 0 ? <WarningsStrip warnings={row.warnings} ar={ar} /> : null}

        <p className="text-[10px] text-muted-foreground">
          {ar
            ? "قراءة المحرك القواعدي الموحّد (نفس محرك لوحة الإشارات): اتجاه 25 / زخم 20 / حجم 15 / بنية 25 / جودة 15 — كل نقطة موثقة أعلاه. ليست توصية استثمارية ولا سعرًا مستهدفًا."
            : "The unified rules-engine read (same engine as the signals board): trend 25 / momentum 20 / volume 15 / structure 25 / quality 15 — every point cited above. Not investment advice and not a price target."}
        </p>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// "الرؤية ببساطة" — the EMA-FIRST vision narrative (2026-11-17 owner mandate).
// Built by the pure builder src/lib/technical/stance-narrative.ts from REAL
// inputs only (the unified engine's state + the snapshot's own EMA20/EMA50 —
// the same adjusted bars every number on this tab is computed from). ONE
// paragraph a beginner reads once, then three crisp bullets: الوضع / خط الحكم
// / ما بعد. Static S/R are demoted to a reference-sign footnote — the EMA pair
// is the backbone, and the daily close is the judge. Replaces the old
// mixed-source client summary (old-stance reason + zones + RSI bullets) that
// could contradict the stance hero above it.
// ---------------------------------------------------------------------------

function StanceVisionBlock({ vision, ar }: { vision: StanceVision; ar: boolean }) {
  // Arabic-only by doctrine (the copy register matches src/lib/position/review.ts);
  // English readers still get the stance hero's bilingual evidence above.
  if (!ar) return null
  return (
    <Card className="p-0">
      <CardHeader className="px-5 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ScrollText className="h-3.5 w-3.5 text-primary" aria-hidden />
          الرؤية ببساطة
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-5 pb-5">
        <p className="text-xs leading-relaxed text-foreground">{vision.paraAr}</p>
        <ol className="space-y-1.5">
          {vision.bulletsAr.map((b) => (
            <li key={b.label} className="flex items-start gap-2 text-xs leading-relaxed">
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                  b.label === "خط الحكم" ? "bg-amber-500" : b.label === "ما بعد" ? "bg-primary" : "bg-muted-foreground"
                }`}
                aria-hidden
              />
              <span className="flex-1">
                <span className="font-bold">{b.label}: </span>
                {b.text}
              </span>
            </li>
          ))}
        </ol>
        <p className="text-[10px] leading-relaxed text-muted-foreground">{vision.footnoteAr}</p>
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
          {/* 2026-11-14 audit fix: the sector name used to render raw ("Banks")
              in Arabic mode — localize it like the rest of the product. */}
          <span className="font-medium">{sector.name ? sectorLabel(sector.name, ar ? "ar" : "en") : (ar ? "القطاع" : "Sector")}</span>
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
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["company-technical", companyId],
    queryFn: () => api.companyTechnical(companyId),
    staleTime: 120_000,
    // A 403 (PREMIUM_REQUIRED) is a final answer, not a transient failure —
    // retrying can never succeed and only spams the endpoint.
    retry: (attempt, err) => (err as Error & { status?: number })?.status === 403 ? false : attempt < 2,
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
    // 2026-11-14 audit fix: a locked company (403 PREMIUM_REQUIRED) used to
    // render the generic "could not be loaded — try again" error, sending free
    // users into pointless retries on the highest-intent surface. It is a
    // final entitlement answer — show the upgrade CTA instead.
    const locked = (error as (Error & { status?: number }) | null)?.status === 403
    return (
      <div className="space-y-4">
        <DisclaimerBanner ar={ar} />
        {locked ? (
          <Card className="p-8 text-center">
            <div className="mx-auto flex max-w-md flex-col items-center gap-3">
              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                {ar ? "المحتوى الفني مقفل" : "Locked technical content"}
              </Badge>
              <p className="text-sm text-muted-foreground">
                {ar
                  ? "التحليل الفني لكل شركات البورصة (مناطق الدخول والخروج ووقف الخسارة) متاح مع باقة Pro."
                  : "Technical analysis for every listed company (entry/exit zones and stop levels) is available on Pro."}
              </p>
              <Link
                href="/premium"
                className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                {ar ? "ترقية الآن" : "Upgrade now"}
              </Link>
            </div>
          </Card>
        ) : (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            {ar ? "تعذر تحميل التحليل الفني الآن — أعد المحاولة." : "Technical analysis could not be loaded — try again."}
          </Card>
        )}
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

  // Day change from the last two DISTINCT sessions of the ADJUSTED series.
  const dayPct = sessionChangePct(candles)
  const tr = snap.trend
  const emaRows = [
    { label: "EMA 20", v: tr.ema20 ?? null },
    { label: "EMA 50", v: tr.ema50 ?? null },
    { label: "EMA 200", v: tr.ema200 ?? null },
  ]

  // EMA-first vision — ONE source of truth: the unified engine's state decides
  // the action sentence, the EMA20/EMA50 geometry decides the story sentences.
  // Inputs are the tab's own displayed numbers (same adjusted bars as the
  // chart and the EMA card below), so the narrative can never quote a figure
  // the page does not show.
  const vision = buildStanceVision({
    state: data.signalsV2?.state ?? null,
    lastClose: snap.lastClose,
    ema20: tr.ema20,
    ema50: tr.ema50,
  })

  return (
    <div className="space-y-4">
      {/* a. honest disclaimer — always first */}
      <DisclaimerBanner ar={ar} />

      {/* b. THE stance hero — reads the unified engine row (tech-signals@7),
          the SAME row the /signals board publishes, so this card and the board
          publish the SAME score, state and plan. No legacy fallback card: the
          v1 stance engine output was removed from this tab (owner mandate
          2026-11-17 — one stock, one analysis, one engine). */}
      {data.signalsV2 ? (
        <V2StanceCard row={data.signalsV2} ar={ar} />
      ) : (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {ar
            ? "قراءة المحرك الموحد غير متاحة على هذه اللقطة — والرؤية تحت مبنية على المتوسطات المحسوبة من نفس الشموع المعدلة."
            : "The unified engine read is unavailable on this snapshot — the vision below is built from the moving averages computed on the same adjusted bars."}
        </Card>
      )}

      {/* c. the EMA-first vision — one paragraph + الوضع / خط الحكم / ما بعد */}
      <StanceVisionBlock vision={vision} ar={ar} />

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

      {/* j. (removed 2026-11-17) the old engine's pre-flagged signals dump
          (the indicator-flag card that used to live here) — a second
          old-engine output whose wording could contradict the unified stance
          card above. The unified engine's cited evidence (ليه القرار ده؟) is
          the one reading. */}

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
