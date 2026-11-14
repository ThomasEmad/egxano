import { NextRequest } from "next/server"
import { secureBearerMatch } from "@/lib/secure-compare"

// GET /api/v1/cron/alerts-push — safety-net re-run of price-alert evaluation.
//
// The PRIMARY trigger is the snapshot write itself (src/lib/market/refresh.ts
// evaluates on every refresh), so alerts fire with the site closed as soon as
// new prices land. This cron covers the residual cases where no refresh
// happens (e.g. prices recorded by another import path, or an evaluation
// window missed by a cold instance) — it re-evaluates every active alert
// against the latest stored prices and pushes anything newly triggered.
//
// Auth: `Authorization: Bearer $CRON_SECRET` (timing-safe), same contract as
// cron/audit and cron/market:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://host/api/v1/cron/alerts-push
//
// Dedupe lives in src/lib/alerts/evaluate.ts (atomic active→false claim), so
// this route can never double-notify an alert the snapshot hook already fired.

export const maxDuration = 60

// In-process single-flight (same pattern as cron/audit): overlapping firings
// would race on the same alert set for no benefit.
let evalBusy = false

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false // cron disabled unless explicitly configured
  return secureBearerMatch(req.headers.get("authorization"), secret)
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  if (evalBusy) {
    return Response.json(
      { ok: false, error: "EVALUATION_IN_PROGRESS", message: "Another evaluation is already in progress." },
      { status: 503, headers: { "Retry-After": "60" } }
    )
  }
  evalBusy = true
  try {
    const { evaluateAndNotifyAllAlerts } = await import("@/lib/alerts/evaluate")
    const { getFreshMarketSnapshot } = await import("@/lib/market/snapshot")

    // Latest stored prices (DB Setting, inline-refresh when very stale);
    // an in-session opportunistic kick may chain a full refresh — the next
    // firing then evaluates against those even-fresher prices.
    const snapshot = await getFreshMarketSnapshot()
    const summary = await evaluateAndNotifyAllAlerts(snapshot)

    return Response.json({ ok: true, pricesAsOf: snapshot?.pricesAsOf ?? null, ...summary })
  } catch (e) {
    return Response.json(
      { ok: false, error: "ALERTS_PUSH_FAILED", message: e instanceof Error ? e.message.slice(0, 200) : String(e) },
      { status: 500 }
    )
  } finally {
    evalBusy = false
  }
}
