import { db } from "@/lib/db"

// Runtime, idempotent table bootstrap for the Web Push + Notification Outbox
// features.
//
// Why: the production Neon database is not reachable for `prisma migrate` /
// `db push` from every environment that ships this code, so new tables must
// self-heal on first use (same spirit as the self-healing Plan rows in
// /api/v1/subscription/request). The statements below match
// `model PushSubscription` and `model NotificationOutbox` in
// prisma/schema.prisma exactly — including the index/constraint names Prisma
// itself would create — so a later real `prisma db push` / migration is a
// no-op here, never a conflict.
//
// Memoized: runs at most once per instance per process lifetime; a failure
// clears the memo so the next call retries instead of the instance staying
// wedged forever.

/**
 * Memoize `run` once per process (per closure — each ensure function gets its
 * own memo); a failure clears the memo to allow a retry on the next call.
 */
function memoizeEnsure(run: () => Promise<void>): () => Promise<void> {
  let memo: Promise<void> | null = null
  return () => {
    if (!memo) {
      memo = run().catch((e) => {
        memo = null // transient DB error — allow a retry on next call
        throw e
      })
    }
    return memo
  }
}

async function runEnsure(): Promise<void> {
  // Column types mirror Prisma's postgres defaults: String → TEXT,
  // DateTime → TIMESTAMP(3), @default(now()) → DEFAULT CURRENT_TIMESTAMP,
  // Float → DOUBLE PRECISION, Json → JSONB.
  // `id` is app-generated (Prisma cuid) — no DB default needed.
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PushSubscription" (
      "id"        TEXT          NOT NULL,
      "userId"    TEXT          NOT NULL,
      "endpoint"  TEXT          NOT NULL,
      "p256dh"    TEXT          NOT NULL,
      "auth"      TEXT          NOT NULL,
      "createdAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  // Named exactly like Prisma's own DDL (@unique → `_key`, @@index → `_idx`).
  await db.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint")`
  )
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription"("userId")`
  )
}

async function runEnsureOutbox(): Promise<void> {
  // Mirrors `model NotificationOutbox` in prisma/schema.prisma. The UNIQUE
  // index on "alertId" is the transactional-outbox EVENT KEY: it makes a
  // duplicate publish for the same triggered alert impossible at the DB level
  // (the claim transaction in src/lib/alerts/evaluate.ts relies on it).
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "NotificationOutbox" (
      "id"            TEXT               NOT NULL,
      "alertId"       TEXT               NOT NULL,
      "userId"        TEXT               NOT NULL,
      "ticker"        TEXT               NOT NULL,
      "direction"     TEXT               NOT NULL,
      "targetPrice"   DOUBLE PRECISION   NOT NULL,
      "triggerPrice"  DOUBLE PRECISION   NOT NULL,
      "payload"       JSONB              NOT NULL,
      "status"        TEXT               NOT NULL DEFAULT 'PENDING',
      "attempts"      INTEGER            NOT NULL DEFAULT 0,
      "maxAttempts"   INTEGER            NOT NULL DEFAULT 6,
      "nextAttemptAt" TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "leaseUntil"    TIMESTAMP(3),
      "lastError"     TEXT,
      "sentAt"        TIMESTAMP(3),
      "createdAt"     TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"     TIMESTAMP(3)       NOT NULL,
      CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
    )
  `)
  await db.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "NotificationOutbox_alertId_key" ON "NotificationOutbox"("alertId")`
  )
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "NotificationOutbox_status_nextAttemptAt_idx" ON "NotificationOutbox"("status", "nextAttemptAt")`
  )
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "NotificationOutbox_userId_idx" ON "NotificationOutbox"("userId")`
  )
}

/** Ensures the push tables exist — call lazily in subscribe/send paths. */
const ensurePushMemo = memoizeEnsure(runEnsure)
export function ensurePushTables(): Promise<void> {
  return ensurePushMemo()
}

/**
 * Ensures the NotificationOutbox table exists — call lazily in the publish
 * (claim) transaction path and every drain path. Same memoized self-heal
 * pattern as ensurePushTables (its own memo — the two tables are independent).
 */
const ensureOutboxMemo = memoizeEnsure(runEnsureOutbox)
export function ensureNotificationOutboxTable(): Promise<void> {
  return ensureOutboxMemo()
}
