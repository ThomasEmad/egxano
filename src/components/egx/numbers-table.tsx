"use client"

// NumbersTable — جدول أرقام السوق كاملة (owner request: "أرقام لكل الأسهم
// وملاحظات بواجهة جذابة ومريحة للعين").
//
// One dense, sortable row per scored company: price + day move, the
// opportunity state, the executable levels (entry/stop/RR), the ladder rungs
// T1/T2/T3 with the remaining upside, the OQS quality score, and a
// click-to-expand notes panel carrying the per-stock assessment verbatim
// (stateNoteAr + rejection reasons + watch-next + each rung's Arabic
// evidence). Premium-only surface: the board route strips every analytical
// field for locked rows (gateRowForFree), so the table renders identity-only
// rows honestly when they appear — mirroring the board's free gating.
//
// Data source: the SAME premium board payload (GET /api/v1/technical/signals)
// the table above uses — no second fetch, no new compute; the opportunity
// layer travels on the served rows for paid callers.

import Link from "next/link"
import { Fragment, useMemo, useState } from "react"
import { ArrowDownRight, ArrowUpRight, ChevronDown } from "lucide-react"
import { Card } from "@/components/ui/card"
import type { MarketSignalRow, RowOpportunity } from "@/lib/technical/signals-service"
import type { OpportunityView } from "@/lib/technical/opportunity"

/** Arabic-first state labels (kept in sync with opportunities-strip). */
const STATE_LABEL: Record<OpportunityView["state"], { ar: string; en: string; dot: string; text: string }> = {
  actionable: { ar: "جاهزة", en: "Ready", dot: "bg-positive", text: "text-positive" },
  conditional: { ar: "مشروطة", en: "Conditional", dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-400" },
  observation: { ar: "مراقبة", en: "Watch", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  early: { ar: "مبكرة", en: "Early", dot: "bg-purple-500", text: "text-purple-600 dark:text-purple-400" },
  missed: { ar: "فاتت", en: "Missed", dot: "bg-negative", text: "text-negative" },
  invalidated: { ar: "ألغيت", en: "Invalidated", dot: "bg-negative", text: "text-negative" },
  none: { ar: "—", en: "—", dot: "bg-muted-foreground/50", text: "text-muted-foreground" },
}

type SortKey = "oqs" | "change" | "upside"

function pctStr(v: number | null): string {
  if (v === null) return "—"
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`
}

function pctCls(v: number | null): string {
  if (v === null) return "text-muted-foreground"
  return v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-muted-foreground"
}

function priceStr(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : "—"
}

function zoneStr(low: number | null | undefined, high: number | null | undefined): string {
  if (typeof low !== "number" || typeof high !== "number" || !Number.isFinite(low) || !Number.isFinite(high)) return "—"
  return low === high ? low.toFixed(2) : `${low.toFixed(2)}–${high.toFixed(2)}`
}

export function NumbersTable({ rows, ar }: { rows: MarketSignalRow[]; ar: boolean }) {
  const [sort, setSort] = useState<SortKey>("oqs")
  const [openId, setOpenId] = useState<string | null>(null)

  const fullRows = useMemo(() => rows.filter((r): r is MarketSignalRow => !("locked" in r)), [rows])

  const sorted = useMemo(() => {
    const key = (r: MarketSignalRow): number => {
      if (sort === "change") return r.changePct ?? -Infinity
      if (sort === "upside") return r.opportunity?.view.remainingPctToT1 ?? -Infinity
      return r.opportunity?.oqs ?? -1
    }
    return [...fullRows].sort((a, b) => key(b) - key(a) || a.ticker.localeCompare(b.ticker))
  }, [fullRows, sort])

  const withOpportunity = sorted.filter((r) => r.opportunity).length

  const sortChip = (k: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => setSort(k)}
      className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
        sort === k ? "border-primary/50 bg-primary/10 text-primary" : "border-border/60 bg-background text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  )

  return (
    <Card className="overflow-hidden p-0">
      {/* Header: title + counts + sort chips */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/20 px-3 py-2">
        <h3 className="text-xs font-bold text-foreground">
          {ar ? "أرقام السوق كاملة — كل سهم بأرقامه وملاحظته" : "Full market numbers — every stock, every note"}
        </h3>
        <span className="rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground tabular">
          {sorted.length} {ar ? "سهم" : "stocks"}
        </span>
        <span className="rounded-md border border-positive/40 bg-positive/10 px-1.5 py-0.5 text-[10px] font-semibold text-positive tabular">
          {withOpportunity} {ar ? "قراءة فرصة" : "opportunity reads"}
        </span>
        <span className="ms-auto flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">{ar ? "ترتيب:" : "sort:"}</span>
          {sortChip("oqs", ar ? "جودة الفرصة" : "OQS")}
          {sortChip("upside", ar ? "العائد المتبقي" : "Upside")}
          {sortChip("change", ar ? "تغير اليوم" : "Day move")}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border/60 bg-muted/10 text-muted-foreground">
              <th className="px-2 py-1.5 text-start font-semibold">{ar ? "التاسر" : "Ticker"}</th>
              <th className="px-2 py-1.5 text-start font-semibold">{ar ? "السعر" : "Price"}</th>
              <th className="px-2 py-1.5 text-start font-semibold">{ar ? "الحالة" : "State"}</th>
              <th className="px-2 py-1.5 text-start font-semibold">{ar ? "الدخول" : "Entry"}</th>
              <th className="px-2 py-1.5 text-start font-semibold">{ar ? "الوقف" : "Stop"}</th>
              <th className="px-2 py-1.5 text-start font-semibold">{ar ? "م/ع" : "R/R"}</th>
              <th className="px-2 py-1.5 text-start font-semibold">{ar ? "الهدف الأول" : "T1"}</th>
              <th className="px-2 py-1.5 text-start font-semibold">{ar ? "الثاني" : "T2"}</th>
              <th className="px-2 py-1.5 text-start font-semibold">{ar ? "الثالث" : "T3"}</th>
              <th className="px-2 py-1.5 text-start font-semibold" title={ar ? "من السعر الحالي حتى الهدف الأول" : "from the current price to T1"}>{ar ? "العائد" : "Upside"}</th>
              <th className="px-2 py-1.5 text-start font-semibold">{ar ? "الجودة" : "OQS"}</th>
              <th className="w-6 px-1 py-1.5" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const op = r.opportunity
              const view = op?.view
              const targets = op?.ladder?.targets ?? null
              const t1 = targets?.[0] ?? null
              const t2 = targets?.[1] ?? null
              const t3 = targets?.[2] ?? null
              // levels: the executable plan whenever one exists (any state) —
              // hiding them behind "actionable" left every row reading "—"
              // (2026-11-15 owner bug report). A watching row's provisional
              // setup levels display with a "≈" prefix (recomputed at activation)
              // — but ONLY when the server actually vetted them: an attached
              // layer that did not drop the setup. No layer (unclassified) or a
              // dropped (stale) setup → no levels at all (dead geometry, AMES).
              const plan = r.tradePlan ?? null
              const setup = op && !op.setupDropped ? (r.setup ?? null) : null
              const entry = plan
                ? zoneStr(plan.entryLow, plan.entryHigh)
                : setup?.provisionalEntry
                  ? `≈ ${zoneStr(setup.provisionalEntry.low, setup.provisionalEntry.high)}`
                  : "—"
              const stop = plan
                ? priceStr(plan.stop)
                : setup?.provisionalStop
                  ? `≈ ${priceStr(setup.provisionalStop.level)}`
                  : "—"
              const rr = plan
                ? Number.isFinite(Number(plan.riskReward))
                  ? Number(plan.riskReward).toFixed(2)
                  : "—"
                : setup?.provisionalRiskReward != null && Number.isFinite(setup.provisionalRiskReward)
                  ? `≈ ${Number(setup.provisionalRiskReward).toFixed(2)}`
                  : "—"
              const stateMeta = view ? STATE_LABEL[view.state] : null
              const open = openId === r.companyId
              return (
                <Fragment key={r.companyId}>
                  <tr
                    onClick={() => setOpenId(open ? null : r.companyId)}
                    className={`cursor-pointer border-b border-border/40 transition-colors hover:bg-muted/30 ${open ? "bg-muted/20" : ""}`}
                  >
                    <td className="px-2 py-1.5">
                      <Link
                        href={`/company/${r.companyId}?tab=technical`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-bold text-foreground hover:text-primary"
                        dir="ltr"
                      >
                        {r.ticker}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-1 tabular" dir="ltr">
                        <span className="font-semibold text-foreground">{r.lastClose?.toFixed(2) ?? "—"}</span>
                        <span className={`text-[10px] font-semibold ${pctCls(r.changePct)}`}>
                          {r.changePct !== null && r.changePct > 0 ? <ArrowUpRight className="inline h-2.5 w-2.5" aria-hidden /> : r.changePct !== null && r.changePct < 0 ? <ArrowDownRight className="inline h-2.5 w-2.5" aria-hidden /> : null}
                          {pctStr(r.changePct)}
                        </span>
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      {stateMeta ? (
                        <span className={`inline-flex items-center gap-1 font-semibold ${stateMeta.text}`} title={view?.direction === "buy" ? (ar ? "قراءة شراء" : "buy read") : view?.direction === "sell" ? (ar ? "قراءة بيع" : "sell read") : undefined}>
                          <span className={`h-1.5 w-1.5 rounded-full ${stateMeta.dot}`} aria-hidden />
                          {ar ? stateMeta.ar : stateMeta.en}
                          {view?.direction ? (
                            <span className={`rounded px-1 text-[9px] font-bold ${view.direction === "buy" ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative"}`} dir={ar ? undefined : "ltr"}>
                              {ar ? (view.direction === "buy" ? "شراء" : "بيع") : view.direction === "buy" ? "BUY" : "SELL"}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 tabular text-blue-600 dark:text-blue-400" dir="ltr" title={plan ? undefined : setup?.provisionalEntry ? (ar ? "مستويات تقديرية عند التفعيل" : "provisional at activation") : undefined}>{entry}</td>
                    <td className="px-2 py-1.5 tabular text-negative" dir="ltr">{stop}</td>
                    <td className="px-2 py-1.5 tabular" dir="ltr">{rr}</td>
                    <td className="px-2 py-1.5 tabular" dir="ltr">
                      {t1 ? <span className="font-semibold text-foreground">{priceStr(t1.price)}</span> : "—"}
                    </td>
                    <td className="px-2 py-1.5 tabular text-muted-foreground" dir="ltr">{t2 ? priceStr(t2.price) : "—"}</td>
                    <td className="px-2 py-1.5 tabular text-muted-foreground" dir="ltr">{t3 ? priceStr(t3.price) : "—"}</td>
                    <td className={`px-2 py-1.5 font-semibold tabular ${pctCls(view?.remainingPctToT1 ?? null)}`} dir="ltr" title={ar ? "من السعر الحالي حتى الهدف الأول" : "from the current price to T1"}>
                      {view ? pctStr(view.remainingPctToT1) : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      {op?.oqs !== undefined && op?.oqs !== null ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="font-bold tabular text-foreground" dir="ltr">{op.oqs}</span>
                          <span className="h-1 w-8 overflow-hidden rounded-full bg-muted" aria-hidden>
                            <span
                              className="block h-full rounded-full bg-positive"
                              style={{ width: `${Math.max(0, Math.min(100, op.oqs))}%` }}
                            />
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-1 py-1.5 text-muted-foreground">
                      <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                    </td>
                  </tr>
                  {open ? (
                    <tr className="border-b border-border/40 bg-muted/10">
                      <td colSpan={12} className="px-3 py-2">
                        <NotesPanel row={r} op={op ?? null} ar={ar} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/** The per-stock notes panel — everything the engine computed, verbatim. */
function NotesPanel({ row, op, ar }: { row: MarketSignalRow; op: RowOpportunity | null; ar: boolean }) {
  const view = op?.view ?? null
  const targets = op?.ladder?.targets ?? null
  const reasons = row.reasons ?? []
  return (
    <div className="space-y-1.5 text-[11px] leading-relaxed">
      {view ? (
        <>
          <p className="font-semibold text-foreground">{view.stateNoteAr}</p>
          {op?.planRebuiltNoteAr ? <p className="text-blue-600 dark:text-blue-400">{op.planRebuiltNoteAr}</p> : null}
          {op?.setupDroppedNoteAr ? <p className="text-amber-600 dark:text-amber-400">{op.setupDroppedNoteAr}</p> : null}
          {view.rejectionReasonsAr.length > 0 ? (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground">{ar ? "ما الذي قد يفشل:" : "What may fail:"}</p>
              <ul className="mt-0.5 space-y-0.5">
                {view.rejectionReasonsAr.map((x, i) => (
                  <li key={i} className="text-negative">{x}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-muted-foreground">
            <span className="font-semibold">{ar ? "راقب ماذا: " : "Watch: "}</span>
            {view.watchNextAr}
          </p>
          {targets && targets.length > 0 ? (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground">{ar ? "أدلة الأهداف:" : "Target evidence:"}</p>
              <ul className="mt-0.5 space-y-0.5">
                {targets.map((t) => (
                  <li key={t.label} className="text-muted-foreground">
                    <span className="font-bold text-foreground" dir="ltr">{t.label} {priceStr(t.price)}</span> — {t.whyAr}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {op?.oqsNoteAr ? <p className="text-muted-foreground">{op.oqsNoteAr}</p> : null}
        </>
      ) : (
        <p className="text-muted-foreground">
          {ar
            ? "قراءة غير مرشحة لطبقة الفرص (انتظار أو بلا تفعيل هيكلي) — لا مستويات ولا أهداف تُصنَّع."
            : "Non-candidate read (wait / no structural trigger) — no levels or targets are manufactured."}
          {reasons.length > 0 ? ` ${reasons.map((x) => x.ar).join(" · ")}` : ""}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">
        {ar ? "آخر تحديث: " : "As of: "}
        <span dir="ltr">{row.asOf ?? "—"}</span>
      </p>
    </div>
  )
}
