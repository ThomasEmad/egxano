// Read the public, 15-minute-delayed market snapshot from the freshest source
// available:
//   1. the database `Setting` row `market_ticker_snapshot_v1` — written by
//      /api/v1/cron/market (works on serverless, refreshed intraday)
//   2. the build-time file `public/data/market-ticker.json` (fallback)
// Whichever has the newer `asOf` wins. `getFreshMarketSnapshot()` is the
// entry point for every reader; when the winner is >20 min stale inside the
// EGX session window it also kicks a background refresh via `after()`.
//
// Server-only (uses `fs` + `db`). It never invents a price: a missing/corrupt
// snapshot returns `null` and callers must render "—".

import fs from "node:fs"
import path from "node:path"
import { after } from "next/server"
import { db } from "@/lib/db"
import { MARKET_SNAPSHOT_SETTING_KEY } from "./refresh"

/** How long the Setting-derived snapshot is cached in this lambda (hot paths). */
const DB_SNAPSHOT_TTL_MS = 15_000
/** Kick a background refresh when the best snapshot is older than this. */
const STALE_KICK_MS = 20 * 60_000
/** Per-lambda cooldown between opportunistic kicks. */
const KICK_COOLDOWN_MS = 10 * 60_000
/** Beyond this age the session-window gate is ignored (guaranteed daily EOD). */
const VERY_STALE_MS = 26 * 3_600_000

export interface MarketSnapshotMover {
  ticker: string
  price: number
  changePct: number
  volume?: number
}

export interface MarketSnapshotIndex {
  name: string
  level: number
  changePct: number
}

export interface MarketSnapshot {
  asOf: string | null
  indicesAsOf: string | null
  pricesAsOf: string | null
  delayMinutes: number | null
  indices: MarketSnapshotIndex[]
  movers: MarketSnapshotMover[]
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** Validate an untrusted JSON blob into a MarketSnapshot (null when unusable). */
export function parseSnapshot(raw: unknown): MarketSnapshot | null {
  try {
    const r = raw as Record<string, unknown>

    const indices = Array.isArray(r.indices)
      ? r.indices
          .map((item) => {
            const row = item as Record<string, unknown>
            const name = asString(row.name)
            const level = asNumber(row.level)
            const changePct = asNumber(row.changePct)
            return name && level !== null && changePct !== null ? { name, level, changePct } : null
          })
          .filter((v): v is MarketSnapshotIndex => v !== null)
      : []

    const movers = Array.isArray(r.movers)
      ? r.movers
          .map((item) => {
            const row = item as Record<string, unknown>
            const ticker = asString(row.ticker)
            const price = asNumber(row.price)
            const changePct = asNumber(row.changePct)
            const volume = asNumber(row.volume)
            if (!ticker || price === null || price <= 0 || changePct === null || Math.abs(changePct) > 50) {
              return null
            }
            return { ticker, price, changePct, ...(volume !== null ? { volume } : {}) }
          })
          .filter((v): v is MarketSnapshotMover => v !== null)
      : []

    const asOf = asString(r.asOf)
    const indicesAsOf = asString(r.indicesAsOf) ?? asOf
    const pricesAsOf = asString(r.pricesAsOf) ?? asOf
    const delayMinutes = asNumber(r.delayMinutes)

    // A timestamp that is present but unparseable makes staleness math
    // impossible — treat the whole blob as unusable rather than "epoch-fresh".
    if (asOf && Number.isNaN(Date.parse(asOf))) return null
    if (!asOf && !indicesAsOf && !pricesAsOf && indices.length === 0 && movers.length === 0) {
      return null
    }

    return { asOf, indicesAsOf, pricesAsOf, delayMinutes, indices, movers }
  } catch {
    return null
  }
}

/** Read and validate the build-time file snapshot. Null when absent or unusable. */
export function readMarketSnapshot(): MarketSnapshot | null {
  try {
    const file = path.join(process.cwd(), "public", "data", "market-ticker.json")
    return parseSnapshot(JSON.parse(fs.readFileSync(file, "utf8")))
  } catch {
    return null
  }
}

function snapshotTime(s: MarketSnapshot | null): number {
  if (!s?.asOf) return -1
  const t = Date.parse(s.asOf)
  return Number.isNaN(t) ? -1 : t
}

/** The snapshot with the newer asOf (null-safe). */
export function newerSnapshot(a: MarketSnapshot | null, b: MarketSnapshot | null): MarketSnapshot | null {
  if (!a) return b
  if (!b) return a
  return snapshotTime(a) >= snapshotTime(b) ? a : b
}

/** EGX trading window (Sun–Thu, 09:00–16:00 Cairo) for opportunistic refreshes. */
export function isEgxRefreshWindow(now: Date = new Date()): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Africa/Cairo",
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(now)
    const wd = parts.find((p) => p.type === "weekday")?.value ?? ""
    const h = Number(parts.find((p) => p.type === "hour")?.value)
    if (!wd || Number.isNaN(h)) return true
    const tradingDay = ["Sun", "Mon", "Tue", "Wed", "Thu"].includes(wd)
    return tradingDay && h >= 9 && h < 16
  } catch {
    return true // unknown timezone support — refresh anyway
  }
}

let dbSnapCache: { snap: MarketSnapshot | null; at: number } | null = null
let lastKickAt = 0

/**
 * Freshest snapshot: DB Setting row vs build-time file, newer asOf wins.
 * The DB read is cached 15s per lambda to keep hot paths at ~zero extra cost.
 * When the winner is stale (>20 min) inside the EGX window (or >26h old any
 * time), a single background refresh is kicked via `after()` — the response
 * itself is never delayed.
 */
export async function getFreshMarketSnapshot(): Promise<MarketSnapshot | null> {
  const fileSnap = readMarketSnapshot()

  let dbSnap: MarketSnapshot | null
  if (dbSnapCache && Date.now() - dbSnapCache.at < DB_SNAPSHOT_TTL_MS) {
    dbSnap = dbSnapCache.snap
  } else {
    dbSnap = null
    try {
      const row = await db.setting.findUnique({
        where: { key: MARKET_SNAPSHOT_SETTING_KEY },
        select: { value: true },
      })
      if (row?.value) {
        dbSnap = parseSnapshot(JSON.parse(row.value))
      }
    } catch {
      dbSnap = null // no DB here — file fallback keeps working
    }
    dbSnapCache = { snap: dbSnap, at: Date.now() }
  }

  const best = newerSnapshot(dbSnap, fileSnap)
  kickOpportunisticRefresh(best)
  return best
}

function kickOpportunisticRefresh(snap: MarketSnapshot | null): void {
  if (!snap?.pricesAsOf) return
  const ageMs = Date.now() - Date.parse(snap.pricesAsOf)
  if (Number.isNaN(ageMs)) return
  const stale = ageMs > STALE_KICK_MS
  const veryStale = ageMs > VERY_STALE_MS
  if (!stale && !veryStale) return
  // In-session staleness refreshes often; off-session only when truly old.
  if (!veryStale && !isEgxRefreshWindow()) return
  if (Date.now() - lastKickAt < KICK_COOLDOWN_MS) return
  lastKickAt = Date.now()
  try {
    after(async () => {
      try {
        const { refreshMarketSnapshot } = await import("./refresh")
        const r = await refreshMarketSnapshot()
        if (r.ok) dbSnapCache = null // next reader picks up the fresh DB row
      } catch (e) {
        console.warn("opportunistic market refresh failed:", e instanceof Error ? e.message.slice(0, 200) : String(e))
      }
    })
  } catch {
    // after() unavailable outside request scope — cron path still covers it
  }
}

/** Ticker -> mover map. Tickers are upper-cased for stable matching. */
export function moverMap(snapshot: MarketSnapshot | null): Map<string, MarketSnapshotMover> {
  const map = new Map<string, MarketSnapshotMover>()
  for (const mover of snapshot?.movers ?? []) map.set(mover.ticker.toUpperCase(), mover)
  return map
}
