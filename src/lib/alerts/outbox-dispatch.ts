// =============================================================================
// Outbox dispatcher — drains due NotificationOutbox rows and delivers Web Push.
// =============================================================================
// The consumer half of the Transactional Outbox (design: docs/notes/
// notification-audit.md §5). The producer half (the transactional claim +
// insert) lives in src/lib/alerts/evaluate.ts.
//
// HONEST LATENCY (same contract as src/lib/alerts/outbox-logic.ts — repeat it
// here because this is the module operators will read):
//   * Inline dispatch fires right after the trigger commit → delivery in
//     seconds in the common case.
//   * Every snapshot-write refresh (src/lib/market/refresh.ts) sweeps due jobs
//     → with normal daytime traffic, retries land within minutes.
//   * GET /api/v1/alerts sweeps the polling user's own jobs (~60 s cadence).
//   * GET /api/v1/cron/alerts-push drains FIRST, then evaluates — the daily
//     14:00 UTC cron is the GUARANTEED floor: with zero traffic, up to ~24 h
//     can pass between attempts (Vercel Hobby plan allows daily crons only),
//     and a persistently failing job goes DEAD after maxAttempts (≈6 attempts
//     ≈ up to a week from trigger to dead-letter).
//
// Race safety: each job is claimed with a CONDITIONAL updateMany that repeats
// the due predicate (the codebase's proven atomic-claim pattern). Two lambdas
// draining concurrently can both SEE a due row, but only one wins the claim
// (count === 1); the loser skips. SENDING rows with an expired lease are
// re-claimable — that is the recovery path for serverless kills mid-dispatch
// (the audit's F-01 crash window, closed on the dispatch side by the lease).
//
// Semantics: at-least-once. A lambda killed after the push service accepted a
// send but before SENT was written will resend on the next drain — the user
// may rarely see one duplicate OS notification. Web push has no ack API; that
// is the correct trade against silently losing notifications.
//
// Observability: single-line structured logs (drain results, job transitions).
// NEVER logged: payloads, subscription endpoints beyond the 48-char prefix the
// legacy path already used, and NEVER any VAPID or p256dh/auth key material.

import { db } from "@/lib/db"
import { ensureNotificationOutboxTable } from "@/lib/db-schema-bootstrap"
import { sendPushToUser } from "@/lib/web-push"
import {
  OUTBOX_DRAIN_PRESETS,
  OUTBOX_LEASE_MS,
  classifyOutboxSend,
  isOutboxJobDue,
  isPushPayload,
  nextAttemptAtAfterFailure,
  truncateForLog,
  type OutboxDecision,
} from "@/lib/alerts/outbox-logic"
import type { OutboxDrainOptions, OutboxDrainResult } from "@/lib/alerts/outbox-logic"
import type { NotificationOutbox } from "@prisma/client"

export { OUTBOX_DRAIN_PRESETS }

// --- structured logging (single-line JSON, no secrets) -------------------------

function logOutbox(evt: string, fields: Record<string, string | number | boolean | null>): void {
  // console.info for happy paths, console.warn for failures — both single-line
  // JSON so Vercel log drains can parse them.
  console[evt.endsWith("failed") ? "warn" : "info"](JSON.stringify({ evt, ...fields }))
}

function jobLogFields(job: NotificationOutbox, extra: Record<string, string | number | boolean | null> = {}): Record<string, string | number | boolean | null> {
  return {
    jobId: job.id,
    alertId: job.alertId,
    userId: job.userId,
    status: job.status,
    attempts: job.attempts,
    ...(job.lastError ? { lastError: truncateForLog(job.lastError, 160) } : {}),
    ...extra,
  }
}

// --- drain ---------------------------------------------------------------------

type DrainPreset = keyof typeof OUTBOX_DRAIN_PRESETS

/**
 * Claim and dispatch due outbox jobs. Never throws — every failure mode is
 * caught and logged so an invocation can never fail its host request.
 *
 * `options.limit`/`timeBudgetMs` bound the work (serverless-safe);
 * `options.userId` scopes the drain to one user (GET /api/v1/alerts);
 * `options.preset` picks the standard budgets by invocation point.
 */
export async function drainOutbox(options: Partial<OutboxDrainOptions> & { preset?: DrainPreset } = {}): Promise<OutboxDrainResult> {
  const preset = options.preset ? OUTBOX_DRAIN_PRESETS[options.preset] : OUTBOX_DRAIN_PRESETS.inline
  const limit = Math.max(1, options.limit ?? preset.limit)
  const timeBudgetMs = Math.max(1_000, options.timeBudgetMs ?? preset.timeBudgetMs)
  const startedAt = Date.now()
  const result: OutboxDrainResult = { drained: 0, sent: 0, dead: 0, retried: 0 }

  try {
    await ensureNotificationOutboxTable()

    const now = new Date()
    const due = await db.notificationOutbox.findMany({
      where: {
        // user-scoped drain (alerts GET) or global sweep (refresh/cron/inline)
        ...(options.userId ? { userId: options.userId } : {}),
        OR: [
          { status: "PENDING", nextAttemptAt: { lte: now } },
          { status: "SENDING", leaseUntil: { lt: now } }, // lease expiry = recovery of abandoned jobs
        ],
      },
      orderBy: { nextAttemptAt: "asc" },
      take: limit,
    })
    if (due.length === 0) return result
    const deadline = startedAt + timeBudgetMs

    for (const candidate of due) {
      if (Date.now() >= deadline) {
        logOutbox("outbox_drain_budget_exhausted", { drained: result.drained, remaining: due.length - result.drained })
        break
      }
      const outcome = await dispatchOne(candidate, deadline)
      if (outcome === null) continue // lost the claim race — another instance owns it
      result.drained++
      result[outcome === "SENT" ? "sent" : outcome === "DEAD" ? "dead" : "retried"]++
    }

    logOutbox("outbox_drain", { ...result, scope: options.userId ? "user" : "global", ms: Date.now() - startedAt })
    return result
  } catch (e) {
    // Drain is always best-effort: log and return the partial result.
    logOutbox("outbox_drain_failed", { error: truncateForLog(e instanceof Error ? e.message : String(e), 160), ...result })
    return result
  }
}

/**
 * Claim one job atomically and run one dispatch round. Returns the transition
 * kind, or null when the claim was lost (another instance won) or the budget
 * ran out before the send.
 */
async function dispatchOne(candidate: NotificationOutbox, deadline: number): Promise<"SENT" | "RETRY" | "DEAD" | null> {
  if (!isOutboxJobDue(candidate, new Date())) return null
  const now = new Date()
  // Atomic claim — repeats the due predicate in the WHERE, so of any number of
  // concurrent drains exactly one flips the row to SENDING (count === 1).
  const claim = await db.notificationOutbox.updateMany({
    where: {
      id: candidate.id,
      OR: [
        { status: "PENDING", nextAttemptAt: { lte: now } },
        { status: "SENDING", leaseUntil: { lt: now } },
      ],
    },
    data: {
      status: "SENDING",
      leaseUntil: new Date(now.getTime() + OUTBOX_LEASE_MS),
      attempts: { increment: 1 },
    },
  })
  if (claim.count !== 1) return null

  const attempts = candidate.attempts + 1
  const maxAttempts = candidate.maxAttempts > 0 ? candidate.maxAttempts : 6

  try {
    if (Date.now() >= deadline) {
      // Budget exhausted before the send — release the job back to PENDING
      // immediately (don't burn a failed attempt on it) via the retry path
      // below with a synthetic round.
      const decision: OutboxDecision = { kind: "RETRY", reason: "drain-budget-exhausted" }
      await finalize(candidate, decision, { payloadValid: true, subscribers: 0, sent: 0, removed: 0, skipped: true, attempts, maxAttempts })
      return "RETRY"
    }

    // Never trust the stored Json payload.
    const payloadValid = isPushPayload(candidate.payload)
    const payload = payloadValid ? (candidate.payload as unknown as { title: string; body: string; url?: string }) : null

    const summary = payload
      ? await sendPushToUser(candidate.userId, payload)
      : { sent: 0, removed: 0, skipped: true, subscribers: 0 }

    const decision = classifyOutboxSend({
      payloadValid,
      subscribers: summary.subscribers,
      sent: summary.sent,
      removed: summary.removed,
      skipped: summary.skipped,
      lastError: summary.lastError ?? null,
      attempts,
      maxAttempts,
    })
    await finalize(candidate, decision, { payloadValid, subscribers: summary.subscribers, sent: summary.sent, removed: summary.removed, skipped: summary.skipped, attempts, maxAttempts, lastError: summary.lastError ?? null })
    return decision.kind
  } catch (e) {
    // Anything unexpected during the round: treat as transient and requeue via
    // the retry path (the claim already burned an attempt — honest: the send
    // MIGHT have gone out, so this can duplicate at-least-once, never lose).
    const decision = classifyOutboxSend({
      payloadValid: true,
      subscribers: 1,
      sent: 0,
      removed: 0,
      skipped: true,
      lastError: truncateForLog(e instanceof Error ? e.message : String(e), 120),
      attempts,
      maxAttempts,
    })
    await finalize(candidate, decision, { payloadValid: true, subscribers: 1, sent: 0, removed: 0, skipped: true, attempts, maxAttempts })
    return decision.kind
  }
}

/** Write the post-round transition and log it. */
async function finalize(
  candidate: NotificationOutbox,
  decision: OutboxDecision,
  round: { payloadValid: boolean; subscribers: number; sent: number; removed: number; skipped: boolean; attempts: number; maxAttempts: number; lastError?: string | null }
): Promise<void> {
  const now = new Date()
  try {
    if (decision.kind === "SENT") {
      // Provider acceptance ≠ guaranteed OS display (no web-push ack exists).
      // deviceSummary (when partial) documents per-device gaps in lastError.
      await db.notificationOutbox.update({
        where: { id: candidate.id },
        data: { status: "SENT", sentAt: now, leaseUntil: null, lastError: decision.deviceSummary },
      })
    } else if (decision.kind === "RETRY") {
      await db.notificationOutbox.update({
        where: { id: candidate.id },
        data: {
          status: "PENDING",
          leaseUntil: null,
          nextAttemptAt: nextAttemptAtAfterFailure(round.attempts, now),
          lastError: truncateForLog(decision.reason, 200),
        },
      })
    } else {
      await db.notificationOutbox.update({
        where: { id: candidate.id },
        data: { status: "DEAD", leaseUntil: null, lastError: truncateForLog(decision.reason, 200) },
      })
    }
    logOutbox(`outbox_job_${decision.kind.toLowerCase()}`, jobLogFields(candidate, {
      to: decision.kind,
      attemptsAfter: round.attempts,
      devices: round.subscribers,
      accepted: round.sent,
      pruned: round.removed,
      ...(decision.kind === "SENT" ? {} : { reason: truncateForLog("reason" in decision ? decision.reason : "", 120) }),
    }))
  } catch (e) {
    // The send already happened (or the round was skipped); a failed status
    // write leaves the row SENDING until its lease expires and the next drain
    // re-claims it — at-least-once, never lost.
    logOutbox("outbox_finalize_failed", {
      jobId: candidate.id,
      error: truncateForLog(e instanceof Error ? e.message : String(e), 160),
    })
  }
}
