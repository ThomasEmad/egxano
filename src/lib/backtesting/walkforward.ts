// WALK-FORWARD SPLIT — chronological 60/20/20 (train/validation/test) over
// the REPLAY session list (the sessions where signals are actually
// evaluated). Baseline does NO parameter tuning: the windows are recorded
// with dates so a future engine comparison can evaluate on the same
// untouched test window.
import { WALK_FORWARD_SPLIT } from "./constants"
import type { ReplayResult } from "./replay"

export interface WindowCounts {
  train: number
  validation: number
  test: number
}

export interface WindowDates {
  train: { start: string | null; end: string | null }
  validation: { start: string | null; end: string | null }
  test: { start: string | null; end: string | null }
}

export function splitWindows(replay: ReplayResult): { counts: WindowCounts; dates: WindowDates } {
  const n = replay.records.length
  const train = Math.floor(n * WALK_FORWARD_SPLIT.train)
  const validation = Math.floor(n * WALK_FORWARD_SPLIT.validation)
  // test takes the remainder so the windows always tile the replay list
  const test = n - train - validation

  const at = (i: number): string | null => (i >= 0 && i < n ? replay.records[i].ts : null)
  return {
    counts: { train, validation, test },
    dates: {
      train: { start: at(0), end: at(train - 1) },
      validation: { start: at(train), end: at(train + validation - 1) },
      test: { start: at(train + validation), end: at(n - 1) },
    },
  }
}
