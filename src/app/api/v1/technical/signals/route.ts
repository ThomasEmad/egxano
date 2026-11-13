import { getCachedMarketSignals } from "@/lib/technical/signals-service"
import { NextRequest } from "next/server"
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
// ENTITLEMENT ENFORCEMENT (backend — 2026-11-14): free/anonymous callers are
// capped to the FIXED free-access set. Filters, sorting and pagination are a
// UI concern; here the response itself is intersected with the set, so no
// filter combination, direct API call or query parameter can ever reveal a
// sixth company — and no locked ticker name ever leaves the server. The heavy
// computation stays cached tier-independent; the slice happens per-request.

export const maxDuration = 60

type SignalsPayload = Awaited<ReturnType<typeof getCachedMarketSignals>>

export async function GET(req: NextRequest) {
  // Resolve the tier FIRST (cheap: cached plan lookup, one session query).
  const token = req.headers.get("x-session-token")
  const bearer = req.headers.get("authorization")
  const rawToken = token ?? (bearer ? (bearer.startsWith("Bearer ") ? bearer.slice(7) : bearer) : null)
  const userId = await getSessionUser(rawToken)
  const plan = userId ? await getActivePlanId(userId) : "FREE"
  const paid = isPaidPlanId(plan)

  // The heavy whole-market computation is cached tier-independent (10 min);
  // the entitlement slice happens per-request AFTER the cache read.
  const full = (await cached("technical-signals:served:v1", 10 * 60_000, () =>
    getCachedMarketSignals(),
  )) as SignalsPayload

  if (paid) {
    return Response.json(
      { ...full, plan, upgradeHint: null },
      { headers: { "cache-control": "private, max-age=60, stale-while-revalidate=300" } },
    )
  }

  // FREE/anonymous: intersect with the FIXED free set BEFORE any filtering.
  const allowedRows = full.rows.filter((r) => isFreeSignalTicker(r.ticker))
  const missing = FREE_SIGNAL_TICKERS.filter(
    (t) => !allowedRows.some((r) => r.ticker.toUpperCase() === t.toUpperCase()),
  )
  return Response.json(
    {
      ...full,
      rows: allowedRows,
      universe: allowedRows.length,
      scored: allowedRows.filter((r) => r.signal !== null).length,
      weakData: allowedRows.filter((r) => r.signal === null).length,
      hiddenCompanies: Math.max(0, (full.rows?.length ?? 0) - allowedRows.length),
      plan,
      upgradeHint: {
        message: "الفلاتر المتقدمة وتغطية كل الشركات متاحة في باقتي Pro وPro Plus.",
        freeSetSize: FREE_SIGNAL_TICKERS.length,
      },
      missingFreeTickers: missing,
    },
    { headers: { "cache-control": "private, max-age=60, stale-while-revalidate=300" } },
  )
}
