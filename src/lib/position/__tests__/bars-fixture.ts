// =============================================================================
// Shared bar-series fixtures for the cushion-rule and position-review tests.
// The geometry is engineered to produce EXACT zones via buildZoneMap:
//   an early low base at `base` (two pivots: base and base+0.4 → one 2× zone),
//   a mid base at 104 (two pivots: 104.0 and 104.4 → the broken 2× zone),
//   a rise to 114, then a final session closing at 103 (or an override).
// Default lows/highs stay strictly outside the pivot windows so the only
// clusters are the intended ones.
// =============================================================================

import type { Bar } from "@/lib/signals/types"

export function bar(ts: string, open: number, high: number, low: number, close: number, volume: number | null = 1000): Bar {
  return { ts, open, high, low, close, volume }
}

/** 80 sessions:
 *  0-9    rise 100 → 103 with TWO pivot lows at `base` / `base+0.4` (idx 2, 8)
 *  10-29  rise 103 → 118
 *  30-35  drop 118 → 104.6
 *  36-40  base: pivot low 104.0 (idx 37)
 *  41-48  rise 104.6 → 113
 *  49-56  drop to 104.6: pivot low 104.4 (idx 53)
 *  57-58  bounce 108
 *  59     FINAL session: close = `finalClose` (default 103 — breaks the 104 zone) */
export function cushionSeries(base: number, finalClose = 103): Bar[] {
  const bars: Bar[] = []
  let i = 0
  const push = (close: number, lowOverride: number | null, highOverride: number | null) => {
    const ts = `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}-${String(i).padStart(3, "0")}`
    const low = lowOverride ?? close - 0.35
    const high = highOverride ?? close + 0.35
    bars.push(bar(ts, close, Math.max(high, close), Math.min(low, close), close))
    i++
  }

  // 0-11: early base + rise; pivots at idx 3 (base) and idx 8 (base+0.4) —
  // buildZoneMap only scans pivots from i = PIVOT_K (3), so idx ≤ 2 never counts
  for (let k = 0; k < 3; k++) push(100.6 + k * 0.4, null, null) // closes 100.6,101,101.4 — lows stay above a 100-level pivot
  push(101, base, null) // idx 3 — first base pivot
  for (let k = 0; k < 4; k++) push(101.5 + k * 0.5, null, null) // idx 4-7
  push(101.2, base + 0.4, null) // idx 8 — second base pivot (rise pause)
  // 10-42: strong rise 103 → 118 (33 sessions — detectExit needs ≥70 bars)
  for (let k = 0; k < 33; k++) push(103.5 + k * 0.45, null, null)
  // 30-35: drop 118 → 104.6
  for (let k = 0; k < 6; k++) push(118 - k * 2.25, null, null)
  // 36-40: base — pivot low 104.0 at idx 37
  push(104.8, null, null)
  push(104.3, 104.0, null)
  push(104.8, null, null)
  push(104.9, null, null)
  push(105.2, null, null)
  // 41-48: rise 104.6 → 113
  for (let k = 0; k < 8; k++) push(105.5 + k * 0.95, null, null)
  // 49-56: drop; pivot low 104.4 at idx 53
  for (let k = 0; k < 4; k++) push(112.5 - k * 2.0, null, null)
  push(105.0, null, null)
  push(104.6, 104.4, null)
  push(104.9, null, null)
  push(105.1, null, null)
  // 57-58: bounce to 108
  push(106.5, null, null)
  push(108.0, null, null)
  // 59: the break session
  push(finalClose, Math.min(finalClose - 0.2, finalClose), null)
  return bars
}

/** 71 sessions of a clean monotone decline 120 → 100 — no pivot lows, hence
 *  NO support zones at all (the "open field below" position-review case). */
export function decliningSeries(): Bar[] {
  const bars: Bar[] = []
  for (let i = 0; i < 71; i++) {
    const close = 120 - i * (20 / 70)
    const ts = `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}-${String(i).padStart(3, "0")}`
    bars.push(bar(ts, close, close + 0.35, close - 0.35, close))
  }
  return bars
}
