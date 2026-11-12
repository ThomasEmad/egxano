// Piotroski F-Score — deterministic, criterion-transparent implementation
// (piotroski@1). Methodology charter: docs/product/quant-research-methodology.md
//
// Contract (mirrors src/lib/financial/calc.ts discipline):
//   * Pure evaluation on explicit period values — no DB access inside
//     `evaluatePiotroski`, so the 9 criteria are unit-testable verbatim.
//   * Missing/insufficient inputs → NOT_EVALUABLE with the reason attached;
//     never zero, never a guessed value.
//   * Every criterion carries its actual input figures + which period they
//     came from, so the UI can show evidence next to each pass/fail (the
//     deliberate counter-position to competitors' opaque "X/9" badges).
//   * Fallbacks (LONG_TERM_DEBT → TOTAL_LIABILITIES, <1% dilution = flat)
//     are labeled notes, not silent substitutions.

import { db } from "@/lib/db"

export const PIOTROSKI_VERSION = "piotroski@1"

const CODES = [
  "REVENUE",
  "GROSS_PROFIT",
  "NET_PROFIT",
  "TOTAL_ASSETS",
  "TOTAL_LIABILITIES",
  "LONG_TERM_DEBT",
  "CURRENT_ASSETS",
  "CURRENT_LIABILITIES",
  "OPERATING_CASH_FLOW",
  "SHARES_OUTSTANDING",
] as const

export type PiotroskiCode = (typeof CODES)[number]

export type PeriodValues = Partial<Record<PiotroskiCode, number>>

export type CriterionStatus = "PASS" | "FAIL" | "NOT_EVALUABLE"

export type CriterionInput = {
  code: PiotroskiCode
  labelEn: string
  labelAr: string
  period: "current" | "prior"
  value: number | null
}

export type PiotroskiCriterion = {
  id: string
  labelEn: string
  labelAr: string
  status: CriterionStatus
  passed: boolean | null
  inputs: CriterionInput[]
  noteEn?: string
  noteAr?: string
}

export type PiotroskiEvaluation = {
  score: number
  evaluated: number
  criteria: PiotroskiCriterion[]
  warningsEn: string[]
  warningsAr: string[]
}

const INPUT_LABELS: Record<PiotroskiCode, { en: string; ar: string }> = {
  REVENUE: { en: "Revenue", ar: "الإيرادات" },
  GROSS_PROFIT: { en: "Gross profit", ar: "إجمالي الربح" },
  NET_PROFIT: { en: "Net profit", ar: "صافي الربح" },
  TOTAL_ASSETS: { en: "Total assets", ar: "إجمالي الأصول" },
  TOTAL_LIABILITIES: { en: "Total liabilities", ar: "إجمالي الالتزامات" },
  LONG_TERM_DEBT: { en: "Long-term debt", ar: "الدين طويل الأجل" },
  CURRENT_ASSETS: { en: "Current assets", ar: "الأصول المتداولة" },
  CURRENT_LIABILITIES: { en: "Current liabilities", ar: "الالتزامات المتداولة" },
  OPERATING_CASH_FLOW: { en: "Operating cash flow", ar: "التدفق النقدي التشغيلي" },
  SHARES_OUTSTANDING: { en: "Shares outstanding", ar: "عدد الأسهم" },
}

const val = (p: PeriodValues, c: PiotroskiCode): number | null => {
  const v = p[c]
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

function input(code: PiotroskiCode, period: "current" | "prior", v: number | null): CriterionInput {
  return { code, labelEn: INPUT_LABELS[code].en, labelAr: INPUT_LABELS[code].ar, period, value: v }
}

/** Bilingual note helper — keeps criterion construction terse. */
function notes(en: string, ar: string) {
  return { noteEn: en, noteAr: ar }
}

/** Safe ratio: null when denominator missing/non-positive (never divides by ≤ 0). */
function ratio(n: number | null, d: number | null): number | null {
  if (n === null || d === null || d <= 0) return null
  return n / d
}

/**
 * The nine Piotroski criteria on two consecutive ANNUAL periods.
 * `current` = latest fiscal year, `previous` = the year before it.
 * Assets are period-end (not averages) so both years are computed
 * identically — the choice is disclosed on every ROA criterion note.
 */
export function evaluatePiotroski(current: PeriodValues, previous: PeriodValues): PiotroskiEvaluation {
  const criteria: PiotroskiCriterion[] = []
  const warningsEn: string[] = []
  const warningsAr: string[] = []

  const push = (c: PiotroskiCriterion) => criteria.push(c)

  const roaOf = (p: PeriodValues): number | null => ratio(val(p, "NET_PROFIT"), val(p, "TOTAL_ASSETS"))

  // 1. Positive ROA
  {
    const roa = roaOf(current)
    const ok = roa !== null
    push({
      id: "roa_positive",
      labelEn: "Positive return on assets",
      labelAr: "عائد إيجابي على الأصول",
      status: ok ? (roa > 0 ? "PASS" : "FAIL") : "NOT_EVALUABLE",
      passed: ok ? roa > 0 : null,
      inputs: [input("NET_PROFIT", "current", val(current, "NET_PROFIT")), input("TOTAL_ASSETS", "current", val(current, "TOTAL_ASSETS"))],
      ...notes(
        "Net profit ÷ period-end total assets",
        "صافي الربح ÷ إجمالي الأصول في نهاية الفترة",
      ),
    })
  }

  // 2. Positive operating cash flow
  {
    const ocf = val(current, "OPERATING_CASH_FLOW")
    push({
      id: "ocf_positive",
      labelEn: "Positive operating cash flow",
      labelAr: "تدفق نقدي تشغيلي إيجابي",
      status: ocf === null ? "NOT_EVALUABLE" : ocf > 0 ? "PASS" : "FAIL",
      passed: ocf === null ? null : ocf > 0,
      inputs: [input("OPERATING_CASH_FLOW", "current", ocf)],
    })
  }

  // 3. ROA improving
  {
    const roaC = roaOf(current)
    const roaP = roaOf(previous)
    const ok = roaC !== null && roaP !== null
    push({
      id: "roa_improving",
      labelEn: "ROA improving year over year",
      labelAr: "تحسن العائد على الأصول عن العام السابق",
      status: ok ? (roaC > roaP ? "PASS" : "FAIL") : "NOT_EVALUABLE",
      passed: ok ? roaC > roaP : null,
      inputs: [input("NET_PROFIT", "current", val(current, "NET_PROFIT")), input("TOTAL_ASSETS", "current", val(current, "TOTAL_ASSETS")), input("NET_PROFIT", "prior", val(previous, "NET_PROFIT")), input("TOTAL_ASSETS", "prior", val(previous, "TOTAL_ASSETS"))],
      ...notes(
        "Both years use period-end assets for comparability",
        "السنتان محسوبتان على أصول نهاية الفترة لضمان قابلية المقارنة",
      ),
    })
  }

  // 4. Accruals check: OCF > net profit
  {
    const ocf = val(current, "OPERATING_CASH_FLOW")
    const np = val(current, "NET_PROFIT")
    const ok = ocf !== null && np !== null
    push({
      id: "ocf_above_profit",
      labelEn: "Cash flow exceeds accounting profit (quality of earnings)",
      labelAr: "التدفق النقدي يتجاوز الربح المحاسبي (جودة الأرباح)",
      status: ok ? (ocf > np ? "PASS" : "FAIL") : "NOT_EVALUABLE",
      passed: ok ? ocf > np : null,
      inputs: [input("OPERATING_CASH_FLOW", "current", ocf), input("NET_PROFIT", "current", np)],
    })
  }

  // 5. Leverage decreasing — LONG_TERM_DEBT with a labeled fallback
  {
    const debtCode: PiotroskiCode = val(current, "LONG_TERM_DEBT") !== null || val(previous, "LONG_TERM_DEBT") !== null ? "LONG_TERM_DEBT" : "TOTAL_LIABILITIES"
    const levC = ratio(val(current, debtCode), val(current, "TOTAL_ASSETS"))
    const levP = ratio(val(previous, debtCode), val(previous, "TOTAL_ASSETS"))
    const ok = levC !== null && levP !== null
    const usedFallback = debtCode === "TOTAL_LIABILITIES"
    push({
      id: "leverage_down",
      labelEn: usedFallback ? "Leverage decreasing (total liabilities basis)" : "Leverage decreasing (long-term debt basis)",
      labelAr: usedFallback ? "انخفاض الرفع المالي (ع أساس إجمالي الالتزامات)" : "انخفاض الرفع المالي (ع أساس الدين طويل الأجل)",
      status: ok ? (levC < levP ? "PASS" : "FAIL") : "NOT_EVALUABLE",
      passed: ok ? levC < levP : null,
      inputs: [input(debtCode, "current", val(current, debtCode)), input("TOTAL_ASSETS", "current", val(current, "TOTAL_ASSETS")), input(debtCode, "prior", val(previous, debtCode)), input("TOTAL_ASSETS", "prior", val(previous, "TOTAL_ASSETS"))],
      ...(usedFallback
        ? notes(
            "Long-term debt unavailable for at least one period — total liabilities used (disclosed fallback)",
            "الدين طويل الأجل غير متاح لإحدى الفترتين — تم استخدام إجمالي الالتزامات (بديل معلن)",
          )
        : notes(
            "Long-term debt ÷ period-end total assets",
            "الدين طويل الأجل ÷ إجمالي الأصول في نهاية الفترة",
          )),
    })
  }

  // 6. Current ratio improving
  {
    const crC = ratio(val(current, "CURRENT_ASSETS"), val(current, "CURRENT_LIABILITIES"))
    const crP = ratio(val(previous, "CURRENT_ASSETS"), val(previous, "CURRENT_LIABILITIES"))
    const ok = crC !== null && crP !== null
    push({
      id: "current_ratio_up",
      labelEn: "Current ratio improving",
      labelAr: "تحسن نسبة التداول",
      status: ok ? (crC > crP ? "PASS" : "FAIL") : "NOT_EVALUABLE",
      passed: ok ? crC > crP : null,
      inputs: [input("CURRENT_ASSETS", "current", val(current, "CURRENT_ASSETS")), input("CURRENT_LIABILITIES", "current", val(current, "CURRENT_LIABILITIES")), input("CURRENT_ASSETS", "prior", val(previous, "CURRENT_ASSETS")), input("CURRENT_LIABILITIES", "prior", val(previous, "CURRENT_LIABILITIES"))],
    })
  }

  // 7. No share dilution — <1% treated as flat (labeled)
  {
    const shC = val(current, "SHARES_OUTSTANDING")
    const shP = val(previous, "SHARES_OUTSTANDING")
    const ok = shC !== null && shP !== null
    if (ok) {
      const growth = (shC - shP) / shP
      const flat = growth > 0 && growth < 0.01
      push({
        id: "no_dilution",
        labelEn: "No material share dilution",
        labelAr: "لا زيادة جوهرية في عدد الأسهم",
        status: shC <= shP ? "PASS" : flat ? "PASS" : "FAIL",
        passed: shC <= shP || flat,
        inputs: [input("SHARES_OUTSTANDING", "current", shC), input("SHARES_OUTSTANDING", "prior", shP)],
        ...(flat
          ? notes(
              `Share count rose ${(growth * 100).toFixed(2)}% — under 1%, treated as unchanged`,
              `عدد الأسهم زاد بنسبة ${(growth * 100).toFixed(2)}% — أقل من 1%، تُعامل كغير متغيرة`,
            )
          : {}),
      })
    } else {
      push({
        id: "no_dilution",
        labelEn: "No material share dilution",
        labelAr: "لا زيادة جوهرية في عدد الأسهم",
        status: "NOT_EVALUABLE",
        passed: null,
        inputs: [input("SHARES_OUTSTANDING", "current", shC), input("SHARES_OUTSTANDING", "prior", shP)],
      })
    }
  }

  // 8. Gross margin improving
  {
    const gmC = ratio(val(current, "GROSS_PROFIT"), val(current, "REVENUE"))
    const gmP = ratio(val(previous, "GROSS_PROFIT"), val(previous, "REVENUE"))
    const ok = gmC !== null && gmP !== null
    push({
      id: "gross_margin_up",
      labelEn: "Gross margin improving",
      labelAr: "تحسن هامش إجمالي الربح",
      status: ok ? (gmC > gmP ? "PASS" : "FAIL") : "NOT_EVALUABLE",
      passed: ok ? gmC > gmP : null,
      inputs: [input("GROSS_PROFIT", "current", val(current, "GROSS_PROFIT")), input("REVENUE", "current", val(current, "REVENUE")), input("GROSS_PROFIT", "prior", val(previous, "GROSS_PROFIT")), input("REVENUE", "prior", val(previous, "REVENUE"))],
    })
  }

  // 9. Asset turnover improving
  {
    const atC = ratio(val(current, "REVENUE"), val(current, "TOTAL_ASSETS"))
    const atP = ratio(val(previous, "REVENUE"), val(previous, "TOTAL_ASSETS"))
    const ok = atC !== null && atP !== null
    push({
      id: "asset_turnover_up",
      labelEn: "Asset turnover improving",
      labelAr: "تحسن معدل دوران الأصول",
      status: ok ? (atC > atP ? "PASS" : "FAIL") : "NOT_EVALUABLE",
      passed: ok ? atC > atP : null,
      inputs: [input("REVENUE", "current", val(current, "REVENUE")), input("TOTAL_ASSETS", "current", val(current, "TOTAL_ASSETS")), input("REVENUE", "prior", val(previous, "REVENUE")), input("TOTAL_ASSETS", "prior", val(previous, "TOTAL_ASSETS"))],
    })
  }

  const evaluated = criteria.filter((c) => c.status !== "NOT_EVALUABLE").length
  if (evaluated < 9) {
    warningsEn.push(`${9 - evaluated} of 9 criteria could not be evaluated for this company (missing statement items) — the score covers evaluated criteria only.`)
    warningsAr.push(`تعذّر تقييم ${9 - evaluated} من أصل 9 معايير لهذه الشركة (بنود غير متوفرة في القوائم) — الدرجة تغطي المعايير المقيّمة فقط.`)
  }

  const score = criteria.reduce((a, c) => a + (c.status === "PASS" ? 1 : 0), 0)
  return { score, evaluated, criteria, warningsEn, warningsAr }
}

// ---------------------------------------------------------------------------
// Database layer — two most recent ANNUAL reports with matching statement
// basis, values from FinancialValue.normalizedValue only (no unit guessing).
// ---------------------------------------------------------------------------

export type PiotroskiResult = {
  companyId: string
  score: number
  evaluated: number
  criteria: PiotroskiCriterion[]
  currentPeriod: { fiscalYear: number; periodLabel: string } | null
  priorPeriod: { fiscalYear: number; periodLabel: string } | null
  basis: "CONSOLIDATED" | "STANDALONE"
  version: string
  computedAt: string
  warnings: string[]
  warningsAr: string[]
}

const PROCESSING_OK = ["VALIDATED", "APPROVED", "EXTRACTED"] as const

type ReportLite = { id: string; fiscalYear: number; periodLabel: string; statementType: string }

/** Row shape we need for picking values (reportId optional so filtered subsets fit too). */
type MetricRow = {
  id: string
  reportId?: string
  metricCode: string
  normalizedValue: number | null
  validationStatus: string
  subPeriod: string | null
}

/** Deterministic value pick: no subPeriod first, VALID first, stable by id. */
function pickValue(rows: readonly MetricRow[], code: PiotroskiCode): number | null {
  const candidates = rows
    .filter((r) => r.metricCode === code)
    .sort((a, b) => {
      const subA = a.subPeriod === null ? 0 : 1
      const subB = b.subPeriod === null ? 0 : 1
      if (subA !== subB) return subA - subB
      const valA = a.validationStatus === "VALID" ? 0 : 1
      const valB = b.validationStatus === "VALID" ? 0 : 1
      if (valA !== valB) return valA - valB
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
  for (const r of candidates) {
    if (r.normalizedValue !== null && Number.isFinite(r.normalizedValue)) return r.normalizedValue
  }
  return null
}

function valuesFor(rows: readonly MetricRow[], codes: readonly PiotroskiCode[]): PeriodValues {
  const out: PeriodValues = {}
  for (const c of codes) {
    const v = pickValue(rows, c)
    if (v !== null) out[c] = v
  }
  return out
}

export async function computePiotroski(companyId: string): Promise<PiotroskiResult | null> {
  const reports = await db.financialReport.findMany({
    where: {
      companyId,
      periodType: "ANNUAL",
      deletedAt: null,
      processingStatus: { in: [...PROCESSING_OK] },
    },
    orderBy: [{ fiscalYear: "desc" }, { periodEnd: "desc" }],
    select: { id: true, fiscalYear: true, periodLabel: true, statementType: true },
    take: 24,
  })
  if (reports.length === 0) return null

  // Group by fiscal year; within a year prefer CONSOLIDATED, then the newest row.
  const byYear = new Map<number, ReportLite[]>()
  for (const r of reports) {
    const list = byYear.get(r.fiscalYear) ?? []
    list.push(r)
    byYear.set(r.fiscalYear, list)
  }
  const years = [...byYear.keys()].sort((a, b) => b - a)
  if (years.length < 2) return null

  const preferredFor = (year: number, basis: "CONSOLIDATED" | "STANDALONE"): ReportLite | null => {
    const list = byYear.get(year) ?? []
    return list.find((r) => r.statementType === basis) ?? null
  }

  // Pick the newest year, then the best matching basis that BOTH years share.
  const latestYear = years[0]
  const priorYear = years.find((y) => y < latestYear)!
  const curCons = preferredFor(latestYear, "CONSOLIDATED")
  const prevCons = preferredFor(priorYear, "CONSOLIDATED")
  const curStand = preferredFor(latestYear, "STANDALONE")
  const prevStand = preferredFor(priorYear, "STANDALONE")

  let basis: "CONSOLIDATED" | "STANDALONE"
  let current: ReportLite | null
  let previous: ReportLite | null
  const warnings: string[] = []
  const warningsAr: string[] = []

  if (curCons && prevCons) {
    basis = "CONSOLIDATED"
    current = curCons
    previous = prevCons
  } else if (curStand && prevStand) {
    basis = "STANDALONE"
    current = curStand
    previous = prevStand
  } else {
    // Mixed basis — still evaluated (both are published statements) but disclosed.
    basis = curCons ? "CONSOLIDATED" : "STANDALONE"
    current = curCons ?? curStand
    previous = prevCons ?? prevStand
    if (!current || !previous) return null
    warnings.push("Consolidated and standalone statements are mixed between the two periods — compare with care.")
    warningsAr.push("القوائم المجمعة والمنفصلة مختلطة بين الفترتين — قارن بحذر.")
  }

  const rows = await db.financialValue.findMany({
    where: { reportId: { in: [current.id, previous.id] }, metricCode: { in: [...CODES] } },
    select: { id: true, reportId: true, metricCode: true, normalizedValue: true, validationStatus: true, subPeriod: true },
  })
  const curRows = rows.filter((r) => r.reportId === current!.id)
  const prevRows = rows.filter((r) => r.reportId === previous!.id)
  const currentValues = valuesFor(curRows, CODES)
  const previousValues = valuesFor(prevRows, CODES)

  const evaluation = evaluatePiotroski(currentValues, previousValues)

  if (latestYear - priorYear !== 1) {
    warnings.push(`The two latest annual periods are ${priorYear} and ${latestYear} — not strictly consecutive fiscal years.`)
    warningsAr.push(`أحدث فترتين سنويتين هما ${priorYear} و${latestYear} — ليستا سنتين مالية متتاليتين بشكل صارم.`)
  }

  return {
    companyId,
    score: evaluation.score,
    evaluated: evaluation.evaluated,
    criteria: evaluation.criteria,
    currentPeriod: { fiscalYear: current.fiscalYear, periodLabel: current.periodLabel },
    priorPeriod: { fiscalYear: previous.fiscalYear, periodLabel: previous.periodLabel },
    basis,
    version: PIOTROSKI_VERSION,
    computedAt: new Date().toISOString(),
    warnings: [...warnings, ...evaluation.warningsEn],
    warningsAr: [...warningsAr, ...evaluation.warningsAr],
  }
}
