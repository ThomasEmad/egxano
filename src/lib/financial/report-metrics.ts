// =============================================================================
// Extended deterministic financial metrics for AI reports.
// =============================================================================
//
// The platform's CalculatedMetric registry intentionally exposes a curated
// metric list (growth metrics were removed from the product by owner decision).
// The AI report, however, needs the fuller analyst set from the spec
// (growth, ROIC, liquidity, coverage, CAGR, cash-flow quality…). Those are
// computed HERE — deterministically, from verified values only — and fed to
// the model as facts. The model interprets; it never computes.
//
// Hard rules:
//   * missing input  → { status: "unavailable" } — NEVER zero, NEVER guessed
//   * zero divisor   → unavailable (never Infinity)
//   * periods are never mixed across bases (the caller supplies ONE basis)
//   * flow metrics are compared only like-for-like (Q vs Q, FY vs FY)
//   * every output carries the formula + source period labels

export interface MetricOut {
  value: number | null
  unit: string
  formula: string
  /** reported = straight from a statement line; calculated = derived here */
  basis: "reported" | "calculated"
  sourcePeriods: string[]
  status: "ok" | "unavailable"
  reason?: string
}

export interface PeriodInput {
  periodKey: string
  periodLabel: string
  periodType: string
  fiscalYear: number
  /** metric code -> normalized value (plain EGP / EGP-per-share / count) */
  raw: Record<string, number>
  /** calculated metrics from the platform recompute (already validated) */
  calc: Record<string, number>
}

export interface ExtendedMetrics {
  profitability: Record<string, MetricOut>
  valuation: Record<string, MetricOut>
  health: Record<string, MetricOut>
  growthQuality: Record<string, MetricOut>
  meta: {
    anchorPeriodKey: string
    anchorLabel: string
    priorAnnualKey: string | null
    priorComparableKey: string | null
    currency: string
  }
}

function ok(value: number, unit: string, formula: string, basis: MetricOut["basis"], sourcePeriods: string[]): MetricOut {
  return { value: Math.round(value * 100) / 100, unit, formula, basis, sourcePeriods, status: "ok" }
}
function na(unit: string, formula: string, sourcePeriods: string[], reason: string): MetricOut {
  return { value: null, unit, formula, basis: "calculated", sourcePeriods, status: "unavailable", reason }
}
function div(a: number | undefined, b: number | undefined): number | null {
  if (typeof a !== "number" || !Number.isFinite(a)) return null
  if (typeof b !== "number" || !Number.isFinite(b) || b === 0) return null
  return a / b
}

function growth(current: number | undefined, prior: number | undefined): number | null {
  if (typeof current !== "number" || !Number.isFinite(current)) return null
  if (typeof prior !== "number" || !Number.isFinite(prior) || prior === 0) return null
  // Growth across sign flips (loss→profit) is undefined as a percentage.
  if (prior < 0) return null
  return ((current - prior) / Math.abs(prior)) * 100
}

function cagr(current: number | undefined, base: number | undefined, years: number): number | null {
  if (!Number.isFinite(base) || !Number.isFinite(current) || (base as number) <= 0 || (current as number) <= 0) return null
  if (years <= 0) return null
  return (Math.pow((current as number) / (base as number), 1 / years) - 1) * 100
}

function findAnnual(periods: PeriodInput[], fiscalYear: number): PeriodInput | null {
  return periods.find((p) => p.periodType === "ANNUAL" && p.fiscalYear === fiscalYear) ?? null
}

/**
 * Build the extended metric set. `periods` must all share ONE statement basis
 * (the snapshot builder guarantees this). `anchor` is the analysis period.
 */
export function buildExtendedMetrics(
  periods: PeriodInput[],
  anchor: PeriodInput,
  market: { price: number | null; dps12m: number | null; hasDividendRecords: boolean }
): ExtendedMetrics {
  const R = anchor.raw
  const C = anchor.calc
  const cur = "EGP"
  const prevComparable =
    anchor.periodType === "ANNUAL"
      ? findAnnual(periods, anchor.fiscalYear - 1)
      : periods.find((p) => p.periodType === anchor.periodType && p.fiscalYear === anchor.fiscalYear - 1 && p.periodLabel.replace(/\d{4}/, "") === anchor.periodLabel.replace(/\d{4}/, "")) ?? null
  const priorAnnual = findAnnual(periods, anchor.fiscalYear - 1)
  const annuals = periods.filter((p) => p.periodType === "ANNUAL").sort((a, b) => a.fiscalYear - b.fiscalYear)

  // ---------------- Profitability ----------------
  const profitability: Record<string, MetricOut> = {
    revenue_growth: growth(R.REVENUE, prevComparable?.raw.REVENUE) !== null
      ? ok(growth(R.REVENUE, prevComparable?.raw.REVENUE)!, "PERCENT", "(revenue − prior-year revenue) / prior-year revenue × 100", "calculated", [anchor.periodKey, prevComparable!.periodKey])
      : na("PERCENT", "(revenue − prior-year revenue) / prior-year revenue × 100", [anchor.periodKey], prevComparable ? "prior revenue negative or zero" : "no comparable prior period"),
    net_income_growth: growth(R.NET_PROFIT, prevComparable?.raw.NET_PROFIT) !== null
      ? ok(growth(R.NET_PROFIT, prevComparable?.raw.NET_PROFIT)!, "PERCENT", "(net profit − prior net profit) / |prior net profit| × 100", "calculated", [anchor.periodKey, prevComparable!.periodKey])
      : na("PERCENT", "(net profit − prior net profit) / |prior net profit| × 100", [anchor.periodKey], prevComparable ? "prior net profit negative or zero (sign-flip growth undefined)" : "no comparable prior period"),
    gross_profit_margin: typeof C.gross_margin === "number"
      ? ok(C.gross_margin, "PERCENT", "GROSS_PROFIT / REVENUE × 100 (platform metric)", "reported", [anchor.periodKey])
      : na("PERCENT", "GROSS_PROFIT / REVENUE × 100", [anchor.periodKey], "missing gross profit or revenue"),
    operating_profit_margin: typeof C.operating_margin === "number"
      ? ok(C.operating_margin, "PERCENT", "OPERATING_INCOME / REVENUE × 100 (platform metric)", "reported", [anchor.periodKey])
      : na("PERCENT", "OPERATING_INCOME / REVENUE × 100", [anchor.periodKey], "missing operating income or revenue"),
    net_profit_margin: typeof C.net_margin === "number"
      ? ok(C.net_margin, "PERCENT", "NET_PROFIT / REVENUE × 100 (platform metric)", "reported", [anchor.periodKey])
      : na("PERCENT", "NET_PROFIT / REVENUE × 100", [anchor.periodKey], "missing net profit or revenue"),
    roe: typeof C.roe === "number"
      ? ok(C.roe, "PERCENT", "NET_PROFIT / TOTAL_EQUITY × 100 (platform metric)", "reported", [anchor.periodKey])
      : na("PERCENT", "NET_PROFIT / TOTAL_EQUITY × 100", [anchor.periodKey], "missing net profit or equity"),
    roa: typeof C.roa === "number"
      ? ok(C.roa, "PERCENT", "NET_PROFIT / TOTAL_ASSETS × 100 (platform metric)", "reported", [anchor.periodKey])
      : na("PERCENT", "NET_PROFIT / TOTAL_ASSETS × 100", [anchor.periodKey], "missing net profit or assets"),
  }
  // ROIC = EBIT × (1 − effective tax rate) / invested capital
  const taxRate = div(R.INCOME_TAX, R.PROFIT_BEFORE_TAX)
  const nopat = taxRate !== null && typeof R.EBIT === "number" ? R.EBIT * (1 - Math.min(Math.max(taxRate, 0), 1)) : null
  profitability.roic = nopat !== null && typeof R.INVESTED_CAPITAL === "number" && R.INVESTED_CAPITAL > 0
    ? ok((nopat / R.INVESTED_CAPITAL) * 100, "PERCENT", "EBIT × (1 − effective tax rate) / invested capital × 100", "calculated", [anchor.periodKey])
    : na("PERCENT", "EBIT × (1 − effective tax rate) / invested capital × 100", [anchor.periodKey], "needs EBIT, income tax, pre-tax profit and invested capital")

  // ---------------- Valuation ----------------
  const shares = typeof R.SHARES_OUTSTANDING === "number" && R.SHARES_OUTSTANDING > 0 ? R.SHARES_OUTSTANDING : null
  const price = typeof market.price === "number" && market.price > 0 ? market.price : null
  const valuation: Record<string, MetricOut> = {
    eps: typeof C.eps === "number"
      ? ok(C.eps, "EGP_PER_SHARE", "NET_PROFIT / shares outstanding (platform metric)", "reported", [anchor.periodKey])
      : na("EGP_PER_SHARE", "NET_PROFIT / shares outstanding", [anchor.periodKey], "missing net profit or share count"),
    p_e: typeof C.p_e === "number"
      ? ok(C.p_e, "RATIO", "price / EPS (platform market metric)", "calculated", [anchor.periodKey])
      : na("RATIO", "price / EPS", [anchor.periodKey], "needs a market price and positive EPS"),
    p_b: typeof C.p_b === "number"
      ? ok(C.p_b, "RATIO", "market cap / total equity (platform market metric)", "calculated", [anchor.periodKey])
      : na("RATIO", "market cap / total equity", [anchor.periodKey], "needs a market price and positive equity"),
  }
  const annualRevenue = priorAnnual ? null : null // revenue basis below
  const revenueForPS = (anchor.periodType === "ANNUAL" ? R.REVENUE : (priorAnnual?.raw.REVENUE ?? undefined))
  const revenueLabel = anchor.periodType === "ANNUAL" ? anchor.periodKey : priorAnnual?.periodKey
  valuation.p_s = price !== null && shares !== null && typeof revenueForPS === "number" && revenueForPS > 0
    ? ok((price * shares) / (revenueForPS as number), "RATIO", "market cap / annual revenue", "calculated", [revenueLabel!])
    : na("RATIO", "market cap / annual revenue", revenueLabel ? [revenueLabel] : [], "needs price, share count and positive annual revenue")
  const ebitda = typeof R.EBITDA === "number" && R.EBITDA > 0 ? R.EBITDA : null
  const netDebtVal = typeof R.NET_DEBT === "number" ? R.NET_DEBT : (typeof R.TOTAL_DEBT === "number" && typeof R.CASH_AND_EQUIVALENTS === "number" ? R.TOTAL_DEBT - R.CASH_AND_EQUIVALENTS : null)
  const ev = price !== null && shares !== null && netDebtVal !== null ? price * shares + netDebtVal : null
  valuation.ev_ebitda = ev !== null && ebitda !== null
    ? ok(ev / ebitda, "RATIO", "(market cap + net debt) / EBITDA", "calculated", [anchor.periodKey])
    : na("RATIO", "(market cap + net debt) / EBITDA", [anchor.periodKey], "needs price, shares, net debt and positive EBITDA")
  valuation.dividend_yield = market.hasDividendRecords && market.dps12m !== null && price !== null
    ? ok((market.dps12m / price) * 100, "PERCENT", "trailing-12m dividends per share / price × 100 (platform market metric)", "calculated", [anchor.periodKey])
    : na("PERCENT", "trailing-12m dividends per share / price × 100", [anchor.periodKey], "no dividend records or no price")
  void annualRevenue

  // ---------------- Financial health ----------------
  const health: Record<string, MetricOut> = {
    current_ratio: div(R.CURRENT_ASSETS, R.CURRENT_LIABILITIES) !== null
      ? ok(div(R.CURRENT_ASSETS, R.CURRENT_LIABILITIES)!, "RATIO", "current assets / current liabilities", "calculated", [anchor.periodKey])
      : na("RATIO", "current assets / current liabilities", [anchor.periodKey], "balance-sheet detail (current assets/liabilities) not published for this company"),
    quick_ratio: (typeof R.CURRENT_ASSETS === "number" && typeof R.CURRENT_LIABILITIES === "number" && R.CURRENT_LIABILITIES > 0 && typeof R.INVENTORY === "number")
      ? ok((R.CURRENT_ASSETS - R.INVENTORY) / R.CURRENT_LIABILITIES, "RATIO", "(current assets − inventory) / current liabilities", "calculated", [anchor.periodKey])
      : na("RATIO", "(current assets − inventory) / current liabilities", [anchor.periodKey], "needs current assets, inventory and current liabilities"),
    debt_to_equity: typeof C.debt_to_equity === "number"
      ? ok(C.debt_to_equity, "RATIO", "total debt / equity (platform metric)", "reported", [anchor.periodKey])
      : na("RATIO", "total debt / equity", [anchor.periodKey], "missing debt or equity"),
    total_debt: typeof R.TOTAL_DEBT === "number"
      ? ok(R.TOTAL_DEBT, cur, "reported balance-sheet total debt", "reported", [anchor.periodKey])
      : na(cur, "total debt (balance sheet)", [anchor.periodKey], "not published"),
    net_debt: netDebtVal !== null
      ? ok(netDebtVal, cur, "net debt as reported, else total debt − cash & equivalents", "calculated", [anchor.periodKey])
      : na(cur, "net debt (as reported, else total debt − cash)", [anchor.periodKey], "needs net debt or total debt + cash"),
    interest_coverage: (() => {
      const ebit = typeof R.EBIT === "number" ? R.EBIT : typeof R.OPERATING_INCOME === "number" ? R.OPERATING_INCOME : null
      const interest = typeof R.FINANCE_COST === "number" && R.FINANCE_COST !== 0 ? Math.abs(R.FINANCE_COST) : typeof R.INTEREST_PAID_CF === "number" && R.INTEREST_PAID_CF !== 0 ? Math.abs(R.INTEREST_PAID_CF) : null
      if (ebit === null || interest === null || interest === 0) return na("RATIO", "EBIT / interest expense", [anchor.periodKey], interest === null ? "no interest expense reported" : "EBIT negative or missing")
      return ok(ebit / interest, "RATIO", "EBIT / interest expense", "calculated", [anchor.periodKey])
    })(),
    operating_cash_flow: typeof R.OPERATING_CASH_FLOW === "number"
      ? ok(R.OPERATING_CASH_FLOW, cur, "reported cash-flow statement OCF", "reported", [anchor.periodKey])
      : na(cur, "operating cash flow (cash-flow statement)", [anchor.periodKey], "not published"),
    free_cash_flow: typeof R.FREE_CASH_FLOW === "number"
      ? ok(R.FREE_CASH_FLOW, cur, "reported free cash flow", "reported", [anchor.periodKey])
      : na(cur, "free cash flow", [anchor.periodKey], "not published by the source"),
  }

  // ---------------- Growth & quality (multi-year, annual basis only) ----------------
  const growthQuality: Record<string, MetricOut> = {}
  const latestAnnual = annuals[annuals.length - 1]
  const base3 = annuals.find((p) => p.fiscalYear === (latestAnnual?.fiscalYear ?? 0) - 3)
  growthQuality.revenue_cagr_3y = latestAnnual && base3
    ? (() => {
        const v = cagr(latestAnnual.raw.REVENUE, base3.raw.REVENUE, 3)
        return v !== null ? ok(v, "PERCENT", "(revenue_FY / revenue_FY−3)^(1/3) − 1 × 100", "calculated", [latestAnnual.periodKey, base3.periodKey]) : na("PERCENT", "(revenue_FY / revenue_FY−3)^(1/3) − 1 × 100", [latestAnnual.periodKey, base3.periodKey], "non-positive revenue in window")
      })()
    : na("PERCENT", "(revenue_FY / revenue_FY−3)^(1/3) − 1 × 100", [], "needs 4 consecutive annual statements")
  growthQuality.earnings_cagr_3y = latestAnnual && base3
    ? (() => {
        const v = cagr(latestAnnual.raw.NET_PROFIT, base3.raw.NET_PROFIT, 3)
        return v !== null ? ok(v, "PERCENT", "(net_profit_FY / net_profit_FY−3)^(1/3) − 1 × 100", "calculated", [latestAnnual.periodKey, base3.periodKey]) : na("PERCENT", "(net_profit_FY / net_profit_FY−3)^(1/3) − 1 × 100", [latestAnnual.periodKey, base3.periodKey], "non-positive earnings in window (CAGR undefined)")
      })()
    : na("PERCENT", "(net_profit_FY / net_profit_FY−3)^(1/3) − 1 × 100", [], "needs 4 consecutive annual statements")
  growthQuality.cash_flow_growth = prevComparable && typeof R.OPERATING_CASH_FLOW === "number" && typeof prevComparable.raw.OPERATING_CASH_FLOW === "number"
    ? (() => {
        const v = growth(R.OPERATING_CASH_FLOW, prevComparable.raw.OPERATING_CASH_FLOW)
        return v !== null ? ok(v, "PERCENT", "(OCF − prior OCF) / |prior OCF| × 100", "calculated", [anchor.periodKey, prevComparable.periodKey]) : na("PERCENT", "(OCF − prior OCF) / |prior OCF| × 100", [anchor.periodKey, prevComparable!.periodKey], "prior OCF non-positive")
      })()
    : na("PERCENT", "(OCF − prior OCF) / |prior OCF| × 100", [anchor.periodKey], "needs operating cash flow for the period and its comparable prior")
  growthQuality.earnings_quality = typeof R.OPERATING_CASH_FLOW === "number" && typeof R.NET_PROFIT === "number" && R.NET_PROFIT !== 0
    ? ok(R.OPERATING_CASH_FLOW / R.NET_PROFIT, "RATIO", "operating cash flow / net profit (>1 means profits are converting to cash)", "calculated", [anchor.periodKey])
    : na("RATIO", "operating cash flow / net profit", [anchor.periodKey], "needs OCF and non-zero net profit")
  growthQuality.working_capital_trend = (() => {
    const withWc = annuals.filter((p) => typeof p.raw.WORKING_CAPITAL === "number").slice(-3)
    if (withWc.length >= 2) {
      const first = withWc[0].raw.WORKING_CAPITAL
      const last = withWc[withWc.length - 1].raw.WORKING_CAPITAL
      const changePct = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null
      return ok(changePct ?? last - first, "PERCENT", `working capital ${withWc[0].periodLabel} → ${withWc[withWc.length - 1].periodLabel} (Δ%)`, "calculated", withWc.map((p) => p.periodKey))
    }
    return na("PERCENT", "working capital Δ% across annuals", [], "working capital not published for enough annual periods")
  })()

  return {
    profitability,
    valuation,
    health,
    growthQuality,
    meta: {
      anchorPeriodKey: anchor.periodKey,
      anchorLabel: anchor.periodLabel,
      priorAnnualKey: priorAnnual?.periodKey ?? null,
      priorComparableKey: prevComparable?.periodKey ?? null,
      currency: cur,
    },
  }
}
