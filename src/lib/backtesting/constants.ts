// Backtest configuration — ONE constants object; every assumption is a knob.
// Defaults are disclosed as ASSUMPTIONS in docs/notes/backtest-baseline.md.

export interface BacktestConfig {
  /** Sessions consumed before the first evaluated signal (engine evidence:
   *  EMA50 + MACD(36) + rangePos60 + perfM3(63) all computable ≥ 64-80). */
  warmupSessions: number
  /** EGX daily price limit band, %. If the entry-session close moves more
   *  than ±band vs the signal-session close, the name is treated as
   *  limit-locked (untradable) and the fill is skipped. DEFAULT ASSUMPTION
   *  (±20% EGX main-market band, pre-2022 single-session limit; no
   *  tier-specific band differentiation modeled). */
  dailyPriceLimitPct: number
  /** Transaction cost per side, % of traded value (brokerage + fees + spread
   *  allowance). DEFAULT ASSUMPTION 0.30%/side — see disclosure: EGX retail
   *  brokerage is commonly quoted ≈0.10–0.19% but primary sources were
   *  unreachable from this sandbox, so a conservative allowance is used. */
  costPerSidePct: number
  /** Minimum plan risk-reward for a BUY signal to be tradable. Plans with
   *  RR below this are skipped and counted in the plan-validity rate. */
  minRiskReward: number
  /** Time-stop: exit at close after N holding sessions (inclusive of entry
   *  session) if neither stop nor target was hit. */
  timeStopSessions: number
  /** One position per ticker at a time (retail single-name reality).
   *  Buy signals arriving while a trade is open are ignored. */
  allowOverlappingTrades: boolean
  /** Forward-return horizon (sessions) for the SELL exit-evidence metric. */
  sellFwdHorizonSessions: number
  /** Minimum validated sessions for a ticker to enter the backtest. */
  minSessions: number
}

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  warmupSessions: 80,
  dailyPriceLimitPct: 20,
  costPerSidePct: 0.3,
  minRiskReward: 1.0,
  timeStopSessions: 20,
  allowOverlappingTrades: false,
  sellFwdHorizonSessions: 5,
  minSessions: 150,
}

/** Walk-forward split (chronological, on the replay-session list).
 *  Baseline: NO parameter tuning — the test window is recorded and left
 *  untouched for future A/B engine comparisons. */
export const WALK_FORWARD_SPLIT = { train: 0.6, validation: 0.2, test: 0.2 } as const

/** Score bands for segmentation (engine final score, 0-100). */
export function scoreBand(score: number | null): string {
  if (score === null) return "nullScore"
  if (score < 70) return "<70"
  if (score < 80) return "70-79"
  return ">=80"
}

/** EGX ~248 trading sessions/year observed from the 2025-2026 calendars;
 *  computed per-window from actual session counts where possible. */
export const EGX_SESSIONS_PER_YEAR = 248
