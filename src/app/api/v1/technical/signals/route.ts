// =============================================================================
// GET /api/v1/technical/signals — the market-wide board (tech-signals@7).
//
// SERVES THE REBUILT ENGINE (src/lib/signals/*): four states — buy / near /
// wait / exit — with plans whose math invariants are enforced server-side
// (stop < entry, target1 > close, RR exact). No short-selling plans exist in
// the engine: "exit" closes an existing long.
//
// ENTITLEMENT ENFORCEMENT (backend, unchanged): the whole-market computation
// is cached tier-independent; paid plans (Pro / Pro Plus) receive the full
// filtered universe; free/anonymous callers receive FULL rows for the fixed
// free set and locked identity rows (ticker/name/sector/price only) for the
// rest. Summary counts stay public — they describe the matched universe, and
// no paid analysis field ever leaves the server for a locked row.
//
// FILTERS (v2 vocabulary) run server-side over the full cached compute so a
// locked row can be filtered without leaking the values it was filtered on.
//
// COLD STARTS: a freshly-scaled instance serves the persisted v2 snapshot
// (age-bounded 15 min in session / 24h off-hours) while the compute refreshes.
// =============================================================================

import { NextRequest } from "next/server"
import { getSignalsBoard, gateRowV2ForFree, readBoardSnapshotV2, type BoardOutputV2, type GatedRowV2 } from "@/lib/signals/board-service"
import { cached, peekCacheAgeMs } from "@/lib/server-cache"
import { getSessionUser, USER_SESSION_COOKIE } from "@/lib/auth"
import { getActivePlanId } from "@/lib/subscription"
import { isPaidPlanId, isFreeSignalTicker, FREE_SIGNAL_TICKERS } from "@/lib/plans/entitlements"
import type { SignalState } from "@/lib/signals/types"

export const maxDuration = 60

/** Max locked identity rows returned to a free caller (the rest stay counted). */
const FREE_LOCKED_ROW_LIMIT = 24

// ---- filter vocabulary (v2 board) ----
type SignalFilter = "all" | SignalState
type TierFilter = "all" | "EGX30" | "EGX70" | "MAIN"
type SortKey = "score" | "change" | "ticker" | "rr"

const SIGNAL_FILTERS: SignalFilter[] = ["all", "buy", "near", "wait", "exit"]
const TIER_FILTERS: TierFilter[] = ["all", "EGX30", "EGX70", "MAIN"]
const SORT_KEYS: SortKey[] = ["score", "change", "ticker", "rr"]

function pick<T extends string>(raw: string | null, allowed: T[], fallback: T): T {
  return raw && (allowed as string[]).includes(raw) ? (raw as T) : fallback
}

interface Filters {
  signal: SignalFilter
  tier: TierFilter
  sector: string
  q: string
  sort: SortKey
}

function parseFilters(sp: URLSearchParams): Filters {
  return {
    signal: pick(sp.get("signal"), SIGNAL_FILTERS, "all"),
    tier: pick(sp.get("tier"), TIER_FILTERS, "all"),
    sector: (sp.get("sector") ?? "").trim().slice(0, 80),
    q: (sp.get("q") ?? "").trim().slice(0, 40),
    sort: pick(sp.get("sort"), SORT_KEYS, "score"),
  }
}

function applyFilters(rows: BoardOutputV2["rows"], f: Filters): BoardOutputV2["rows"] {
  const q = f.q.toUpperCase()
  const out = rows.filter((r) => {
    if (f.signal !== "all" && r.state !== f.signal) return false
    if (f.tier !== "all" && (r.marketTier ?? "MAIN") !== f.tier) return false
    if (f.sector && r.sector !== f.sector) return false
    if (q && !r.ticker.toUpperCase().includes(q) && !(r.nameEn ?? "").toUpperCase().includes(q) && !(r.nameAr ?? "").includes(f.q)) return false
    return true
  })
  const rrOf = (r: BoardOutputV2["rows"][number]): number => {
    const plan = "plan" in r ? r.plan : null
    const prov = "setup" in r && r.setup ? r.setup.provisional : null
    const value = plan?.riskReward ?? prov?.riskReward ?? null
    return value ?? -1
  }
  switch (f.sort) {
    case "change":
      out.sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999))
      break
    case "ticker":
      out.sort((a, b) => a.ticker.localeCompare(b.ticker))
      break
    case "rr":
      out.sort((a, b) => rrOf(b) - rrOf(a))
      break
    default:
      // "score" — the engine's publish order already ranks score within state
      break
  }
  return out
}

export async function GET(req: NextRequest) {
  const headerToken = req.headers.get("x-session-token") ?? req.headers.get("authorization")
  const rawToken = headerToken
    ? headerToken.startsWith("Bearer ")
      ? headerToken.slice(7)
      : headerToken
    : (req.cookies.get(USER_SESSION_COOKIE)?.value ?? null)
  const userId = await getSessionUser(rawToken)
  const plan = userId ? await getActivePlanId(userId) : "FREE"
  const paid = isPaidPlanId(plan)

  // Tier-independent compute (10-min cache); a cold instance prefers the fresh
  // persisted snapshot and warms the memory cache in the background.
  let full: BoardOutputV2
  const cacheKey = "technical-signals:board-v2:served:v1"
  const age = peekCacheAgeMs(cacheKey)
  if (age !== null) {
    full = (await cached(cacheKey, 10 * 60_000, () => getSignalsBoard())) as BoardOutputV2
  } else {
    const snap = await readBoardSnapshotV2()
    if (snap) {
      full = snap
      void getSignalsBoard().catch(() => {})
    } else {
      full = await cached(cacheKey, 10 * 60_000, () => getSignalsBoard())
    }
  }

  const sp = new URL(req.url).searchParams
  const filters = parseFilters(sp)
  const filtered = applyFilters(full.rows, filters)
  const sectors = [...new Set(full.rows.map((r) => r.sector))].sort((a, b) => a.localeCompare(b))

  const headers = { "cache-control": "private, max-age=60, stale-while-revalidate=300" }

  if (paid) {
    return Response.json({ ...full, rows: filtered, sectors, plan, upgradeHint: null }, { headers })
  }

  // FREE/anonymous: the fixed free set keeps FULL rows (pinned first); other
  // matches become locked identity rows capped at FREE_LOCKED_ROW_LIMIT.
  const rows: (BoardOutputV2["rows"][number] | GatedRowV2)[] = []
  for (const r of filtered) {
    if (isFreeSignalTicker(r.ticker)) rows.push(r)
  }
  let lockedIncluded = 0
  for (const r of filtered) {
    if (isFreeSignalTicker(r.ticker)) continue
    if (lockedIncluded < FREE_LOCKED_ROW_LIMIT) {
      lockedIncluded++
      rows.push(gateRowV2ForFree(r))
    }
  }
  const lockedRemaining = Math.max(0, filtered.length - rows.length)
  const missing = FREE_SIGNAL_TICKERS.filter((t) => !filtered.some((r) => ("locked" in r ? false : r.ticker.toUpperCase() === t.toUpperCase())))

  return Response.json(
    {
      ...full,
      rows,
      sectors,
      plan,
      lockedRemaining,
      hiddenCompanies: lockedRemaining,
      upgradeHint: {
        message: "الأرقام الحقيقية ظاهرة — تفاصيل الفرص ومستويات التنفيذ تحتاج باقة Pro.",
        freeSetSize: FREE_SIGNAL_TICKERS.length,
      },
      missingFreeTickers: missing,
    },
    { headers },
  )
}
