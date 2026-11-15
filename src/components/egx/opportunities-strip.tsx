"use client"

// "فرص اليوم" — the opportunity@1 strip rendered at the top of the signals
// board (src/components/egx/signals-view.tsx).
//
// Data: GET /api/v1/signals/opportunities — the server builds the digest from
// the cached whole-market computation (pure core buildOpportunityDigestV1 in
// src/lib/technical/signals-service.ts): qualifying rows (opportunity.eligible
// — the STRICT gates: > 5% remaining upside to the ladder's T1 AND RR ≥ 1.5)
// ranked by OQS DESC, then a clearly separated informative tail of
// conditional/observation rows, total capped at 5 — never padded. Missed rows
// (the NO-CHASE verdict) travel separately in missedRows.
//
// Every card answers (owner directive §9): ما هي الفرصة؟ / لماذا؟ / جاهزة
// الآن؟ / الدخول والوقف والهدف الأول / العائد المتبقي / ما الذي قد يفشل /
// راقب ماذا / آخر تحديث — conclusion first, technical evidence (ladder whyAr,
// OQS components) collapsed inside <details>. Honest empty state when
// qualifying === 0: the exact server note, no manufactured opportunities.
//
// Distinct sections: جاهزة الآن / بانتظار تفعيل / غير مؤهلة (collapsed by
// default). Free/anonymous callers receive locked identity rows (the board's
// exact gateRowForFree shape) — every paid field was stripped server-side.
//
// The SAME card component (OpportunityCardView) is reused by the company
// technical tab (src/components/egx/technical-tab.tsx) fed by the per-company
// data route — one stock, one analysis, everywhere.

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { ArrowDownRight, ArrowUpRight, Lock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/client/api"
import { useI18n } from "@/lib/i18n"
import type { MarketRegime } from "@/lib/technical/board-gates"
import type { OpportunityDigestRow, OpportunityMissedRow, OpportunityDigestResponse } from "@/lib/technical/signals-service"
import type { OpportunityView } from "@/lib/technical/opportunity"
import type { OpportunityScoreComponents } from "@/lib/technical/opportunity-score"
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

/** Opportunity-state badge — the answer to "ما هي الفرصة؟". */
const OPP_STATE_LABEL: Record<OpportunityView["state"], { ar: string; en: string; cls: string; dot: string }> = {
  actionable: { ar: "فرصة جاهزة", en: "Ready opportunity", cls: "border-positive/40 bg-positive/10 text-positive", dot: "bg-positive" },
  conditional: { ar: "دخول مشروط", en: "Conditional entry", cls: "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400", dot: "bg-blue-500" },
  observation: { ar: "تحت المراقبة", en: "Under watch", cls: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
  early: { ar: "فرصة مبكرة", en: "Early read", cls: "border-purple-500/40 bg-purple-500/10 text-purple-600 dark:text-purple-400", dot: "bg-purple-500" },
  missed: { ar: "الفرصة فاتت", en: "Missed", cls: "border-negative/40 bg-negative/10 text-negative", dot: "bg-negative" },
  invalidated: { ar: "الفرصة لم تعد قائمة", en: "Invalidated", cls: "border-negative/40 bg-negative/10 text-negative", dot: "bg-negative" },
  none: { ar: "لا فرصة", en: "No opportunity", cls: "border-border/60 bg-muted/40 text-muted-foreground", dot: "bg-muted-foreground" },
}

/** The "جاهزة الآن؟" chip — one honest word per state family. */
function readinessLabel(view: OpportunityView, ar: boolean): { text: string; cls: string } {
  if (view.eligible) return { text: ar ? "نعم — جاهزة الآن" : "Yes — ready now", cls: "border-positive/40 bg-positive/10 text-positive" }
  if (view.state === "conditional")
    return { text: ar ? "مبدئيًا — بانتظار التفعيل" : "Provisionally — awaiting activation", cls: "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400" }
  return { text: ar ? "ليس بعد" : "Not yet", cls: "border-border/60 bg-muted/40 text-muted-foreground" }
}

/** OQS component labels — Arabic-first (mirrors the score module's note). */
const OQS_COMPONENT_LABEL: Record<keyof OpportunityScoreComponents, { ar: string; en: string }> = {
  evidence: { ar: "قوة الأدلة", en: "Evidence" },
  structure: { ar: "بنية الاتجاه", en: "Trend structure" },
  relativeStrength: { ar: "الأداء النسبي", en: "Relative strength" },
  volumeConfirmation: { ar: "تأكيد الحجم", en: "Volume confirmation" },
  resistanceClearance: { ar: "مسافة المقاومة", en: "Resistance clearance" },
  upside: { ar: "المساحة للهدف", en: "Upside room" },
  riskReward: { ar: "المخاطرة/العائد", en: "Risk/reward" },
  liquidity: { ar: "السيولة", en: "Liquidity" },
  executionReadiness: { ar: "جاهزية التنفيذ", en: "Execution readiness" },
  dataFreshness: { ar: "حداثة البيانات", en: "Data freshness" },
}

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

function priceStr(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : "—"
}

/** One cell of the tidy levels grid — replaces the scattered chips. */
function LevelCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-background px-1 py-1.5">
      <p className="text-[9px] font-medium text-muted-foreground">{label}</p>
      <p className={`text-[11px] font-bold tabular ${tone ?? "text-foreground"}`} dir="ltr">{value}</p>
    </div>
  )
}

/** The card model — OpportunityDigestRow satisfies it structurally; the
 *  company technical tab builds the same shape from its own route payload. */
export interface OpportunityCardModel {
  companyId?: string
  ticker: string
  nameEn?: string
  nameAr?: string | null
  lastClose: number | null
  changePct?: number | null
  asOf: string | null
  /** conviction tier after the regime gate (display context, not the ranking) */
  tier?: "A" | "B" | "C"
  /** the regime-gate Arabic note when the tier was downgraded */
  noteAr?: string | null
  view: OpportunityView
  targets: { label: string; price: number; kind: string; strength: number | null; whyAr: string }[] | null
  oqs: number | null
  oqsComponents: OpportunityScoreComponents | null
  oqsNoteAr: string
  /** factual risk lines: rejection reasons, else the row's negative reasons */
  riskFactorsAr: string[]
  entryLow: number | null
  entryHigh: number | null
  stop: number | null
  riskReward: number | null
  activationKind: "close_above" | "close_below" | null
  activationLevel: number | null
  activationConditionAr: string | null
}

/**
 * The opportunity card (paid view) — conclusion first, evidence collapsed.
 * Answers: ما هي الفرصة؟ (state badge) · لماذا؟ (stateNoteAr) · جاهزة الآن؟ ·
 * الدخول/الوقف/الهدف الأول (+T2) · العائد المتبقي (exact) · ما الذي قد يفشل ·
 * راقب ماذا · آخر تحديث. The expandable section carries the ladder's per-target
 * Arabic evidence + the OQS components + the score note.
 */
export function OpportunityCardView({ model, ar }: { model: OpportunityCardModel; ar: boolean }) {
  const { view, targets } = model
  const stateMeta = OPP_STATE_LABEL[view.state]
  const stateLabel =
    view.state === "actionable"
      ? ar
        ? view.direction === "sell"
          ? "فرصة بيع جاهزة"
          : "فرصة شراء جاهزة"
        : view.direction === "sell"
          ? "Ready sell opportunity"
          : "Ready buy opportunity"
      : ar
        ? stateMeta.ar
        : stateMeta.en
  const ready = readinessLabel(view, ar)
  const t1 = targets?.[0] ?? null
  const isWatchingActivation = model.entryLow === null && model.activationLevel !== null
  const nameLine = ar ? (model.nameAr ?? model.nameEn ?? "") : (model.nameEn ?? "")

  return (
    <Card className="group relative p-0 transition-shadow hover:shadow-md">
      <CardContent className="space-y-2 px-3.5 py-3">
        {/* Identity + state badge (ما هي الفرصة؟) */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {model.companyId ? (
              <Link href={`/company/${model.companyId}?tab=technical`} className="flex items-center gap-1.5 text-sm font-bold text-foreground hover:text-primary">
                <span dir="ltr">{model.ticker}</span>
                <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </Link>
            ) : (
              <span className="flex items-center gap-1.5 text-sm font-bold text-foreground" dir="ltr">{model.ticker}</span>
            )}
            {nameLine ? (
              <p className="truncate text-[11px] text-muted-foreground" title={nameLine}>{nameLine}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge variant="outline" className={`gap-1 px-1.5 py-0 text-[10px] font-bold ${stateMeta.cls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${stateMeta.dot}`} aria-hidden />
              {stateLabel}
            </Badge>
            {model.tier ? (
              <span
                className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${TIER_CLS[model.tier]}`}
                title={ar ? "قناعة القراءة — جودة الأدلة وليست الاتجاه" : "Conviction — quality of evidence, not direction"}
              >
                {ar ? `قناعة ${TIER_AR_LETTER[model.tier]}` : `Tier ${model.tier}`}
              </span>
            ) : null}
          </div>
        </div>

        {/* Last price + day move (public market data) */}
        <div className="flex items-baseline gap-1.5" dir="ltr">
          <span className="text-sm font-bold tabular text-foreground">{model.lastClose?.toFixed(2) ?? "—"}</span>
          {model.changePct !== undefined ? (
            <span className={`flex items-center text-[11px] font-semibold tabular ${pctCls(model.changePct)}`}>
              {model.changePct !== null && model.changePct > 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : model.changePct !== null && model.changePct < 0 ? <ArrowDownRight className="h-3 w-3" aria-hidden /> : null}
              {pctStr(model.changePct)}
            </span>
          ) : null}
        </div>

        {/* لماذا؟ — the ONE primary assessment */}
        <p className="text-[11px] leading-relaxed text-foreground">{view.stateNoteAr}</p>

        {/* جاهزة الآن؟ */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">{ar ? "جاهزة الآن؟" : "Ready now?"}</span>
          <Badge variant="outline" className={`px-1.5 py-0 text-[10px] font-semibold ${ready.cls}`}>
            {ready.text}
          </Badge>
          {view.provisional ? (
            <span className="text-[10px] text-amber-600 dark:text-amber-400">
              {ar ? "المستويات تقديرية وتُعاد عند التفعيل" : "levels are provisional — recomputed at activation"}
            </span>
          ) : null}
        </div>

        {/* المستويات — شبكة منظمة (دخول/وقف/م-ع أو تفعيل/هدف/عائد) */}
        {isWatchingActivation ? (
          <>
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border/60 bg-border/40 text-center">
              <LevelCell
                label={ar ? "التفعيل" : "Activation"}
                value={`${model.activationKind === "close_below" ? "<" : ">"} ${priceStr(model.activationLevel)}`}
                tone="text-amber-600 dark:text-amber-400"
              />
              <LevelCell label={ar ? "الهدف الأول" : "T1"} value={priceStr(t1?.price ?? null)} />
              <LevelCell
                label={ar ? "العائد" : "Upside"}
                value={view.upsidePctToT1 !== null ? pctStr(view.upsidePctToT1) : "—"}
                tone={pctCls(view.upsidePctToT1)}
              />
            </div>
            {model.activationConditionAr ? (
              <p className="text-[10px] leading-relaxed text-muted-foreground">{model.activationConditionAr}</p>
            ) : null}
          </>
        ) : (
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border/60 bg-border/40 text-center">
            <LevelCell
              label={ar ? "الدخول" : "Entry"}
              value={zoneStr(model.entryLow, model.entryHigh)}
              tone="text-blue-600 dark:text-blue-400"
            />
            <LevelCell label={ar ? "الوقف" : "Stop"} value={priceStr(model.stop)} tone="text-negative" />
            <LevelCell label={ar ? "م/ع" : "R/R"} value={model.riskReward !== null ? model.riskReward.toFixed(2) : "—"} />
          </div>
        )}

        {/* سلّم الأهداف — بارز: كل هدف عند حاجز هيكلي حقيقي مع ملاحظته (الميزة التنافسية) */}
        {targets && targets.length > 0 ? (
          <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
            <p className="text-[10px] font-bold text-foreground">
              {ar ? "سلّم الأهداف — كل هدف عند حاجز هيكلي حقيقي موثق:" : "Target ladder — each rung at a real documented obstacle:"}
            </p>
            {targets.map((t, i) => {
              // % basis = the CURRENT close, not the entry — after the
              // stale-plan fix the ladder is anchored on the live price, and
              // the reader reads "+x%" as "from where the stock trades now"
              const upsideFromCurrent =
                model.lastClose !== null && Number.isFinite(model.lastClose)
                  ? ((t.price - (model.lastClose as number)) / (model.lastClose as number)) * 100
                  : null
              return (
                <div key={t.label} className="flex items-start gap-1.5">
                  <span
                    className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold ${i === 0 ? "bg-positive/10 text-positive" : "bg-muted text-muted-foreground"}`}
                    dir="ltr"
                  >
                    {t.label}
                  </span>
                  <span className="shrink-0 text-[11px] font-bold tabular text-foreground" dir="ltr">{priceStr(t.price)}</span>
                  {upsideFromCurrent !== null ? (
                    <span className={`shrink-0 text-[10px] font-semibold tabular ${pctCls(upsideFromCurrent)}`} dir="ltr">
                      {pctStr(upsideFromCurrent)}
                    </span>
                  ) : null}
                  <p className="line-clamp-2 min-w-0 flex-1 text-[10px] leading-relaxed text-muted-foreground" title={t.whyAr}>
                    {t.whyAr}
                  </p>
                </div>
              )
            })}
          </div>
        ) : null}

        {/* العائد المتبقي — من السعر الحالي حتى الهدف الأول (الرقم البارز) */}
        <div className="flex items-baseline justify-between rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
          <span className="text-[10px] font-medium text-muted-foreground">
            {ar ? "العائد المتبقي حتى الهدف الأول (من السعر الحالي)" : "Remaining upside to T1 (from current price)"}
          </span>
          <span className={`text-sm font-bold tabular ${pctCls(view.remainingPctToT1)}`} dir="ltr">
            {view.remainingPctToT1 !== null ? pctStr(view.remainingPctToT1) : "—"}
          </span>
        </div>
        {view.state === "conditional" && view.upsidePctToT1 !== null ? (
          <p className="text-[9px] text-muted-foreground">{ar ? "تقديري عند التفعيل" : "provisional at activation"}</p>
        ) : null}

        {/* ما الذي قد يفشل — factual only (rejections, else the row's negative reasons) */}
        {model.riskFactorsAr.length > 0 ? (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold text-muted-foreground">{ar ? "ما الذي قد يفشل:" : "What may fail:"}</p>
            <ul className="space-y-0.5">
              {model.riskFactorsAr.slice(0, 3).map((r, i) => (
                <li key={i} className="text-[10px] leading-relaxed text-negative">{r}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* راقب ماذا */}
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          <span className="font-semibold">{ar ? "راقب ماذا: " : "Watch: "}</span>
          {view.watchNextAr}
        </p>

        {/* آخر تحديث */}
        <p className="text-[10px] text-muted-foreground">
          {ar ? "آخر تحديث: " : "As of: "}
          <span dir="ltr">{model.asOf ?? "—"}</span>
        </p>

        {/* Regime-gate note — only on rows the regime actually downgraded */}
        {model.noteAr ? (
          <p className="text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">{model.noteAr}</p>
        ) : null}

        {/* Expandable quality section — OQS components + note (the ladder with
            its per-target evidence is shown in full ABOVE, never duplicated) */}
        {model.oqs !== null || model.oqsNoteAr ? (
          <details className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
            <summary className="cursor-pointer text-[10px] font-semibold text-muted-foreground">
              {ar ? "تقييم جودة الفرصة (OQS) ومكوّناته" : "Opportunity quality score (OQS) + components"}
            </summary>
            <div className="mt-2 space-y-2">
              {model.oqs !== null ? (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-foreground">
                    {ar ? "تقييم جودة الفرصة (OQS): " : "Opportunity quality score (OQS): "}
                    <span className="tabular" dir="ltr">{model.oqs}/100</span>
                  </p>
                  {model.oqsComponents ? (
                    <div className="flex flex-wrap gap-1">
                      {(Object.keys(model.oqsComponents) as (keyof OpportunityScoreComponents)[]).map((k) => (
                        <span key={k} className="rounded border border-border/60 bg-background px-1 py-0.5 text-[9px] text-muted-foreground">
                          {ar ? OQS_COMPONENT_LABEL[k].ar : OQS_COMPONENT_LABEL[k].en}{" "}
                          <span className="tabular" dir="ltr">{model.oqsComponents?.[k]}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {model.oqsNoteAr ? <p className="text-[10px] leading-relaxed text-muted-foreground">{model.oqsNoteAr}</p> : null}
            </div>
          </details>
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

/** Small missed (NO-CHASE) row — the separate list under the sections. */
function MissedRow({ row, ar }: { row: OpportunityMissedRow; ar: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/40 py-1.5 last:border-b-0">
      <span className="text-xs font-bold text-foreground" dir="ltr">{row.ticker}</span>
      <span className="text-[11px] font-semibold text-negative">{row.missedAr}</span>
      <span className="text-[10px] text-muted-foreground">
        {ar ? "العائد المتبقي حتى الهدف الأول: " : "Remaining upside to T1: "}
        <span className="tabular" dir="ltr">{row.remainingPctToT1 !== null ? pctStr(row.remainingPctToT1) : "—"}</span>
      </span>
      <span className="ms-auto text-[10px] text-muted-foreground">
        {ar ? "آخر تحديث: " : "As of: "}
        <span dir="ltr">{row.asOf ?? "—"}</span>
      </span>
    </div>
  )
}

function SectionHeading({ ar, title, count, tone }: { ar: boolean; title: string; count: number; tone: string }) {
  return (
    <div className="flex items-center gap-2">
      <h3 className={`text-xs font-bold ${tone}`}>{title}</h3>
      <span className="rounded-md border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground tabular">{count}</span>
    </div>
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
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      </div>
    )
  }

  if (!data) return null
  const rows = data.rows as (OpportunityDigestRow | GatedSignalRow)[]
  const missedRows = (data.missedRows ?? []) as (OpportunityMissedRow | GatedSignalRow)[]
  const paidRows = rows.filter((r) => !("locked" in r)) as OpportunityDigestRow[]
  const qualifying = paidRows.filter((r) => r.section === "qualifying")
  const watch = paidRows.filter((r) => r.section === "watch")
  const ineligible = paidRows.filter((r) => r.section === "ineligible")
  const regimeCls = REGIME_CLS[data.regime]
  const regimeLabel = ar ? ({ bull: "صاعد", bear: "هابط", neutral: "محايد" } as const)[data.regime] : ({ bull: "Bull", bear: "Bear", neutral: "Neutral" } as const)[data.regime]

  return (
    <section className="space-y-3 rounded-xl border border-border/60 bg-muted/10 p-3" aria-label={ar ? "فرص اليوم" : "Today's opportunities"}>
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
          ? "الترتيب بتقييم جودة الفرصة (OQS) — والفرصة المؤهلة يجب أن تجتاز بوابتي العائد المتبقي (> 5% حتى الهدف الأول) والمخاطرة (م/ع ≥ 1.5) على أرقام محسوبة فعليًا. الفرق المحكوم عليه بفشل يحمل أسبابه بالأرقام — ولا تُصنَّع فرص."
          : "Ranked by opportunity quality score (OQS) — qualifying requires BOTH strict gates: > 5% remaining upside to the ladder's T1 AND RR ≥ 1.5 on real computed numbers. Rejected reads carry their actual numbers — opportunities are never manufactured."}
      </p>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {ar
          ? "التحديث التلقائي كل 30 ثانية خلال الجلسة (الأحد–الخميس حتى الساعة 3:00 مساءً بتوقيت القاهرة) ويتوقف بعدها تمامًا — ومصدر الأسعار متأخر ~15 دقيقة وليس لحظيًا."
          : "Auto-refresh runs every 30 seconds during the session (Sun–Thu until 3:00 PM Cairo) and stops completely afterwards — prices are ~15 minutes delayed, not real-time."}
      </p>

      {/* Honest empty state — qualifying === 0 carries the exact server note */}
      {data.qualifying === 0 ? (
        <Card className="p-4 text-center">
          <p className="text-xs font-semibold text-foreground">{data.emptyNoteAr ?? (ar ? "لا توجد فرص مؤهلة اليوم." : "No qualifying opportunities today.")}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            {ar
              ? "الأقسام أدناه تعرض القراءات تحت المراقبة وغير المؤهلة بأسبابها المحسوبة — مراقبة، لا تصنيع."
              : "The sections below show watched and non-qualifying reads with their computed reasons — watch, never manufacture."}
          </p>
        </Card>
      ) : null}

      {/* جاهزة الآن — qualifying, OQS-ranked */}
      {qualifying.length > 0 ? (
        <div className="space-y-2">
          <SectionHeading ar={ar} title={ar ? "جاهزة الآن" : "Ready now"} count={qualifying.length} tone="text-positive" />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {qualifying.map((r) => (
              <OpportunityCardView key={r.companyId} model={r} ar={ar} />
            ))}
          </div>
        </div>
      ) : null}

      {/* بانتظار تفعيل — conditional rows (provisional geometry passed) */}
      {watch.length > 0 ? (
        <div className="space-y-2">
          <SectionHeading ar={ar} title={ar ? "بانتظار تفعيل" : "Awaiting activation"} count={watch.length} tone="text-blue-600 dark:text-blue-400" />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {watch.map((r) => (
              <OpportunityCardView key={r.companyId} model={r} ar={ar} />
            ))}
          </div>
        </div>
      ) : null}

      {/* غير مؤهلة — observation rows, collapsed by default */}
      {ineligible.length > 0 ? (
        <details className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
          <summary className="cursor-pointer">
            <SectionHeading ar={ar} title={ar ? "غير مؤهلة (مبسوطة للمراجعة)" : "Non-qualifying (for review)"} count={ineligible.length} tone="text-muted-foreground" />
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ineligible.map((r) => (
              <OpportunityCardView key={r.companyId} model={r} ar={ar} />
            ))}
          </div>
        </details>
      ) : null}

      {/* فرص فاتت — the separate NO-CHASE list, collapsed by default */}
      {missedRows.length > 0 ? (
        <details className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
          <summary className="cursor-pointer">
            <SectionHeading ar={ar} title={ar ? "الفرصة فاتت — لا مطاردة" : "Missed — no chasing"} count={missedRows.length} tone="text-negative" />
          </summary>
          <div className="mt-1">
            {missedRows.map((r) =>
              "locked" in r ? (
                <div key={r.companyId} className="flex items-center gap-2 border-b border-border/40 py-1.5 last:border-b-0">
                  <span className="text-xs font-bold text-foreground" dir="ltr">{r.ticker}</span>
                  <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
                </div>
              ) : (
                <MissedRow key={r.companyId} row={r} ar={ar} />
              ),
            )}
          </div>
        </details>
      ) : null}

      {/* Free callers: locked identity cards for every digest row */}
      {"locked" in (rows[0] ?? {}) ? (
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {rows.map((r) => (
            <LockedOpportunityCard key={r.companyId} row={r as GatedSignalRow} ar={ar} />
          ))}
        </div>
      ) : null}
    </section>
  )
}
