import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { PrismaClient } from "@prisma/client"
import { NextRequest } from "next/server"

// Same guard as auth.test.ts: these suites need a real Postgres test DB
// (Neon test project). Skip explicitly when only the SQLite fallback is set.
const testDbUrl = process.env.DATABASE_URL ?? ""
const hasTestDb = testDbUrl.startsWith("postgresql://") || testDbUrl.startsWith("postgres://")

const db = new PrismaClient()

describe.skipIf(!hasTestDb)("access control", () => {
  it("requirePremium rejects unauthenticated requests", async () => {
    const { requirePremium } = await import("@/lib/access")
    const req = new NextRequest("http://localhost/api/v1/test")
    const userId = await requirePremium(req)
    expect(userId).toBeNull()
  })

  it("requirePremium rejects users whose trial month has expired", async () => {
    const { requirePremium } = await import("@/lib/access")
    // 2026-11-16 trial era: EVERY account gets a full month from the deploy
    // epoch (TRIAL_EPOCH + 30d ≈ 2026-12-16), so "expired" is only reachable
    // in time — the clock is moved past both trial windows (Date only; DB and
    // timers stay real) and the account is created 70 mocked-days old.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2027-01-10T12:00:00.000Z"))
    try {
      const user = await db.user.create({
        data: {
          email: `test-nonpremium-${Date.now()}@example.com`,
          passwordHash: "test",
          role: "user",
          isActive: true,
          createdAt: new Date(Date.now() - 70 * 86_400_000),
        },
        select: { id: true },
      })

      const { createSession } = await import("@/lib/auth")
      const token = await createSession(user.id)
      const req = new NextRequest("http://localhost/api/v1/test", {
        headers: { "x-session-token": token },
      })
      const userId = await requirePremium(req)
      expect(userId).toBeNull()

      await db.user.delete({ where: { id: user.id } })
    } finally {
      vi.useRealTimers()
    }
  })

  it("requirePremium ACCEPTS a fresh account inside its automatic trial month", async () => {
    const { requirePremium } = await import("@/lib/access")
    const user = await db.user.create({
      data: {
        email: `test-trial-${Date.now()}@example.com`,
        passwordHash: "test",
        role: "user",
        isActive: true,
      },
      select: { id: true },
    })

    const { createSession } = await import("@/lib/auth")
    const token = await createSession(user.id)
    const req = new NextRequest("http://localhost/api/v1/test", {
      headers: { "x-session-token": token },
    })
    const userId = await requirePremium(req)
    expect(userId).toBe(user.id)

    await db.user.delete({ where: { id: user.id } })
  })

  it("forbiddenResponse returns 403", async () => {
    const { forbiddenResponse } = await import("@/lib/access")
    const res = forbiddenResponse("Premium required.")
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("PREMIUM_REQUIRED")
  })
})

afterAll(async () => {
  await db.$disconnect()
})
