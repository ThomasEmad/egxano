// Audit Runner — orchestrates all 8 categories × all companies, computes
// quality scores, persists AuditRun + AuditIssue + CompanyConfidenceScore.
//
// v2 precision pipeline:
//   1. Values are partitioned into usable / quarantined / failed.
//   2. Accounting identities run on ONE canonical record per fiscal year
//      (annual preferred), so a FY row and its Q4 copy are never double-counted.
//   3. Every finding is classified (blocker / coverage / advisory / metadata).
//   4. Accuracy, completeness, freshness and provenance are scored separately.
//
// Idempotent: same DB state → same findings/order/counters.
//
// Execution models (both share auditCompanies + persistResults):
//   * runFullAudit               — one pass over all companies (admin trigger).
//   * startOrResumeChunkedAudit  — ≤ chunkSize companies per call, resumable via
//     a Setting cursor; the cron route chains calls until done. Lives inside
//     the serverless window no matter how the data grows.
//
// Writes are BATCHED per pass (one issue createMany + one score replace) — the
// per-company write loop (~600 round trips) was the other reason the daily
// cron outgrew its 300s window after the Nov-2026 backfill.

import { db } from "@/lib/db"
import type { AuditCheckResult, AuditRunType } from "./types"
import { computeConfidenceScore } from "./confidence-score"
import { runAccountingChecks, type BSPeriodValues } from "./accounting-checks"
import { runLogicalChecks } from "./logical-checks"
import { runTemporalChecks, type PeriodRecord } from "./temporal-checks"
import { runCrossSourceChecks, type MultiSourceObservation } from "./cross-source-checks"
import { runMissingDataChecks, criticalMetricsFor } from "./missing-data-checks"
import { runOutlierChecks } from "./outlier-checks"
import { runProvenanceChecks } from "./provenance-checks"
import { runSectorChecks } from "./sector-checks"
import { classifyCheck, type IssueClass, type RootCause } from "./issue-class"
import { isAuthoritativeValue } from "@/lib/financial/integrity-policy"

const MONTH_MS = 1000 * 60 * 60 * 24 * 30.4
const CURSOR_PREFIX = "audit_cursor:"

export interface AuditRunnerOptions {
  type?: AuditRunType
  limitCompanies?: number
  persist?: boolean
}

export interface ChunkedAuditOptions {
  type: AuditRunType
  /** Max companies processed per call. */
  chunkSize: number
  /** Continue an existing running run (cron chain). */
  resumeRunId?: string
}

export interface ChunkedAuditResult {
  done: boolean
  runId: string
  type: AuditRunType
  checkedSoFar: number
  issuesSoFar: number
  remaining: number
  lastTicker: string | null
  summary?: AuditRunSummary
}

export interface CompanyAuditOutcome {
  ticker: string
  nameEn: string
  sector: string
  issues: AuditCheckResult[]
  confidence: number
  confidenceRating: string
  accuracy: number
  completeness: number
  freshness: number
  provenance: number
  certification: string
  latestDataPeriod: string | null
  latestDataAgeMonths: number
  sources: string[]
  usableValues: number
  quarantinedValues: number
}

export interface AuditRunSummary {
  runId: string
  type: AuditRunType
  startedAt: Date
  durationSec: number
  companiesChecked: number
  issuesFound: { critical: number; high: number; medium: number; low: number; total: number }
  byClass: Record<IssueClass, number>
  byCategory: Record<string, number>
  byRootCause: Record<string, number>
  outcomes: CompanyAuditOutcome[]
}

function periodLabelOf(periodType: string, sub: string | null, fiscalYear: number): string {
  if (periodType === "ANNUAL") return `FY ${fiscalYear}`
  if (sub) return `${sub} ${fiscalYear}`
  return `${periodType} ${fiscalYear}`
}

function subOf(r: { periodType: string; periodLabel: string }): string | null {
  const l = r.periodLabel.toUpperCase()
  if (r.periodType === "QUARTERLY") { const m = l.match(/Q([1-4])/); return m ? `Q${m[1]}` : null }
  if (r.periodType === "SEMIANNUAL") { const m = l.match(/H([1-2])/); return m ? `H${m[1]}` : null }
  if (r.periodType === "NINE_MONTH") return "9M"
  return null
}

interface ValueRow {
  metricCode: string
  normalizedValue: number
  currency: string
  unit: string
  subPeriod: string | null
  validationStatus: string
  validationNotes: string | null
}

interface ReportRow {
  id: string
  periodType: string
  periodLabel: string
  fiscalYear: number
  periodEnd: Date
  statementType: string
  sourceName: string
  sourceUrl: string | null
  version: number
  extractionMethod: string | null
  createdAt: Date
  values: ValueRow[]
}

const PERIOD_PRIORITY: Record<string, number> = {
  ANNUAL: 5, NINE_MONTH: 4, SEMIANNUAL: 3, QUARTERLY: 2, TTM: 1, LTM: 1, OTHER: 0,
}

function isUsable(v: ValueRow): boolean {
  // Single source of truth: the integrity policy shared with analytics and the
  // recompute pipeline. Excludes FAILED, NEEDS_REVIEW, carried-forward copies
  // and zero placeholders — the audit must never certify data users cannot see.
  return isAuthoritativeValue(v)
}

/**
 * The values that truly belong to THIS report's own period.
 *
 * A harvested report often stores two columns per metric: CURRENT (the period
 * being reported) and PREVIOUS/Q1…Q4 (the comparative column). Treating both as
 * observations made the audit compare a period with its own prior year and
 * report fake "cross-source conflicts" and broken identities.
 *
 * Rule: CURRENT wins; otherwise the sub-period matching the report type
 * (Q1..Q4 / H1 / 9M); a single unambiguous value is accepted; anything else is
 * ambiguous and skipped rather than guessed.
 */
function ownValues(r: ReportRow): ValueRow[] {
  const byMetric = new Map<string, ValueRow[]>()
  for (const v of r.values) {
    if (!byMetric.has(v.metricCode)) byMetric.set(v.metricCode, [])
    byMetric.get(v.metricCode)!.push(v)
  }
  const expected = subOf(r)
  const out: ValueRow[] = []
  for (const list of byMetric.values()) {
    const current = list.find(v => v.subPeriod === "CURRENT")
    if (current) { out.push(current); continue }
    const matching = expected ? list.find(v => v.subPeriod === expected) : undefined
    if (matching) { out.push(matching); continue }
    if (list.length === 1) out.push(list[0])
  }
  return out
}

/**
 * One canonical observation per fiscal year for identity/ratio checks.
 * Prefer ANNUAL, then 9M/H1/Q4…, consolidated over standalone, newest version,
 * and the report with the most values. Values from sibling reports of the SAME
 * period + basis only fill missing codes (never mix consolidated/standalone).
 */
function canonicalPeriods(reports: ReportRow[]): Array<{ period: string; fiscalYear: number; values: Map<string, number> }> {
  const byYear = new Map<number, ReportRow[]>()
  for (const r of reports) {
    if (r.fiscalYear <= 0) continue
    if (!ownValues(r).some(isUsable)) continue
    if (!byYear.has(r.fiscalYear)) byYear.set(r.fiscalYear, [])
    byYear.get(r.fiscalYear)!.push(r)
  }

  const out: Array<{ period: string; fiscalYear: number; values: Map<string, number> }> = []
  for (const [fiscalYear, candidates] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    const consolidated = candidates.filter(r => r.statementType === "CONSOLIDATED")
    const pool = consolidated.length > 0 ? consolidated : candidates
    pool.sort((a, b) =>
      (PERIOD_PRIORITY[b.periodType] ?? 0) - (PERIOD_PRIORITY[a.periodType] ?? 0) ||
      b.periodEnd.getTime() - a.periodEnd.getTime() ||
      b.version - a.version ||
      ownValues(b).length - ownValues(a).length,
    )
    const primary = pool[0]
    const values = new Map<string, number>()
    for (const v of ownValues(primary)) if (isUsable(v)) values.set(v.metricCode, v.normalizedValue)
    // fill gaps from reports of the exact same period label + basis
    for (const r of pool.slice(1)) {
      if (r.periodLabel !== primary.periodLabel || r.statementType !== primary.statementType) continue
      for (const v of ownValues(r)) {
        if (isUsable(v) && !values.has(v.metricCode)) values.set(v.metricCode, v.normalizedValue)
      }
    }
    out.push({ period: primary.periodLabel, fiscalYear, values })
  }
  return out
}

// ────────────────────────────── data loading ──────────────────────────────

/**
 * Bulk-load reports + values for the given companies. One query, only the
 * columns the checks actually read (heavy source text/bbox stay out of the
 * result). Returns reports grouped by companyId, ordered per company.
 */
async function loadReportsByCompany(companyIds: string[]): Promise<Map<string, ReportRow[]>> {
  if (companyIds.length === 0) return new Map()
  const allReports = await db.financialReport.findMany({
    where: { deletedAt: null, companyId: { in: companyIds } },
    orderBy: [{ fiscalYear: "asc" }, { periodLabel: "asc" }],
    select: {
      companyId: true,
      id: true,
      periodType: true,
      periodLabel: true,
      fiscalYear: true,
      periodEnd: true,
      statementType: true,
      sourceName: true,
      sourceUrl: true,
      version: true,
      extractionMethod: true,
      createdAt: true,
      values: {
        select: {
          metricCode: true,
          normalizedValue: true,
          currency: true,
          unit: true,
          subPeriod: true,
          validationStatus: true,
          validationNotes: true,
        },
      },
    },
  })
  const byCompany = new Map<string, ReportRow[]>()
  for (const r of allReports) {
    const { companyId, ...rest } = r
    const list = byCompany.get(companyId)
    if (list) list.push(rest as unknown as ReportRow)
    else byCompany.set(companyId, [rest as unknown as ReportRow])
  }
  return byCompany
}

/**
 * Runs orphaned-run recovery: runs left "running" by a hard kill (lambda
 * window exceeded) would otherwise sit orphaned forever and their PARTIAL
 * issue sets would pollute the open-issues baseline. Runs older than 15 min
 * are marked failed and their open issues removed.
 */
async function healOrphanedRuns(): Promise<number> {
  const cutoff = new Date(Date.now() - 15 * 60_000)
  const orphans = await db.auditRun.findMany({
    where: { status: "running", startedAt: { lt: cutoff } },
    select: { id: true },
  })
  if (orphans.length === 0) return 0
  for (const o of orphans) {
    await db.auditIssue.deleteMany({ where: { auditRunId: o.id } }).catch(() => {})
    await db.setting.deleteMany({ where: { key: `${CURSOR_PREFIX}${o.id}` } }).catch(() => {})
  }
  await db.auditRun.updateMany({
    where: { id: { in: orphans.map(o => o.id) } },
    data: { status: "failed", endedAt: new Date() },
  })
  return orphans.length
}

// ─────────────────────────── per-company pipeline ───────────────────────────

interface CompanyResult {
  outcome: CompanyAuditOutcome
  issueRows: Array<{
    auditRunId: string
    ticker: string
    metricCode: string | null
    period: string | null
    category: string
    severity: string
    description: string
    descriptionAr: string | null
    currentValue: string | null
    expectedValue: string | null
    status: string
  }>
  scoreRow: {
    ticker: string
    score: number
    rating: string
    breakdownJson: string
    auditRunId: string
    computedAt: Date
  }
}

async function auditCompanies(
  companies: Awaited<ReturnType<typeof loadActiveCompanies>>,
  runId: string | null,
  isinMap: Map<string, string>,
): Promise<CompanyResult[]> {
  const reportsByCompany = await loadReportsByCompany(companies.map(c => c.id))
  const results: CompanyResult[] = []

  for (const company of companies) {
    const ticker = company.ticker
    const reports = reportsByCompany.get(company.id) ?? []

    // ── partition values (own-period values only, one per metric per report)
    let usableValues = 0
    let quarantinedValues = 0
    const quarantinedMetrics = new Set<string>()
    const usableMetrics = new Set<string>()
    for (const r of reports) {
      for (const v of ownValues(r)) {
        if (isAuthoritativeValue(v)) {
          usableValues++
          usableMetrics.add(v.metricCode)
        } else {
          quarantinedValues++
          quarantinedMetrics.add(v.metricCode)
        }
      }
    }
    for (const m of usableMetrics) quarantinedMetrics.delete(m)

    // ── all periods (temporal checks need the full sequence)
    const periodRecords: PeriodRecord[] = reports
      .filter(r => ownValues(r).some(isUsable))
      .map(r => ({
        period: periodLabelOf(r.periodType, subOf(r), r.fiscalYear),
        periodType: r.periodType,
        fiscalYear: r.fiscalYear,
        periodEnd: r.periodEnd,
        sub: subOf(r) ?? undefined,
        statementType: r.statementType,
        values: new Map(ownValues(r).filter(isUsable).map(v => [v.metricCode, v.normalizedValue] as [string, number])),
      }))

    // ── canonical annual-equivalent records (no FY/Q4 double counting)
    const canonical = canonicalPeriods(reports)
    const canonicalValues = canonical.map(c => c.values)

    const bsPeriods: BSPeriodValues[] = canonicalValues.map((values, i) => {
      const o: BSPeriodValues = { period: canonical[i].period }
      for (const [code, val] of values) o[code as keyof BSPeriodValues] = val as never
      return o
    })

    const sectorPeriodValues = canonicalValues.map((values, i) => {
      const o: Record<string, number | string | undefined> = { period: canonical[i].period }
      for (const [code, val] of values) o[code] = val
      return o
    })

    // ── cross-source observations (own-period usable values only)
    const observations: MultiSourceObservation[] = []
    for (const r of reports) {
      for (const v of ownValues(r)) {
        if (!isUsable(v)) continue
        observations.push({
          metricCode: v.metricCode,
          period: periodLabelOf(r.periodType, subOf(r), r.fiscalYear),
          statementType: r.statementType,
          sourceName: r.sourceName,
          normalizedValue: v.normalizedValue,
          currency: v.currency,
          unit: v.unit,
          version: r.version,
        })
      }
    }

    // ── run the 8 categories
    let issues: AuditCheckResult[] = []
    issues = issues.concat(runAccountingChecks(ticker, bsPeriods, company.sector))
    issues = issues.concat(runLogicalChecks(ticker, bsPeriods as never, company.sector))
    issues = issues.concat(runTemporalChecks(ticker, periodRecords))
    issues = issues.concat(runCrossSourceChecks(ticker, observations).results)
    issues = issues.concat(runProvenanceChecks({
      ticker,
      isin: company.isin,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
      reports: reports.map(r => ({
        id: r.id, sourceName: r.sourceName, sourceUrl: r.sourceUrl,
        createdAt: r.createdAt, extractionMethod: r.extractionMethod,
      })),
    }, isinMap))
    issues = issues.concat(runSectorChecks(ticker, company.sector, sectorPeriodValues as never))

    // ── coverage maps (own-period usable values only)
    const anyCoverage = new Map<string, Set<number>>()
    const annualCoverage = new Map<string, Set<number>>()
    for (const r of reports) {
      for (const v of ownValues(r)) {
        if (!isUsable(v)) continue
        if (!anyCoverage.has(v.metricCode)) anyCoverage.set(v.metricCode, new Set())
        anyCoverage.get(v.metricCode)!.add(r.fiscalYear)
        if (r.periodType === "ANNUAL") {
          if (!annualCoverage.has(v.metricCode)) annualCoverage.set(v.metricCode, new Set())
          annualCoverage.get(v.metricCode)!.add(r.fiscalYear)
        }
      }
    }
    const latestAnnualYears = [...(annualCoverage.get("REVENUE") ?? [])]
    const latestFY = latestAnnualYears.length > 0
      ? Math.max(...latestAnnualYears)
      : reports.reduce((m, r) => Math.max(m, r.fiscalYear), 0)
    issues = issues.concat(runMissingDataChecks({
      ticker, sector: company.sector, coverage: anyCoverage, annualCoverage,
      quarantinedMetrics, latestFiscalYear: latestFY,
    }))

    // ── outliers on the latest canonical period
    if (canonical.length > 0) {
      const latest = canonical[canonical.length - 1]
      const outlierVals = Object.fromEntries(latest.values) as Record<string, number>
      issues = issues.concat(runOutlierChecks(ticker, company.sector, [{ period: latest.period, ...outlierVals }]))
    }

    // ── classify + dedupe
    const seenKeys = new Set<string>()
    issues = issues
      .map(i => {
        const { issueClass, rootCause } = classifyCheck(i)
        return { ...i, issueClass, rootCause }
      })
      .filter(i => {
        const k = `${i.checkName}|${i.period}|${i.metricCode ?? ""}`
        if (seenKeys.has(k)) return false
        seenKeys.add(k)
        return true
      })

    // ── provenance / freshness
    const sources = [...new Set(reports.map(r => r.sourceName))]
    const latestReport = reports.reduce<{ end: Date; label: string } | null>((acc, r) => {
      if (!acc || r.periodEnd > acc.end) return { end: r.periodEnd, label: r.periodLabel }
      return acc
    }, null)
    const latestDataAgeMonths = latestReport
      ? Math.max(0, Math.round((Date.now() - latestReport.end.getTime()) / MONTH_MS))
      : 999

    // critical coverage: sector-aware critical set present in the latest annual period
    const latestAnnual = [...reports].reverse().find(r => r.periodType === "ANNUAL" && ownValues(r).some(isUsable))
    const latestAnnualCodes = new Set(latestAnnual ? ownValues(latestAnnual).filter(isUsable).map(v => v.metricCode) : [])
    const criticalSet = criticalMetricsFor(company.sector)
    const presentCount = criticalSet.filter(c => latestAnnualCodes.has(c)).length

    // ── score
    const issueCompat = issues.map((i, idx) => ({
      id: `chk_${idx}`,
      auditRunId: runId ?? "dry",
      ticker,
      metricCode: i.metricCode,
      period: i.period,
      category: i.category,
      severity: i.severity,
      description: `[${i.checkName}] ${i.details}`,
      detectedAt: new Date(),
      status: "open" as const,
    }))
    const { score, rating, breakdown } = computeConfidenceScore({
      ticker,
      latestDataAgeMonths,
      sources,
      issues: issueCompat,
      criticalCoveragePct: Math.round((presentCount / criticalSet.length) * 100),
    })

    results.push({
      outcome: {
        ticker, nameEn: company.nameEn, sector: company.sector,
        issues, confidence: score, confidenceRating: rating,
        accuracy: breakdown.accuracy ?? 0,
        completeness: breakdown.completeness ?? 0,
        freshness: breakdown.freshness ?? 0,
        provenance: breakdown.provenance ?? 0,
        certification: breakdown.certification ?? "review_required",
        latestDataPeriod: latestReport?.label ?? null,
        latestDataAgeMonths,
        sources,
        usableValues,
        quarantinedValues,
      },
      issueRows: issues.map(i => ({
        auditRunId: runId ?? "dry",
        ticker,
        metricCode: i.metricCode ?? null,
        period: i.period ?? null,
        category: i.category,
        severity: i.severity,
        description: `[${i.checkName}] ${i.details}`,
        descriptionAr: i.detailsAr ? `[${i.checkName}] ${i.detailsAr}` : null,
        currentValue: i.currentValue !== undefined ? String(i.currentValue) : null,
        expectedValue: i.expectedValue !== undefined ? String(i.expectedValue) : null,
        status: "open",
      })),
      scoreRow: {
        ticker, score, rating,
        breakdownJson: JSON.stringify(breakdown),
        auditRunId: runId ?? "dry",
        computedAt: new Date(),
      },
    })
  }

  return results
}

async function loadActiveCompanies(limitCompanies?: number) {
  return db.company.findMany({
    where: { isActive: true },
    ...(limitCompanies ? { take: limitCompanies } : {}),
    orderBy: { ticker: "asc" },
  })
}

function tally(results: CompanyResult[]) {
  const found = { critical: 0, high: 0, medium: 0, low: 0 }
  const byCategory: Record<string, number> = {}
  const byClass: Record<IssueClass, number> = { blocker: 0, coverage: 0, advisory: 0, metadata: 0 }
  const byRootCause: Record<string, number> = {}
  for (const r of results) {
    for (const i of r.outcome.issues) {
      found[i.severity as keyof typeof found] = (found[i.severity as keyof typeof found] ?? 0) + 1
      byCategory[i.category] = (byCategory[i.category] ?? 0) + 1
      byClass[i.issueClass as IssueClass] = (byClass[i.issueClass as IssueClass] ?? 0) + 1
      byRootCause[i.rootCause ?? "OTHER"] = (byRootCause[i.rootCause ?? "OTHER"] ?? 0) + 1
    }
  }
  return { found, byCategory, byClass, byRootCause }
}

/** Batched writes: one issue createMany + one score replace per pass. */
async function persistResults(runId: string, results: CompanyResult[]): Promise<void> {
  const issueRows = results.flatMap(r => r.issueRows)
  if (issueRows.length > 0) {
    await db.auditIssue.createMany({ data: issueRows })
  }
  const tickers = results.map(r => r.scoreRow.ticker)
  if (tickers.length > 0) {
    // Replace-in-place: two statements, no per-company round trips. Scores are
    // recomputed every run — a millisecond gap is invisible to readers.
    await db.$transaction([
      db.companyConfidenceScore.deleteMany({ where: { ticker: { in: tickers } } }),
      db.companyConfidenceScore.createMany({ data: results.map(r => r.scoreRow) }),
    ])
  }
}

// ─────────────────────────────── full audit ───────────────────────────────

export async function runFullAudit(opts: AuditRunnerOptions = {}): Promise<AuditRunSummary> {
  const started = new Date()
  const type: AuditRunType = opts.type ?? "manual"
  const persist = opts.persist ?? true

  if (persist) await healOrphanedRuns()

  const runRow = persist
    ? await db.auditRun.create({ data: { type, startedAt: started, status: "running" } })
    : null
  const runId = runRow?.id ?? "dry"

  const allCompaniesRaw = await db.company.findMany({ select: { ticker: true, isin: true } })
  const isinMap = new Map<string, string>()
  for (const c of allCompaniesRaw) if (c.isin) isinMap.set(c.isin, c.ticker)

  const companies = await loadActiveCompanies(opts.limitCompanies)
  const results = await auditCompanies(companies, runRow?.id ?? null, isinMap)
  const { found, byCategory, byClass, byRootCause } = tally(results)

  if (runRow) await persistResults(runRow.id, results)

  const ended = new Date()
  const durationSec = Math.round((ended.getTime() - started.getTime()) / 1000)
  if (runRow) {
    await db.auditRun.update({
      where: { id: runRow.id },
      data: {
        endedAt: ended, durationSec, status: "completed",
        companiesChecked: companies.length,
        issuesFound: found.critical + found.high + found.medium + found.low,
      },
    })
  }

  return {
    runId, type, startedAt: started, durationSec,
    companiesChecked: companies.length,
    issuesFound: { ...found, total: found.critical + found.high + found.medium + found.low },
    byClass, byCategory, byRootCause,
    outcomes: results.map(r => r.outcome),
  }
}

// ────────────────────────────── chunked audit ──────────────────────────────

/**
 * Process ≤ chunkSize companies per call and leave a resumable cursor. The
 * cron route loops within its window, then chains the next call via after().
 * Guarantees completion regardless of data growth, one small window at a time.
 */
export async function startOrResumeChunkedAudit(opts: ChunkedAuditOptions): Promise<ChunkedAuditResult> {
  await healOrphanedRuns()

  // resolve the run row (resume an ACTIVE recent run, else start fresh)
  let runRow: { id: string; startedAt: Date } | null = null
  if (opts.resumeRunId) {
    const candidate = await db.auditRun.findUnique({
      where: { id: opts.resumeRunId },
      select: { id: true, startedAt: true, status: true },
    })
    if (candidate && candidate.status === "running" && Date.now() - candidate.startedAt.getTime() < 2 * 3_600_000) {
      runRow = candidate
    }
  }
  const cursorKey = runRow ? `${CURSOR_PREFIX}${runRow.id}` : null
  let lastTicker: string | null = null
  let checkedSoFar = 0
  let issuesSoFar = 0
  const startedAt = runRow?.startedAt ?? new Date()

  if (runRow && cursorKey) {
    const raw = await db.setting.findUnique({ where: { key: cursorKey } })
    if (raw?.value) {
      try {
        const c = JSON.parse(raw.value) as { lastTicker?: string; checked?: number; issues?: number }
        lastTicker = c.lastTicker ?? null
        checkedSoFar = c.checked ?? 0
        issuesSoFar = c.issues ?? 0
      } catch { /* malformed cursor → start from the top of this run */ }
    }
  } else {
    runRow = await db.auditRun.create({
      data: { type: opts.type, startedAt, status: "running" },
      select: { id: true, startedAt: true },
    })
  }
  const runId = runRow!.id

  const allCompaniesRaw = await db.company.findMany({ select: { ticker: true, isin: true } })
  const isinMap = new Map<string, string>()
  for (const c of allCompaniesRaw) if (c.isin) isinMap.set(c.isin, c.ticker)

  const remaining = lastTicker
    ? await db.company.count({ where: { isActive: true, ticker: { gt: lastTicker } } })
    : await db.company.count({ where: { isActive: true } })

  if (remaining === 0) {
    // everything processed — finalize
    const durationSec = Math.round((Date.now() - startedAt.getTime()) / 1000)
    await db.auditRun.update({
      where: { id: runId },
      data: { endedAt: new Date(), durationSec, status: "completed", companiesChecked: checkedSoFar, issuesFound: issuesSoFar },
    })
    await db.setting.deleteMany({ where: { key: `${CURSOR_PREFIX}${runId}` } }).catch(() => {})
    return { done: true, runId, type: opts.type, checkedSoFar, issuesSoFar, remaining: 0, lastTicker, summary: undefined }
  }

  const companies = await db.company.findMany({
    where: { isActive: true, ...(lastTicker ? { ticker: { gt: lastTicker } } : {}) },
    orderBy: { ticker: "asc" },
    take: opts.chunkSize,
  })

  const results = await auditCompanies(companies, runId, isinMap)
  await persistResults(runId, results)

  const chunkTally = tally(results)
  checkedSoFar += companies.length
  issuesSoFar += chunkTally.found.critical + chunkTally.found.high + chunkTally.found.medium + chunkTally.found.low
  lastTicker = companies[companies.length - 1].ticker
  const leftAfter = remaining - companies.length

  if (leftAfter === 0) {
    const durationSec = Math.round((Date.now() - startedAt.getTime()) / 1000)
    await db.auditRun.update({
      where: { id: runId },
      data: { endedAt: new Date(), durationSec, status: "completed", companiesChecked: checkedSoFar, issuesFound: issuesSoFar },
    })
    await db.setting.deleteMany({ where: { key: `${CURSOR_PREFIX}${runId}` } }).catch(() => {})
    return {
      done: true, runId, type: opts.type, checkedSoFar, issuesSoFar, remaining: 0, lastTicker,
      summary: {
        runId, type: opts.type, startedAt, durationSec,
        companiesChecked: checkedSoFar,
        issuesFound: { ...chunkTally.found, total: 0 }, // cumulative totals live on the run row; per-call tallies are chunk-local
        byClass: chunkTally.byClass, byCategory: chunkTally.byCategory, byRootCause: chunkTally.byRootCause,
        outcomes: results.map(r => r.outcome),
      },
    }
  }

  // persist the cursor for the next chained call
  await db.setting.upsert({
    where: { key: `${CURSOR_PREFIX}${runId}` },
    create: { key: `${CURSOR_PREFIX}${runId}`, value: JSON.stringify({ lastTicker, checked: checkedSoFar, issues: issuesSoFar }), type: "json", description: "audit chunk resume cursor" },
    update: { value: JSON.stringify({ lastTicker, checked: checkedSoFar, issues: issuesSoFar }) },
  })
  await db.auditRun.update({
    where: { id: runId },
    data: { companiesChecked: checkedSoFar, issuesFound: issuesSoFar },
  })

  return { done: false, runId, type: opts.type, checkedSoFar, issuesSoFar, remaining: leftAfter, lastTicker }
}

export type { RootCause }
