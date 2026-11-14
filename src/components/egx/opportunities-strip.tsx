"use client"

// "فرص اليوم" — the ordered opportunities strip rendered at the top of the
// signals board (src/components/egx/signals-view.tsx).
//
// Data: GET /api/v1/signals/opportunities — the server builds the digest from
// the cached whole-market computation (pure core in
// src/lib/technical/board-gates.ts): confirmed + watching rows only,
// conviction-tier sorted (A first), regime-gated, capped at 5, NEVER padded.
//
// Tier semantics: the A/B/C badge is QUALITY OF EVIDENCE (score band + plan
// quality + positive-reason dominance), not direction — disclosed in the
// strip's subtitle. The regime badge shows the board-wide gate context; rows
// the regime penalized carry their own Arabic note on the card.
//
// Free/anonymous callers receive locked identity rows (the board's exact
// gateRowForFree shape): ticker/name/last price + the Pro CTA — every paid
// field was stripped server-side before serialization.

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { ArrowDownRight, ArrowUpRight, Lock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/client/api"
import { useI18n } from "@/lib/i18n"
import type { MarketRegime, OpportunityRow } from "@/lib/technical/board-gates"
import type { GatedSignalRow } from "@/lib/technical/signals-service"

const REGIME_CLS: Record<MarketRegime, { badge: string; dot: string }> = {
  bull: { badge: "border-positive/40 bg-positive/10 text-positive", dot: "bg-positive" },
  bear: { badge: "border-negative/40 bg-negative/10 text-negative", dot: "bg-negative" },
  neutral: { badge: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
}

const TIER_CLS: Record<"A" | "B" | "C", string> = {
  A: "border-positive/40 bg-positive/10 text-positive",
  B: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  C: "border-border/60 bg-muted/40 text-muted-foreground",
}

/** Arabic-first tier letters (أ/ب/ج) — matching the strip's disclosure line. */
const TIER_AR_LETTER: Record<"A" | "B" | "C", string> = { A: "أ", B: "ب", C: "ج" }

const STATE_CLS: Record<"buy" | "sell", string> = {
  buy: "border-positive/40 bg-positive/10 text-positive",
  sell: "border-negative/40 bg-negative/10 text-negative",
}

const WATCHING_CLS = "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"

function pctStr(v: number | null): string {
  if (v === null) return "—"
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`
}

function pctCls(v: number | null): string {
  if (v === null) return "text-muted-foreground"
  return v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-muted-foreground"
}

function zoneStr(low: number | null, high: number | null): string {
  if (low === null || high === null) return "—"
  return low === high ? low.toFixed(2) : `${low.toFixed(2)}–${high.toFixed(2)}`
}

/** Compact paid opportunity card — the exact fields the digest row allowlists. */
function OpportunityCard({ row, ar }: { row: OpportunityRow; ar: boolean }) {
  const stateCls = row.signalState === "watching" ? WATCHING_CLS : STATE_CLS[row.direction]
  const stateLabel =
    row.signalState === "confirmed"
      ? row.direction === "buy"
        ? ar ? "شراء مؤكد" : "Confirmed buy"
        : ar ? "بيع مؤكد" : "Confirmed sell"
      : ar
        ? `${row.direction === "buy" ? "مراقبة شراء" : "مراقبة بيع"}`
        : `${row.direction === "buy" ? "Buy watch" : "Sell watch"}`

  return (
    <Card className="group relative p-0 transition-shadow hover:shadow-md">
      <CardContent className="space-y-2 px-3.5 py-3">
        {/* Identity + tier + state */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/company/${row.companyId}?tab=technical`} className="flex items-center gap-1.5 text-sm font-bold text-foreground hover:text-primary">
              <span dir="ltr">{row.ticker}</span>
              <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </Link>
            <p className="truncate text-[11px] text-muted-foreground" title={ar ? (row.nameAr ?? row.nameEn) : row.nameEn}>
              {ar ? (row.nameAr ?? row.nameEn) : row.nameEn}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${TIER_CLS[row.tier]}`}
              title={ar ? "قناعة القراءة — جودة الأدلة وليست الاتجاه" : "Conviction — quality of evidence, not direction"}
            >
              {ar ? `قناعة ${TIER_AR_LETTER[row.tier]}` : `Tier ${row.tier}`}
            </span>
            <Badge variant="outline" className={`gap-1 px-1.5 py-0 text-[9px] font-semibold ${stateCls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${row.signalState === "watching" ? "bg-amber-500" : row.direction === "buy" ? "bg-positive" : "bg-negative"}`} aria-hidden />
              {stateLabel}
            </Badge>
          </div>
        </div>

        {/* Last price + day move (public market data) */}
        <div className="flex items-baseline gap-1.5" dir="ltr">
          <span className="text-sm font-bold tabular text-foreground">{row.lastClose?.toFixed(2) ?? "—"}</span>
          <span className={`flex items-center text-[11px] font-semibold tabular ${pctCls(row.changePct)}`}>
            {row.changePct !== null && row.changePct > 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : row.changePct !== null && row.changePct < 0 ? <ArrowDownRight className="h-3 w-3" aria-hidden /> : null}
            {pctStr(row.changePct)}
          </span>
        </div>

        {/* The one actionable line: entry zone + RR (confirmed) or the
            close-based activation level (watching) */}
        {row.signalState === "confirmed" ? (
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-md border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
              {ar ? "دخول: " : "Entry: "}
              <span className="tabular" dir="ltr">{zoneStr(row.entryLow, row.entryHigh)}</span>
            </span>
            <span className="rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {ar ? "م/ع " : "R/R "}
              <span className="tabular" dir="ltr">{row.riskReward !== null ? row.riskReward.toFixed(2) : "—"}</span>
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              {ar ? "تفعيل: " : "Activation: "}
              {ar ? "إغلاق " : "close "}
              <span className="tabular" dir="ltr">{row.activationKind === "close_below" ? "<" : ">"} {row.activationLevel !== null ? row.activationLevel.toFixed(2) : "—"}</span>
            </span>
          </div>
        )}

        {/* Regime-gate note — only on rows the regime actually downgraded */}
        {row.noteAr ? (
          <p className="text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">{row.noteAr}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Locked compact card — the board's free gating, same redaction server-side. */
function LockedOpportunityCard({ row, ar }: { row: GatedSignalRow; ar: boolean }) {
  return (
    <Card className="relative overflow-hidden p-0">
      <CardContent className="space-y-2 px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-bold text-foreground" dir="ltr">{row.ticker}</span>
            <p className="truncate text-[11px] text-muted-foreground" title={ar ? (row.nameAr ?? row.nameEn) : row.nameEn}>
              {ar ? (row.nameAr ?? row.nameEn) : row.nameEn}
            </p>
          </div>
          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </div>
        <div className="flex items-baseline gap-1.5" dir="ltr">
          <span className="text-sm font-bold tabular text-foreground">{row.lastClose?.toFixed(2) ?? "—"}</span>
          <span className={`text-[11px] font-semibold tabular ${pctCls(row.changePct)}`}>{pctStr(row.changePct)}</span>
        </div>
        <Button asChild size="sm" variant="outline" className="h-6 w-full px-2 text-[10px] font-semibold">
          <Link href="/premium">{ar ? "افتح التفاصيل مع Pro" : "Unlock with Pro"}</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

export function OpportunitiesStrip() {
  const { lang } = useI18n()
  const ar = lang === "ar"

  const { data, isLoading, isError } = useQuery({
    queryKey: ["signal-opportunities"],
    queryFn: () => api.signalOpportunities(),
    staleTime: 120_000,
    retry: false,
  })

  // The strip is additive: on a fetch failure the board renders untouched.
  if (isError) return null

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-5 w-40 rounded-md" />
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      </div>
    )
  }

  if (!data) return null
  const rows = data.rows
  const regimeCls = REGIME_CLS[data.regime]
  const regimeLabel = ar ? ({ bull: "صاعد", bear: "هابط", neutral: "محايد" } as const)[data.regime] : ({ bull: "Bull", bear: "Bear", neutral: "Neutral" } as const)[data.regime]

  return (
    <section className="space-y-2 rounded-xl border border-border/60 bg-muted/10 p-3" aria-label={ar ? "فرص اليوم" : "Today's opportunities"}>
      {/* Strip header: title + regime badge + honest gate context */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">{ar ? "فرص اليوم" : "Today's opportunities"}</h2>
        <Badge variant="outline" className={`gap-1.5 text-[10px] font-semibold ${regimeCls.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${regimeCls.dot}`} aria-hidden />
          {ar ? `السوق: ${regimeLabel}` : `Market: ${regimeLabel}`}
        </Badge>
        <span className="text-[10px] text-muted-foreground" dir={ar ? "rtl" : "ltr"}>
          {ar
            ? `اتساع فني ${data.breadthPct !== null ? `${data.breadthPct}%` : "—"} · وسيط الدرجة ${data.medianScore !== null ? data.medianScore : "—"}`
            : `breadth ${data.breadthPct !== null ? `${data.breadthPct}%` : "—"} · median score ${data.medianScore !== null ? data.medianScore : "—"}`}
        </span>
        <span className="ms-auto text-[10px] text-muted-foreground" dir={ar ? "rtl" : "ltr"}>
          {ar ? `${data.qualifying} فرصة مؤهلة` : `${data.qualifying} qualifying`}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{data.regimeNoteAr}</p>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {ar
          ? "القناعة (أ/ب/ج) تقيس جودة الأدلة خلف القراءة — الدرجة الفنية وجودة الخطة وغلبة الأسباب الإيجابية — وليست اتجاه السهم. القراءات المعاكسة للاتجاه العام تُخفّض درجة واحدة."
          : "Conviction (A/B/C) measures the QUALITY OF EVIDENCE behind a read — score, plan quality and positive-reason dominance — not its direction. Reads fighting the market regime are downgraded one tier."}
      </p>

      {/* Up to 5 compact cards — fewer qualify ⇒ fewer shown, never padded */}
      {rows.length === 0 ? (
        <Card className="p-4 text-center text-xs text-muted-foreground">
          {ar
            ? "لا توجد فرص مؤهلة الآن — لا قراءة مؤكدة أو تحت المراقبة بجودة أدلة كافية اليوم."
            : "No qualifying opportunities right now — no confirmed or watched read with enough evidence quality today."}
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {rows.map((r) =>
            "locked" in r ? (
              <LockedOpportunityCard key={r.companyId} row={r} ar={ar} />
            ) : (
              <OpportunityCard key={r.companyId} row={r} ar={ar} />
            ),
          )}
        </div>
      )}
    </section>
  )
}
