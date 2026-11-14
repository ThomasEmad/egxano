import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { requireAuth } from "@/lib/access"
import { checkEndpointRateLimit, getClientIp } from "@/lib/rate-limit"
import { audit } from "@/lib/audit"
import { ensurePushTables } from "@/lib/db-schema-bootstrap"

// POST /api/v1/push/subscribe — store the browser's Web Push subscription
// (body: { endpoint, keys: { p256dh, auth } }) so price alerts can reach the
// user even when the site is closed. The push table self-heals on first use
// (no migration access needed in every environment).
//
// Upsert keyed by endpoint: a browser re-subscribing (new keys after a push
// service rotation, another profile on the same install) re-points the same
// endpoint at the current user instead of failing on the unique constraint.

export async function POST(req: NextRequest) {
  const userId = await requireAuth(req)
  if (!userId) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })

  const rl = await checkEndpointRateLimit("push-subscribe", getClientIp(req))
  if (!rl.allowed) {
    return Response.json({ error: "RATE_LIMITED", message: "Too many changes — slow down a little." }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : ""
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : ""
  const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : ""

  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    return Response.json(
      { error: "VALIDATION", message: "endpoint (https) and keys.p256dh / keys.auth are required" },
      { status: 400 }
    )
  }

  try {
    await ensurePushTables()
    await db.pushSubscription.upsert({
      where: { endpoint },
      // endpoint ownership transfers to whoever currently holds the browser
      // subscription — the client that owns the endpoint IS the valid sender
      update: { userId, p256dh, auth },
      create: { userId, endpoint, p256dh, auth },
    })
  } catch (e) {
    console.warn("push subscribe failed:", e instanceof Error ? e.message.slice(0, 160) : String(e))
    return Response.json({ error: "PUSH_STORE_FAILED", message: "Could not save the subscription." }, { status: 500 })
  }

  await audit("PUSH_SUBSCRIBED", {
    actor: userId,
    entityType: "PushSubscription",
    entityId: endpoint.slice(0, 120),
  })

  return Response.json({ ok: true }, { status: 201 })
}
