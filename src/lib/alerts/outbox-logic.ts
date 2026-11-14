// =============================================================================
// Pure outbox mechanics — statuses, backoff, lease math, dispatch decisions.
// =============================================================================
// No DB, no clock reads, no I/O: every constant and decision function here is
// unit-tested in src/lib/alerts/__tests__/outbox-dispatch.test.ts. The
// stateful dispatcher (outbox-dispatch.ts) applies them against real rows.
//
// HONEST LATENCY CONTRACT (encoded in the constants below — state this to any
// stakeholder asking "when does the push arrive"):
//   * Best case (inline dispatch right after the trigger commit): seconds.
//   * With normal daytime traffic: minutes — every snapshot-write refresh
//     sweeps the outbox (≈ every 8 min in session), the owner's open /alerts
//     page sweeps their own rows every ~60 s poll.
//   * With ZERO traffic: the only guaranteed dispatch opportunity is the daily
//     14:00 UTC cron (Vercel Hobby = daily crons only) → up to ~24 h between
//     attempts; each retry climbs the backoff ladder but the LADDER only
//     matters when there is traffic to drain it.
//   * A job that keeps failing goes DEAD after maxAttempts (default 6) —
//     at one attempt/day that is roughly a week from trigger to DEAD-letter.
//   * DEAD is final: the alert stays triggered (one-shot product model); the
//     user re-arms by creating a new alert and sees "فشل التسليم" in the UI.

import type { PushPayload } from "@/lib/web-push"

// --- status vocabulary -------------------------------------------------------

export const OUTBOX_STATUSES = ["PENDING", "SENDING", "SENT", "DEAD"] as const
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number]

// --- timing constants (see the latency contract above) -----------------------

/** Dispatch lease: how long a SENDING row is exclusively ours. Must exceed the
 *  worst send round (per-device send timeout 15s × parallel fan-out + DB
 *  writes). 2 minutes is generous; an expired lease is the recovery path for
 *  serverless kills (Vercel freeze/OOM mid-dispatch) — the next drain re-claims. */
export const OUTBOX_LEASE_MS = 2 * 60_000

/** Retry backoff after the Nth failed attempt (1m, 5m, 30m, 2h, 12h, 24h).
 *  attempts=1 → [0], attempts=2 → [1] … clamped at the last entry. With the
 *  default maxAttempts=6 the last entry is only reached if a job carries a
 *  larger maxAttempts; the schedule exists so tuning maxAttempts up never
 *  needs a code change. */
export const OUTBOX_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000] as const

/** Default attempt ceiling before a job is dead-lettered. */
export const OUTBOX_MAX_ATTEMPTS_DEFAULT = 6

/** Per-send socket timeout (ms) handed to web-push's sendNotification — a hung
 *  push-service connection must not eat the whole drain budget (audit F-12). */
export const WEB_PUSH_SEND_TIMEOUT_MS = 15_000

// --- drain budgets per invocation point (all bounded, host request never waits long) ---

export const OUTBOX_DRAIN_PRESETS = {
  /** Inline, right after the publish transaction (one trigger → its user). */
  inline: { limit: 5, timeBudgetMs: 6_000 },
  /** Tail of the market-refresh hook (snapshot write sweeps leftovers). */
  refresh: { limit: 20, timeBudgetMs: 15_000 },
  /** GET /api/v1/alerts — strictly user-scoped (a request never does cross-user work). */
  userGet: { limit: 5, timeBudgetMs: 6_000 },
  /** Daily cron — the guaranteed floor; first thing the cron does (recovery). */
  cron: { limit: 200, timeBudgetMs: 30_000 },
} as const

export interface OutboxDrainOptions {
  /** Max jobs claimed this round. */
  limit: number
  /** Wall-clock budget; the drain stops between jobs when exceeded. */
  timeBudgetMs: number
  /** Scope the drain to one user's jobs (alerts GET path). */
  userId?: string
}

export interface OutboxDrainResult {
  /** Jobs this drain claimed and dispatched. */
  drained: number
  /** Jobs that ended SENT. */
  sent: number
  /** Jobs that went DEAD this round. */
  dead: number
  /** Jobs requeued for a later attempt (backoff). */
  retried: number
}

// --- due / lease math ---------------------------------------------------------

export interface OutboxJobTiming {
  status: string
  nextAttemptAt: Date
  leaseUntil: Date | null
}

/**
 * Is this job due for a (re-)claim right now?
 *  - PENDING: nextAttemptAt <= now (initial or after backoff);
 *  - SENDING: lease expired (leaseUntil < now) — recovery of abandoned jobs
 *    (serverless kill mid-send). A SENDING row with no lease cannot be due
 *    (defensive: should never exist — the claim always sets leaseUntil).
 *  - SENT/DEAD are terminal and never due.
 */
export function isOutboxJobDue(job: OutboxJobTiming, now: Date): boolean {
  if (job.status === "PENDING") return job.nextAttemptAt.getTime() <= now.getTime()
  if (job.status === "SENDING") return job.leaseUntil !== null && job.leaseUntil.getTime() < now.getTime()
  return false
}

/** Next attempt time after `attempts` failed attempts (backoff schedule). */
export function nextAttemptAtAfterFailure(attempts: number, now: Date): Date {
  const idx = Math.min(Math.max(attempts - 1, 0), OUTBOX_BACKOFF_MS.length - 1)
  return new Date(now.getTime() + OUTBOX_BACKOFF_MS[idx])
}

// --- publish-side pure logic ---------------------------------------------------

/**
 * The claim predicate for the transactional publish: the alert is consumed
 * ONLY when the conditional update matched exactly one row. Any other count
 * (0 = lost a race with another evaluator / deleted mid-flight) publishes
 * nothing — this is what keeps duplicate trigger events impossible when
 * combined with the alertId UNIQUE key on the outbox row.
 */
export function publishDecision(claimCount: number): "published" | "lost-race" {
  return claimCount === 1 ? "published" : "lost-race"
}

// --- device-side classification --------------------------------------------------

/** Failure class of a single device send, from the push-service status code.
 *  404/410 = subscription gone; 400 = invalid subscription/keys (the push
 *  service rejected the encryption material) — both terminal for the DEVICE
 *  row (pruned). Everything else (403, 429, 5xx, network) is transient for
 *  the device and MAY succeed on retry. NOTE: 403 is deliberately transient —
 *  it can mean a VAPID key mismatch (env rotation), where pruning every row
 *  would be destructive. */
export type DeviceFailureClass = "gone" | "invalid" | "transient"

export function deviceFailureClass(statusCode: number | undefined): DeviceFailureClass {
  if (statusCode === 404 || statusCode === 410) return "gone"
  if (statusCode === 400) return "invalid"
  return "transient"
}

// --- job-level decision (pure) ---------------------------------------------------

/** Summary of one send round against one user's devices (from sendPushToUser). */
export interface DispatchRoundInput {
  /** Payload from the outbox row failed validation → never send, dead-letter. */
  payloadValid: boolean
  /** Subscription rows found for the user BEFORE sending. */
  subscribers: number
  /** Devices whose send was ACCEPTED by the push service (2xx). */
  sent: number
  /** Device rows pruned this round (gone/invalid endpoints). */
  removed: number
  /** True when the send round was skipped wholesale (push disabled/DB error). */
  skipped: boolean
  lastError?: string | null
  /** Attempt count AFTER the claim increment (1-based). */
  attempts: number
  maxAttempts: number
}

export type OutboxDecision =
  | { kind: "SENT"; deviceSummary: string | null }
  | { kind: "RETRY"; reason: string }
  | { kind: "DEAD"; reason: string }

/**
 * Job-level transition after one dispatch round. Order of checks matters:
 *   1. corrupt payload → DEAD (can never succeed);
 *   2. no subscription rows at all → DEAD "no-valid-subscription" (nothing to
 *      send against; the user can re-subscribe but this alert is one-shot);
 *   3. wholesale skip (push not configured / DB hiccup) → transient;
 *   4. any device accepted → SENT (with a per-device note when partial).
 *      IMPORTANT: provider acceptance ≠ guaranteed OS display — web push has
 *      no delivery acknowledgment; "SENT" means the push service accepted the
 *      message. That is the strongest signal the platform exposes.
 *   5. everything pruned and nothing accepted → DEAD "no-valid-subscription";
 *   6. remaining transient failures → RETRY while attempts < maxAttempts,
 *      else DEAD "max-attempts-exceeded".
 */
export function classifyOutboxSend(input: DispatchRoundInput): OutboxDecision {
  if (!input.payloadValid) return { kind: "DEAD", reason: "invalid-payload" }
  if (input.subscribers === 0) return { kind: "DEAD", reason: "no-valid-subscription" }

  if (input.skipped) {
    return input.attempts >= input.maxAttempts
      ? { kind: "DEAD", reason: "max-attempts-exceeded" }
      : { kind: "RETRY", reason: "push-unavailable" }
  }

  if (input.sent > 0) {
    const deviceSummary =
      input.sent < input.subscribers
        ? `delivered ${input.sent}/${input.subscribers} devices${input.lastError ? `; ${input.lastError}` : ""}`
        : null
    return { kind: "SENT", deviceSummary }
  }

  if (input.removed >= input.subscribers) {
    // Every device this round was terminal (gone/invalid) and pruned — nothing
    // valid remains to retry against.
    return { kind: "DEAD", reason: "no-valid-subscription" }
  }

  return input.attempts >= input.maxAttempts
    ? { kind: "DEAD", reason: "max-attempts-exceeded" }
    : { kind: "RETRY", reason: input.lastError ? `transient: ${input.lastError}` : "transient-failure" }
}

// --- payload validation + log hygiene ---------------------------------------------

/** Narrow a JSON value from the DB into a safe PushPayload (never trust Json). */
export function isPushPayload(value: unknown): value is PushPayload {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  if (typeof v.title !== "string" || v.title.length === 0) return false
  if (typeof v.body !== "string") return false
  if (v.url !== undefined && typeof v.url !== "string") return false
  return true
}

/** Single-line log hygiene: truncate error text, never include keys/payloads. */
export function truncateForLog(text: string | null | undefined, max = 120): string {
  if (!text) return ""
  return text.replace(/\s+/g, " ").trim().slice(0, max)
}
