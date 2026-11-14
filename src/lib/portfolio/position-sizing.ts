// =============================================================================
// EGXANO Position Sizing — deterministic risk-based share count (paid module).
// =============================================================================
//
// يحسب عدد الأسهم من ميزانية المخاطرة، مع احترام قيود السيولة والمخاطرة
// الإجمالية للمحفظة وحدود الـ lot — بدون ذكاء اصطناعي ولا عشوائية ولا DB.
// كل رقم في المخرجات مشتق من المدخلات بمعادلة موثقة وقابلة لإعادة الحساب.
//
// CORE MATH (fixed contract — do not "improve" without updating tests):
//   riskBudget          = capital × riskPct (riskPct clamped to [0.002, 0.05])
//   priceRiskPerShare   = |effectiveEntry − stop|        (price risk ONLY)
//   riskPerShare        = priceRiskPerShare + perShareCosts
//   sharesRaw           = riskBudget / riskPerShare
//   shares              = floor → lot-round DOWN → liquidity cap → portfolio
//                         cap → minShares check. NEVER rounds up through the
//                         risk budget: every adjustment only shrinks.
//   riskAmount          = shares × priceRiskPerShare            (price only)
//   riskAmountWithCosts = shares × riskPerShare                 (honest total)
//   breakEven           = effectiveEntry ± perShareCosts        (direction-aware)
//   R-multiple          = (target − breakEven) / priceRiskPerShare  (buy; sell
//                         symmetric: (breakEven − target) / priceRiskPerShare)
//
// COSTS CIRCULARITY (documented, resolved — no hand-waving):
//   A percent-based cost model needs the POSITION VALUE, which needs `shares`,
//   which needs the per-share cost — circular. Resolved with a fixed-point
//   iteration: start from perShareCosts = 0, size, recompute the per-share
//   cost from the sized position value, resize… max 3 iterations, tolerance
//   1e-9 (see COST_FIXPOINT_* below). Because `shares` is floored, the map
//   stabilizes in 1–2 iterations for any realistic fee schedule; a punitive
//   minimum commission on a tiny budget may spiral down to 0 shares — that is
//   the honest answer (the trade is not viable under its own costs), returned
//   as ok:true with shares = 0 and a warning.
//
// HONESTY RULES (match src/lib/technical/trade-plan.ts):
//   • 100% deterministic — no AI, no randomness, no fabricated fee numbers.
//     The ONLY real cost constant reused from this repo is the backtester's
//     conservative 0.30%/side allowance (src/lib/backtesting/constants.ts,
//     DEFAULT_BACKTEST_CONFIG.costPerSidePct — EGX retail brokerage is
//     commonly quoted ≈0.10–0.19% but primary sources were unreachable, so
//     the backtest uses 0.30%); it is exported here as a SUGGESTION only
//     (EGX_CONSERVATIVE_COSTS) and is NOT applied by default. Default costs
//     are 0 with an explicit Arabic warning telling the user to enter their
//     broker's commissions.
//   • A gap through the stop can make the real loss larger than the budget —
//     the estimate is disclosed as such on EVERY successful result.
//   • Every invalid input returns a typed Arabic error; NaN/Infinity never
//     leak into any output field.
//   • Results are informational, not investment advice.
// =============================================================================

import { roundToTick } from "../technical/trade-plan"

// ---- documented constants ----------------------------------------------------

/** Fraction of capital risked per trade when the caller does not specify one. */
export const DEFAULT_RISK_PCT = 0.01
/** Risk-per-trade clamp band (platform policy; user-editable in the UI later). */
export const RISK_PCT_MIN = 0.002
export const RISK_PCT_MAX = 0.05
/** Default liquidity ceiling: shares ≤ 10% of average daily volume. */
export const DEFAULT_LIQUIDITY_CAP_PCT = 0.1
/** Default total portfolio open-risk ceiling as a fraction of capital. */
export const DEFAULT_MAX_PORTFOLIO_RISK_PCT = 0.06
/** Stop closer than 1% of the effective entry is noise, not structure (warn). */
export const MIN_STOP_DISTANCE_PCT = 0.01
/** Fixed-point resolution of the percent-cost circularity (see header). */
export const COST_FIXPOINT_MAX_ITERATIONS = 3
export const COST_FIXPOINT_TOLERANCE = 1e-9
/** Sanity ceiling for a user-supplied per-side cost fraction (5%/side). */
export const MAX_PER_SIDE_PCT = 0.05

/**
 * SUGGESTION ONLY — not applied by default. Reused from this repo's backtest
 * cost model: src/lib/backtesting/constants.ts, DEFAULT_BACKTEST_CONFIG
 * .costPerSidePct = 0.3 (%/side, brokerage + fees + spread allowance, chosen
 * conservative because primary EGX fee sources were unreachable). 0.3% per
 * side = 0.003 fraction per side. Pass it explicitly as
 * `costs: EGX_CONSERVATIVE_COSTS` when the user wants a sane default.
 */
export const EGX_BACKTEST_COST_PER_SIDE_PCT = 0.003
export const EGX_CONSERVATIVE_COSTS = {
  perSidePct: EGX_BACKTEST_COST_PER_SIDE_PCT,
  minPerSide: 0,
} as const

// ---- input / output types ----------------------------------------------------

export type SizingDirection = "buy" | "sell"

export interface PriceZone {
  low: number
  high: number
}

export interface SizingCosts {
  /** Fraction of traded value charged PER SIDE (0.003 = 0.3%/side). */
  perSidePct: number
  /** Minimum currency amount charged per side, regardless of size. */
  minPerSide: number
}

export interface PositionSizingInput {
  /** Account capital in EGP (> 0). */
  capital: number
  /** Fraction of capital risked per trade; default 0.01, clamped to [0.002, 0.05]. */
  riskPct?: number
  /** Trade direction — geometry and break-even are direction-aware. */
  direction: SizingDirection
  /** Entry ZONE — the mid is the effective entry. Takes precedence over entryPrice. */
  entry?: PriceZone
  /** Single entry price (alternative to `entry`). */
  entryPrice?: number
  /** Structural stop. For buy it must be BELOW the effective entry; for sell ABOVE. */
  stop: number
  /** Optional target zone — enables R-multiple outputs. */
  target?: PriceZone
  /** EGX tick size (> 0); all order-relevant prices pass through roundToTick. */
  tickSize: number
  /** User-supplied per-share ROUND-TRIP cost estimate (mutually exclusive with `costs`). */
  costsPerShare?: number
  /** Percent-based cost model (mutually exclusive with `costsPerShare`). */
  costs?: SizingCosts
  /** Average daily volume (shares) — enables the liquidity cap. */
  avgDailyVolume?: number
  /** Liquidity ceiling as a fraction of avgDailyVolume; default 0.1. */
  liquidityCapPct?: number
  /** Risk already open in the portfolio (currency) — enables the portfolio cap. */
  currentOpenRiskAmount?: number
  /** Total portfolio open-risk ceiling as a fraction of capital; default 0.06. */
  maxTotalPortfolioRiskPct?: number
  /** Board-lot / minimum position: if the sized shares are below it → 0 shares + warning. */
  minShares?: number
  /** Lot multiple: shares are rounded DOWN to a multiple of it (default 1 = none). */
  lotSize?: number
}

export type SizingErrorCode =
  | "INVALID_CAPITAL"
  | "INVALID_RISK_PCT"
  | "INVALID_DIRECTION"
  | "MISSING_ENTRY"
  | "INVALID_ENTRY_ZONE"
  | "INVALID_ENTRY_PRICE"
  | "INVALID_STOP"
  | "STOP_WRONG_SIDE"
  | "INVALID_TARGET_ZONE"
  | "TARGET_WRONG_SIDE"
  | "INVALID_TICK_SIZE"
  | "COSTS_CONFLICT"
  | "INVALID_COSTS_PER_SHARE"
  | "INVALID_COSTS"
  | "INVALID_AVG_DAILY_VOLUME"
  | "INVALID_LIQUIDITY_CAP_PCT"
  | "INVALID_CURRENT_OPEN_RISK"
  | "INVALID_MAX_PORTFOLIO_RISK_PCT"
  | "INVALID_MIN_SHARES"
  | "INVALID_LOT_SIZE"
  | "INTERNAL_NUMERIC_GUARD"

export interface PositionSizingOk {
  ok: true
  direction: SizingDirection
  /** Final share count (integer ≥ 0; 0 = no tradable position — see warnings). */
  shares: number
  /** Tick-rounded effective entry (zone mid, or the single price). */
  effectiveEntry: number
  /** Where the effective entry came from. */
  entrySource: "zone_mid" | "single_price"
  /** Entry zone as given (a single price is echoed as low = high). */
  entryZone: PriceZone
  /** Tick-rounded structural stop actually used. */
  stop: number
  /** Target zone as given (null when absent). */
  targetZone: PriceZone | null
  /** Mid of the tick-rounded target zone (null when absent). */
  targetMid: number | null
  /** riskPct actually used, after clamping. */
  riskPctUsed: number
  /** capital × riskPctUsed. */
  riskBudget: number
  /** |effectiveEntry − stop| — price risk per share, costs excluded. */
  priceRiskPerShare: number
  /** Estimated per-share round-trip cost included in the sizing. */
  perShareCosts: number
  /** priceRiskPerShare + perShareCosts — the sizing denominator. */
  riskPerShare: number
  /** shares × priceRiskPerShare (price risk only). */
  riskAmount: number
  /** shares × riskPerShare — the honest total risk of this position. */
  riskAmountWithCosts: number
  /** shares × effectiveEntry. */
  positionValue: number
  /** Direction-aware break-even: entry ± perShareCosts. NOT tick-rounded —
   *  it embeds a per-share cost estimate, which is sub-tick by nature. */
  breakEven: number
  /** R-multiples vs breakEven over priceRiskPerShare (null when no target). */
  rTargetLow: number | null
  rTargetMid: number | null
  rTargetHigh: number | null
  /** Arabic warnings (gap-risk disclosure is always present). */
  warnings: string[]
}

export interface PositionSizingErr {
  ok: false
  code: SizingErrorCode
  errorAr: string
}

export type PositionSizingResult = PositionSizingOk | PositionSizingErr

// ---- Arabic warning texts (professional, direct, no emoji) --------------------

const WARN_GAP_RISK =
  "ميزانية المخاطرة تقديرية: فجوة سعرية عند الافتتاح قد تجعل الخسارة الفعلية أكبر من الميزانية."
const WARN_COSTS_NOT_INCLUDED =
  "التكاليف غير مضمنة — أدخل عمولات الوسيط لتفعيلها."
const WARN_STOP_TOO_CLOSE =
  "ستوب قريب جدًا — ضوضاء وليس هيكلاً"
const WARN_RISK_CLAMPED =
  `تم تقييد نسبة المخاطرة إلى النطاق المسموح (من ${(RISK_PCT_MIN * 100).toFixed(1)}% إلى ${(RISK_PCT_MAX * 100).toFixed(1)}%).`
const WARN_LIQUIDITY_IGNORED =
  "تم تجاهل حد السيولة لعدم إدخال متوسط الحجم اليومي."
const WARN_ZERO_SHARES =
  "الحجم المحسوب صفر — لا توجد صفقة قابلة للتنفيذ بهذه المعطيات."

const fmt2 = (x: number): string => x.toFixed(2)

// ---- internal guards ---------------------------------------------------------

function isFiniteNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x)
}

function err(code: SizingErrorCode, errorAr: string): PositionSizingErr {
  return { ok: false, code, errorAr }
}

// ---- main entry point ---------------------------------------------------------

/**
 * Size a position from a risk budget. Pure and deterministic: same inputs →
 * same result, always. No DB, no AI, no randomness, no clocks.
 */
export function computePositionSizing(input: PositionSizingInput): PositionSizingResult {
  // ---------- 1. scalar validation (typed Arabic errors, first failure wins)
  if (!isFiniteNum(input.capital) || input.capital <= 0) {
    return err("INVALID_CAPITAL", "رأس المال يجب أن يكون رقمًا أكبر من صفر.")
  }
  if (input.direction !== "buy" && input.direction !== "sell") {
    return err("INVALID_DIRECTION", "الاتجاه يجب أن يكون شراء (buy) أو بيع (sell).")
  }
  const capital = input.capital
  const isBuy = input.direction === "buy"

  let riskPct = DEFAULT_RISK_PCT
  if (input.riskPct !== undefined) {
    if (!isFiniteNum(input.riskPct) || input.riskPct <= 0) {
      return err("INVALID_RISK_PCT", "نسبة المخاطرة يجب أن تكون رقمًا موجبًا (كسر من رأس المال، مثل 0.01).")
    }
    riskPct = input.riskPct
  }
  const riskPctUsed = Math.min(RISK_PCT_MAX, Math.max(RISK_PCT_MIN, riskPct))
  const riskPctClamped = riskPctUsed !== riskPct

  if (!isFiniteNum(input.tickSize) || input.tickSize <= 0) {
    return err("INVALID_TICK_SIZE", "حجم التيك يجب أن يكون رقمًا أكبر من صفر.")
  }
  const tickSize = input.tickSize

  // ---------- 2. entry (zone mid takes documented precedence over single price)
  const hasZone = input.entry !== undefined
  const hasSingle = input.entryPrice !== undefined
  if (!hasZone && !hasSingle) {
    return err("MISSING_ENTRY", "أدخل منطقة دخول (entry.low / entry.high) أو سعر دخول واحد (entryPrice).")
  }
  let entryZone: PriceZone
  let entrySource: PositionSizingOk["entrySource"]
  if (hasZone && input.entry !== undefined) {
    const z = input.entry
    if (!isFiniteNum(z.low) || !isFiniteNum(z.high) || z.low <= 0 || z.high <= 0 || z.low > z.high) {
      return err("INVALID_ENTRY_ZONE", "منطقة الدخول غير صالحة: low و high رقمًا موجبًا و low ≤ high.")
    }
    entryZone = { low: z.low, high: z.high }
    entrySource = "zone_mid"
  } else if (isFiniteNum(input.entryPrice) && input.entryPrice > 0) {
    entryZone = { low: input.entryPrice, high: input.entryPrice }
    entrySource = "single_price"
  } else {
    return err("INVALID_ENTRY_PRICE", "سعر الدخول يجب أن يكون رقمًا موجبًا.")
  }

  if (!isFiniteNum(input.stop) || input.stop <= 0) {
    return err("INVALID_STOP", "وقف الخسارة يجب أن يكون رقمًا موجبًا.")
  }

  // ---------- 3. optional target zone
  let targetZone: PriceZone | null = null
  if (input.target !== undefined) {
    const t = input.target
    if (!isFiniteNum(t.low) || !isFiniteNum(t.high) || t.low <= 0 || t.high <= 0 || t.low > t.high) {
      return err("INVALID_TARGET_ZONE", "منطقة الهدف غير صالحة: low و high رقمًا موجبًا و low ≤ high.")
    }
    targetZone = { low: t.low, high: t.high }
  }

  // ---------- 4. costs (mutually exclusive sources)
  if (input.costsPerShare !== undefined && input.costs !== undefined) {
    return err("COSTS_CONFLICT", "لا يمكن تمرير costsPerShare و costs معًا — اختر مصدرًا واحدًا للتكاليف.")
  }
  if (input.costsPerShare !== undefined && (!isFiniteNum(input.costsPerShare) || input.costsPerShare < 0)) {
    return err("INVALID_COSTS_PER_SHARE", "التكلفة لكل سهم يجب أن تكون رقمًا ≥ 0.")
  }
  if (input.costs !== undefined) {
    const c = input.costs
    if (
      !isFiniteNum(c.perSidePct) || c.perSidePct < 0 || c.perSidePct > MAX_PER_SIDE_PCT ||
      !isFiniteNum(c.minPerSide) || c.minPerSide < 0
    ) {
      return err("INVALID_COSTS", `التكاليف غير صالحة: perSidePct كسر بين 0 و ${MAX_PER_SIDE_PCT} لكل جهة، و minPerSide رقم ≥ 0.`)
    }
  }

  // ---------- 5. liquidity / portfolio / lot constraints
  if (input.avgDailyVolume !== undefined && (!isFiniteNum(input.avgDailyVolume) || input.avgDailyVolume <= 0)) {
    return err("INVALID_AVG_DAILY_VOLUME", "متوسط الحجم اليومي يجب أن يكون رقمًا موجبًا.")
  }
  if (input.liquidityCapPct !== undefined && (!isFiniteNum(input.liquidityCapPct) || input.liquidityCapPct <= 0 || input.liquidityCapPct > 1)) {
    return err("INVALID_LIQUIDITY_CAP_PCT", "نسبة حد السيولة يجب أن تكون كسرًا بين 0 و 1 (مثل 0.1).")
  }
  if (input.currentOpenRiskAmount !== undefined && (!isFiniteNum(input.currentOpenRiskAmount) || input.currentOpenRiskAmount < 0)) {
    return err("INVALID_CURRENT_OPEN_RISK", "المخاطرة المفتوحة الحالية يجب أن تكون رقمًا ≥ 0.")
  }
  if (input.maxTotalPortfolioRiskPct !== undefined && (!isFiniteNum(input.maxTotalPortfolioRiskPct) || input.maxTotalPortfolioRiskPct <= 0 || input.maxTotalPortfolioRiskPct > 1)) {
    return err("INVALID_MAX_PORTFOLIO_RISK_PCT", "الحد الأقصى لمخاطرة المحفظة يجب أن يكون كسرًا بين 0 و 1 (مثل 0.06).")
  }
  if (input.minShares !== undefined && (!isFiniteNum(input.minShares) || input.minShares < 0)) {
    return err("INVALID_MIN_SHARES", "الحد الأدنى لعدد الأسهم يجب أن يكون رقمًا ≥ 0.")
  }
  if (input.lotSize !== undefined && (!isFiniteNum(input.lotSize) || input.lotSize <= 0 || !Number.isInteger(input.lotSize))) {
    return err("INVALID_LOT_SIZE", "حجم الـ lot يجب أن يكون عددًا صحيحًا موجبًا.")
  }

  // ---------- 6. geometry: tick-rounded order levels (platform convention:
  // every order-relevant price passes through roundToTick — trade-plan.ts)
  const effectiveEntry = roundToTick(entrySource === "zone_mid" ? (entryZone.low + entryZone.high) / 2 : entryZone.low, tickSize)
  const stop = roundToTick(input.stop, tickSize)
  if (isBuy ? !(stop < effectiveEntry) : !(stop > effectiveEntry)) {
    return err(
      "STOP_WRONG_SIDE",
      isBuy
        ? "وقف الخسارة يجب أن يكون أقل من سعر الدخول الفعلي في صفقة شراء."
        : "وقف الخسارة يجب أن يكون أكبر من سعر الدخول الفعلي في صفقة بيع.",
    )
  }
  let targetLow: number | null = null
  let targetHigh: number | null = null
  let targetMid: number | null = null
  if (targetZone !== null) {
    targetLow = roundToTick(targetZone.low, tickSize)
    targetHigh = roundToTick(targetZone.high, tickSize)
    targetMid = (targetLow + targetHigh) / 2
    if (isBuy ? !(targetMid > effectiveEntry) : !(targetMid < effectiveEntry)) {
      return err(
        "TARGET_WRONG_SIDE",
        isBuy
          ? "هدف الصفقة يجب أن يكون أعلى من سعر الدخول الفعلي في صفقة شراء."
          : "هدف الصفقة يجب أن يكون أقل من سعر الدخول الفعلي في صفقة بيع.",
      )
    }
  }

  const priceRiskPerShare = Math.abs(effectiveEntry - stop)

  // ---------- 7. stop sanity (warning, not fatal — the trader owns structure)
  const warnings: string[] = []
  const stopTooClose = priceRiskPerShare < tickSize || priceRiskPerShare < MIN_STOP_DISTANCE_PCT * effectiveEntry
  if (stopTooClose) warnings.push(WARN_STOP_TOO_CLOSE)
  if (riskPctClamped) warnings.push(WARN_RISK_CLAMPED)

  // ---------- 8. per-share costs + sizing (fixed point for the percent model)
  const riskBudget = capital * riskPctUsed

  let perShareCosts = 0
  let shares = Math.floor(riskBudget / priceRiskPerShare)

  if (input.costsPerShare !== undefined) {
    perShareCosts = input.costsPerShare
    shares = Math.floor(riskBudget / (priceRiskPerShare + perShareCosts))
  } else if (input.costs !== undefined) {
    // Fixed-point resolution of the circularity documented in the header:
    // cost ← position value ← shares ← cost. Floor makes the map monotone
    // enough to stabilize in 1–2 rounds; 3 rounds max, tolerance 1e-9.
    for (let i = 0; i < COST_FIXPOINT_MAX_ITERATIONS; i++) {
      if (shares <= 0) break // no position to price — the trade is dead either way
      const positionValueIter = shares * effectiveEntry
      const perSideCost = Math.max(positionValueIter * input.costs.perSidePct, input.costs.minPerSide)
      const next = (2 * perSideCost) / shares // round trip = 2 sides
      const converged = Math.abs(next - perShareCosts) <= COST_FIXPOINT_TOLERANCE
      perShareCosts = next
      if (converged) break
      shares = Math.floor(riskBudget / (priceRiskPerShare + perShareCosts))
    }
  }

  const riskPerShare = priceRiskPerShare + perShareCosts

  // ---------- 9. downward-only constraint cascade (NEVER round up)
  // a) lot multiple
  const lotSize = input.lotSize ?? 1
  if (lotSize > 1) shares = Math.floor(shares / lotSize) * lotSize

  // b) liquidity cap: shares ≤ liquidityCapPct × avgDailyVolume (floored —
  //    a fractional cap is never rounded up into shares)
  if (input.liquidityCapPct !== undefined && input.avgDailyVolume === undefined) {
    warnings.push(WARN_LIQUIDITY_IGNORED)
  }
  if (input.avgDailyVolume !== undefined) {
    const liquidityCapPct = input.liquidityCapPct ?? DEFAULT_LIQUIDITY_CAP_PCT
    const capShares = Math.floor(input.avgDailyVolume * liquidityCapPct)
    if (capShares < shares) {
      shares = capShares
      warnings.push(
        `الحجم مقيّد بحد السيولة: ${capShares} سهم كحد أقصى (${(liquidityCapPct * 100).toFixed(1)}% من متوسط الحجم اليومي).`,
      )
    }
  }

  // c) portfolio cap: the NEW trade's full risk (with costs — the honest
  //    figure a portfolio tracker should hold) must fit under
  //    capital × maxTotalPortfolioRiskPct − currentOpenRiskAmount.
  if (input.currentOpenRiskAmount !== undefined || input.maxTotalPortfolioRiskPct !== undefined) {
    const maxTotalPct = input.maxTotalPortfolioRiskPct ?? DEFAULT_MAX_PORTFOLIO_RISK_PCT
    const openRisk = input.currentOpenRiskAmount ?? 0
    const totalCeiling = capital * maxTotalPct
    const allowance = Math.max(0, totalCeiling - openRisk)
    const maxSharesForPortfolio = Math.floor(allowance / riskPerShare)
    if (maxSharesForPortfolio < shares) {
      if (shares > 0) {
        warnings.push(
          `تم تقليل حجم الصفقة لاحترام الحد الأقصى لمخاطرة المحفظة (${(maxTotalPct * 100).toFixed(1)}% من رأس المال): المتاح للصفقة الجديدة ${fmt2(allowance)} بعد مخاطرة مفتوحة قدرها ${fmt2(openRisk)}.`,
        )
      }
      shares = maxSharesForPortfolio
    }
  }

  // d) board-lot / minimum position — zero shares, not a fractional trade
  const sharesBeforeMin = shares
  if (input.minShares !== undefined && input.minShares > 0 && shares < input.minShares) {
    shares = 0
    warnings.push(
      sharesBeforeMin > 0
        ? `الحجم المحسوب (${sharesBeforeMin} سهم) أقل من الحد الأدنى المطلوب (${input.minShares} سهم) — لا صفقة.`
        : `الحجم المحسوب أقل من الحد الأدنى المطلوب (${input.minShares} سهم) — لا صفقة.`,
    )
  }

  if (shares === 0) warnings.push(WARN_ZERO_SHARES)
  if (perShareCosts === 0) warnings.push(WARN_COSTS_NOT_INCLUDED)
  // Mandatory on every successful result — the budget is an estimate, not a
  // guarantee (overnight gaps trade through stops).
  warnings.push(WARN_GAP_RISK)

  // ---------- 10. output figures (final shares; every number finite)
  const riskAmount = shares * priceRiskPerShare
  const riskAmountWithCosts = shares * riskPerShare
  const positionValue = shares * effectiveEntry
  const breakEven = isBuy ? effectiveEntry + perShareCosts : effectiveEntry - perShareCosts

  let rTargetLow: number | null = null
  let rTargetMidR: number | null = null
  let rTargetHigh: number | null = null
  if (targetLow !== null && targetHigh !== null && targetMid !== null) {
    const signed = (x: number): number => (isBuy ? (x - breakEven) / priceRiskPerShare : (breakEven - x) / priceRiskPerShare)
    rTargetLow = signed(targetLow)
    rTargetMidR = signed(targetMid)
    rTargetHigh = signed(targetHigh)
  }

  // Numeric guard: the contract is that NaN/Infinity never leak. All inputs
  // were validated finite and every denominator here is > 0, so this is a
  // belt-and-braces assertion, not an expected path.
  const outputs = [effectiveEntry, stop, priceRiskPerShare, perShareCosts, riskPerShare, riskBudget, riskAmount, riskAmountWithCosts, positionValue, breakEven, shares]
  if (outputs.some((v) => !Number.isFinite(v))) {
    return err("INTERNAL_NUMERIC_GUARD", "خطأ حسابي داخلي — لم تُنتج المعادلات قيمة رقمية صالحة.")
  }
  for (const r of [rTargetLow, rTargetMidR, rTargetHigh]) {
    if (r !== null && !Number.isFinite(r)) {
      return err("INTERNAL_NUMERIC_GUARD", "خطأ حسابي داخلي — لم تُنتج المعادلات قيمة رقمية صالحة.")
    }
  }

  return {
    ok: true,
    direction: input.direction,
    shares,
    effectiveEntry,
    entrySource,
    entryZone,
    stop,
    targetZone,
    targetMid,
    riskPctUsed,
    riskBudget,
    priceRiskPerShare,
    perShareCosts,
    riskPerShare,
    riskAmount,
    riskAmountWithCosts,
    positionValue,
    breakEven,
    rTargetLow,
    rTargetMid: rTargetMidR,
    rTargetHigh,
    warnings,
  }
}
