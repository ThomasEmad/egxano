import { db } from "@/lib/db"

// Runtime, idempotent table bootstrap for the Web Push feature.
//
// Why: the production Neon database is not reachable for `prisma migrate` /
// `db push` from every environment that ships this code, so new tables must
// self-heal on first use (same spirit as the self-healing Plan rows in
// /api/v1/subscription/request). The statements below match
// `model PushSubscription` in prisma/schema.prisma exactly — including the
// index/constraint names Prisma itself would create — so a later real
// `prisma db push` / migration is a no-op here, never a conflict.
//
// Memoized: runs at most once per instance per process lifetime; a failure
// clears the memo so the next call retries instead of the instance staying
// wedged forever.

let ensurePromise: Promise<void> | null = null

async function runEnsure(): Promise<void> {
  // Column types mirror Prisma's postgres defaults: String → TEXT,
  // DateTime → TIMESTAMP(3), @default(now()) → DEFAULT CURRENT_TIMESTAMP.
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

/** Ensures the push tables exist — call lazily in subscribe/send paths. */
export function ensurePushTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = runEnsure().catch((e) => {
      ensurePromise = null // transient DB error — allow a retry on next call
      throw e
    })
  }
  return ensurePromise
}
