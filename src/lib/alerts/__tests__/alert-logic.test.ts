import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

// DB-free unit contract for the pure alert-evaluation logic
// (src/lib/alerts/logic.ts). The transactional publish path itself is covered
// by its design + SQL constraints (see the bootstrap-DDL test at the bottom):
// the Prisma $transaction (claim + outbox insert) needs a live Postgres, so
// its DB-level behavior is verified here by the UNIQUE event-key constraint
// and will be smoke-tested on the preview deployment (Neon unreachable from
// this sandbox).

import {
  FALLBACK_PRICE_MAX_AGE_MS,
  alertEvaluationGate,
  alertHit,
  deliveryInfoFromOutbox,
  fallbackPriceIsFresh,
} from "@/lib/alerts/logic"
import { publishDecision } from "@/lib/alerts/outbox-logic"

// Cairo-verified instants (12:00 Cairo = 10:00 UTC in Nov 2026, UTC+2):
// 2026-11-12 Thu · 13 Fri · 14 Sat · 15 Sun · 16 Mon · 17 Tue · 18 Wed.
const THU = new Date("2026-11-12T10:00:00.000Z")
const FRI = new Date("2026-11-13T10:00:00.000Z")
const SAT = new Date("2026-11-14T10:00:00.000Z")
const SUN = new Date("2026-11-15T10:00:00.000Z")
const MON = new Date("2026-11-16T10:00:00.000Z")
const WED = new Date("2026-11-18T10:00:00.000Z")

describe("alertHit — equality/gap semantics", () => {
  it("fires ABOVE at or above the target (equality triggers)", () => {
    expect(alertHit("ABOVE", 50, 50)).toBe(true)
    expect(alertHit("ABOVE", 50, 50.01)).toBe(true)
    expect(alertHit("ABOVE", 50, 49.99)).toBe(false)
  })

  it("fires BELOW at or below the target (equality triggers)", () => {
    expect(alertHit("BELOW", 50, 50)).toBe(true)
    expect(alertHit("BELOW", 50, 49.99)).toBe(true)
    expect(alertHit("BELOW", 50, 50.01)).toBe(false)
  })

  it("does not fire in the gap (strictly between target and price)", () => {
    // ABOVE target 50, price 49.5 — 0.5 gap, no hit.
    expect(alertHit("ABOVE", 50, 49.5)).toBe(false)
    // BELOW target 50, price 50.5 — ditto.
    expect(alertHit("BELOW", 50, 50.5)).toBe(false)
  })

  it("never fires for an unknown direction", () => {
    expect(alertHit("SIDEWAYS", 50, 50)).toBe(false)
    expect(alertHit("", 50, 10)).toBe(false)
  })
})

describe("fallbackPriceIsFresh — F-03 freshness guard (7 calendar days)", () => {
  const now = new Date("2026-11-14T12:00:00.000Z")

  it("accepts a 6-day-old fallback price", () => {
    expect(fallbackPriceIsFresh("2026-11-08T12:00:00.000Z", now)).toBe(true)
  })

  it("accepts a price exactly at the 7-day boundary (inclusive)", () => {
    expect(fallbackPriceIsFresh("2026-11-07T12:00:00.000Z", now)).toBe(true)
    expect(FALLBACK_PRICE_MAX_AGE_MS).toBe(7 * 24 * 3_600_000)
  })

  it("rejects an 8-day-old fallback price", () => {
    expect(fallbackPriceIsFresh("2026-11-06T12:00:00.000Z", now)).toBe(false)
  })

  it("rejects unknown/unparseable age (fail-closed)", () => {
    expect(fallbackPriceIsFresh(null, now)).toBe(false)
    expect(fallbackPriceIsFresh(undefined, now)).toBe(false)
    expect(fallbackPriceIsFresh("not-a-date", now)).toBe(false)
  })

  it("rejects a future-dated price? no — treats it as fresh (age <= max)", () => {
    // A future asOf (clock skew, re-stamped data) has age <= 0 → passes the
    // age gate; the weekend guard handles the re-stamping harm separately.
    expect(fallbackPriceIsFresh("2026-11-20T12:00:00.000Z", now)).toBe(true)
  })
})

describe("alertEvaluationGate — F-04 weekend guard", () => {
  const thuFetch = "2026-11-12T14:00:00.000Z" // Thursday-session data
  const wedSnapshot = "2026-11-11T14:00:00.000Z" // Wednesday-session data
  const friFetch = "2026-11-13T06:31:00.000Z" // Friday fetch, restates Thursday
  const satFetch = "2026-11-14T00:50:00.000Z" // Saturday fetch, restates Thursday

  it("always evaluates on Cairo trading days (Sun–Thu), any data", () => {
    for (const now of [SUN, MON, THU, WED]) {
      expect(alertEvaluationGate({ now, dataAsOf: friFetch, prevDataAsOf: thuFetch }).evaluate).toBe(true)
    }
    expect(alertEvaluationGate({ now: THU, dataAsOf: null }).evaluate).toBe(true)
  })

  it("refresh path: Friday/Saturday fetch restating the already-stored Thursday session → skip", () => {
    expect(alertEvaluationGate({ now: FRI, dataAsOf: friFetch, prevDataAsOf: thuFetch })).toEqual({
      evaluate: false,
      reason: "weekend-restated-close",
    })
    expect(alertEvaluationGate({ now: SAT, dataAsOf: satFetch, prevDataAsOf: thuFetch }).evaluate).toBe(false)
  })

  it("refresh path: Friday fetch carrying NEW session data (previous snapshot is Wednesday) → evaluate", () => {
    // Thursday's refreshes all failed; the Friday fetch is the FIRST recording
    // of Thursday's close — genuinely new session data, not a re-stamp.
    expect(alertEvaluationGate({ now: FRI, dataAsOf: friFetch, prevDataAsOf: wedSnapshot })).toEqual({
      evaluate: true,
      reason: "weekend-new-session-data",
    })
  })

  it("refresh path: unknown previous snapshot on a weekend → fail closed (skip)", () => {
    expect(alertEvaluationGate({ now: FRI, dataAsOf: friFetch, prevDataAsOf: null }).evaluate).toBe(false)
    expect(alertEvaluationGate({ now: SAT, dataAsOf: satFetch, prevDataAsOf: null }).evaluate).toBe(false)
  })

  it("cron path: stored Thursday-restated data on Fri/Sat → skip the phantom", () => {
    expect(alertEvaluationGate({ now: FRI, dataAsOf: friFetch })).toEqual({
      evaluate: false,
      reason: "weekend-restated-close",
    })
    expect(alertEvaluationGate({ now: SAT, dataAsOf: satFetch }).evaluate).toBe(false)
  })

  it("cron path: genuinely older stored data on a weekend → evaluate (bounded by the freshness guard)", () => {
    expect(alertEvaluationGate({ now: FRI, dataAsOf: wedSnapshot })).toEqual({
      evaluate: true,
      reason: "weekend-older-data",
    })
  })

  it("cron path: no data at all on a weekend → skip", () => {
    expect(alertEvaluationGate({ now: FRI, dataAsOf: null }).evaluate).toBe(false)
  })
})

describe("deliveryInfoFromOutbox — honest UI state mapping (F-07)", () => {
  const base = { status: "PENDING", attempts: 0, sentAt: null, nextAttemptAt: "2026-11-14T12:00:00.000Z" as const }

  it("maps SENT with its delivered timestamp", () => {
    const info = deliveryInfoFromOutbox({ ...base, status: "SENT", sentAt: "2026-11-14T11:00:00.000Z", nextAttemptAt: null })
    expect(info).toEqual({ state: "SENT", attempts: 0, sentAt: "2026-11-14T11:00:00.000Z", nextRetryAt: null })
  })

  it("maps PENDING attempts=0 to the pending state (claimed, not yet sent)", () => {
    expect(deliveryInfoFromOutbox(base)?.state).toBe("PENDING")
  })

  it("maps PENDING/SENDING attempts>0 to RETRYING with the next retry time", () => {
    const retrying = deliveryInfoFromOutbox({ ...base, attempts: 2, status: "PENDING" })
    expect(retrying).toEqual({ state: "RETRYING", attempts: 2, sentAt: null, nextRetryAt: "2026-11-14T12:00:00.000Z" })
    expect(deliveryInfoFromOutbox({ ...base, attempts: 1, status: "SENDING" })?.state).toBe("RETRYING")
  })

  it("maps DEAD to FAILED", () => {
    expect(deliveryInfoFromOutbox({ ...base, status: "DEAD", nextAttemptAt: null })?.state).toBe("FAILED")
  })

  it("returns null for a missing row (legacy trigger — state unknown, honestly)", () => {
    expect(deliveryInfoFromOutbox(null)).toBeNull()
    expect(deliveryInfoFromOutbox(undefined)).toBeNull()
  })
})

describe("publishDecision — the claim predicate of the transactional publish", () => {
  it("publishes only when the conditional claim matched exactly one row", () => {
    expect(publishDecision(1)).toBe("published")
    expect(publishDecision(0)).toBe("lost-race")
    // A count > 1 is impossible for an id-targeted conditional update, but the
    // predicate treats anything but exactly 1 as "do not publish".
    expect(publishDecision(2)).toBe("lost-race")
  })
})

describe("outbox SQL constraint design (DB unreachable here — verified by the DDL)", () => {
  it("bootstraps a UNIQUE index on alertId — the event key that makes duplicate trigger events impossible", () => {
    const ddl = readFileSync(new URL("../../db-schema-bootstrap.ts", import.meta.url), "utf8")
    expect(ddl).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "NotificationOutbox_alertId_key" ON "NotificationOutbox"("alertId")')
    expect(ddl).toContain(
      'CREATE INDEX IF NOT EXISTS "NotificationOutbox_status_nextAttemptAt_idx" ON "NotificationOutbox"("status", "nextAttemptAt")'
    )
    expect(ddl).toContain('CREATE INDEX IF NOT EXISTS "NotificationOutbox_userId_idx" ON "NotificationOutbox"("userId")')
    // Status defaults to PENDING — every published event is deliverable.
    expect(ddl).toContain(`"status"        TEXT               NOT NULL DEFAULT 'PENDING'`)
    // Matching Prisma model constraint: alertId @unique (schema.prisma).
    const schema = readFileSync(new URL("../../../../prisma/schema.prisma", import.meta.url), "utf8")
    const model = schema.slice(schema.indexOf("model NotificationOutbox"))
    expect(model).toContain("alertId       String    @unique")
  })
})
