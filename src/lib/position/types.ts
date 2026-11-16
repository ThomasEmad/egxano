// =============================================================================
// حلل سهمي (Position Review) — types. Owner feature (2026-11-17): the user
// enters their AVERAGE BUY PRICE and the engine talks to them like a market-
// savvy friend: hold / wait / exit, EVERY reason spelled out, every support
// and resistance on the table, and the full technical reading of the stock.
// Pure data shapes — the decision logic lives in review.ts, DB in service.ts.
// =============================================================================

/** The three outcomes for an OPEN position (never a short invitation). */
export type PositionDecision = "hold" | "wait" | "exit"

export const POSITION_DECISION_AR: Record<PositionDecision, string> = {
  hold: "احتفظ",
  wait: "انتظر وراقب",
  exit: "اخرج الآن",
}

/** One S/R zone as the user reads it: the level, its touch history, and its
 *  distance from BOTH reference points (live close and their average buy). */
export interface LevelLine {
  kind: "support" | "resistance"
  low: number
  high: number
  touches: number
  /** a resistance the market later closed above (now acts as a reference) */
  broken: boolean
  /** session of the most recent touch */
  lastTouchTs: string
  /** zone mid vs the live close, signed % (positive = level above price) */
  distFromPricePct: number
  /** zone mid vs the user's average buy, signed % */
  distFromAvgPct: number
  /** what this level IS, in the friend's words */
  noteAr: string
}

/** The compact technical reading shown next to the decision. */
export interface TechnicalSnapshot {
  lastClose: number
  rsi14: number | null
  ema20: number | null
  ema50: number | null
  trendAr: string
  relVol: number | null
  rangePos60: number | null
  atr14: number | null
  /** engine v2 state the stock is in (buy / near / wait / exit) */
  signalState: string
  /** 0–100 engine score (null when data is insufficient) */
  signalScore: number | null
  bars: number
  asOf: string | null
}

/** The friend's follow-up QUESTION (deep-loss regime only): "do you see another
 *  10% of downside?" — both outcomes are pre-computed so the UI can answer it
 *  with zero extra API calls (and zero quota burn). */
export interface ReviewQuestion {
  promptAr: string
  yesLabelAr: string
  noLabelAr: string
  /** what the engine says IF the user answers yes (expects more downside) */
  yesOutcomeAr: string
  /** what the engine says IF the user answers no (no extra downside expected) */
  noOutcomeAr: string
  /** the client-side answer echo (null until the user answers) */
  answeredAr: string | null
}

/** The full report — everything the friend would say, structured. */
export interface PositionReview {
  decision: PositionDecision
  decisionAr: string
  /** the friend's opening line — the verdict in one breath */
  headlineAr: string
  /** the user's numbers, echoed back so they can verify the input */
  avgBuyPrice: number
  lastClose: number
  /** signed P/L % on the average buy (positive = in profit) */
  pnlPct: number
  /** signed EGP per share on the average buy */
  pnlPerShare: number
  /** % gain needed on ANY OTHER stock to undo the current loss:
   *  (avgBuy / close − 1) × 100 — the compounding-math the owner mandates
   *  (−50% needs +100%, −25% needs +33.3%, −20% needs +25%). null in profit. */
  recoveryPct: number | null
  /** EVERY reason, in order, the friend's voice — no hidden weighting */
  reasonsAr: string[]
  /** the concrete follow-up plan when the decision is "wait" (e.g. sell on
   *  the first rebound); null when the decision itself is the plan */
  planAr: string | null
  /** the deep-loss follow-up question (null outside the deep-loss regime) */
  question: ReviewQuestion | null
  /** the friend's honesty closer: thinking WITH you, never a certain order */
  closingAr: string
  supports: LevelLine[]
  resistances: LevelLine[]
  /** how the levels were derived (honesty line, Arabic) */
  levelsBasisAr: string
  /** the line in the sand: the close that flips this decision */
  invalidationAr: string
  /** fundamental / liquidity / data-quality warnings that travel with it */
  warningsAr: string[]
  snapshot: TechnicalSnapshot
  engine: string
}

/** The daily free-tier quota echo (null when not signed in). */
export interface QuotaInfo {
  used: number
  limit: number
  remaining: number
  unlimited: boolean
}

/** Result wrapper for the API: null report means "not reviewable" with a
 *  reason (company missing, no price series at all). */
export interface PositionReviewResult {
  review: PositionReview | null
  notReviewableAr: string | null
  companyId: string
  ticker: string
  nameAr: string | null
  sector: string
  quota: QuotaInfo | null
}
