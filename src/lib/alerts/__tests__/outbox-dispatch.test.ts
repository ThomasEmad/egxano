import { describe, expect, it } from "vitest"

// DB-free unit contract for the pure outbox mechanics
// (src/lib/alerts/outbox-logic.ts): due/lease math, backoff schedule, and the
// job-level decision function that maps one dispatch round to the next row
// state. The stateful dispatcher applies these against real rows.

import {
  OUTBOX_BACKOFF_MS,
  OUTBOX_LEASE_MS,
  OUTBOX_MAX_ATTEMPTS_DEFAULT,
  classifyOutboxSend,
  deviceFailureClass,
  isOutboxJobDue,
  isPushPayload,
  nextAttemptAtAfterFailure,
  truncateForLog,
} from "@/lib/alerts/outbox-logic"

const NOW = new Date("2026-11-14T12:00:00.000Z")

describe("isOutboxJobDue — the claim predicate (race-safety lives in the conditional UPDATE)", () => {
  it("PENDING is due once nextAttemptAt has passed", () => {
    expect(isOutboxJobDue({ status: "PENDING", nextAttemptAt: NOW, leaseUntil: null }, NOW)).toBe(true)
    expect(isOutboxJobDue({ status: "PENDING", nextAttemptAt: new Date(NOW.getTime() - 1), leaseUntil: null }, NOW)).toBe(true)
  })

  it("PENDING backed-off into the future is NOT due (backoff ladder respected)", () => {
    expect(isOutboxJobDue({ status: "PENDING", nextAttemptAt: new Date(NOW.getTime() + 60_000), leaseUntil: null }, NOW)).toBe(false)
  })

  it("SENDING with a live lease is NOT due — the lease protects an in-flight dispatch", () => {
    const leased = { status: "SENDING", nextAttemptAt: NOW, leaseUntil: new Date(NOW.getTime() + OUTBOX_LEASE_MS) }
    expect(isOutboxJobDue(leased, NOW)).toBe(false)
  })

  it("SENDING with an EXPIRED lease IS due — recovery of abandoned jobs (serverless kills)", () => {
    const abandoned = { status: "SENDING", nextAttemptAt: NOW, leaseUntil: new Date(NOW.getTime() - 1) }
    expect(isOutboxJobDue(abandoned, NOW)).toBe(true)
    expect(isOutboxJobDue(abandoned, new Date(NOW.getTime() + OUTBOX_LEASE_MS + 1))).toBe(true)
  })

  it("SENDING with no lease (defensive: should never exist) is never due", () => {
    expect(isOutboxJobDue({ status: "SENDING", nextAttemptAt: NOW, leaseUntil: null }, NOW)).toBe(false)
  })

  it("terminal rows are never due", () => {
    expect(isOutboxJobDue({ status: "SENT", nextAttemptAt: NOW, leaseUntil: null }, NOW)).toBe(false)
    expect(isOutboxJobDue({ status: "DEAD", nextAttemptAt: NOW, leaseUntil: null }, NOW)).toBe(false)
  })
})

describe("backoff + lease constants", () => {
  it("ladder is 1m, 5m, 30m, 2h, 12h, 24h", () => {
    expect(OUTBOX_BACKOFF_MS).toEqual([60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000])
    expect(OUTBOX_MAX_ATTEMPTS_DEFAULT).toBe(6)
  })

  it("maps attempt N to schedule slot N-1 and clamps past the end", () => {
    expect(nextAttemptAtAfterFailure(1, NOW).getTime()).toBe(NOW.getTime() + 60_000)
    expect(nextAttemptAtAfterFailure(2, NOW).getTime()).toBe(NOW.getTime() + 5 * 60_000)
    expect(nextAttemptAtAfterFailure(3, NOW).getTime()).toBe(NOW.getTime() + 30 * 60_000)
    expect(nextAttemptAtAfterFailure(4, NOW).getTime()).toBe(NOW.getTime() + 2 * 3_600_000)
    expect(nextAttemptAtAfterFailure(5, NOW).getTime()).toBe(NOW.getTime() + 12 * 3_600_000)
    expect(nextAttemptAtAfterFailure(6, NOW).getTime()).toBe(NOW.getTime() + 24 * 3_600_000)
    expect(nextAttemptAtAfterFailure(9, NOW).getTime()).toBe(NOW.getTime() + 24 * 3_600_000) // clamped
    expect(nextAttemptAtAfterFailure(0, NOW).getTime()).toBe(NOW.getTime() + 60_000) // clamped low
  })

  it("lease is long enough to cover the worst send round (per-device timeout 15s × fan-out)", () => {
    expect(OUTBOX_LEASE_MS).toBeGreaterThanOrEqual(2 * 60_000)
  })
})

describe("deviceFailureClass — per-device terminal vs transient (multi-device fan-out)", () => {
  it("404/410 = gone (subscription dead)", () => {
    expect(deviceFailureClass(404)).toBe("gone")
    expect(deviceFailureClass(410)).toBe("gone")
  })

  it("400 = invalid subscription/keys", () => {
    expect(deviceFailureClass(400)).toBe("invalid")
  })

  it("403/429/5xx/network(unknown) = transient — 403 must NOT prune (VAPID rotation safety)", () => {
    expect(deviceFailureClass(403)).toBe("transient")
    expect(deviceFailureClass(429)).toBe("transient")
    expect(deviceFailureClass(503)).toBe("transient")
    expect(deviceFailureClass(undefined)).toBe("transient")
  })
})

describe("classifyOutboxSend — job status transitions from one dispatch round", () => {
  const ok = { payloadValid: true, sent: 0, removed: 0, skipped: false, lastError: null as string | null }

  it("invalid payload → DEAD immediately (can never succeed)", () => {
    expect(classifyOutboxSend({ ...ok, subscribers: 3, attempts: 1, maxAttempts: 6, payloadValid: false })).toEqual({
      kind: "DEAD",
      reason: "invalid-payload",
    })
  })

  it("no subscription rows → DEAD no-valid-subscription (nothing to send against)", () => {
    expect(classifyOutboxSend({ ...ok, subscribers: 0, attempts: 1, maxAttempts: 6 })).toEqual({
      kind: "DEAD",
      reason: "no-valid-subscription",
    })
  })

  it("wholesale skip (push disabled / DB hiccup) → RETRY, then DEAD at the ceiling", () => {
    expect(classifyOutboxSend({ ...ok, subscribers: 2, skipped: true, attempts: 1, maxAttempts: 6 }).kind).toBe("RETRY")
    expect(classifyOutboxSend({ ...ok, subscribers: 2, skipped: true, attempts: 6, maxAttempts: 6 })).toEqual({
      kind: "DEAD",
      reason: "max-attempts-exceeded",
    })
  })

  it("ANY device accepted → SENT (at-least-one semantics; acceptance ≠ guaranteed OS display)", () => {
    expect(classifyOutboxSend({ ...ok, subscribers: 3, sent: 3, attempts: 1, maxAttempts: 6 })).toEqual({ kind: "SENT", deviceSummary: null })
    expect(classifyOutboxSend({ ...ok, subscribers: 3, sent: 1, attempts: 4, maxAttempts: 6 }).kind).toBe("SENT")
  })

  it("partial success records a per-device outcome summary", () => {
    const d = classifyOutboxSend({ ...ok, subscribers: 3, sent: 2, attempts: 1, maxAttempts: 6, lastError: "HTTP 503: upstream" })
    expect(d).toEqual({ kind: "SENT", deviceSummary: "delivered 2/3 devices; HTTP 503: upstream" })
  })

  it("all devices pruned and nothing accepted → DEAD no-valid-subscription", () => {
    expect(classifyOutboxSend({ ...ok, subscribers: 2, removed: 2, attempts: 1, maxAttempts: 6 })).toEqual({
      kind: "DEAD",
      reason: "no-valid-subscription",
    })
  })

  it("multi-device mixed failure (1 of 3 pruned, 2 transient) → RETRY while attempts remain", () => {
    expect(classifyOutboxSend({ ...ok, subscribers: 3, removed: 1, attempts: 1, maxAttempts: 6 }).kind).toBe("RETRY")
    expect(classifyOutboxSend({ ...ok, subscribers: 3, removed: 1, attempts: 6, maxAttempts: 6 })).toEqual({
      kind: "DEAD",
      reason: "max-attempts-exceeded",
    })
  })

  it("pure transient failure (nothing pruned) → RETRY with the error reason, DEAD at the ceiling", () => {
    const retry = classifyOutboxSend({ ...ok, subscribers: 1, attempts: 2, maxAttempts: 6, lastError: "HTTP 500: oops" })
    expect(retry).toEqual({ kind: "RETRY", reason: "transient: HTTP 500: oops" })
    expect(classifyOutboxSend({ ...ok, subscribers: 1, attempts: 6, maxAttempts: 6 }).kind).toBe("DEAD")
    // per-job maxAttempts is respected (a job may carry a custom ceiling)
    expect(classifyOutboxSend({ ...ok, subscribers: 1, attempts: 9, maxAttempts: 10 }).kind).toBe("RETRY")
    expect(classifyOutboxSend({ ...ok, subscribers: 1, attempts: 10, maxAttempts: 10 }).kind).toBe("DEAD")
  })
})

describe("payload + log hygiene", () => {
  it("isPushPayload accepts only well-formed push content", () => {
    expect(isPushPayload({ title: "تنبيه سعر COMI", body: "…", url: "/company/COMI" })).toBe(true)
    expect(isPushPayload({ title: "t", body: "b" })).toBe(true)
    expect(isPushPayload(null)).toBe(false)
    expect(isPushPayload("string")).toBe(false)
    expect(isPushPayload({})).toBe(false)
    expect(isPushPayload({ body: "no title" })).toBe(false)
    expect(isPushPayload({ title: "t", body: 5 })).toBe(false)
    expect(isPushPayload({ title: "t", body: "b", url: 42 })).toBe(false)
  })

  it("truncateForLog flattens and caps length (never used for keys/payloads)", () => {
    expect(truncateForLog("a".repeat(300)).length).toBe(120)
    expect(truncateForLog("line1\nline2\ttab")).toBe("line1 line2 tab")
    expect(truncateForLog(null)).toBe("")
    expect(truncateForLog(undefined)).toBe("")
  })
})
