"use client"

// Shared client bits for the rebuilt signals engine (tech-signals@7) — used by
// BOTH the /signals board and the company technical tab so a plan, its return
// figures and the disclosed warnings render identically on every surface.
// Pure presentation: no fetching, no state.

import { AlertTriangle } from "lucide-react"
import { SCORE_GROUP_AR, type Evidence, type SignalState, type SignalWarning, type TradePlanV2 } from "@/lib/signals/types"

function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—"
  return v.toFixed(digits)
}

function pctStr(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—"
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`
}

// ---------------------------------------------------------------------------
// Evidence list — the cited facts behind a signal (shared by the board and
// the company technical tab)
// ---------------------------------------------------------------------------

export function EvidenceList({ items, ar }: { items: Evidence[]; ar: boolean }) {
  const contributing = items.filter((e) => (e.points ?? 0) > 0)
  const disclosed = items.filter((e) => (e.points ?? 0) <= 0)
  return (
    <ul className="space-y-1.5 text-sm leading-relaxed">
      {contributing.map((e, i) => (
        <li key={`c${i}`} className="flex gap-2">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-positive" />
          <span>
            {ar ? e.ar : e.en}
            {e.group ? <span className="ms-1 text-xs text-muted-foreground">({SCORE_GROUP_AR[e.group]} +{e.points})</span> : null}
          </span>
        </li>
      ))}
      {disclosed.map((e, i) => (
        <li key={`d${i}`} className="flex gap-2 text-muted-foreground">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
          <span>{ar ? e.ar : e.en}</span>
        </li>
      ))}
    </ul>
  )
}

export const V2_STATE_META: Record<SignalState, { ar: string; en: string; chipCls: string; dotCls: string }> = {
  buy: { ar: "شراء", en: "Buy", chipCls: "bg-positive/15 text-positive border-positive/30", dotCls: "bg-positive" },
  near: { ar: "قرب التفعيل", en: "Near activation", chipCls: "bg-amber-500/15 text-amber-500 border-amber-500/30", dotCls: "bg-amber-500" },
  wait: { ar: "انتظار", en: "Wait", chipCls: "bg-muted text-muted-foreground border-border", dotCls: "bg-muted-foreground" },
  exit: { ar: "خروج", en: "Exit", chipCls: "bg-negative/15 text-negative border-negative/30", dotCls: "bg-negative" },
}

// ---------------------------------------------------------------------------
// Level strip — the shared plan grid (confirmed or provisional), with the
// approximate return to target and risk to stop (owner addition 2026-11-16)
// ---------------------------------------------------------------------------

export function LevelStrip({ plan, provisional, ar }: { plan: TradePlanV2; provisional?: boolean; ar: boolean }) {
  const cell = (label: string, value: string, sub?: { text: string; cls: string }, cls = "text-foreground") => (
    <div className="min-w-[84px] flex-1 rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${cls}`}>{value}</div>
      {sub ? <div className={`text-[10px] font-semibold tabular-nums ${sub.cls}`}>{sub.text}</div> : null}
    </div>
  )
  const tag = provisional ? (ar ? "تقديري — يُعاد حسابه عند التفعيل" : "provisional — recomputed at activation") : ar ? "مستويات تنفيذية" : "executable levels"
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>{tag}</span>
        <span className="font-semibold text-foreground">R/R {fmt(plan.riskReward)}</span>
        {plan.target1ReturnPct !== undefined ? (
          <span className="font-semibold text-positive">
            {ar ? "العائد حتى الهدف ≈ " : "est. return ≈ "}
            {pctStr(plan.target1ReturnPct)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {cell(ar ? "دخول" : "Entry", `${fmt(plan.entryLow)}–${fmt(plan.entryHigh)}`)}
        {cell(ar ? "وقف" : "Stop", fmt(plan.stop), plan.stopRiskPct !== undefined ? { text: `−${plan.stopRiskPct.toFixed(1)}%`, cls: "text-negative" } : undefined, "text-negative")}
        {cell(ar ? "الهدف الأول" : "Target 1", fmt(plan.target1), plan.target1ReturnPct !== undefined ? { text: pctStr(plan.target1ReturnPct), cls: "text-positive" } : undefined, "text-positive")}
        {plan.target2 !== null ? cell(ar ? "الهدف الثاني" : "Target 2", fmt(plan.target2), plan.target2ReturnPct !== null ? { text: pctStr(plan.target2ReturnPct), cls: "text-positive" } : undefined, "text-positive") : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Warnings strip — fundamentals/liquidity disclosures next to the signal
// (wording is factual mechanics only; never an accusation of any party)
// ---------------------------------------------------------------------------

export function WarningsStrip({ warnings, ar, compact }: { warnings: SignalWarning[]; ar: boolean; compact?: boolean }) {
  if (!warnings.length) return null
  return (
    <div className="space-y-1.5 rounded-md border border-amber-500/35 bg-amber-500/5 px-3 py-2">
      {warnings.map((w) => (
        <div key={w.kind} className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
          <div>
            <p className="text-xs font-semibold leading-relaxed text-amber-700 dark:text-amber-400">{ar ? w.ar : w.en}</p>
            {compact ? null : <p className="mt-0.5 text-[11px] leading-relaxed text-amber-700/80 dark:text-amber-400/80">{ar ? w.detailAr : w.detailEn}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
