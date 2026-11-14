import { NextRequest } from "next/server"
import { secureBearerMatch } from "@/lib/secure-compare"

// GET /api/v1/cron/alerts-push — the daily guaranteed floor of the alert
// delivery pipeline (Vercel Hobby allows daily crons only): 14:00 UTC, after
// EGX close + delayed data has landed.
//
// Two jobs, in this order:
//   1. DRAIN the NotificationOutbox (RECOVERY — runs first): dispatch every
//      due Web Push job previous instances left behind — PENDING retries from
//      the backoff ladder AND SENDING rows whose lease expired (serverless
//      kills mid-send). This is the only dispatch opportunity with zero
//      traffic.
//   2. Run the daily safety-net EVALUATION (existing behavior): re-evaluate
//      every active alert against the latest stored prices and push anything
//      newly triggered — now transactionally published to the outbox and
//      inline-dispatched (see src/lib/alerts/evaluate.ts).
//
// HONEST LATENCY (encoded in src/lib/alerts/outbox-logic.ts): with normal
// daytime traffic, delivery/retries land within minutes (refresh sweeps
// ≈ every 8 min in session; /alerts polls every ~60 s). With ZERO traffic,
// THIS cron is the only dispatch opportunity → up to ~24 h between attempts;
// a persistently failing job goes DEAD after maxAttempts (≈6 attempts ≈ up
// to a week from trigger to dead-letter).
//
// WEEKEND GUARD (audit F-04): on Fri/Sat (Cairo) the scanner restates
// Thursday's close with a fresh fetch-time stamp — evaluating it would fire
// alerts on phantom "new" data. The outbox DRAIN above is deliberately NOT
// weekend-gated (delivering an already-triggered alert is correct any day);
// only the evaluation is gated (see alertEvaluationGate in logic.ts).
//
// Auth: `Authorization: Bearer $CRON_SECRET` (timing-safe), same contract as
// cron/audit and cron/market:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://host/api/v1/cron/alerts-push
//
// Dedupe lives in src/lib/alerts/evaluate.ts (atomic active→false claim
// inside the same transaction that publishes the outbox event), so this
// route can never double-notify an alert the snapshot hook already fired.

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
    const { drainOutbox, OUTBOX_DRAIN_PRESETS } = await import("@/lib/alerts/outbox-dispatch")
    const { alertEvaluationGate, evaluateAndNotifyAllAlerts } = await import("@/lib/alerts/evaluate")
    const { getFreshMarketSnapshot } = await import("@/lib/market/snapshot")

    // 1. RECOVERY: drain due outbox jobs first (retries + lease-expired
    //    SENDING rows), so delivery never waits behind the evaluation.
    //    drainOutbox never throws; the cron drain budget keeps us far inside
    //    maxDuration=60 even on a deep backlog.
    const outbox = await drainOutbox({ ...OUTBOX_DRAIN_PRESETS.cron })

    // Latest stored prices (DB Setting, inline-refresh when very stale);
    // an in-session opportunistic kick may chain a full refresh — the next
    // firing then evaluates against those even-fresher prices.
    const snapshot = await getFreshMarketSnapshot()

    // 2. Weekend-gated safety-net evaluation (F-04 — see header comment).
    const gate = alertEvaluationGate({
      now: new Date(),
      dataAsOf: snapshot?.pricesAsOf ?? snapshot?.asOf ?? null,
      // no prevDataAsOf: cron path — the gate skips only the phantom
      // re-stamp (stored session === the session today restates).
    })
    const summary = gate.evaluate
      ? await evaluateAndNotifyAllAlerts(snapshot)
      : { checked: 0, triggered: 0, sent: 0, staleSkipped: 0 }

    return Response.json({
      ok: true,
      pricesAsOf: snapshot?.pricesAsOf ?? null,
      ...summary,
      evaluationGate: gate.reason,
      // Outbox drain results (recovery): jobs dispatched / confirmed sent /
      // dead-lettered this run. `retried` rows wait for the next opportunity
      // per the backoff ladder (honest latency: see header comment).
      outbox: { drained: outbox.drained, sent: outbox.sent, dead: outbox.dead, retried: outbox.retried },
    })
  } catch (e) {
    return Response.json(
      { ok: false, error: "ALERTS_PUSH_FAILED", message: e instanceof Error ? e.message.slice(0, 200) : String(e) },
      { status: 500 }
    )
  } finally {
    evalBusy = false
  }
}
