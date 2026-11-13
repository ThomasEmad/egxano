import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { isAdmin, unauthorizedResponse } from "@/lib/admin-auth"
import { audit } from "@/lib/audit"

// GET /api/v1/admin/plans
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return await unauthorizedResponse()
  const plans = await db.plan.findMany({ orderBy: { sortOrder: "asc" } })
  return Response.json({ plans })
}

// POST /api/v1/admin/plans
export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) return await unauthorizedResponse()
  try {
    const body = await req.json()
    const plan = await db.plan.create({
      data: {
        name: typeof body?.name === "string" ? body.name : "NEW",
        price: typeof body?.price === "number" ? body.price : 0,
        currency: typeof body?.currency === "string" ? body.currency : "EGP",
        durationDays: typeof body?.durationDays === "number" ? body.durationDays : 30,
        features: typeof body?.features === "string" ? body.features : "[]",
        isActive: body?.isActive !== false,
        isDefault: body?.isDefault === true,
        sortOrder: typeof body?.sortOrder === "number" ? body.sortOrder : 0,
      },
    })
    await audit("PLAN_CREATED", { actor: req.headers.get("x-admin-token") || "admin", entityType: "Plan", entityId: plan.id, details: `Created plan ${plan.name}` })
    return Response.json(plan, { status: 201 })
  } catch (e) {
    console.error("create plan error", e)
    return Response.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

// PATCH /api/v1/admin/plans — edit a plan row (price / first-month offer /
// duration / features / active flag). Used by /admin/plans.
//
// Validation: numeric fields must be finite and non-negative; features must
// serialize to a JSON array of strings (the client sends the textarea lines).
export async function PATCH(req: NextRequest) {
  if (!(await isAdmin(req))) return await unauthorizedResponse()

  let body: {
    id?: unknown
    price?: unknown
    offerPrice?: unknown
    offerActive?: unknown
    offerLabel?: unknown
    durationDays?: unknown
    features?: unknown
    isActive?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "INVALID_PAYLOAD", message: "Body must be JSON." }, { status: 400 })
  }

  const id = typeof body.id === "string" ? body.id : ""
  if (!id) return Response.json({ error: "INVALID_PAYLOAD", message: "id is required." }, { status: 400 })

  const existing = await db.plan.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!existing) return Response.json({ error: "NOT_FOUND", message: "Plan not found." }, { status: 404 })

  // --- build the validated update set ---
  const data: {
    price?: number
    offerPrice?: number | null
    offerActive?: boolean
    offerLabel?: string | null
    durationDays?: number
    features?: string
    isActive?: boolean
  } = {}

  if (body.price !== undefined) {
    const price = Number(body.price)
    if (!Number.isFinite(price) || price < 0) {
      return Response.json({ error: "VALIDATION", message: "price must be a non-negative number." }, { status: 400 })
    }
    data.price = price
  }

  if (body.offerPrice !== undefined) {
    if (body.offerPrice === null) {
      data.offerPrice = null
    } else {
      const offerPrice = Number(body.offerPrice)
      if (!Number.isFinite(offerPrice) || offerPrice < 0) {
        return Response.json({ error: "VALIDATION", message: "offerPrice must be a non-negative number or null." }, { status: 400 })
      }
      data.offerPrice = offerPrice
    }
  }

  if (body.offerActive !== undefined) {
    if (typeof body.offerActive !== "boolean") {
      return Response.json({ error: "VALIDATION", message: "offerActive must be a boolean." }, { status: 400 })
    }
    data.offerActive = body.offerActive
  }

  if (body.offerLabel !== undefined) {
    if (body.offerLabel === null) {
      data.offerLabel = null
    } else if (typeof body.offerLabel === "string") {
      data.offerLabel = body.offerLabel.trim().slice(0, 120) || null
    } else {
      return Response.json({ error: "VALIDATION", message: "offerLabel must be a string or null." }, { status: 400 })
    }
  }

  if (body.durationDays !== undefined) {
    const durationDays = Number(body.durationDays)
    if (!Number.isInteger(durationDays) || durationDays < 0) {
      return Response.json({ error: "VALIDATION", message: "durationDays must be a non-negative integer." }, { status: 400 })
    }
    data.durationDays = durationDays
  }

  if (body.features !== undefined) {
    let list: unknown[] | null = null
    if (Array.isArray(body.features)) {
      list = body.features
    } else if (typeof body.features === "string") {
      try {
        const parsed = JSON.parse(body.features)
        if (Array.isArray(parsed)) list = parsed
      } catch {
        // fall through — plain string is rejected below
      }
    }
    if (!list || list.some((f) => typeof f !== "string")) {
      return Response.json({ error: "VALIDATION", message: "features must be a JSON array of strings (one feature per line in the editor)." }, { status: 400 })
    }
    data.features = JSON.stringify(list)
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      return Response.json({ error: "VALIDATION", message: "isActive must be a boolean." }, { status: 400 })
    }
    data.isActive = body.isActive
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "VALIDATION", message: "No editable fields provided." }, { status: 400 })
  }

  try {
    const plan = await db.plan.update({ where: { id }, data })
    await audit("PLAN_UPDATED", {
      actor: "admin",
      entityType: "Plan",
      entityId: plan.id,
      details: `Updated plan ${plan.name}: ${Object.keys(data).join(", ")}`,
    })
    return Response.json({ ok: true, plan })
  } catch (e) {
    console.error("update plan error", e)
    return Response.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
