"use client"

// Technical analysis tab — deterministic readings over real daily price bars.
// Everything shown is computed server-side (src/lib/technical/analyze.ts) from
// stored sessions; nothing is estimated. The interpretation strip at the top
// is rule-based (counts of pre-flagged signals) — honest and reproducible.

import { useQuery } from "@tanstack/react-query"
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Boxes,
  ClipboardCheck,
  Gauge,
  Globe,
  Layers,
  Minus,
  Network,
  SquareStack,
  Waves,
  Zap,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/client/api"
import { useI18n } from "@/lib/i18n"
import { TradingViewChart } from "@/components/egx/tradingview"
import { AdjustedPriceChart, type ChartCandle } from "@/components/egx/adjusted-price-chart"
// Type-only imports from the deterministic lib layer — erased at build time,
// so no server code ever reaches the client bundle.
import type { MarketContextSection } from "@/lib/technical/analyze"
import type { StructureSnapshot } from "@/lib/technical/structure"
import type { VsaSnapshot } from "@/lib/technical/vsa"
import type { ZonesSnapshot } from "@/lib/technical/zones"
import type { QualityScore } from "@/lib/technical/quality"

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
  trend: {
    sma20: number | null
    sma50: number | null
    sma100: number | null
    sma200: number | null
    priceVsSma20: string | null
    priceVsSma50: string | null
    priceVsSma200: string | null
    sma20VsSma50: string | null
    sma50VsSma200: string | null
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
  high52w: number | null
  low52w: number | null
  fromHigh52wPct: number | null
  fromLow52wPct: number | null
  signals: { code: string; tone: "positive" | "negative" | "neutral"; severity?: "warning" | "info"; text: string; textAr: string }[]
  /** Corporate-action ex-dates the series was rebuilt across (bonus/split/
   *  cash/rights) — null/undefined when no adjustment applied. */
  adjustedActions?: number | null
  // --- Newer analysis sections (optional: older cached payloads omit them) ---
  /** Swing map + BOS/CHoCH events (src/lib/technical/structure.ts). */
  structure?: StructureSnapshot | null
  /** Volume Spread Analysis events (src/lib/technical/vsa.ts). */
  vsa?: VsaSnapshot | null
  /** Supply & demand zones (src/lib/technical/zones.ts). */
  zones?: ZonesSnapshot | null
  /** Market & sector context injected by the intelligence layer. */
  context?: MarketContextSection | null
  /** Analytical quality score (src/lib/technical/quality.ts). */
  quality?: QualityScore | null
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
// ---------------------------------------------------------------------------

function MarketContextStrip({ ctx, ar }: { ctx: MarketContextSection; ar: boolean }) {
  const b = ctx.breadth
  const sector = ctx.sector
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
      {ctx.pctAboveSma20 !== null ? (
        <span className="text-[11px] text-muted-foreground">
          {ar ? "فوق SMA20" : "above SMA20"} <span className="tnum" dir="ltr">{ctx.pctAboveSma20.toFixed(0)}%</span>
        </span>
      ) : null}
      {ctx.pctAboveSma50 !== null ? (
        <span className="text-[11px] text-muted-foreground">
          {ar ? "فوق SMA50" : "above SMA50"} <span className="tnum" dir="ltr">{ctx.pctAboveSma50.toFixed(0)}%</span>
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
  "swing level": "مستوى سوينغ",
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
                    <span className="min-w-0 flex-1">{ar ? e.textAr : e.text}</span>
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
// Volume Spread Analysis (VSA) — spread/volume events with tone coloring.
// ---------------------------------------------------------------------------

const VSA_EVENT_AR: Record<string, string> = {
  selling_climax: "ذروة بيع",
  buying_climax: "ذروة شراء",
  stopping_volume: "حجم مكبح",
  no_demand: "لا طلب",
  no_supply: "لا عرض",
  effort_no_result: "جهد بلا نتيجة",
}

function VsaSection({ vsa, ar }: { vsa: VsaSnapshot | null | undefined; ar: boolean }) {
  if (!vsa) return null
  return (
    <Card className="p-0">
      <CardHeader className="px-5 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Zap className="h-3.5 w-3.5 text-primary" aria-hidden />
          {ar ? "تحليل الانتشار والحجم (VSA)" : "Volume Spread Analysis (VSA)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-5 pb-5">
        {!vsa.available ? (
          <p className="text-xs text-muted-foreground">
            {vsa.reason ?? (ar ? "تحليل الانتشار والحجم غير متاح لهذه البيانات." : "VSA unavailable for this data.")}
          </p>
        ) : vsa.events.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {ar ? "لا أحداث انتشار مؤهلة في جلسات المسح الأخيرة." : "No qualifying spread events in the scanned sessions."}
          </p>
        ) : (
          <div className="space-y-1.5">
            {vsa.events.map((e, i) => (
              <div
                key={`${e.code}-${e.ts}-${i}`}
                className={`flex flex-wrap items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                  e.tone === "bullish-leaning"
                    ? "border-positive/30 bg-positive/5 text-positive"
                    : e.tone === "bearish-leaning"
                      ? "border-negative/30 bg-negative/5 text-negative"
                      : "border-border/60 bg-muted/20 text-muted-foreground"
                }`}
              >
                <Badge variant="outline" className="shrink-0 bg-background/50">
                  {ar ? (VSA_EVENT_AR[e.code] ?? e.code) : e.code.replace(/_/g, " ")}
                </Badge>
                <span className="min-w-0 flex-1">{ar ? e.textAr : e.text}</span>
                <span className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="tnum" dir="ltr">{e.volRatio.toFixed(1)}×</span>
                  <span className="tnum" dir="ltr">{e.spreadPct > 0 ? "+" : ""}{e.spreadPct.toFixed(1)}%</span>
                  {e.followThrough ? (
                    <span className={e.followThrough === "recovered" ? "font-semibold text-positive" : "font-semibold text-negative"}>
                      {e.followThrough === "recovered" ? (ar ? "تبع مؤكد" : "follow-through") : (ar ? "فشل التبع" : "failed follow-through")}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          {vsa.baselineVolume !== null
            ? ar
              ? `خط الأساس: ~${Math.round(vsa.baselineVolume).toLocaleString("en-GB")} سهم · نافذة ${vsa.baselineWindow} جلسة.`
              : `Baseline ≈ ${Math.round(vsa.baselineVolume).toLocaleString("en-GB")} shares over a ${vsa.baselineWindow}-session window.`
            : ar
              ? `نافذة خط الأساس: ${vsa.baselineWindow} جلسة.`
              : `Baseline window: ${vsa.baselineWindow} sessions.`}
        </p>
        {vsa.limitations.length > 0 ? (
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            {ar ? "حدود: " : "Limitations: "}
            {vsa.limitations.join(" · ")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Supply & demand zones — kind-colored cards with a quality meter.
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
                <p className="text-[11px] text-muted-foreground">
                  {z.kind === "demand" ? (ar ? "الإبطال تحت" : "Invalidation below") : (ar ? "الإبطال فوق" : "Invalidation above")}{" "}
                  <span className="tnum" dir="ltr">{z.invalidation.toFixed(2)}</span>
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
// Analytical quality score — completeness/evidence score, NOT a trade forecast.
// ---------------------------------------------------------------------------

const QUALITY_BAND_META: Record<QualityScore["band"], { ar: string; en: string; cls: string }> = {
  high: { ar: "أصلي", en: "High", cls: "border-positive/40 bg-positive/10 text-positive" },
  good: { ar: "جيد", en: "Good", cls: "border-primary/40 bg-primary/10 text-primary" },
  incomplete: { ar: "ناقص", en: "Incomplete", cls: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  weak: { ar: "ضعيف", en: "Weak", cls: "border-negative/40 bg-negative/10 text-negative" },
  blocked: { ar: "مقيّد ببوابة بيانات", en: "Blocked by data gate", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
}

function QualitySection({ quality, ar }: { quality: QualityScore | null | undefined; ar: boolean }) {
  if (!quality) return null
  const band = QUALITY_BAND_META[quality.band]
  return (
    <Card className="p-0">
      <CardHeader className="px-5 pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <ClipboardCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
            {ar ? "الجودة التحليلية للقراءة" : "Analytical quality"}
          </span>
          <Badge variant="outline" className={band.cls}>{ar ? band.ar : band.en}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-5 pb-5">
        <div className="flex items-center gap-3">
          <span className="tnum shrink-0 text-2xl font-bold" dir="ltr">
            {quality.score}
            <span className="text-sm font-medium text-muted-foreground">/100</span>
          </span>
          {/* Segmented bar: segment width = weight, fill = earned/weight */}
          <div className="flex h-2.5 min-w-[120px] flex-1 gap-px overflow-hidden rounded-full bg-muted">
            {quality.dimensions.map((d) => (
              <div
                key={d.key}
                className="relative h-full"
                style={{ flexGrow: Math.max(1, d.weight) }}
                title={`${ar ? d.labelAr : d.label}: ${d.earned}/${d.weight}`}
              >
                <div
                  className="absolute inset-y-0 start-0 rounded-full bg-primary"
                  style={{ width: `${Math.min(100, Math.max(0, (d.earned / Math.max(1, d.weight)) * 100))}%` }}
                />
              </div>
            ))}
          </div>
        </div>
        {quality.gateVeto ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{quality.gateVeto}</span>
          </div>
        ) : null}
        <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
          {quality.dimensions.map((d) => (
            <div key={d.key} className="rounded-lg border border-border/50 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-medium" title={ar ? d.labelAr : d.label}>{ar ? d.labelAr : d.label}</span>
                <span className="tnum shrink-0 text-muted-foreground" dir="ltr">{d.earned}/{d.weight}</span>
              </div>
              <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{d.reason}</p>
            </div>
          ))}
        </div>
        {quality.conflicts.length > 0 ? (
          <div className="space-y-1.5">
            {quality.conflicts.map((c, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{ar ? "تعارض مرصود: " : "Flagged conflict: "}{c}</span>
              </div>
            ))}
          </div>
        ) : null}
        <p className="text-[10px] text-muted-foreground">
          {ar
            ? "يقيس هذا الرصد اكتمال التحليل وجودة الأدلة — وليس احتمال نجاح صفقة."
            : "Measures analytical completeness and evidence quality — not trade success probability."}
        </p>
      </CardContent>
    </Card>
  )
}

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
      <Card className="p-6 text-center text-sm text-muted-foreground">
        {ar ? "تعذر تحميل التحليل الفني الآن — أعد المحاولة." : "Technical analysis could not be loaded — try again."}
      </Card>
    )
  }

  if (!snap.available || snap.lastClose === null) {
    return (
      <div className="space-y-4">
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

  const fmtN = (v: number | null, digits = 2): string => (v === null ? "—" : v.toFixed(digits))

  return (
    <div className="space-y-4">
      {/* EGXANO's own chart over the corporate-action-ADJUSTED series — the
          same bars every indicator below is computed from, so a bonus/cash
          ex-date never reads as a market crash. */}
      {candles.length > 1 ? (
        <Card className="overflow-hidden p-0">
          <CardContent className="px-2 py-3 sm:px-3">
            <AdjustedPriceChart candles={candles} height={360} adjustedActions={snap.adjustedActions ?? null} />
          </CardContent>
        </Card>
      ) : null}

      {/* TradingView embed — display-only external view. TradingView draws the
          RAW series, so on a company with recent corporate actions its chart
          shows the mechanical ex-date drop; the note makes the difference
          explicit instead of silently contradicting the adjusted numbers. */}
      {ticker ? (
        <Card className="overflow-hidden p-0">
          {(snap.adjustedActions ?? 0) > 0 ? (
            <p className="border-b border-border/60 bg-muted/40 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
              {ar
                ? "ملحوظة: شارت TradingView أدناه يعرض الأسعار الخام — فيبدو هابطًا شكليًا يوم توزيع الأسهم المجانية أو الأرباح النقدية. الرسم والمؤشرات في EGXANO أعلاه محسوبة على الأسعار المعدلة."
                : "Note: the TradingView chart below draws RAW prices — it shows a mechanical drop on bonus/cash ex-dates. EGXANO's chart and indicators above use ex-date-adjusted prices."}
            </p>
          ) : null}
          <CardContent className="p-0">
            <TradingViewChart ticker={ticker} height={420} />
          </CardContent>
        </Card>
      ) : null}

      {/* Header + performance strip */}
      <Card className="p-0">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {ar ? "آخر سعر مسجل" : "Last recorded price"}
              </p>
              <p className="text-2xl font-bold tabular" dir="ltr">
                {snap.lastClose.toFixed(2)} <span className="text-sm font-medium text-muted-foreground">{snap.currency}</span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                {ar ? `${snap.sessions} جلسة مسجلة · حتى ` : `${snap.sessions} sessions · as of `}
                <span dir="ltr">{snap.asOf ?? "—"}</span>
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

      {/* Deterministic reading */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <Activity className="h-4 w-4 text-primary" aria-hidden />
        <p className="text-xs font-medium">{verdict}</p>
        <span className="text-[11px] text-muted-foreground">
          · {ar ? `${pos} إشارة إيجابية / ${neg} سلبية` : `${pos} positive / ${neg} negative signals`}
        </span>
      </div>

      {/* Market & sector context (injected by the intelligence layer; absent → nothing) */}
      {snap.context?.available ? <MarketContextStrip ctx={snap.context} ar={ar} /> : null}

      {/* Pre-flagged signals */}
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

      <div className="grid gap-4 md:grid-cols-2">
        {/* Trend */}
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
            {(
              [
                { label: "SMA 20", v: snap.trend.sma20, vs: snap.trend.priceVsSma20 },
                { label: "SMA 50", v: snap.trend.sma50, vs: snap.trend.priceVsSma50 },
                { label: "SMA 200", v: snap.trend.sma200, vs: snap.trend.priceVsSma200 },
              ] as const
            ).map((row) => (
              <div key={row.label} className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-xs">
                <span className="font-medium">{row.label}</span>
                <span className="tabular" dir="ltr">{fmtN(row.v)}</span>
                <span className={row.vs === "above" ? "text-positive" : row.vs === "below" ? "text-negative" : "text-muted-foreground"}>
                  {row.vs === "above" ? (ar ? "السعر فوقه" : "price above") : row.vs === "below" ? (ar ? "السعر تحته" : "price below") : "—"}
                </span>
              </div>
            ))}
            {snap.trend.cross50200 ? (
              <p className="text-[11px] text-muted-foreground">
                {snap.trend.cross50200 === "golden"
                  ? ar
                    ? `تقاطع ذهبي (50 فوق 200) قبل ${snap.trend.cross50200Age ?? "—"} جلسة.`
                    : `Golden cross (SMA50 > SMA200) ${snap.trend.cross50200Age ?? "—"} sessions ago.`
                  : ar
                    ? `تقاطع سفلي (50 تحت 200) قبل ${snap.trend.cross50200Age ?? "—"} جلسة.`
                    : `Death cross (SMA50 < SMA200) ${snap.trend.cross50200Age ?? "—"} sessions ago.`}
              </p>
            ) : null}
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

        {/* Volatility, volume, 52w */}
        <Card className="p-0">
          <CardHeader className="px-5 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-3.5 w-3.5 text-primary" aria-hidden />
              {ar ? "التقلب والحجم ونطاق 52 أسبوعاً" : "Volatility, volume & 52-week range"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-5 pb-5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">ATR(14)</span>
              <span className="tabular" dir="ltr">{fmtN(snap.volatility.atr14)} {snap.volatility.atrPct !== null ? `(${snap.volatility.atrPct.toFixed(1)}%)` : ""}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{ar ? "بولينجر (علوي/أوسط/سفلي)" : "Bollinger (upper/mid/lower)"}</span>
              <span className="tabular" dir="ltr">
                {fmtN(snap.volatility.bollinger.upper)} / {fmtN(snap.volatility.bollinger.middle)} / {fmtN(snap.volatility.bollinger.lower)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{ar ? "الحجم النسبي (مقابل 20 جلسة)" : "Relative volume (vs 20 sessions)"}</span>
              <span className="tabular" dir="ltr">{snap.volume.relVol !== null ? `${snap.volume.relVol.toFixed(2)}×` : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">OBV {ar ? "ميل 20 جلسة" : "20-session slope"}</span>
              <span className={`tabular ${pctColor(snap.volume.obvSlope20)}`} dir="ltr">{fmtN(snap.volume.obvSlope20)}</span>
            </div>
            {snap.high52w !== null && snap.low52w !== null ? (
              <>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-muted-foreground">52W {ar ? "القمة/القاع" : "high / low"}</span>
                  <span className="tabular" dir="ltr">{snap.high52w.toFixed(2)} / {snap.low52w.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{ar ? "من القمة" : "From high"}</span>
                  <span className={`tabular ${pctColor(snap.fromHigh52wPct)}`} dir="ltr">{pctStr(snap.fromHigh52wPct)}</span>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Market structure — swings, multi-timeframe chips, BOS/CHoCH, key levels */}
      <StructureSection structure={snap.structure} ar={ar} />

      {/* Volume Spread Analysis */}
      <VsaSection vsa={snap.vsa} ar={ar} />

      {/* Supply & demand zones */}
      <ZonesSection zones={snap.zones} ar={ar} />

      {/* Analytical quality score */}
      <QualitySection quality={snap.quality} ar={ar} />

      {snap.limitations.length > 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {ar ? "حدود البيانات: " : "Data limitations: "}
          {ar
            ? snap.limitations.map((l) => l).join(" · ")
            : snap.limitations.join(" · ")}
        </p>
      ) : null}
    </div>
  )
}
