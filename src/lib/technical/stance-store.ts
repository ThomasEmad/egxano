// =============================================================================
// Canonical stance store — the SINGLE SOURCE OF TRUTH for per-company technical
// readings and levels (2026-11-14).
//
// WHY THIS EXISTS: the signals board computed its trade plan from a close-only
// series while the company technical tab computed its own plan from the full
// OHLC bundle — two sources produced two different stop-loss numbers for the
// SAME stock (13.27 on the board vs 12.67 on the tab, with 13.11 shown as the
// invalidation). That is unacceptable for a paid financial product.
//
// CONTRACT: every surface (signals board, company technical tab, cron
// evaluators) reads the persisted StanceSnapshot row. The reading is computed
// ONCE per data change (buildTechnicalBundleWithContext → computeStanceFromSnapshot)
// and persisted. Lazily recomputed when stale (> STALE_AFTER_MS) or when the
// engine version changes; the stance-refresh cron keeps the universe warm.
// =============================================================================

import { db } from "@/lib/db"
import { computeStanceFromSnapshot, SIGNALS_VERSION, type TechStance } from "@/lib/technical/signals"
import { buildTechnicalBundleWithContext } from "@/lib/market/intelligence/context"

/** Bump whenever the bundle/stance computation changes shape. */
export const STANCE_ENGINE_VERSION = "stance@1"

/** A persisted stance older than this is recomputed lazily. */
export const STALE_AFTER_MS = 20 * 60 * 60 * 1000

/** Persisted stances older than this are not trusted for board display. */
export const BOARD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export type CanonicalStance = {
  stance: TechStance
  dataAsOf: Date
  computedAt: Date
  engineVersion: string
}

function parseStanceJson(row: {
  stanceJson: string
  dataAsOf: Date
  computedAt: Date
  engineVersion: string
}): TechStance | null {
  try {
    const parsed = JSON.parse(row.stanceJson) as TechStance
    if (!parsed || typeof parsed !== "object") return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Read the persisted canonical stance for a company WITHOUT recomputing.
 * Returns null when no fresh-enough row exists.
 */
export async function readCanonicalStance(companyId: string, maxAgeMs = BOARD_MAX_AGE_MS): Promise<CanonicalStance | null> {
  const row = await db.stanceSnapshot.findUnique({ where: { companyId } })
  if (!row) return null
  if (row.engineVersion !== STANCE_ENGINE_VERSION) return null
  if (Date.now() - row.computedAt.getTime() > maxAgeMs) return null
  const stance = parseStanceJson(row)
  if (!stance) return null
  return { stance, dataAsOf: row.dataAsOf, computedAt: row.computedAt, engineVersion: row.engineVersion }
}

/**
 * The canonical reading path used by the company technical tab: return the
 * persisted stance when fresh; otherwise recompute from the full OHLC bundle,
 * persist it, and return it. The SAME row the signals board reads.
 */
export async function getCanonicalStance(companyId: string): Promise<{ stance: TechStance; dataAsOf: Date; persisted: boolean }> {
  const row = await db.stanceSnapshot.findUnique({ where: { companyId } })
  if (
    row &&
    row.engineVersion === STANCE_ENGINE_VERSION &&
    Date.now() - row.computedAt.getTime() < STALE_AFTER_MS
  ) {
    const stance = parseStanceJson(row)
    if (stance) return { stance, dataAsOf: row.dataAsOf, persisted: true }
  }
  const bundle = await buildTechnicalBundleWithContext(companyId)
  const stance = computeStanceFromSnapshot(bundle.snapshot)
  const dataAsOf = bundle.snapshot.asOf ? new Date(bundle.snapshot.asOf) : new Date(0)
  await db.stanceSnapshot.upsert({
    where: { companyId },
    create: {
      companyId,
      engineVersion: STANCE_ENGINE_VERSION,
      signalsVersion: SIGNALS_VERSION,
      dataAsOf,
      stanceJson: JSON.stringify(stance),
    },
    update: {
      engineVersion: STANCE_ENGINE_VERSION,
      signalsVersion: SIGNALS_VERSION,
      dataAsOf,
      stanceJson: JSON.stringify(stance),
      computedAt: new Date(),
    },
  })
  return { stance, dataAsOf, persisted: false }
}

/**
 * Cron worker: recompute the oldest stances (or companies missing one).
 * Chunked so a serverless invocation stays inside its time budget.
 */
export async function refreshOldestStances(limit = 40): Promise<{ recomputed: number; skipped: number }> {
  const companies = await db.company.findMany({
    where: { isActive: true },
    select: { id: true, ticker: true },
    orderBy: { ticker: "asc" },
  })
  const snapshots = await db.stanceSnapshot.findMany({
    select: { companyId: true, computedAt: true },
  })
  const computedAtByCompany = new Map(snapshots.map((s) => [s.companyId, s.computedAt.getTime()]))

  // Missing snapshots first (oldest computedAt = 0), then stalest first.
  const ordered = companies
    .map((c) => ({ ...c, at: computedAtByCompany.get(c.id) ?? 0 }))
    .sort((a, b) => a.at - b.at)
    .slice(0, limit)

  let recomputed = 0
  let skipped = 0
  for (const c of ordered) {
    try {
      const bundle = await buildTechnicalBundleWithContext(c.id)
      if (!bundle.snapshot || bundle.snapshot.sessions === 0) {
        skipped++
        continue
      }
      const stance = computeStanceFromSnapshot(bundle.snapshot)
      const dataAsOf = bundle.snapshot.asOf ? new Date(bundle.snapshot.asOf) : new Date(0)
      await db.stanceSnapshot.upsert({
        where: { companyId: c.id },
        create: {
          companyId: c.id,
          engineVersion: STANCE_ENGINE_VERSION,
          signalsVersion: SIGNALS_VERSION,
          dataAsOf,
          stanceJson: JSON.stringify(stance),
        },
        update: {
          engineVersion: STANCE_ENGINE_VERSION,
          signalsVersion: SIGNALS_VERSION,
          dataAsOf,
          stanceJson: JSON.stringify(stance),
          computedAt: new Date(),
        },
      })
      recomputed++
    } catch {
      skipped++
    }
  }
  return { recomputed, skipped }
}
