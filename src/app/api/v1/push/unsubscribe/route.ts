import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { requireAuth } from "@/lib/access"
import { checkEndpointRateLimit, getClientIp } from "@/lib/rate-limit"
import { ensurePushTables } from "@/lib/db-schema-bootstrap"

// POST /api/v1/push/unsubscribe  (DELETE accepted too — the client-side API
// surface reads more naturally as a DELETE) — remove a stored subscription.
// Body/query: { endpoint }.
//
// The delete is scoped to the CALLER's userId: knowing someone else's
// endpoint URL must not let you detach their browser from their alerts.

async function remove(req: NextRequest) {
  try {
    const userId = await requireAuth(req)
    if (!userId) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })

    const rl = await checkEndpointRateLimit("push-unsubscribe", getClientIp(req))
    if (!rl.allowed) {
      return Response.json({ error: "RATE_LIMITED", message: "Too many changes — slow down a little." }, { status: 429 })
    }

    let endpoint = ""
    if (req.method === "DELETE") endpoint = new URL(req.url).searchParams.get("endpoint") ?? ""
    if (!endpoint) {
      const body = await req.json().catch(() => ({}))
      endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : ""
    }
    if (!endpoint) {
      return Response.json({ error: "VALIDATION", message: "endpoint is required" }, { status: 400 })
    }

    // Lazily create the table so a disable-before-first-enable on a fresh DB
    // is a clean {removed: 0} instead of a 500.
    await ensurePushTables()
    const res = await db.pushSubscription.deleteMany({ where: { endpoint, userId } })
    return Response.json({ ok: true, removed: res.count })
  } catch (e) {
    console.warn("push unsubscribe failed:", e instanceof Error ? e.message.slice(0, 160) : String(e))
    return Response.json({ error: "PUSH_STORE_FAILED", message: "Could not remove the subscription." }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  return remove(req)
}

export async function DELETE(req: NextRequest) {
  return remove(req)
}
