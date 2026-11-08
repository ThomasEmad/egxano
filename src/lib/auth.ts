// User authentication helpers (session-based, database-backed tokens).

import { randomUUID } from "node:crypto"
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"
import { hashToken } from "@/lib/secure-compare"

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// Server components (e.g. the printable report page) resolve the session from
// this cookie. The server — not client JS — sets it (HttpOnly + Secure), so a
// successful XSS can neither read the token nor replay it into the header
// flow. Client JS keeps its localStorage copy for the `x-session-token`
// header used by the client-side data layer.
export const USER_SESSION_COOKIE = "egx-user-token"

/** Set-Cookie value for a fresh session (lifetime matches SESSION_TTL_MS). */
export function sessionCookieHeader(token: string): string {
  return `${USER_SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`
}

/** Set-Cookie value that clears the session cookie. */
export function clearSessionCookieHeader(): string {
  return `${USER_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export async function createUser(email: string, password: string, name?: string): Promise<{ id: string; email: string }> {
  const passwordHash = await hashPassword(password)
  const user = await db.user.create({
    data: {
      email: email.toLowerCase().trim(),
      passwordHash,
      name: name ?? null,
      role: "user",
    },
    select: { id: true, email: true },
  })
  return user
}

export async function authenticateUser(email: string, password: string): Promise<{ id: string; email: string; role: string } | null> {
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, email: true, passwordHash: true, role: true, isActive: true },
  })
  if (!user || !user.isActive) return null
  // OAuth-only accounts (Google/Facebook sign-ups) have no local password —
  // they cannot authenticate with email+password until they set one.
  if (!user.passwordHash) return null
  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) return null
  return { id: user.id, email: user.email, role: user.role }
}

export async function createSession(userId: string): Promise<string> {
  const token = randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  // Store only the SHA-256 hash of the token (same model as admin sessions) —
  // the raw token lives only in the client's request header.
  await db.session.create({
    data: { userId, token: hashToken(token), expiresAt },
  })
  return token
}

export async function getSessionUser(token: string | null): Promise<string | null> {
  if (!token) return null
  const key = hashToken(token)
  // Hot-path cache: every authenticated request used to cost a DB round-trip
  // just for auth — under load (thousands of concurrent readers) that alone
  // saturates the connection pool. A short TTL keeps logout semantics intact
  // (the invalidators below clear the cache in the same process), while
  // repeat reads of the same session cost zero DB.
  const hit = sessionCache.get(key)
  if (hit) {
    if (hit.expiresAt < new Date()) {
      sessionCache.delete(key)
      return null
    }
    // bounded staleness: revalidate against the DB every 5 minutes so a
    // revocation performed in another process converges quickly
    if (Date.now() - hit.cachedAt > 5 * 60_000) {
      sessionCache.delete(key)
    } else {
      return hit.userId
    }
  }
  const session = await db.session.findUnique({
    where: { token: key },
    select: { userId: true, expiresAt: true },
  })
  if (!session) return null
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { token: key } }).catch(() => {})
    return null
  }
  sessionCache.set(key, { userId: session.userId, expiresAt: session.expiresAt, cachedAt: Date.now() })
  if (sessionCache.size > 10_000) {
    // bound memory: drop the oldest quarter when the cache grows too large
    const entries = [...sessionCache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt)
    for (let i = 0; i < Math.floor(entries.length / 4); i++) sessionCache.delete(entries[i][0])
  }
  return session.userId
}

interface CachedSession {
  userId: string
  expiresAt: Date
  cachedAt: number
}
const sessionCache = new Map<string, CachedSession>()

export function clearSessionCache(token?: string | null, userId?: string): void {
  if (token) sessionCache.delete(hashToken(token))
  if (userId) {
    for (const [k, v] of sessionCache) if (v.userId === userId) sessionCache.delete(k)
  }
}

export async function invalidateSession(token: string | null): Promise<void> {
  clearSessionCache(token)
  if (!token) return
  await db.session.delete({ where: { token: hashToken(token) } }).catch(() => {})
}

export async function invalidateUserSessions(userId: string): Promise<void> {
  clearSessionCache(null, userId)
  await db.session.deleteMany({ where: { userId } }).catch(() => {})
}

export async function cleanupExpiredSessions(): Promise<void> {
  await db.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  }).catch(() => {})
}
