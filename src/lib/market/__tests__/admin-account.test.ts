// =============================================================================
// Admin account login (owner mandate 2026-11-16): the owner logs in with an
// EMAIL + PASSWORD they chose, bootstrapped from ADMIN_EMAIL / ADMIN_PASSWORD
// on first login and persisted scrypt-hashed — the env password is never
// stored, and verification is timing-safe. Both login methods mint the SAME
// admin session, so every admin surface accepts either.
// =============================================================================

import { describe, expect, it } from "vitest"
import { hashAdminPassword, verifyAdminPassword } from "@/lib/admin-auth"

describe("admin account credentials", () => {
  it("hashes and verifies the owner's password (round trip)", async () => {
    const { salt, hash } = await hashAdminPassword("test-owner-password-123")
    expect(salt).toMatch(/^[0-9a-f]{32}$/)
    expect(hash).toMatch(/^[0-9a-f]{128}$/)
    await expect(verifyAdminPassword("test-owner-password-123", { salt, hash })).resolves.toBe(true)
  })

  it("rejects a wrong password without throwing", async () => {
    const { salt, hash } = await hashAdminPassword("correct-horse")
    await expect(verifyAdminPassword("wrong-battery", { salt, hash })).resolves.toBe(false)
  })

  it("produces a different hash per salt (no static rainbow column)", async () => {
    const a = await hashAdminPassword("same-password")
    const b = await hashAdminPassword("same-password")
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
  })

  it("verifies against a reloaded record (persistence shape is enough)", async () => {
    const { salt, hash } = await hashAdminPassword("roundtrip-check")
    // simulate the Setting JSON round trip
    const reloaded = JSON.parse(JSON.stringify({ salt, hash })) as { salt: string; hash: string }
    await expect(verifyAdminPassword("roundtrip-check", reloaded)).resolves.toBe(true)
  })
})
