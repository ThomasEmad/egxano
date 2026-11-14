import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { getSessionUser, USER_SESSION_COOKIE } from "@/lib/auth"
import { getActivePlanId } from "@/lib/subscription"
import { isPaidPlanId } from "@/lib/plans/entitlements"
import { getCompanyLifecycle } from "@/lib/technical/lifecycle-service"
import type { LifecycleState } from "@/lib/technical/lifecycle"
import type { SignalState } from "@/lib/technical/signals"

// GET /api/v1/signals/lifecycle?companyId=... (or ticker=...)
//
// The plan-lifecycle read for ONE company: how its published stance reacted
// to the daily bars after its creation — watching setups activate /
// invalidate / expire, confirmed plans enter / stop / hit target / time out
// (src/lib/technical/lifecycle.ts — derived on demand, nothing persisted).
//
// AUTH: exactly like the signals board route — x-session-token /
// Authorization header first, then the HttpOnly USER_SESSION_COOKIE fallback
// (same live-bug rationale: same-origin fetches ship the cookie, so the
// caller's real tier resolves without touching the shared client layer).
// Plan resolution via getActivePlanId (src/lib/subscription.ts).
//
// ENTITLEMENT: lifecycle details (activation/entry/exit dates, fill prices,
// the recomputed plan, the event list) are PAID content. Free/anonymous
// callers receive ONLY { signalState, lifecycleState } — no levels, no
// events, no dates — everything else is stripped server-side and never
// reaches the browser. Paid plans get the full view.
export async function GET(req: NextRequest) {
  const t0 = Date.now()
  const headerToken = req.headers.get("x-session-token") ?? req.headers.get("authorization")
  const rawToken = headerToken
    ? headerToken.startsWith("Bearer ")
      ? headerToken.slice(7)
      : headerToken
    : (req.cookies.get(USER_SESSION_COOKIE)?.value ?? null)
  const userId = await getSessionUser(rawToken)
  const t1 = Date.now()
  const plan = userId ? await getActivePlanId(userId) : "FREE"
  const paid = isPaidPlanId(plan)

  const sp = new URL(req.url).searchParams
  const companyIdParam = sp.get("companyId")?.trim() ?? ""
  const tickerParam = sp.get("ticker")?.trim() ?? ""
  if (!companyIdParam && !tickerParam) {
    return Response.json({ error: "companyId or ticker is required" }, { status: 400 })
  }

  // Identity resolution (cheap, indexed): by id, or case-insensitively by ticker.
  const company = companyIdParam
    ? await db.company.findUnique({ where: { id: companyIdParam }, select: { id: true, ticker: true } })
    : await db.company.findFirst({
        where: { ticker: { equals: tickerParam, mode: "insensitive" } },
        select: { id: true, ticker: true },
      })
  const t2 = Date.now()
  if (!company) {
    return Response.json({ error: "company not found" }, { status: 404 })
  }

  const result = await getCompanyLifecycle(company.id, { ticker: company.ticker })
  const t3 = Date.now()

  const signalState: SignalState | null = result?.signalState ?? null
  const lifecycleState: LifecycleState | null = result?.lifecycle.state ?? null

  const headers = {
    "cache-control": "private, max-age=60, stale-while-revalidate=300",
    "server-timing": `auth;dur=${t1 - t0},resolve;dur=${t2 - t1},lifecycle;dur=${t3 - t2},total;dur=${Date.now() - t0}`,
  }

  if (!paid) {
    // FREE/anonymous: { signalState, lifecycleState } ONLY — the view (levels,
    // dates, fills, events, plan) never leaves the server.
    return Response.json(
      {
        companyId: company.id,
        ticker: company.ticker,
        signalState,
        lifecycleState,
        lifecycle: null,
        plan,
      },
      { headers },
    )
  }

  return Response.json(
    {
      companyId: company.id,
      ticker: company.ticker,
      signalState,
      lifecycleState,
      lifecycle: result?.lifecycle ?? null,
      plan,
    },
    { headers },
  )
}
