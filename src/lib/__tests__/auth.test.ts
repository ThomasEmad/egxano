import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PrismaClient } from "@prisma/client"
import { hashToken } from "@/lib/secure-compare"

// These suites are integration tests against a real Postgres (the dedicated
// schema-only Neon test project). When no test DB is configured (repo .env
// missing / TEST_DATABASE_URL unset), vitest falls back to a SQLite `file:`
// URL which the Postgres schema rejects — skip explicitly with the reason
// instead of failing with an opaque Prisma datasource validation error.
const testDbUrl = process.env.DATABASE_URL ?? ""
const hasTestDb = testDbUrl.startsWith("postgresql://") || testDbUrl.startsWith("postgres://")

const db = new PrismaClient()

describe.skipIf(!hasTestDb)("database-backed sessions", () => {
  it("creates and retrieves a session", async () => {
    const user = await db.user.create({
      data: {
        email: `test-session-${Date.now()}@example.com`,
        passwordHash: "test",
        role: "user",
        isActive: true,
      },
      select: { id: true },
    })

    const { createSession, getSessionUser, invalidateSession } = await import("@/lib/auth")
    const token = await createSession(user.id)
    expect(token).toBeTruthy()

    const fetchedUserId = await getSessionUser(token)
    expect(fetchedUserId).toBe(user.id)

    await invalidateSession(token)
    const afterInvalidation = await getSessionUser(token)
    expect(afterInvalidation).toBeNull()

    await db.user.delete({ where: { id: user.id } })
  })

  it("returns null for expired sessions", async () => {
    const user = await db.user.create({
      data: {
        email: `test-expiry-${Date.now()}@example.com`,
        passwordHash: "test",
        role: "user",
        isActive: true,
      },
      select: { id: true },
    })

    const { createSession, getSessionUser } = await import("@/lib/auth")
    const token = await createSession(user.id)

    await db.session.update({
      where: { token: hashToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const fetchedUserId = await getSessionUser(token)
    expect(fetchedUserId).toBeNull()

    await db.user.delete({ where: { id: user.id } })
  })
})

describe.skipIf(!hasTestDb)("admin sessions", () => {
  it("creates and validates an admin session", async () => {
    const { adminLogin, isAdmin } = await import("@/lib/admin-auth")
    process.env.ADMIN_PASSCODE = "test-admin-passcode"
    const token = await adminLogin("test-admin-passcode")
    expect(token).toBeTruthy()

    const admin = await isAdmin(new Request("http://localhost", { headers: { cookie: `egx_admin_session=${token}` } }))
    expect(admin).toBe(true)

    const notAdmin = await isAdmin(new Request("http://localhost"))
    expect(notAdmin).toBe(false)
  })
})

afterAll(async () => {
  await db.$disconnect()
})
