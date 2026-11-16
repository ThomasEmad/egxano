// =============================================================================
// Admin manual price override (owner mandate 2026-11-16).
//
// The owner can set a company's price MANUALLY from the company page (their
// explicit decision, full responsibility, audited server-side). Users must
// never see any marker that a value was hand-set — the overridden price IS
// the site's price, everywhere, live.
//
// Design: a durable Setting row (`admin-price-overrides`) holds a JSON map
// keyed by companyId. Reads apply it at READ time — so no ingestion (scanner
// pull, Yahoo backfill) can ever clobber the owner's value, and clearing the
// override instantly returns every surface to the feed.
//
// Honored by: latest-price helpers (valuation, dashboard, dividends), the
// company snapshot price, the ticker strip, the signals board (batched +
// per-company), and the technical bundle — the override patches the LAST bar
// of each merged series so indicators, plans and scores see it consistently.
// =============================================================================

import { db } from "@/lib/db"

export const ADMIN_PRICE_OVERRIDES_KEY = "admin-price-overrides"

export interface AdminPriceOverride {
  /** the owner-set price in EGP */
  price: number
  /** optional owner-set session volume (null = keep the feed's volume) */
  volume?: number | null
  updatedAt: string
}

type OverrideMap = Record<string, AdminPriceOverride>

let memCache: { value: OverrideMap; at: number } | null = null
const MEM_TTL_MS = 60_000

async function readOverrideMap(): Promise<OverrideMap> {
  if (memCache && Date.now() - memCache.at < MEM_TTL_MS) return memCache.value
  let map: OverrideMap = {}
  try {
    const row = await db.setting.findUnique({ where: { key: ADMIN_PRICE_OVERRIDES_KEY }, select: { value: true } })
    if (row?.value) {
      const parsed = JSON.parse(row.value) as OverrideMap
      if (parsed && typeof parsed === "object") map = parsed
    }
  } catch {
    map = {}
  }
  memCache = { value: map, at: Date.now() }
  return map
}

function flushMemCache(): void {
  memCache = null
}

/** Overrides for a set of companies (batched — one Setting read per 60s). */
export async function getAdminPriceOverrides(companyIds: string[]): Promise<Map<string, AdminPriceOverride>> {
  const map = await readOverrideMap()
  const out = new Map<string, AdminPriceOverride>()
  for (const id of companyIds) {
    const ov = map[id]
    if (ov && typeof ov.price === "number" && Number.isFinite(ov.price) && ov.price > 0) out.set(id, ov)
  }
  return out
}

/** ALL overrides (ticker strip overlays by ticker, so it needs the full map). */
export async function getAllAdminPriceOverrides(): Promise<OverrideMap> {
  return readOverrideMap()
}

/** The owner's override for ONE company, or null. */
export async function getAdminPriceOverride(companyId: string): Promise<AdminPriceOverride | null> {
  const map = await getAdminPriceOverrides([companyId])
  return map.get(companyId) ?? null
}

/** Persist (or update) the owner's manual price. Live: flushes every cache. */
export async function setAdminPriceOverride(
  companyId: string,
  price: number,
  volume: number | null = null,
): Promise<AdminPriceOverride> {
  if (!Number.isFinite(price) || price <= 0) throw new Error("override price must be a positive number")
  const map = await readOverrideMap()
  const ov: AdminPriceOverride = { price, volume, updatedAt: new Date().toISOString() }
  map[companyId] = ov
  const value = JSON.stringify(map)
  await db.setting.upsert({
    where: { key: ADMIN_PRICE_OVERRIDES_KEY },
    create: { key: ADMIN_PRICE_OVERRIDES_KEY, value, type: "json", description: "Admin manual price overrides (owner-only, audited)" },
    update: { value },
  })
  flushMemCache()
  const { invalidateServerCache } = await import("@/lib/server-cache")
  invalidateServerCache()
  return ov
}

/** Remove the override — every surface returns to the market feed instantly. */
export async function clearAdminPriceOverride(companyId: string): Promise<void> {
  const map = await readOverrideMap()
  if (!(companyId in map)) return
  delete map[companyId]
  const value = JSON.stringify(map)
  await db.setting.upsert({
    where: { key: ADMIN_PRICE_OVERRIDES_KEY },
    create: { key: ADMIN_PRICE_OVERRIDES_KEY, value, type: "json", description: "Admin manual price overrides (owner-only, audited)" },
    update: { value },
  })
  flushMemCache()
  const { invalidateServerCache } = await import("@/lib/server-cache")
  invalidateServerCache()
}

/**
 * Patch the LAST bar of a merged series with the owner's price — OHLC-aware
 * (high keeps its ceiling, low its floor, open untouched). Mutates the last
 * element in place; call after the series merge so indicators, levels and the
 * chart all read the owner's value.
 */
export function applyAdminPriceOverrideToLastBar(
  bars: { open: number; high: number; low: number; close: number; volume: number | null }[],
  ov: AdminPriceOverride | null,
): void {
  if (!ov || bars.length === 0) return
  const last = bars[bars.length - 1]
  last.close = ov.price
  if (ov.price > last.high) last.high = ov.price
  if (ov.price < last.low) last.low = ov.price
  if (ov.volume !== undefined && ov.volume !== null && Number.isFinite(ov.volume) && ov.volume > 0) {
    last.volume = ov.volume
  }
}

/** Recompute a change% against a overridden price while preserving the feed's
 *  implied previous close: prev = feedPrice / (1 + feedChange/100). */
export function adjustedChangePctForOverride(feedPrice: number, feedChangePct: number, overridePrice: number): number {
  const denom = 1 + feedChangePct / 100
  const prev = denom > 0 ? feedPrice / denom : null
  if (prev === null || !Number.isFinite(prev) || prev <= 0) return feedChangePct
  return (overridePrice / prev - 1) * 100
}

/** unit multiplier for financial values (as printed → plain EGP). */
export function unitMultiplier(unit: string): number {
  switch (unit) {
    case "THOUSAND":
      return 1_000
    case "MILLION":
      return 1_000_000
    case "BILLION":
      return 1_000_000_000
    default:
      return 1
  }
}
