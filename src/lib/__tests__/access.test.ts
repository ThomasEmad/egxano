import { describe, it, expect, beforeAll, afterAll } from "vitest"
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

  it("requirePremium rejects non-premium users", async () => {
    const { requirePremium } = await import("@/lib/access")
    const user = await db.user.create({
      data: {
        email: `test-nonpremium-${Date.now()}@example.com`,
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
    expect(userId).toBeNull()

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
