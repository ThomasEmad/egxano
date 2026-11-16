// Admin authentication gate.
// Sessions are database-backed and stored in HttpOnly Secure SameSite cookies.
//
// Two login methods (owner mandate 2026-11-16 — "حساب أدمن أسجل بيه"):
//   • the legacy ADMIN_PASSCODE one-liner, and
//   • a full admin ACCOUNT (email + password) bootstrapped from the
//     ADMIN_EMAIL / ADMIN_PASSWORD environment variables on the first login
//     and persisted hashed in the Setting table (scrypt, timing-safe compare).
// Both methods mint the SAME admin session cookie, so every admin surface
// (/admin/*, the live value editor, corporate actions, …) accepts either.

import { randomUUID, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import { cookies } from "next/headers"
import { db } from "@/lib/db"
import { hashToken, secureCompare } from "@/lib/secure-compare"

const scrypt = promisify(scryptCb) as (password: string | Buffer, salt: string | Buffer, keylen: number) => Promise<Buffer>

const ADMIN_ACCOUNT_KEY = "admin-account"
const SCRYPT_KEYLEN = 64

export interface AdminAccountRecord {
  email: string
  salt: string // hex
  hash: string // hex
  createdAt: string
}

/** scrypt hash in the persisted `salt$hash` hex form (exported for tests). */
export async function hashAdminPassword(password: string, saltHex?: string): Promise<{ salt: string; hash: string }> {
  const salt = saltHex ?? randomBytes(16).toString("hex")
  const derived = await scrypt(password, Buffer.from(salt, "hex"), SCRYPT_KEYLEN)
  return { salt, hash: derived.toString("hex") }
}

/** Constant-time password verification against the persisted record. */
export async function verifyAdminPassword(password: string, record: { salt: string; hash: string }): Promise<boolean> {
  try {
    const derived = await scrypt(password, Buffer.from(record.salt, "hex"), SCRYPT_KEYLEN)
    const stored = Buffer.from(record.hash, "hex")
    if (stored.length !== derived.length) return false
    return timingSafeEqual(derived, stored)
  } catch {
    return false
  }
}

async function readAdminAccount(): Promise<AdminAccountRecord | null> {
  try {
    const row = await db.setting.findUnique({ where: { key: ADMIN_ACCOUNT_KEY }, select: { value: true } })
    if (!row?.value) return null
    const parsed = JSON.parse(row.value) as AdminAccountRecord
    if (!parsed?.email || !parsed.salt || !parsed.hash) return null
    return parsed
  } catch {
    return null
  }
}

async function writeAdminAccount(record: AdminAccountRecord): Promise<void> {
  await db.setting.upsert({
    where: { key: ADMIN_ACCOUNT_KEY },
    create: { key: ADMIN_ACCOUNT_KEY, value: JSON.stringify(record), type: "json", description: "Admin account (email + scrypt password hash)" },
    update: { value: JSON.stringify(record) },
  })
}

/**
 * Email + password admin login. On the FIRST call with ADMIN_EMAIL /
 * ADMIN_PASSWORD set in the environment, the account is bootstrapped
 * (persisted scrypt-hashed — the env password is never stored) and the
 * verification proceeds against the persisted record, so rotating the env
 * later does NOT silently change credentials unless the account is recreated.
 */
export async function adminLoginWithCredentials(email: unknown, password: unknown): Promise<string | null> {
  const em = typeof email === "string" ? email.trim().toLowerCase() : ""
  const pw = typeof password === "string" ? password : ""
  if (!em || !pw || em.length > 254) return null
  const envEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const envPassword = process.env.ADMIN_PASSWORD
  let record = await readAdminAccount()
  if (!record && envEmail && envPassword && em === envEmail) {
    const { salt, hash } = await hashAdminPassword(envPassword)
    record = { email: envEmail, salt, hash, createdAt: new Date().toISOString() }
    await writeAdminAccount(record)
  }
  if (!record) return null
  if (em !== record.email) return null
  const ok = await verifyAdminPassword(pw, record)
  if (!ok) return null
  return createAdminSession()
}

/** Mint a fresh DB-backed admin session token (shared by both login methods). */
export async function createAdminSession(): Promise<string> {
  // Housekeeping: drop expired sessions so the table never grows unbounded.
  await db.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {})
  const token = randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  // Store only the SHA-256 hash of the token — a DB leak must not yield
  // working sessions. The raw token exists once, in the Set-Cookie header.
  await db.adminSession.create({
    data: { token: hashToken(token), expiresAt },
  })
  return token
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const COOKIE_NAME = "egx_admin_session"
const COOKIE_PATH = "/"

function passcode(): string {
  const envPasscode = process.env.ADMIN_PASSCODE
  if (!envPasscode) {
    throw new Error("ADMIN_PASSCODE environment variable is not set")
  }
  return envPasscode
}

export async function adminLogin(input: string | undefined): Promise<string | null> {
  // Timing-safe comparison — plain `!==` leaks prefix timing on the passcode.
  if (!input || !secureCompare(input, passcode())) return null
  return createAdminSession()
}

export async function isAdmin(req: Request): Promise<boolean> {
  const token = getAdminTokenFromRequest(req)
  if (!token) return false
  const session = await db.adminSession.findUnique({
    where: { token: hashToken(token) },
    select: { expiresAt: true },
  })
  if (!session) return false
  if (session.expiresAt < new Date()) {
    await db.adminSession.delete({ where: { token: hashToken(token) } }).catch(() => {})
    return false
  }
  return true
}

/** Server-component variant: reads the session from the Next.js cookie store. */
export async function isAdminServer(): Promise<boolean> {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  if (!token) return false
  const session = await db.adminSession.findUnique({
    where: { token: hashToken(token) },
    select: { expiresAt: true },
  })
  if (!session) return false
  if (session.expiresAt < new Date()) return false
  return true
}

export function getAdminTokenFromRequest(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie")
  if (!cookieHeader) return null
  const cookies = cookieHeader.split(";").map((c) => c.trim().split("="))
  for (const [name, value] of cookies) {
    if (name === COOKIE_NAME) return decodeURIComponent(value)
  }
  return null
}

export function setAdminCookie(token: string, expiresAt: Date): Response {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
  const cookie = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=${COOKIE_PATH}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Strict`,
    `Max-Age=${maxAge}`,
    `Expires=${expiresAt.toUTCString()}`,
  ].join("; ")
  return new Response(null, {
    headers: {
      "Set-Cookie": cookie,
    },
  })
}

export function clearAdminCookie(): Response {
  const cookie = [
    `${COOKIE_NAME}=`,
    `Path=${COOKIE_PATH}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Strict`,
    `Max-Age=0`,
    `Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  ].join("; ")
  return new Response(null, {
    headers: {
      "Set-Cookie": cookie,
    },
  })
}

export async function unauthorizedResponse(): Promise<Response> {
  return Response.json(
    { error: "ADMIN_AUTH_REQUIRED", message: "This action requires admin authentication." },
    { status: 401 }
  )
}
