// =============================================================================
// Board snapshot — the persisted shared read model for the market-wide signals
// board. Every successful whole-market computation writes the payload into the
// existing `Setting` table (same pattern as market_ticker_snapshot_v1), and a
// freshly-scaled serverless instance serves that snapshot instantly instead of
// blocking its first user for the full ~9s computation. Data honesty: the
// snapshot carries its own computedAt/asOf and is served only within an
// age bound (15 min during Cairo market hours, 24h off-hours); anything older
// falls back to the full computation.
// =============================================================================

import { db } from "@/lib/db"
import type { MarketSignalsOutput } from "./signals-service"

const BOARD_SNAPSHOT_KEY = "technical-signals:board:v1"

export const BOARD_SNAPSHOT_FRESH_MS = 15 * 60_000
export const BOARD_SNAPSHOT_MAX_MS = 24 * 60 * 60_000

/** Is the EGX in session (Cairo clock, Sun–Thu 10:00–14:30)? */
export function isEgxMarketOpenCairo(now: Date = new Date()): boolean {
  const cairo = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    hour: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now)
  const hour = Number(cairo.find((p) => p.type === "hour")?.value ?? "0") % 24
  const weekday = cairo.find((p) => p.type === "weekday")?.value ?? ""
  return ["Sun", "Mon", "Tue", "Wed", "Thu"].includes(weekday) && hour >= 10 && hour < 14.5
}

function snapshotMaxAge(now: Date = new Date()): number {
  return isEgxMarketOpenCairo(now) ? BOARD_SNAPSHOT_FRESH_MS : BOARD_SNAPSHOT_MAX_MS
}

/** Write-behind persist of a computed board. Never throws. */
export async function persistBoardSnapshot(payload: MarketSignalsOutput): Promise<boolean> {
  try {
    const value = JSON.stringify(payload)
    await db.setting.upsert({
      where: { key: BOARD_SNAPSHOT_KEY },
      create: { key: BOARD_SNAPSHOT_KEY, value, type: "json", description: "Market-wide technical signals board snapshot (shared read model)" },
      update: { value },
    })
    return true
  } catch {
    // A locked-down DB user or a transient failure must never break the board.
    return false
  }
}

/**
 * Read the persisted board snapshot when it is fresh enough to serve honestly.
 * Returns null on absence/corruption/staleness — callers fall back to compute.
 */
export async function readBoardSnapshot(now: Date = new Date()): Promise<MarketSignalsOutput | null> {
  try {
    const row = await db.setting.findUnique({ where: { key: BOARD_SNAPSHOT_KEY }, select: { value: true } })
    if (!row) return null
    const parsed = JSON.parse(row.value) as MarketSignalsOutput
    if (!parsed || !Array.isArray(parsed.rows) || parsed.rows.length === 0) return null
    const computedAt = parsed.computedAt ? new Date(parsed.computedAt).getTime() : NaN
    if (!Number.isFinite(computedAt)) return null
    if (Date.now() - computedAt > snapshotMaxAge(now)) return null
    return parsed
  } catch {
    return null
  }
}
