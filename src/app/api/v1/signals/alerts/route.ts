import { NextRequest } from "next/server"
import { getSessionUser, USER_SESSION_COOKIE } from "@/lib/auth"
import { getActivePlanId } from "@/lib/subscription"
import { PLANS, isPaidPlanId, isFreeSignalTicker, type PlanId } from "@/lib/plans/entitlements"
import { readLifecycleAlertFeed } from "@/lib/notifications/lifecycle-alerts-store"
import {
  orderAlertsNewestFirst,
  ALERT_FEED_CAP,
  type LifecycleAlert,
} from "@/lib/notifications/lifecycle-alerts"

// GET /api/v1/signals/alerts — recent plan-lifecycle TRANSITION alerts.
//
// The daily sweep (scripts/daily-lifecycle-sweep.mjs, scheduled after the
// 13:30 UTC candles refresh + stance recompute) computes each actionable
// company's lifecycle, diffs it against the previous persisted snapshot and
// persists the transition alerts into the Setting KV store
// (src/lib/notifications/lifecycle-alerts-store.ts). This route serves that
// persisted feed — it NEVER recomputes lifecycles on read (deterministic,
// stateless read path; the feed is exactly as fresh as the last sweep).
//
// AUTH: exactly like the signals board route — x-session-token /
// Authorization header first, then the HttpOnly USER_SESSION_COOKIE fallback
// (same live-bug rationale: same-origin fetches ship the cookie, so the
// caller's real tier resolves without touching the shared client layer).
// Plan resolution via getActivePlanId (src/lib/subscription.ts).
//
// ENTITLEMENT:
//   • paid plans (Pro / legacy-PRO_PLUS / Pro Quarterly) receive the whole
//     tracked market's alerts;
//   • free/anonymous callers receive alerts ONLY for the fixed free set
//     (the same server-side intersection the board applies —
//     isFreeSignalTicker), so no locked ticker's transition ever leaves the
//     server;
//   • the max items returned per tier is PlanLimits.alerts
//     (FREE 5 / PRO 30 / PRO_3M 30 — src/lib/plans/entitlements.ts, the same
//     single source of truth every other gate derives from), bounded by the
//     persisted feed's own cap.
//
// cache-control: private — the payload is tier-dependent and must never sit
// in a shared cache.
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
  const plan: PlanId = userId ? await getActivePlanId(userId) : "FREE"
  const paid = isPaidPlanId(plan)

  // Per-tier cap: PlanLimits.alerts (number | "UNLIMITED") bounded by the
  // feed's own hard cap.
  const planLimit = PLANS[plan].limits.alerts
  const limit = planLimit === "UNLIMITED" ? ALERT_FEED_CAP : Math.min(planLimit, ALERT_FEED_CAP)

  const feed = await readLifecycleAlertFeed()
  const t2 = Date.now()

  const ordered = orderAlertsNewestFirst(feed)
  // FREE/anonymous: the server-side free-set intersection — only
  // transitions of the pinned free-entitlement companies leave the server.
  const matched = paid ? ordered : ordered.filter((a) => isFreeSignalTicker(a.ticker))
  const alerts = matched.slice(0, limit)
  const truncated = matched.length > alerts.length

  const headers = {
    "cache-control": "private, max-age=60, stale-while-revalidate=300",
    "server-timing": `auth;dur=${t1 - t0},feed;dur=${t2 - t1},total;dur=${Date.now() - t0}`,
  }

  return Response.json(
    {
      plan,
      limit,
      count: alerts.length,
      alerts,
      // Honest hint when the tier cap truncated the caller's matched feed.
      upgradeHint: !paid && truncated
        ? { message: "التنبيهات الأحدث ظاهرة — السعة الكاملة لباقتك الحالية. ترقية Pro ترفع الحد إلى 30." }
        : null,
    },
    { headers },
  )
}
