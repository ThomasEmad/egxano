// =============================================================================
// Market intelligence service — DB plumbing around the pure compute module.
//
// rebuildIntelligence(): snapshot JSON + PriceBar volume baselines + stored
//   daily history + enrichment block → MarketIntelligence → persisted to
//   Setting (live cache) and MarketIntelligenceDay (durable history, one row
//   per session, updated in place during the same day).
// getIntelligence(): validated read of the stored snapshot (null when absent).
// runEnrichmentChunk()/enrichmentCursor management for the daily job that
//   computes true 52-week / SMA200 breadth from runtime Yahoo bars
//   (in-memory only — the storage policy for price bars is respected).
// =============================================================================

import { db } from "@/lib/db"
import {
  computeIntelligence,
  marketIntelligenceSchema,
  MI_SETTING_KEY,
  ENRICHMENT_SETTING_KEY,
  type IntelInput,
  type MarketIntelligence,
  type MoverInput,
  type VolumeBaseline,
  type EnrichmentBlock,
  type HistoryDay,
} from "./compute"

const BASELINE_LOOKBACK_DAYS = 100 // covers a 60-session baseline comfortably
const HISTORY_ROWS = 60
const ENRICH_PARTIAL_KEY = "market_enrichment_partial_v1"
const ENRICH_CURSOR_KEY = "market_enrichment_cursor_v1"

/** Parse the stored market snapshot JSON safely (untrusted content). */
function readSnapshotMovers(snapshotValue: string): { asOf: string; delayMinutes: number; movers: { ticker: string; price: number; changePct: number; volume?: number; cap?: number }[] } | null {
  try {
    const raw = JSON.parse(snapshotValue) as Record<string, unknown>
    const asOf = typeof raw.asOf === "string" ? raw.asOf : null
    const moversRaw = Array.isArray(raw.movers) ? raw.movers : null
    if (!asOf || !moversRaw) return null
    const movers: { ticker: string; price: number; changePct: number; volume?: number; cap?: number }[] = []
    for (const m of moversRaw) {
      if (typeof m !== "object" || m === null) continue
      const r = m as Record<string, unknown>
      const ticker = typeof r.ticker === "string" ? r.ticker.toUpperCase() : null
      const price = typeof r.price === "number" && r.price > 0 ? r.price : null
      const changePct = typeof r.changePct === "number" && Math.abs(r.changePct) <= 50 ? r.changePct : null
      if (!ticker || price === null || changePct === null) continue
      const volume = typeof r.volume === "number" && r.volume > 0 ? r.volume : undefined
      const cap = typeof r.cap === "number" && r.cap > 0 ? r.cap : undefined
      movers.push({ ticker, price, changePct, ...(volume ? { volume } : {}), ...(cap ? { cap } : {}) })
    }
    const delayMinutes = typeof raw.delayMinutes === "number" ? raw.delayMinutes : 15
    return { asOf, delayMinutes, movers }
  } catch {
    return null
  }
}

function utcDayOf(iso: string): string {
  const d = new Date(iso)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10)
}

/** Build ticker → 20/60-session volume baselines from PriceBar (excludes the latest stored session). */
async function loadBaselines(): Promise<Record<string, VolumeBaseline>> {
  const cutoff = new Date(Date.now() - BASELINE_LOOKBACK_DAYS * 86_400_000)
  const bars = await db.priceBar.findMany({
    where: { volume: { not: null }, ts: { gte: cutoff } },
    orderBy: { ts: "asc" },
    select: { companyId: true, volume: true },
  })
  const byCompany = new Map<string, number[]>()
  for (const b of bars) {
    const arr = byCompany.get(b.companyId) ?? []
    arr.push(b.volume as number)
    byCompany.set(b.companyId, arr)
  }
  const out: Record<string, VolumeBaseline> = {}
  for (const [companyId, vols] of byCompany) {
    const prior20 = vols.slice(0, -1).slice(-20)
    const prior60 = vols.slice(0, -1).slice(-60)
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
    out[companyId] = { avg20: avg(prior20), avg60: avg(prior60), sessions: vols.length }
  }
  return out
}

async function loadHistory(): Promise<HistoryDay[]> {
  const rows = await db.marketIntelligenceDay.findMany({
    orderBy: { day: "asc" },
    take: HISTORY_ROWS,
    select: { day: true, snapshotJson: true, advancing: true, declining: true, unchanged: true, regime: true, pulse: true },
  })
  const out: HistoryDay[] = []
  for (const r of rows) {
    let tradedValueEgp: number | null = null
    let turnoverShares: Record<string, number> | null = null
    try {
      const parsed = JSON.parse(r.snapshotJson) as { breadth?: { tradedValueEgp?: number | null }; rotation?: { sectors?: { sector: string; turnoverSharePct: number | null }[] } }
      tradedValueEgp = parsed.breadth?.tradedValueEgp ?? null
      if (parsed.rotation?.sectors?.length) {
        turnoverShares = {}
        for (const s of parsed.rotation.sectors) if (s.turnoverSharePct !== null) turnoverShares[s.sector] = s.turnoverSharePct
      }
    } catch {
      // history row without parsable snapshot — counters still valid
    }
    out.push({
      day: r.day.toISOString().slice(0, 10),
      advancing: r.advancing,
      declining: r.declining,
      unchanged: r.unchanged,
      regime: r.regime,
      pulse: r.pulse,
      tradedValueEgp,
      turnoverShares,
    })
  }
  return out
}

async function loadEnrichment(): Promise<EnrichmentBlock | null> {
  const row = await db.setting.findUnique({ where: { key: ENRICHMENT_SETTING_KEY }, select: { value: true } })
  if (!row) return null
  try {
    const raw = JSON.parse(row.value) as EnrichmentBlock
    if (typeof raw.asOf !== "string") return null
    return raw
  } catch {
    return null
  }
}

/**
 * Rebuild the whole-market intelligence snapshot from the freshest stored
 * market snapshot. Safe to call concurrently — the last writer wins with an
 * atomic upsert. Returns the built snapshot (or null when there is no fresh
 * market snapshot to compute from).
 */
export async function rebuildIntelligence(): Promise<MarketIntelligence | null> {
  const snapRow = await db.setting.findUnique({ where: { key: "market_ticker_snapshot_v1" }, select: { value: true } })
  const snap = snapRow ? readSnapshotMovers(snapRow.value) : null
  if (!snap || snap.movers.length === 0) return null

  // Company metadata for the movers.
  const tickers = [...new Set(snap.movers.map((m) => m.ticker))]
  const companies = await db.company.findMany({
    where: { ticker: { in: tickers }, isActive: true },
    select: { id: true, ticker: true, nameEn: true, nameAr: true, sector: true, sharesOutstanding: true },
  })
  const meta = new Map(companies.map((c) => [c.ticker.toUpperCase(), c]))

  const [baselinesByCompany, history, enrichment] = await Promise.all([loadBaselines(), loadHistory(), loadEnrichment()])

  // companyId-keyed baselines → ticker-keyed.
  const idToTicker = new Map(companies.map((c) => [c.id, c.ticker.toUpperCase()]))
  const baselines: Record<string, VolumeBaseline> = {}
  for (const [companyId, b] of Object.entries(baselinesByCompany)) {
    const t = idToTicker.get(companyId)
    if (t) baselines[t] = b
  }

  const movers: MoverInput[] = []
  for (const m of snap.movers) {
    const c = meta.get(m.ticker)
    if (!c) continue // scanner row without a tracked company — excluded, not fabricated
    const cap = m.cap ?? (c.sharesOutstanding && c.sharesOutstanding > 0 ? m.price * c.sharesOutstanding : null)
    movers.push({
      ticker: m.ticker,
      name: c.nameEn,
      nameAr: c.nameAr,
      sector: c.sector,
      price: m.price,
      changePct: m.changePct,
      volume: m.volume ?? null,
      cap: cap ?? null,
    })
  }

  const input: IntelInput = {
    now: snap.asOf,
    day: utcDayOf(snap.asOf),
    delayMinutes: snap.delayMinutes,
    movers,
    baselines,
    history,
    enrichment,
  }
  const intel = computeIntelligence(input)

  const json = JSON.stringify(intel)
  const dayDate = new Date(input.day + "T00:00:00Z")
  await db.$transaction([
    db.setting.upsert({
      where: { key: MI_SETTING_KEY },
      update: { value: json, type: "json" },
      create: { key: MI_SETTING_KEY, value: json, type: "json", description: "Whole-market intelligence snapshot (breadth/regime/pulse/rotation) — rebuilt on every market refresh" },
    }),
    // One row per session: same-day rebuilds replace the row's content.
    db.marketIntelligenceDay.upsert({
      where: { day: dayDate },
      update: {
        snapshotJson: json,
        advancing: intel.breadth.advancing,
        declining: intel.breadth.declining,
        unchanged: intel.breadth.unchanged,
        regime: intel.regime.code,
        pulse: intel.pulse.score,
      },
      create: {
        day: dayDate,
        snapshotJson: json,
        advancing: intel.breadth.advancing,
        declining: intel.breadth.declining,
        unchanged: intel.breadth.unchanged,
        regime: intel.regime.code,
        pulse: intel.pulse.score,
        sourceName: "EGXANO_INTELLIGENCE",
      },
    }),
  ])
  return intel
}

/** Validated read of the stored intelligence snapshot (null when absent). */
export async function getIntelligence(): Promise<MarketIntelligence | null> {
  const row = await db.setting.findUnique({ where: { key: MI_SETTING_KEY }, select: { value: true } })
  if (!row) return null
  const parsed = marketIntelligenceSchema.safeParse(JSON.parse(row.value))
  return parsed.success ? (parsed.data as MarketIntelligence) : null
}

// ---------------------------------------------------------------- enrichment

export interface EnrichmentCursor {
  companyIds: string[]
  index: number
  startedAt: string
}

/** Aggregate counts over the partial per-company enrichment results. */
function finalizeEnrichment(partial: Record<string, { above20: boolean | null; above50: boolean | null; above200: boolean | null; newHigh: boolean | null; newLow: boolean | null }>, universe: number): EnrichmentBlock {
  let a20 = 0
  let n20 = 0
  let a50 = 0
  let n50 = 0
  let a200 = 0
  let n200 = 0
  let nh = 0
  let nl = 0
  for (const v of Object.values(partial)) {
    if (v.above20 !== null) {
      n20++
      if (v.above20) a20++
    }
    if (v.above50 !== null) {
      n50++
      if (v.above50) a50++
    }
    if (v.above200 !== null) {
      n200++
      if (v.above200) a200++
    }
    if (v.newHigh) nh++
    if (v.newLow) nl++
  }
  return {
    asOf: new Date().toISOString(),
    pctAboveSma20: n20 ? Math.round((a20 / n20) * 1000) / 10 : null,
    pctAboveSma50: n50 ? Math.round((a50 / n50) * 1000) / 10 : null,
    pctAboveSma200: n200 ? Math.round((a200 / n200) * 1000) / 10 : null,
    new52wHighs: nh,
    new52wLows: nl,
    universe,
  }
}

/**
 * Process up to `limit` companies for the daily enrichment. Returns whether
 * more work remains (the route self-chains via after() until done).
 */
export async function runEnrichmentChunk(limit = 40): Promise<{ done: boolean; processed: number; remaining: number }> {
  const cursorRow = await db.setting.findUnique({ where: { key: ENRICH_CURSOR_KEY }, select: { value: true } })
  let cursor: EnrichmentCursor | null = null
  if (cursorRow) {
    try {
      cursor = JSON.parse(cursorRow.value) as EnrichmentCursor
    } catch {
      cursor = null
    }
  }
  const stale = cursor && Date.now() - new Date(cursor.startedAt).getTime() > 6 * 3600_000
  if (!cursor || stale) {
    const ids = await db.company.findMany({ where: { isActive: true }, select: { id: true }, orderBy: { ticker: "asc" } })
    cursor = { companyIds: ids.map((c) => c.id), index: 0, startedAt: new Date().toISOString() }
    await db.setting.upsert({
      where: { key: ENRICH_PARTIAL_KEY },
      update: { value: "{}", type: "json" },
      create: { key: ENRICH_PARTIAL_KEY, value: "{}", type: "json", description: "Partial per-company enrichment results for the running daily job" },
    })
  }

  const partialRow = await db.setting.findUnique({ where: { key: ENRICH_PARTIAL_KEY }, select: { value: true } })
  let partial: Record<string, { above20: boolean | null; above50: boolean | null; above200: boolean | null; newHigh: boolean | null; newLow: boolean | null }> = {}
  if (partialRow) {
    try {
      partial = JSON.parse(partialRow.value) as typeof partial
    } catch {
      partial = {}
    }
  }

  const { fetchRecentBarsForCompany } = await import("@/lib/technical/live-bars")
  const batch = cursor.companyIds.slice(cursor.index, cursor.index + limit)
  let processed = 0
  for (const companyId of batch) {
    cursor.index++
    try {
      const bars = await fetchRecentBarsForCompany(companyId)
      if (!bars || bars.length < 21) {
        partial[companyId] = { above20: null, above50: null, above200: null, newHigh: null, newLow: null }
        continue
      }
      const closes = bars.map((b) => b.close)
      const last = closes[closes.length - 1]
      const sma = (n: number) => {
        if (closes.length < n) return null
        const w = closes.slice(-n)
        return w.reduce((a, b) => a + b, 0) / n
      }
      const s20 = sma(20)
      const s50 = sma(50)
      const s200 = sma(200)
      const window = bars.slice(-253, -1) // the 252 sessions BEFORE today
      const maxHigh = window.length ? Math.max(...window.map((b) => b.high)) : null
      const minLow = window.length ? Math.min(...window.map((b) => b.low)) : null
      partial[companyId] = {
        above20: s20 === null ? null : last > s20,
        above50: s50 === null ? null : last > s50,
        above200: s200 === null ? null : last > s200,
        newHigh: maxHigh === null ? null : last >= maxHigh * 0.999,
        newLow: minLow === null ? null : last <= minLow * 1.001,
      }
      processed++
    } catch {
      partial[companyId] = { above20: null, above50: null, above200: null, newHigh: null, newLow: null }
    }
  }

  await db.setting.upsert({
    where: { key: ENRICH_PARTIAL_KEY },
    update: { value: JSON.stringify(partial), type: "json" },
    create: { key: ENRICH_PARTIAL_KEY, value: JSON.stringify(partial), type: "json", description: "Partial per-company enrichment results" },
  })
  const remaining = Math.max(0, cursor.companyIds.length - cursor.index)
  await db.setting.upsert({
    where: { key: ENRICH_CURSOR_KEY },
    update: { value: JSON.stringify(cursor), type: "json" },
    create: { key: ENRICH_CURSOR_KEY, value: JSON.stringify(cursor), type: "json", description: "Cursor for the chunked daily enrichment job" },
  })

  if (remaining === 0) {
    const universe = cursor.companyIds.length
    const block = finalizeEnrichment(partial, universe)
    await db.setting.upsert({
      where: { key: ENRICHMENT_SETTING_KEY },
      update: { value: JSON.stringify(block), type: "json" },
      create: { key: ENRICHMENT_SETTING_KEY, value: JSON.stringify(block), type: "json", description: "Daily enrichment: true 52w / SMA breadth computed from runtime Yahoo bars (not stored)" },
    })
    // Clean up the working keys (best-effort — they may not exist).
    try {
      await db.setting.delete({ where: { key: ENRICH_CURSOR_KEY } })
    } catch {
      /* already absent */
    }
    try {
      await db.setting.delete({ where: { key: ENRICH_PARTIAL_KEY } })
    } catch {
      /* already absent */
    }
    // Refresh the intelligence snapshot with the new enrichment block.
    await rebuildIntelligence().catch(() => undefined)
    return { done: true, processed, remaining: 0 }
  }
  return { done: false, processed, remaining }
}
