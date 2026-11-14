import { NextRequest } from "next/server"
import { getCachedMarketSignals, type MarketSignalsOutput, type MarketSignalsResponse } from "@/lib/technical/signals-service"
import { readBoardSnapshot } from "@/lib/technical/board-snapshot"
import { distributionOf, filterMarketRows, gateRowForFree, hasActiveFilters, parseBoardFilterParams } from "@/lib/technical/board-filters"
import { cached } from "@/lib/server-cache"
import { getSessionUser } from "@/lib/auth"
import { getActivePlanId } from "@/lib/subscription"
import { isPaidPlanId, isFreeSignalTicker, FREE_SIGNAL_TICKERS } from "@/lib/plans/entitlements"

// GET /api/v1/technical/signals — market-wide deterministic technical stances.
//
// Every row is a RULE-BASED READING of real traded prices (trend/momentum/
// volume/risk confluence, documented weights in src/lib/technical/signals.ts).
// Rows whose company has a persisted canonical stance display THAT reading —
// identical to the company technical tab (single source of truth).
//
// ENTITLEMENT ENFORCEMENT (backend): the heavy whole-market computation is
// cached tier-independent; every per-request slice happens AFTER the cache
// read. Paid plans (Pro / Pro Plus) receive the full filtered universe.
// Free/anonymous callers receive:
//   • FULL signal values for the fixed free set (the free entitlement);
//   • matched-company IDENTITY for every other match (ticker, name, sector,
//     tier, last price) flagged locked:true — the filter genuinely ran on the
//     full universe, so counts and results are real;
//   • NO paid analysis field (signal, score, dimensions, reasons, styleFits,
//     metrics, trade plan) — those keys are removed server-side before
//     serialization and never reach the browser or any client state.
//
// FILTERS are executed server-side here (same semantics as the UI, one engine
// in board-filters.ts) so locked rows can be filtered without leaking the
// values they were filtered on. Aggregate counts travel, per-company values
// for locked rows do not.
//
// COLD-START honesty: a freshly-scaled instance serves the persisted board
// snapshot (age-bounded: 15 min during Cairo market hours / 24h off-hours)
// while the full computation refreshes in the background — no multi-second
// block, no stale-served-as-fresh (computedAt/asOf travel with the payload).

export const maxDuration = 60

/** Max locked identity rows returned to a free caller (the rest stay counted). */
const FREE_LOCKED_ROW_LIMIT = 24

export async function GET(req: NextRequest) {
  const t0 = Date.now()
  // Resolve the tier FIRST (cheap: cached plan lookup, one session query).
  const token = req.headers.get("x-session-token")
  const bearer = req.headers.get("authorization")
  const rawToken = token ?? (bearer ? (bearer.startsWith("Bearer ") ? bearer.slice(7) : bearer) : null)
  const userId = await getSessionUser(rawToken)
  const t1 = Date.now()
  const plan = userId ? await getActivePlanId(userId) : "FREE"
  const paid = isPaidPlanId(plan)

  // The whole-market computation is cached tier-independent (10 min SWR).
  // On a cold instance, prefer the persisted snapshot over blocking the
  // caller for the full compute; the compute runs in the background and
  // repopulates the in-memory cache.
  let full: MarketSignalsOutput
  let servedFrom: "memory" | "snapshot" | "compute"
  try {
    full = (await cached("technical-signals:served:v1", 10 * 60_000, () =>
      getCachedMarketSignals(),
    )) as MarketSignalsOutput
    servedFrom = "memory"
  } catch {
    const snap = await readBoardSnapshot()
    if (!snap) throw new Error("board compute failed and no snapshot is available")
    full = snap
    servedFrom = "snapshot"
    // Warm the in-memory cache for subsequent requests (single-flight inside).
    void getCachedMarketSignals().catch(() => {})
  }
  const t2 = Date.now()

  const sp = new URL(req.url).searchParams
  const filters = parseBoardFilterParams(sp)
  const filtered = hasActiveFilters(filters) ? filterMarketRows(full.rows, filters) : full.rows
  const matched = distributionOf(filtered)
  // Aggregate per-tier and per-style counts over the FILTERED set — the chips
  // need true counts, and locked rows cannot expose their own values.
  const tiers: Record<string, number> = {}
  const styles: Record<string, number> = {}
  for (const r of filtered) {
    const tier = r.marketTier ?? "MAIN"
    tiers[tier] = (tiers[tier] ?? 0) + 1
    for (const f of r.styleFits) styles[f.tag] = (styles[f.tag] ?? 0) + 1
  }
  const t3 = Date.now()

  const serverTiming = `auth;dur=${t1 - t0},payload;dur=${t2 - t1},filter;dur=${t3 - t2},total;dur=${Date.now() - t0},source=${servedFrom}`
  const headers = {
    "cache-control": "private, max-age=60, stale-while-revalidate=300",
    "server-timing": serverTiming,
  }

  if (paid) {
    const payload: MarketSignalsResponse = {
      ...full,
      rows: filtered,
      matched,
      tiers,
      styles,
      plan,
      upgradeHint: null,
    }
    return Response.json(payload, { headers })
  }

  // FREE/anonymous: the fixed free set keeps its FULL signal rows (the free
  // entitlement); every other matched company ships as a locked identity row.
  // Server sort order is preserved — locked rows are interleaved in position
  // and capped, unlocked free rows are always kept.
  const rows: MarketSignalsResponse["rows"] = []
  let lockedIncluded = 0
  for (const r of filtered) {
    if (isFreeSignalTicker(r.ticker)) {
      rows.push(r)
    } else if (lockedIncluded < FREE_LOCKED_ROW_LIMIT) {
      lockedIncluded++
      rows.push(gateRowForFree(r))
    }
  }
  const lockedRemaining = Math.max(0, matched.total - rows.length)
  const missing = FREE_SIGNAL_TICKERS.filter((t) =>
    rows.some((r) => "locked" in r ? false : r.ticker.toUpperCase() === t.toUpperCase()),
  )

  const payload: MarketSignalsResponse = {
    ...full,
    rows,
    matched,
    tiers,
    styles,
    lockedRemaining,
    universe: full.universe,
    scored: full.scored,
    weakData: full.weakData,
    hiddenCompanies: lockedRemaining,
    plan,
    upgradeHint: {
      message: "النتائج الحقيقية ظاهرة — تفاصيل الإشارات ومستويات التداول تحتاج باقة Pro.",
      freeSetSize: FREE_SIGNAL_TICKERS.length,
    },
    missingFreeTickers: missing,
  }
  return Response.json(payload, { headers })
}
