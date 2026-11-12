"use client"

// Piotroski F-Score card — criterion-level fundamental quality with evidence.
// Every pass/fail row shows the actual figures and the period they came from
// (deliberately unlike competitors' opaque "X/9" badges). States: loading /
// error / no-two-annual-periods / partial-evaluation — all first-class UI.

import { useQuery } from "@tanstack/react-query"
import { Activity, Check, Minus, RefreshCw, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useI18n } from "@/lib/i18n"
import { formatEgp, formatPercent, formatRatio } from "@/lib/financial/units"

type Criterion = {
  id: string
  labelEn: string
  labelAr: string
  status: "PASS" | "FAIL" | "NOT_EVALUABLE"
  passed: boolean | null
  inputs: { code: string; labelEn: string; labelAr: string; period: "current" | "prior"; value: number | null }[]
  noteEn?: string
  noteAr?: string
}

type FScoreData = {
  companyId: string
  score: number
  evaluated: number
  criteria: Criterion[]
  currentPeriod: { fiscalYear: number; periodLabel: string } | null
  priorPeriod: { fiscalYear: number; periodLabel: string } | null
  basis: "CONSOLIDATED" | "STANDALONE"
  version: string
  warnings: string[]
  warningsAr: string[]
}

/** Input figures relevant per criterion (compact evidence line). */
const EVIDENCE_CODES: Record<string, string[]> = {
  roa_positive: ["NET_PROFIT", "TOTAL_ASSETS"],
  ocf_positive: ["OPERATING_CASH_FLOW"],
  roa_improving: ["NET_PROFIT", "TOTAL_ASSETS"],
  ocf_above_profit: ["OPERATING_CASH_FLOW", "NET_PROFIT"],
  leverage_down: ["LONG_TERM_DEBT", "TOTAL_LIABILITIES", "TOTAL_ASSETS"],
  current_ratio_up: ["CURRENT_ASSETS", "CURRENT_LIABILITIES"],
  no_dilution: ["SHARES_OUTSTANDING"],
  gross_margin_up: ["GROSS_PROFIT", "REVENUE"],
  asset_turnover_up: ["REVENUE", "TOTAL_ASSETS"],
}

const RATIO_LIKE = new Set(["TOTAL_ASSETS", "CURRENT_ASSETS", "CURRENT_LIABILITIES", "LONG_TERM_DEBT", "TOTAL_LIABILITIES", "SHARES_OUTSTANDING"])

function fmtInput(code: string, v: number | null): string {
  if (v === null) return "—"
  if (code === "SHARES_OUTSTANDING") return v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : formatRatio(v, 0)
  if (RATIO_LIKE.has(code)) return formatEgp(v)
  return formatEgp(v)
}

/** Ratios shown as percent per criterion id, computed client-side from inputs. */
function derived(c: Criterion): string | null {
  const g = (code: string, period: "current" | "prior") =>
    c.inputs.find((i) => i.code === code && i.period === period)?.value ?? null
  const pct = (n: number | null, d: number | null) => (n !== null && d !== null && d > 0 ? formatPercent(n / d) : null)
  switch (c.id) {
    case "roa_positive":
      return pct(g("NET_PROFIT", "current"), g("TOTAL_ASSETS", "current"))
    case "roa_improving": {
      const cur = pct(g("NET_PROFIT", "current"), g("TOTAL_ASSETS", "current"))
      const prev = pct(g("NET_PROFIT", "prior"), g("TOTAL_ASSETS", "prior"))
      return cur && prev ? `${prev} → ${cur}` : cur
    }
    case "current_ratio_up": {
      const cur = formatRatio(g("CURRENT_ASSETS", "current") !== null && g("CURRENT_LIABILITIES", "current") ? (g("CURRENT_ASSETS", "current") ?? 0) / (g("CURRENT_LIABILITIES", "current") ?? 1) : null)
      const prev = formatRatio(g("CURRENT_ASSETS", "prior") !== null && g("CURRENT_LIABILITIES", "prior") ? (g("CURRENT_ASSETS", "prior") ?? 0) / (g("CURRENT_LIABILITIES", "prior") ?? 1) : null)
      return cur !== "—" && prev !== "—" ? `${prev} → ${cur}` : cur
    }
    case "leverage_down": {
      const debt = (p: "current" | "prior") => g("LONG_TERM_DEBT", p) ?? g("TOTAL_LIABILITIES", p)
      const cur = pct(debt("current"), g("TOTAL_ASSETS", "current"))
      const prev = pct(debt("prior"), g("TOTAL_ASSETS", "prior"))
      return cur && prev ? `${prev} → ${cur}` : cur
    }
    case "gross_margin_up": {
      const cur = pct(g("GROSS_PROFIT", "current"), g("REVENUE", "current"))
      const prev = pct(g("GROSS_PROFIT", "prior"), g("REVENUE", "prior"))
      return cur && prev ? `${prev} → ${cur}` : cur
    }
    case "asset_turnover_up": {
      const cur = formatRatio(g("REVENUE", "current") !== null && g("TOTAL_ASSETS", "current") ? (g("REVENUE", "current") ?? 0) / (g("TOTAL_ASSETS", "current") ?? 1) : null)
      const prev = formatRatio(g("REVENUE", "prior") !== null && g("TOTAL_ASSETS", "prior") ? (g("REVENUE", "prior") ?? 0) / (g("TOTAL_ASSETS", "prior") ?? 1) : null)
      return cur !== "—" && prev !== "—" ? `${prev} → ${cur}` : cur
    }
    case "no_dilution": {
      const cur = g("SHARES_OUTSTANDING", "current")
      const prev = g("SHARES_OUTSTANDING", "prior")
      if (cur === null || prev === null) return null
      const delta = ((cur - prev) / prev) * 100
      return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`
    }
    default:
      return null
  }
}

export function FScoreCard({ companyId }: { companyId: string }) {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["f-score", companyId],
    queryFn: () =>
      fetch(`/api/v1/companies/${encodeURIComponent(companyId)}/f-score`).then((r) =>
        r.ok ? (r.json() as Promise<FScoreData>) : null,
      ),
    staleTime: 300_000,
  })

  if (isLoading) {
    return (
      <Card className="border-border/60">
        <CardHeader className="pb-3 px-5">
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent className="px-5 space-y-2">
          <Skeleton className="h-8 w-32" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  if (isError) {
    return (
      <Card className="border-border/60">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {ar ? "تعذر تحميل درجة الأساسيات — تحقق من الاتصال." : "Could not load the F-Score — check your connection."}
          </p>
          <button onClick={() => refetch()} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent">
            <RefreshCw className="h-3 w-3" aria-hidden />
            {ar ? "إعادة المحاولة" : "Retry"}
          </button>
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    // 404: fewer than two annual reports — honest empty state, not a fake score.
    return (
      <Card className="border-border/60">
        <CardContent className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {ar
              ? "درجة Piotroski تحتاج قائمين سنويين منشورين — تظهر تلقائيًا عند توفرهما."
              : "The Piotroski score needs two published annual statements — it appears automatically once available."}
          </p>
        </CardContent>
      </Card>
    )
  }

  const scoreTone = data.score >= 7 ? "text-success" : data.score >= 5 ? "text-warning" : "text-destructive"
  const warnings = ar ? data.warningsAr : data.warnings
  const basisLabel = data.basis === "CONSOLIDATED" ? (ar ? "قوائم مجمعة" : "consolidated") : ar ? "قوائم منفصلة" : "standalone"

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3 px-5">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
          <Activity className="h-3.5 w-3.5 text-primary" aria-hidden />
          {ar ? "جودة الأساسيات — Piotroski F-Score" : "Fundamental quality — Piotroski F-Score"}
          <span className={`text-xl font-bold tabular ${scoreTone}`} dir="ltr">
            {data.score}/9
          </span>
          <span className="text-[10px] font-normal text-muted-foreground">
            {ar
              ? `${data.currentPeriod?.fiscalYear ?? ""} مقابل ${data.priorPeriod?.fiscalYear ?? ""} · ${basisLabel}${data.evaluated < 9 ? ` · ${data.evaluated} من 9 معيار مُقيّم` : ""}`
              : `${data.currentPeriod?.fiscalYear ?? ""} vs ${data.priorPeriod?.fiscalYear ?? ""} · ${basisLabel}${data.evaluated < 9 ? ` · ${data.evaluated} of 9 criteria evaluated` : ""}`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        <ul className="divide-y divide-border/40">
          {data.criteria.map((c) => {
            const ev = derived(c)
            return (
              <li key={c.id} className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
                <span
                  className={`mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full ${
                    c.status === "PASS"
                      ? "bg-positive/15 text-positive"
                      : c.status === "FAIL"
                        ? "bg-negative/15 text-negative"
                        : "bg-muted text-muted-foreground"
                  }`}
                  aria-hidden
                >
                  {c.status === "PASS" ? <Check className="h-3 w-3" /> : c.status === "FAIL" ? <X className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium leading-snug text-foreground">
                    {ar ? c.labelAr : c.labelEn}
                    {ev ? (
                      <span className="ms-2 font-normal tabular text-muted-foreground" dir="ltr">
                        {ev}
                      </span>
                    ) : null}
                  </p>
                  {(ar ? c.noteAr : c.noteEn) ? (
                    <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{ar ? c.noteAr : c.noteEn}</p>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
        {warnings.length > 0 ? (
          <ul className="mt-3 space-y-1 rounded-lg bg-warning/10 border border-warning/20 p-2.5">
            {warnings.map((w, i) => (
              <li key={i} className="text-[10px] leading-snug text-warning-foreground">
                {w}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
          {ar
            ? "معيار Piotroski التساعي يُحسب آليًا من القوائم السنوية المنشورة — معايير النجاح/الفشل قواعد محاسبية معلنة وليست توصية استثمارية."
            : "The nine Piotroski criteria are computed automatically from published annual statements — pass/fail rules are disclosed accounting tests, not investment advice."}
        </p>
      </CardContent>
    </Card>
  )
}
