import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { adminLogin, adminLoginWithCredentials, setAdminCookie, clearAdminCookie, getAdminTokenFromRequest } from "@/lib/admin-auth"
import { hashToken } from "@/lib/secure-compare"
import { audit } from "@/lib/audit"
import { checkEndpointRateLimit, getClientIp } from "@/lib/rate-limit"

// POST /api/v1/admin/login — exchange the admin passcode OR the admin
// account's email + password for a session cookie (owner mandate 2026-11-16:
// the owner logs in with an ACCOUNT they chose, every admin surface accepts
// either minted session identically).
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req)
    const rateLimit = await checkEndpointRateLimit("auth-admin-login", ip)
    if (!rateLimit.allowed) {
      const retryAfter = Math.ceil((rateLimit.resetAt - Date.now()) / 1000)
      return Response.json(
        { error: "RATE_LIMITED", message: "Too many admin login attempts. Please try again later.", retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      )
    }

    const body = await req.json().catch(() => null)
    const viaAccount = typeof body?.email === "string" && body.email.trim() !== ""
    const token = viaAccount
      ? await adminLoginWithCredentials(body?.email, body?.password)
      : await adminLogin(body?.passcode)
    if (!token) {
      await audit("ADMIN_LOGIN_FAILED", {
        actor: "unknown",
        details: viaAccount ? "Invalid admin email/password" : "Invalid admin passcode",
      })
      return Response.json(
        { error: viaAccount ? "INVALID_CREDENTIALS" : "INVALID_PASSCODE", message: viaAccount ? "الإيميل أو كلمة المرور غير صحيحة" : "Invalid admin passcode" },
        { status: 401 },
      )
    }

    const session = await db.adminSession.findUnique({
      where: { token: hashToken(token) },
      select: { expiresAt: true },
    })

    await audit("ADMIN_LOGIN", { actor: "admin", details: "Admin session started" })

    const cookieResponse = setAdminCookie(token, session?.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000))
    const headers = new Headers()
    const setCookie = cookieResponse.headers.get("Set-Cookie")
    if (setCookie) headers.set("Set-Cookie", setCookie)
    return Response.json({ success: true }, { headers })
  } catch (e) {
    console.error("admin login error", e)
    return Response.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

// POST /api/v1/admin/logout — clear the admin session cookie.
export async function DELETE(req: NextRequest) {
  try {
    const token = getAdminTokenFromRequest(req)
    if (token) {
      await db.adminSession.delete({ where: { token: hashToken(token) } }).catch(() => {})
      await audit("ADMIN_LOGOUT", { actor: "admin", details: "Admin session ended" })
    }
    return clearAdminCookie()
  } catch (e) {
    console.error("admin logout error", e)
    return clearAdminCookie()
  }
}
