"use client"

// Technical analysis tab — deterministic readings over real daily price bars.
// Everything shown is computed server-side (src/lib/technical/analyze.ts) from
// stored sessions; nothing is estimated. The interpretation strip at the top
// is rule-based (counts of pre-flagged signals) — honest and reproducible.

import { useQuery } from "@tanstack/react-query"
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Boxes,
  Gauge,
  Layers,
  Minus,
  Waves,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/client/api"
import { useI18n } from "@/lib/i18n"
import { TradingViewChart } from "@/components/egx/tradingview"

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
      {/* TradingView chart — the only price chart on company pages (the
          platform stores no candle history; the widget is display-only and
          EGXANO's own indicators are computed server-side below). */}
      {ticker ? (
        <Card className="overflow-hidden p-0">
          <CardContent className="p-0">
            <TradingViewChart ticker={ticker} height={460} />
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
