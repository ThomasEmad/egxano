// =============================================================================
// Report context builder — assembles the FULL grounded input for a report:
// financial snapshot (verified values only) + deterministic extended metrics
// + technical snapshot (deterministic indicators over real daily bars).
// Everything here is computable, hashable and reproducible. The LLM only
// interprets; it never calculates and never receives unverifiable data.
// =============================================================================

import { db } from "@/lib/db"
import { buildAiSnapshotBundle } from "@/lib/ai/analysis-snapshot"
import { buildExtendedMetrics, type PeriodInput } from "@/lib/financial/report-metrics"
import { buildTechnicalBundle, TECHNICAL_VERSION, type TechnicalBundle } from "@/lib/technical/analyze"
import { parsePeriodKey } from "@/lib/financial/periods"
import { cached, invalidateServerCache } from "@/lib/server-cache"
import { CONFIG_VERSION, PROMPT_VERSION, REPORT_DEPTH, buildReportKey } from "./identity"

export interface ReportContext {
  company: { id: string; ticker: string; nameEn: string; nameAr: string | null; sector: string; industry: string | null }
  lang: "ar" | "en"
  reportKey: string
  financialJson: string
  financialDataHash: string
  technical: TechnicalBundle | null
  extendedMetricsJson: string
  /** market data actually embedded (from the financial snapshot) */
  priceAsOf: string | null
  completeness: {
    financialCoveragePct: number | null
    technicalCoveragePct: number | null
    limitations: string[]
  }
  periodKey: string | null
  financialAsOf: string | null
  promptPeriodCount: number
  hasFinancialData: boolean
}

interface FinancialSnapshotShape {
  company?: { ticker?: string }
  statementBasis?: string
  periods?: { periodKey: string; periodLabel: string; periodType: string; fiscalYear: number; calculatedMetrics?: Record<string, unknown>; rawValues?: Record<string, unknown> }[]
  market?: { price?: number; priceAsOf?: string; dps12m?: number | null; hasDividendRecords?: boolean }
}

/** Convert a parsed financial snapshot into the extended-metrics input. */
function toPeriodInputs(snap: FinancialSnapshotShape): PeriodInput[] {
  const out: PeriodInput[] = []
  for (const p of snap.periods ?? []) {
    const raw: Record<string, number> = {}
    for (const [k, v] of Object.entries(p.rawValues ?? {})) {
      if (typeof v === "number" && Number.isFinite(v)) raw[k] = v
    }
    const calc: Record<string, number> = {}
    for (const [k, v] of Object.entries(p.calculatedMetrics ?? {})) {
      if (typeof v === "number" && Number.isFinite(v)) calc[k] = v
    }
    out.push({ periodKey: p.periodKey, periodLabel: p.periodLabel, periodType: p.periodType, fiscalYear: p.fiscalYear, raw, calc })
  }
  return out
}

/** Count the share of non-unavailable extended metrics (honest coverage). */
function coveragePct(groups: Record<string, { status: string }>[]): number | null {
  let total = 0
  let ok = 0
  for (const g of groups) {
    for (const m of Object.values(g)) {
      total++
      if (m.status === "ok") ok++
    }
  }
  return total === 0 ? null : Math.round((ok / total) * 100)
}

function technicalCoverage(tech: TechnicalBundle): number {
  const s = tech.snapshot
  const checks = [
    s.trend.sma20 !== null, s.trend.sma50 !== null, s.trend.sma200 !== null,
    s.momentum.rsi14 !== null, s.momentum.macd.macd !== null, s.momentum.stochastic.k !== null,
    s.volatility.atr14 !== null, s.volatility.bollinger.upper !== null, s.volatility.histVol20 !== null,
    s.volume.relVol !== null,
    s.levels.supports.length > 0 || s.levels.resistances.length > 0,
    s.perf.m1 !== null,
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

export async function buildReportContext(
  company: { id: string; ticker: string; nameEn: string; nameAr: string | null; sector: string; industry: string | null; sharesOutstanding?: number | null; listingStatus?: string },
  lang: "ar" | "en"
): Promise<ReportContext> {
  // The context is deterministic per (company, lang, data) — cache it for 5
  // minutes so the worker invocation spends its WHOLE window on the LLM
  // instead of re-paying the ~10-20s snapshot build. Data-pipeline writes
  // call invalidateServerCache(), which clears this with the rest.
  return cached(`ai-report-ctx:${company.id}:${lang}`, 5 * 60_000, () =>
    buildReportContextUncached(company, lang)
  )
}

async function buildReportContextUncached(
  company: { id: string; ticker: string; nameEn: string; nameAr: string | null; sector: string; industry: string | null; sharesOutstanding?: number | null; listingStatus?: string },
  lang: "ar" | "en"
): Promise<ReportContext> {
  // ---------- Financial (existing verified snapshot builder) ----------
  const fin = await buildAiSnapshotBundle({
    ...company,
    sharesOutstanding: company.sharesOutstanding ?? null,
    listingStatus: company.listingStatus ?? "LISTED",
  })
  const snap = JSON.parse(fin.snapshotJson) as FinancialSnapshotShape

  // ---------- Extended deterministic metrics ----------
  const periods = toPeriodInputs(snap)
  const anchor =
    [...periods].reverse().find((p) => p.periodType === "ANNUAL") ?? periods[periods.length - 1] ?? null
  const market = {
    price: typeof snap.market?.price === "number" ? snap.market.price : null,
    dps12m: typeof snap.market?.dps12m === "number" ? snap.market.dps12m : null,
    hasDividendRecords: Boolean(snap.market?.hasDividendRecords),
  }
  const extended = anchor && periods.length ? buildExtendedMetrics(periods, anchor, market) : null
  const extendedGroups = extended
    ? [extended.profitability, extended.valuation, extended.health, extended.growthQuality]
    : []
  const extendedJson = extended ? JSON.stringify(extended) : "{}"

  // ---------- Technical (deterministic, over real daily bars) ----------
  let technical: TechnicalBundle | null = null
  try {
    technical = await buildTechnicalBundle(company.id)
  } catch {
    technical = null // price-bar table hiccup must not kill the report path
  }

  const priceAsOf =
    (snap.market?.priceAsOf ? String(snap.market.priceAsOf).slice(0, 10) : null) ??
    (technical?.snapshot.asOf ?? null)

  const reportKey = buildReportKey({
    companyId: company.id,
    financialDataHash: fin.dataHash,
    technicalHash: technical?.hash ?? null,
    priceAsOf,
    lang,
  })

  const limitations = [...(technical?.snapshot.limitations ?? [])]
  if (!fin.hasData) limitations.push("No verified financial statements are available for this company yet.")
  if (!technical || !technical.snapshot.available) limitations.push("No daily price history is stored — the technical section is unavailable rather than estimated.")

  const anchorPeriodKey = anchor?.periodKey ?? fin.latestAnnualKey ?? null
  const anchorParsed = anchorPeriodKey ? parsePeriodKey(anchorPeriodKey) : null
  const financialAsOf = anchor ? new Date(Date.UTC(anchor.fiscalYear, 12, 31)).toISOString().slice(0, 10) : null

  return {
    company,
    lang,
    reportKey,
    financialJson: fin.snapshotJson,
    financialDataHash: fin.dataHash,
    technical,
    extendedMetricsJson: extendedJson,
    priceAsOf,
    completeness: {
      financialCoveragePct: extended ? coveragePct(extendedGroups) : null,
      technicalCoveragePct: technical && technical.snapshot.available ? technicalCoverage(technical) : null,
      limitations,
    },
    periodKey: anchorPeriodKey,
    financialAsOf: anchorParsed ? financialAsOf : null,
    promptPeriodCount: fin.promptPeriodCount,
    hasFinancialData: fin.hasData,
    ...{ CONFIG_VERSION, PROMPT_VERSION, REPORT_DEPTH, TECHNICAL_VERSION },
  }
}

/** The exact user-message JSON the model receives (one deterministic string). */
export function buildPromptPayload(ctx: ReportContext): string {
  return JSON.stringify(
    {
      financialData: JSON.parse(ctx.financialJson),
      extendedMetrics: JSON.parse(ctx.extendedMetricsJson),
      technicalData: ctx.technical ? ctx.technical.snapshot : null,
    },
    null,
    0
  )
}

// Company lookup helper shared by routes (id | ticker | isin).
export async function resolveCompany(rawId: string) {
  const raw = decodeURIComponent(rawId)
  const upper = raw.toUpperCase()
  return db.company.findFirst({
    where: { OR: [{ id: raw }, { ticker: upper }, { isin: upper }] },
    select: { id: true, ticker: true, nameEn: true, nameAr: true, sector: true, industry: true, sharesOutstanding: true, listingStatus: true },
  })
}
