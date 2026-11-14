// Public surface of the position-sizing module (paid feature).
export {
  computePositionSizing,
  DEFAULT_RISK_PCT,
  RISK_PCT_MIN,
  RISK_PCT_MAX,
  DEFAULT_LIQUIDITY_CAP_PCT,
  DEFAULT_MAX_PORTFOLIO_RISK_PCT,
  MIN_STOP_DISTANCE_PCT,
  COST_FIXPOINT_MAX_ITERATIONS,
  COST_FIXPOINT_TOLERANCE,
  MAX_PER_SIDE_PCT,
  EGX_BACKTEST_COST_PER_SIDE_PCT,
  EGX_CONSERVATIVE_COSTS,
} from "./position-sizing"
export type {
  PositionSizingInput,
  PositionSizingResult,
  PositionSizingOk,
  PositionSizingErr,
  SizingDirection,
  SizingErrorCode,
  PriceZone,
  SizingCosts,
} from "./position-sizing"
