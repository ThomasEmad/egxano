"use client"

// Typed API client for the EGXANO REST API (/api/v1).

export type MetricResultStatus = "OK" | "DATA_UNAVAILABLE" | "NOT_APPLICABLE" | "NOT_COMPUTABLE"

export interface ConditionEval {
  kind: "metric" | "event" | "dividend" | "sector"
  code?: string
  eventType?: string
  statuses?: string[]
  sector?: string
  operator?: string
  threshold?: number
  range?: MetricRange
  labelEn: string
  labelAr: string
  actualDisplay: string
  actualRaw?: number
  status: MetricResultStatus
  note?: string
  matched: boolean
}

export interface CompanyScanResult {
  companyId: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
  isDemoData: boolean
  contextPeriodKey: string | null
  contextPeriodLabel: string | null
  evaluation: { matched: boolean; matchedCount: number; conditions: ConditionEval[] }
}

export interface ScanOutput {
  periodBasis: string
  results: CompanyScanResult[]
  matched: CompanyScanResult[]
  availability: Record<string, number>
  validationErrors: string[]
  ruleId?: string | null
  ruleName?: string
}

export interface ScannerRule {
  id: string
  name: string
  nameAr: string | null
  description: string | null
  isPreset: boolean
  presetKey: string | null
  conditions: ScanCondition[]
  createdBy: string
}

export type MetricRange = { min: number; max: number }

export type ScanCondition =
  | { kind: "metric"; code: string; operator: string; value: number | MetricRange }
  | { kind: "event"; eventType: string }
  | { kind: "dividend"; statuses: string[] }
  | { kind: "sector"; sector: string; operator: "==" | "!=" }

export interface CompanyListItem {
  id: string
  ticker: string
  isin?: string | null
  nameEn: string
  nameAr: string | null
  sector: string
  industry: string | null
  listingStatus: string
  egxCategory?: string | null
  irUrl?: string | null
  isDemoData: boolean
  counts: { reports: number; events: number; dividends: number }
  snapshot: Record<string, { value: number | null; status: string; periodLabel: string; fiscalYear?: number }>
  /** advanced-sort/filter mode only — computed per company for the whole matched universe */
  metrics?: {
    p_e: number | null
    dividend_yield: number | null
    roe: number | null
    roa: number | null
    net_margin: number | null
    eps: number | null
  } | null
  marketPrice?: {
    price: number
    asOf: string | null
    currency: string
    changePct: number | null
  } | null
  marketCap?: number | null
}

export interface CompaniesResponse {
  page: number
  pageSize: number
  total: number
  totalPages: number
  sort: string
  dir?: "asc" | "desc"
  appliedFilters?: Record<string, number | null>
  marketAsOf: string | null
  delayMinutes: number | null
  companies: CompanyListItem[]
}

export interface CompanyDetail {
  company: {
    id: string
    ticker: string
    nameEn: string
    nameAr: string | null
    sector: string
    industry: string | null
    listingStatus: string
    isDemoData: boolean
    sharesOutstanding: number | null
    descriptionEn: string | null
    descriptionAr: string | null
    counts: { reports: number; events: number; dividends: number; values: number }
  }
  latestPeriods: { annual?: string; quarterly?: string; ttm?: string }
  /** freshness: latest trusted filing period-end ("data as of" display) */
  dataAsOf?: { periodEnd: string; periodLabel: string } | null
  matchedPresets: { presetKey: string; name: string; nameAr: string | null; basis: string }[]
  marketPrice: { price: number; asOf: string; currency: string; sourceName: string; isDemoData: boolean } | null
}

export interface EventItem {
  id: string
  eventType: string
  labelEn: string
  labelAr: string
  tone: "positive" | "negative" | "neutral"
  periodLabel: string
  periodType: string
  fiscalYear: number
  currentPeriodKey: string
  previousPeriodKey: string | null
  conditions: { metric: string; current?: number; previous?: number; detail: string; detailAr?: string; ok: boolean }[]
  explanationEn: string
  explanationAr: string
  ruleVersion: string
  detectedAt: string
}

export interface DividendItem {
  id: string
  companyId?: string
  announcementDate: string | null
  eligibilityDate: string | null
  exDividendDate: string | null
  distributionDate: string | null
  dividendPerShare: number | null
  currency: string
  dividendType: string
  status: string
  sourceName: string
  notes: string | null
  isDemoData?: boolean
  company?: { id: string; ticker: string; nameEn: string; nameAr: string | null; sector?: string; isDemoData?: boolean }
}

export interface DashboardData {
  stats: { companies: number; reports: number; validValues: number; events: number }
  scannerCards: {
    id: string
    presetKey: string | null
    name: string
    nameAr: string | null
    description: string | null
    count: number
    topMatches: { companyId: string; ticker: string; nameEn: string; nameAr: string | null; period: string | null }[]
  }[]
  recentEvents: {
    id: string
    eventType: string
    periodLabel: string
    explanationEn: string
    explanationAr: string
    company: { id: string; ticker: string; nameEn: string; nameAr: string | null; isDemoData: boolean }
  }[]
  upcomingDividends: DividendItem[]
}

export interface EventFeedItem {
  id: string
  eventType: string
  labelEn: string
  labelAr: string
  tone: "positive" | "negative" | "neutral"
  periodLabel: string
  periodType: string
  explanationEn: string
  explanationAr: string
  ruleVersion: string
  detectedAt: string
  company: { id: string; ticker: string; nameEn: string; nameAr: string | null; isDemoData: boolean }
}

export interface FinancialsData {
  statementType?: "CONSOLIDATED" | "STANDALONE" | null
  availableStatementTypes?: string[]
  periodView?: "annual" | "interim" | null
  availablePeriodViews?: ("annual" | "interim")[]
  anomalyCount?: number
  periods: { key: string; label: string; periodType: string; fiscalYear: number }[]
  statements: Record<string, { code: string; statementType: string; cells: Record<string, { value: number; unit: string; normalizedValue: number; label: string; reportId: string; flags?: { yoyPct?: number; badSign?: boolean; zero?: boolean; identityFailed?: boolean } }> }[]>
}

export interface MetricsData {
  statementType?: "CONSOLIDATED" | "STANDALONE"
  availableStatementTypes?: string[]
  periodView?: "annual" | "interim" | null
  availablePeriodViews?: ("annual" | "interim")[]
  periods: { key: string; label: string; periodType: string; fiscalYear: number }[]
  rows: {
    code: string
    labelEn: string
    labelAr: string
    unit: string
    kind: string
    cells: Record<string, { value: number | null; status: string; detail: string | null }>
  }[]
}

export interface CompanyDocument {
  id: string
  periodLabel: string
  periodType: string
  fiscalYear: number
  statementType: string
  language: string
  fileName: string | null
  fileSize: number | null
  hasFile: boolean
  valueCount: number
}

export interface AiAnalysisData {
  analysis: {
    content: string
    createdAt: string
    completedAt?: string | null
    periodKey: string | null
    dataHash: string
    technicalHash?: string | null
    priceAsOf?: string | null
    financialAsOf?: string | null
    model: string | null
    lang?: string | null
    degraded?: boolean
    stance?: string | null
    wordCount?: number | null
    completeness?: { financialCoveragePct: number | null; technicalCoveragePct: number | null; limitations: string[] } | null
    reportKey?: string
  } | null
  generation?: { status: string; jobRef: string | null; reportKey: string | null; startedAt?: string } | null
}

export interface AiAnalysisStatusData {
  status: "pending" | "processing" | "failed" | "ready" | "none"
  jobRef: string | null
  reportKey: string | null
  attempts?: number
  lastError?: string | null
  queuedAt?: string | null
  report: AiAnalysisData["analysis"]
}

export interface AiAnalysisGenerateResult {
  status?: "generating"
  jobRef?: string
  reportKey?: string
  message?: string
  cached?: boolean
  analysis?: AiAnalysisData["analysis"]
  error?: string
  message2?: string
}

export interface AiChatMessage {
  role: "user" | "assistant"
  content: string
}

export interface AiChatData {
  reply: string
  usage?: { used: number; limit: number }
}

export interface ReviewData {
  values: {
    id: string
    metricCode: string
    originalLabel: string
    value: number
    unit: string
    normalizedValue: number
    currency: string
    sourcePage: number | null
    sourceText: string | null
    extractionMethod: string | null
    confidence: number
    validationNotes: string | null
    company: { ticker: string; nameEn: string; nameAr: string | null }
    report: { id: string; periodLabel: string; periodType: string; processingStatus: string }
    createdAt: string
  }[]
  reports: {
    id: string
    periodLabel: string
    periodType: string
    processingStatus: string
    notes: string | null
    company: { ticker: string; nameEn: string; nameAr: string | null }
    valueCount: number
    fileHash: string | null
    createdAt: string
  }[]
}

export interface MetricRegistry {
  rawMetrics: { code: string; labelEn: string; labelAr: string; statementType: string; aliases: string[] }[]
  calculatedMetrics: { code: string; labelEn: string; labelAr: string; unit: string; kind: string; description?: string }[]
  marketMetrics: { code: string; labelEn: string; labelAr: string; unit: string; kind: string; description?: string }[]
  eventTypes: { type: string; labelEn: string; labelAr: string; tone: string; description: string }[]
}

export interface PeerData {
  sector: string
  basis: string
  /** true when the sector has fewer than 3 listed companies — peers/medians are empty then */
  insufficient?: boolean
  sectorCount?: number
  /** the self company's freshest period; each peer carries its own `period` */
  period: { key: string; label: string; type: string; fiscalYear: number } | null
  medians: Record<string, number | null>
  peers: {
    id: string
    ticker: string
    nameEn: string
    nameAr: string | null
    sector: string
    isDemoData: boolean
    isSelf: boolean
    values: Record<string, number | null>
    /** period that supplied each metric value — may differ per metric */
    periods: Record<string, { key: string; label: string; type: string; fiscalYear: number } | null>
    /** freshest period among this peer's values */
    period: { key: string; label: string; type: string; fiscalYear: number } | null
    stale: boolean
    /** metric codes whose own period is more than four quarters behind the sector */
    staleCodes?: string[]
  }[]
}

export interface RunHistoryItem {
  id: string
  ruleId: string | null
  ruleName: string
  isPreset: boolean
  periodBasis: string
  matchedCount: number
  matchedCompanyIds: string[]
  ranAt: string
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      message = body.message || body.error || message
      const err = new Error(message) as Error & { status?: number; body?: unknown }
      err.status = res.status
      err.body = body
      throw err
    } catch (e) {
      if (typeof e === "object" && e !== null && "status" in e) throw e
      throw new Error(message)
    }
  }
  return res.json() as Promise<T>
}

export function authHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {}
  const userToken = getUserToken()
  if (userToken) headers["x-session-token"] = userToken
  return headers
}

/** Session token, honoring "remember me": localStorage (persistent) or sessionStorage (tab-only) */
export function getUserToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem("egx-user-token") ?? sessionStorage.getItem("egx-user-token")
}

export function setUserToken(token: string, remember: boolean): void {
  if (typeof window === "undefined") return
  sessionStorage.removeItem("egx-user-token")
  localStorage.removeItem("egx-user-token")
  if (remember) localStorage.setItem("egx-user-token", token)
  else sessionStorage.setItem("egx-user-token", token)
  // The HttpOnly session cookie (used by server components) is set by the
  // server itself (login/register/session endpoints) — never from JS, so the
  // token stays unreadable to page scripts.
}

export function clearUserToken(): void {
  if (typeof window === "undefined") return
  sessionStorage.removeItem("egx-user-token")
  localStorage.removeItem("egx-user-token")
  document.cookie = "egx-user-token=; path=/; max-age=0; samesite=lax"
}

/** Build a query string from defined params (skips undefined/empty values) */
function qs(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v) q.set(k, v)
  }
  const s = q.toString()
  return s ? s : ""
}

export const api = {
  dashboard: () => fetch("/api/v1/dashboard", { headers: authHeaders() }).then((r) => handle<DashboardData>(r)),

  latestResults: () =>
    fetch("/api/v1/dashboard/latest-results").then((r) =>
      handle<{
        results: {
          id: string; companyId: string; ticker: string; name: string; nameEn: string
          companyName: string; period: string
          periodLabel: string; periodType: string; fiscalYear: number
          asOf: string; statementType: string; netProfit: number
          change: number | null; reportUrl: string
        }[]
      }>(r)
    ),

  companies: (params: {
    search?: string
    sector?: string
    page?: number
    pageSize?: number
    ids?: string[]
    tickers?: string[]
    sort?: "ticker" | "marketCap" | "changePct" | "p_e" | "dividend_yield" | "roe" | "net_margin" | "name"
    dir?: "asc" | "desc"
    status?: string
    priceMin?: number
    priceMax?: number
    changeMin?: number
    changeMax?: number
    peMin?: number
    peMax?: number
    dyMin?: number
    roeMin?: number
    roeMax?: number
    netMarginMin?: number
    capMin?: number
    capMax?: number
  }) => {
    const q = new URLSearchParams()
    if (params.search) q.set("search", params.search)
    if (params.sector) q.set("sector", params.sector)
    if (params.ids) q.set("ids", params.ids.join(","))
    if (params.tickers) q.set("tickers", params.tickers.join(","))
    if (params.sort) q.set("sort", params.sort)
    if (params.dir) q.set("dir", params.dir)
    if (params.status) q.set("status", params.status)
    for (const k of [
      "priceMin", "priceMax", "changeMin", "changeMax", "peMin", "peMax",
      "dyMin", "roeMin", "roeMax", "netMarginMin", "capMin", "capMax",
    ] as const) {
      const v = params[k]
      if (v !== undefined && v !== null) q.set(k, String(v))
    }
    q.set("page", String(params.page ?? 1))
    q.set("pageSize", String(params.pageSize ?? 9))
    return fetch(`/api/v1/companies?${q}`).then((r) => handle<CompaniesResponse>(r))
  },

  company: (id: string) => fetch(`/api/v1/companies/${id}`).then((r) => handle<CompanyDetail>(r)),

  financials: (id: string, statementType?: string, periodView?: string) =>
    fetch(`/api/v1/companies/${id}/financials?${qs({ statementType, period_view: periodView })}`).then((r) => handle<FinancialsData>(r)),

  metrics: (id: string, statementType?: string, periodView?: string) =>
    fetch(`/api/v1/companies/${id}/metrics?${qs({ statementType, period_view: periodView })}`).then((r) => handle<MetricsData>(r)),

  downloadReportUrl: (id: string) => `/api/v1/reports/${id}/download`,

  companyTechnical: (id: string) =>
    fetch(`/api/v1/companies/${id}/technical`).then((r) =>
      handle<{
        companyId: string
        ticker: string
        snapshot: import("@/components/egx/technical-tab").TechSnapshot
        hash: string
        /** Corporate-action-adjusted daily candles for the client chart. */
        candles?: { t: string; o: number; h: number; l: number; c: number }[]
        stance?: import("@/lib/technical/signals").TechStance
      }>(r)
    ),

  technicalSignals: () =>
    fetch("/api/v1/technical/signals").then((r) =>
      handle<import("@/lib/technical/signals-service").MarketSignalsOutput>(r)
    ),

  companyDocuments: (id: string) =>
    fetch(`/api/v1/companies/${id}/documents`).then((r) => handle<{ documents: CompanyDocument[] }>(r)),

  aiAnalysis: (id: string, lang?: string) =>
    fetch(`/api/v1/companies/${id}/ai-analysis${lang ? `?lang=${encodeURIComponent(lang)}` : ""}`, { headers: authHeaders() }).then((r) => handle<AiAnalysisData>(r)),

  aiAnalysisStatus: (id: string, lang: string, jobRef?: string | null) =>
    fetch(`/api/v1/companies/${id}/ai-analysis/status?lang=${lang}${jobRef ? `&jobRef=${encodeURIComponent(jobRef)}` : ""}`, { headers: authHeaders() }).then((r) => handle<AiAnalysisStatusData>(r)),

  aiAnalysisMetadata: (id: string, lang: string) =>
    fetch(`/api/v1/companies/${id}/ai-analysis/metadata?lang=${lang}`, { headers: authHeaders() }).then(
      (r) =>
        handle<{
          hasFinancialData: boolean
          priceAsOf: string | null
          financialAsOf: string | null
          completeness: { financialCoveragePct: number | null; technicalCoveragePct: number | null; limitations: string[] }
          technical: { available: boolean; sessions: number; asOf: string | null; sparse: boolean; coveragePct: number | null }
        }>(r)
    ),

  refreshAiAnalysis: (id: string, lang: string) =>
    fetch(`/api/v1/companies/${id}/ai-analysis/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ lang }),
    }).then((r) => handle<{ status: string; jobRef?: string; reportKey?: string }>(r)),

  generateAiAnalysis: (id: string, lang: string, token?: string | null) =>
    fetch(`/api/v1/companies/${id}/ai-analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify({ lang }),
    }).then((r) => handle<AiAnalysisGenerateResult>(r)),

  aiAnalysisChat: (id: string, messages: AiChatMessage[], lang: string) =>
    fetch(`/api/v1/companies/${id}/ai-analysis/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ messages, lang }),
    }).then((r) => handle<AiChatData>(r)),

  events: (id: string) =>
    fetch(`/api/v1/companies/${id}/events`, { headers: authHeaders() }).then((r) => handle<{ events: EventItem[] }>(r)),

  companyDividends: (id: string) =>
    fetch(`/api/v1/companies/${id}/dividends`).then((r) => handle<{ dividends: DividendItem[] }>(r)),

  peers: (id: string, basis?: "latest" | "annual" | "ttm") => fetch(`/api/v1/companies/${id}/peers${basis ? `?basis=${basis}` : ""}`).then((r) => handle<PeerData>(r)),

  eventsFeed: (companyIds?: string[], limit = 15) => {
    const q = new URLSearchParams()
    if (companyIds && companyIds.length) q.set("companyIds", companyIds.join(","))
    q.set("limit", String(limit))
    return fetch(`/api/v1/events?${q}`, { headers: authHeaders() }).then((r) => handle<{ events: EventFeedItem[] }>(r))
  },

  scanHistory: () =>
    fetch(`/api/v1/scanners/history`).then((r) => handle<{ runs: RunHistoryItem[] }>(r)),

  scanners: () => fetch(`/api/v1/scanners`).then((r) => handle<{ rules: ScannerRule[] }>(r)),

  createScanner: (body: { name: string; nameAr?: string; description?: string; conditions: ScanCondition[] }) =>
    fetch(`/api/v1/scanners`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => handle<{ rule: ScannerRule }>(r)),

  deleteScanner: (id: string, token?: string | null) =>
    fetch(`/api/v1/scanners/${id}`, { method: "DELETE", headers: authHeaders(token) }).then((r) => handle<{ ok: boolean }>(r)),

  runScanner: (body: { ruleId?: string; conditions?: ScanCondition[]; periodBasis?: string; name?: string }) =>
    fetch(`/api/v1/scanners/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then((r) => handle<ScanOutput>(r)),

  dividends: (status?: string) =>
    fetch(`/api/v1/dividends${status ? `?status=${status}` : ""}`).then((r) => handle<{ dividends: DividendItem[] }>(r)),

  registry: () => fetch(`/api/v1/metrics`).then((r) => handle<MetricRegistry>(r)),

  adminLogin: (passcode: string) =>
    fetch(`/api/v1/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    }).then((r) => handle<{ token: string }>(r)),

  subscription: () => {
    if (!getUserToken()) {
      return Promise.resolve({
        isPremium: false,
        subscription: null,
        smartAnalysisUsage: null,
      })
    }
    return fetch("/api/v1/subscription/me", { headers: authHeaders() }).then((r) => {
      if (r.status === 401) {
        clearUserToken()
        return { isPremium: false, subscription: null, smartAnalysisUsage: null }
      }
      return handle<{ isPremium: boolean; subscription: { id: string; status: string; planName: string; startDate: string | null; endDate: string | null; activatedAt: string | null; activatedBy: string | null; cancelledAt: string | null; notes: string | null } | null; smartAnalysisUsage: { year: number; month: number; usageCount: number; remaining: number; limit: number; resetAt: string | null } | null }>(r)
    })
  },

  requestSubscription: (notes?: string) =>
    fetch("/api/v1/subscription/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ notes }),
    }).then((r) => handle<{ success: boolean; status: string }>(r)),

  createPaymentRequest: (body: { planId: string; amount: number; paymentMethod?: string; transactionReference?: string | null }) =>
    fetch("/api/v1/payment-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then((r) => handle<{ id: string; status: string; createdAt: string }>(r)),

  myPaymentRequests: () => fetch("/api/v1/payment-requests", { headers: authHeaders() }).then((r) => handle<{ requests: unknown[] }>(r)),

  adminSubscriptions: () =>
    fetch("/api/v1/admin/subscriptions").then((r) => handle<{ subscriptions: unknown[] }>(r)),

  adminPaymentRequests: () =>
    fetch("/api/v1/admin/payment-requests").then((r) => handle<{ requests: unknown[] }>(r)),

  reviewAction: (valueId: string, body: { action: string; value?: number; metricCode?: string; unit?: string; reason?: string }) =>
    fetch(`/api/v1/review/values/${valueId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then((r) => handle<{ ok: boolean }>(r)),
}

// ---------------------------------------------------------------------------
// Per-stock audio briefing ("البريفينج المسموع")
// ---------------------------------------------------------------------------

export interface CompanyBriefingAccess {
  plan: "FREE" | "PRO" | "PRO_PLUS"
  allowed: boolean
  trialExpiresAt: string | null
  reason: "OK" | "LOGIN_REQUIRED" | "TRIAL_EXPIRED" | "GENERATING" | "FAILED"
}

export interface CompanyBriefingData {
  ok: boolean
  ticker: string
  nameAr: string
  /** Narration text — also used for the browser-speech fallback when TTS fails. */
  scriptAr: string
  status: "READY" | "FAILED" | "MISSING"
  hasAudio: boolean
  durationSec: number | null
  access: CompanyBriefingAccess
  updatedAt: string | null
}

export interface BriefingPlayErrorBody {
  reason?: "LOGIN_REQUIRED" | "TRIAL_EXPIRED" | "FAILED" | "RATE_LIMITED"
  message?: string
  upgradeUrl?: string
  trialExpiresAt?: string | null
}

/** GET briefing metadata + access decision (never carries audio bytes). */
export function getCompanyBriefing(companyId: string): Promise<CompanyBriefingData> {
  return fetch(`/api/v1/companies/${companyId}/briefing`, { headers: authHeaders() }).then((r) =>
    handle<CompanyBriefingData>(r),
  )
}

/**
 * POST play → the WAV itself as a Blob (Content-Type audio/wav, private
 * no-store). Non-OK responses are JSON — parsed and attached to the thrown
 * error as `status` + `body` (same error style as handle() above) so the
 * player can branch on reason: LOGIN_REQUIRED / TRIAL_EXPIRED / FAILED.
 */
export async function postCompanyBriefingPlay(companyId: string): Promise<Blob> {
  const res = await fetch(`/api/v1/companies/${companyId}/briefing`, {
    method: "POST",
    headers: authHeaders(),
  })
  if (!res.ok) {
    let body: BriefingPlayErrorBody = {}
    try {
      body = (await res.json()) as BriefingPlayErrorBody
    } catch {
      // non-JSON error body — fall back to the generic message
    }
    const err = new Error(body.message || `Request failed (${res.status})`) as Error & {
      status?: number
      body?: BriefingPlayErrorBody
    }
    err.status = res.status
    err.body = body
    throw err
  }
  return res.blob()
}
