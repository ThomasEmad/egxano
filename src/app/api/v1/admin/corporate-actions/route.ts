import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { isAdmin, unauthorizedResponse } from "@/lib/admin-auth"
import { audit } from "@/lib/audit"
import { invalidateServerCache } from "@/lib/server-cache"
import { detectSuspiciousGaps } from "@/lib/market/corporate-actions"

// Admin corporate-action ledger — the write path that feeds the automatic
// ex-date adjustment engine (src/lib/market/corporate-actions.ts).
//
// GET    ?companyId=…   → all actions of one company (desc by exDate, company joined)
// GET    (no params)    → latest 100 actions joined with company ticker/nameAr
// GET    ?detect=…      → suspicious >12% overnight drops on the company's
//                         PriceBar series vs the recorded action ex-dates
// POST                  → record a new action { companyId, actionType, … }
// PATCH                 → update an action { id, sharesPerShare?, exDate?, … }
// DELETE ?id=           → remove a wrong/manual action
//
// Recording an action here is enough: the adjustment engine applies it
// automatically on the ex-date (prev-close rebuild, technical-series
// de-adjust/re-adjust, rights TERP). No chart editing, ever.

const SOURCE_MANUAL_ADMIN = "MANUAL_ADMIN"
const ALLOWED_ACTION_TYPES = ["rights", "stock_dividend", "split", "cash_dividend"] as const
type AllowedActionType = (typeof ALLOWED_ACTION_TYPES)[number]

/** sharesPerShare → number|null straight from the BigInt pair (UI display). */
function sharesPerShareOf(r: { ratioNumerator: bigint | null; ratioDenominator: bigint | null }): number | null {
  if (r.ratioNumerator === null || r.ratioDenominator === null) return null
  const den = Number(r.ratioDenominator)
  if (!Number.isFinite(den) || den <= 0) return null
  const ratio = Number(r.ratioNumerator) / den
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null
}

// ── exact decimal → fraction ─────────────────────────────────────────────────
// Never via floats: parse the decimal STRING, scale by 10^decimals, reduce by
// gcd. 0.5→1/2, 1.5→3/2, 0.25→1/4, 2→2/1. A denominator above 10000 after
// reduction means the input has more precision than an EGX action ever needs —
// reject rather than store a wrong ratio.

function gcdBig(x: bigint, y: bigint): bigint {
  const zero = BigInt(0)
  if (x < zero) x = -x
  if (y < zero) y = -y
  while (y) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

/** Non-negative finite decimal string → reduced {numerator, denominator}. */
function decimalToFraction(input: string): { numerator: bigint; denominator: bigint } | null {
  const s = input.trim()
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const [intPart, decPart = ""] = s.split(".")
  if (!intPart && !decPart) return null
  const scale = BigInt(10) ** BigInt(decPart.length)
  const num = BigInt((intPart || "0") + decPart)
  const den = scale
  if (num <= BigInt(0)) return null
  const g = gcdBig(num, den)
  const denominator = den / g
  if (denominator > BigInt(10_000)) return null
  return { numerator: num / g, denominator }
}

function fractionOfSharesPerShare(v: unknown): { numerator: bigint; denominator: bigint } | null {
  // String bodies keep the admin's typed decimals exact ("0.35" stays 7/20);
  // JSON numbers round-trip through String() which is shortest-exact in JS.
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v <= 0) return null
    return decimalToFraction(String(v))
  }
  if (typeof v === "string") return decimalToFraction(v)
  return null
}

function isoDay(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : v
}

function statusFor(exDate: Date, now: Date = new Date()): string {
  return exDate.getTime() > now.getTime() ? "upcoming" : "executed"
}

const selectWithCompany = {
  id: true,
  companyId: true,
  actionType: true,
  exDate: true,
  ratioNumerator: true,
  ratioDenominator: true,
  cashPerShare: true,
  subscriptionPrice: true,
  status: true,
  sourceName: true,
  notes: true,
  createdAt: true,
  company: { select: { ticker: true, nameAr: true } },
} as const

function serializeAction(a: {
  id: string
  companyId: string
  actionType: string
  exDate: Date
  ratioNumerator: bigint | null
  ratioDenominator: bigint | null
  cashPerShare: number | null
  subscriptionPrice: number | null
  status: string | null
  sourceName: string
  notes: string | null
  createdAt: Date
  company: { ticker: string | null; nameAr: string | null }
}) {
  return {
    id: a.id,
    companyId: a.companyId,
    ticker: a.company.ticker,
    nameAr: a.company.nameAr,
    actionType: a.actionType,
    sharesPerShare: sharesPerShareOf(a),
    cashPerShare: a.cashPerShare,
    exDate: a.exDate,
    subscriptionPrice: a.subscriptionPrice,
    status: a.status,
    sourceName: a.sourceName,
    notes: a.notes,
    createdAt: a.createdAt,
  }
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return await unauthorizedResponse()
  const params = new URL(req.url).searchParams

  // Gap detector — audit the price series for unrecorded actions.
  const detectId = params.get("detect")
  if (detectId) {
    const [bars, actions] = await Promise.all([
      db.priceBar.findMany({ where: { companyId: detectId }, select: { ts: true, close: true }, orderBy: { ts: "asc" }, take: 2000 }),
      db.corporateAction.findMany({ where: { companyId: detectId }, select: { exDate: true } }),
    ])
    const gaps = detectSuspiciousGaps(
      bars.map((b) => ({ ts: b.ts, close: b.close })),
      actions.map((a) => a.exDate)
    )
    return Response.json({ ok: true, gaps })
  }

  const companyId = params.get("companyId")
  const rows = await db.corporateAction.findMany({
    where: companyId ? { companyId } : undefined,
    orderBy: { exDate: "desc" },
    ...(companyId ? {} : { take: 100 }),
    select: selectWithCompany,
  })
  return Response.json({ ok: true, actions: rows.map(serializeAction) })
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) return await unauthorizedResponse()
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 })
  }

  const { companyId, actionType, exDate, notes } = body
  if (!companyId || typeof companyId !== "string") {
    return Response.json({ error: "companyId required" }, { status: 400 })
  }
  if (!actionType || !ALLOWED_ACTION_TYPES.includes(actionType as AllowedActionType)) {
    return Response.json({ error: "actionType must be one of rights|stock_dividend|split|cash_dividend" }, { status: 400 })
  }
  const exISO = isoDay(exDate)
  if (!exISO) return Response.json({ error: "exDate must be YYYY-MM-DD" }, { status: 400 })

  const co = await db.company.findUnique({ where: { id: companyId }, select: { id: true, ticker: true } })
  if (!co) return Response.json({ error: "company not found" }, { status: 404 })

  const exDateDate = new Date(`${exISO}T00:00:00.000Z`)
  const type = actionType as AllowedActionType

  let ratio: { numerator: bigint; denominator: bigint } | null = null
  let cashPerShare: number | null = null
  let subscriptionPrice: number | null = null

  if (type === "cash_dividend") {
    const cash = Number(body.cashPerShare)
    if (!Number.isFinite(cash) || cash <= 0) {
      return Response.json({ error: "cash dividends need cashPerShare > 0 (التوزيعة النقدية للسهم)" }, { status: 400 })
    }
    cashPerShare = cash
  } else {
    ratio = fractionOfSharesPerShare(body.sharesPerShare)
    if (!ratio) {
      return Response.json({ error: "sharesPerShare must be a positive decimal (max 4 fractional digits after reduction)" }, { status: 400 })
    }
    if (type === "rights") {
      const sub = Number(body.subscriptionPrice)
      if (!Number.isFinite(sub) || sub <= 0) {
        return Response.json({ error: "rights issues need subscriptionPrice > 0 (سعر الاكتتاب)" }, { status: 400 })
      }
      subscriptionPrice = sub
    }
  }

  // Duplicate guard — same company + type + ex-date day already recorded by
  // the admin console (imports from FOUDALENS keep their own sourceId space).
  const dup = await db.corporateAction.findFirst({
    where: {
      companyId,
      actionType: type,
      sourceName: SOURCE_MANUAL_ADMIN,
      exDate: { gte: exDateDate, lt: new Date(exDateDate.getTime() + 86_400_000) },
    },
    select: { id: true },
  })
  if (dup) {
    return Response.json({ error: "duplicate: an admin action of this type already exists for this ex-date", actionId: dup.id }, { status: 409 })
  }

  const created = await db.corporateAction.create({
    data: {
      companyId,
      ticker: co.ticker, // display/debug only — the company relation is the source of truth
      actionType: type,
      exDate: exDateDate,
      ratioNumerator: ratio?.numerator ?? null,
      ratioDenominator: ratio?.denominator ?? null,
      cashPerShare,
      subscriptionPrice,
      currency: "EGP",
      status: statusFor(exDateDate),
      sourceName: SOURCE_MANUAL_ADMIN,
      sourceId: `admin-${Date.now()}`,
      isDemoData: false,
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    },
  })

  await audit("CORPORATE_ACTION_ADD", {
    actor: "admin",
    entityType: "CorporateAction",
    entityId: created.id,
    details: `${co.ticker} ${type} ex=${exISO} ratio=${ratio ? `${ratio.numerator}/${ratio.denominator}` : "—"} cash=${cashPerShare ?? "—"} sub=${subscriptionPrice ?? "—"}`,
  })
  invalidateServerCache()

  return Response.json({
    ok: true,
    action: serializeAction({ ...created, company: { ticker: co.ticker, nameAr: null } }),
  })
}

export async function PATCH(req: NextRequest) {
  if (!(await isAdmin(req))) return await unauthorizedResponse()
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 })
  }
  const { id } = body
  if (!id || typeof id !== "string") return Response.json({ error: "id required" }, { status: 400 })

  const existing = await db.corporateAction.findUnique({ where: { id }, include: { company: { select: { ticker: true } } } })
  if (!existing) return Response.json({ error: "action not found" }, { status: 404 })

  const data: {
    ratioNumerator?: bigint
    ratioDenominator?: bigint
    exDate?: Date
    subscriptionPrice?: number | null
    cashPerShare?: number | null
    status?: string
    notes?: string | null
  } = {}

  if (body.sharesPerShare !== undefined && body.sharesPerShare !== null) {
    if (existing.actionType === "cash_dividend") {
      return Response.json({ error: "cash dividends take cashPerShare, not sharesPerShare" }, { status: 400 })
    }
    const ratio = fractionOfSharesPerShare(body.sharesPerShare)
    if (!ratio) return Response.json({ error: "sharesPerShare must be a positive decimal" }, { status: 400 })
    data.ratioNumerator = ratio.numerator
    data.ratioDenominator = ratio.denominator
  }

  let exDateChanged = false
  if (body.exDate !== undefined && body.exDate !== null) {
    const exISO = isoDay(body.exDate)
    if (!exISO) return Response.json({ error: "exDate must be YYYY-MM-DD" }, { status: 400 })
    data.exDate = new Date(`${exISO}T00:00:00.000Z`)
    exDateChanged = data.exDate.getTime() !== existing.exDate.getTime()
  }

  if (body.subscriptionPrice !== undefined) {
    if (body.subscriptionPrice === null) data.subscriptionPrice = null
    else {
      const sub = Number(body.subscriptionPrice)
      if (!Number.isFinite(sub) || sub <= 0) return Response.json({ error: "subscriptionPrice must be > 0" }, { status: 400 })
      data.subscriptionPrice = sub
    }
  }

  if (body.cashPerShare !== undefined) {
    if (body.cashPerShare === null) data.cashPerShare = null
    else {
      const cash = Number(body.cashPerShare)
      if (!Number.isFinite(cash) || cash <= 0) return Response.json({ error: "cashPerShare must be > 0" }, { status: 400 })
      data.cashPerShare = cash
    }
  }

  if (body.status !== undefined && body.status !== null) {
    const status = String(body.status).trim()
    if (!status || status.length > 40) return Response.json({ error: "invalid status" }, { status: 400 })
    data.status = status
  } else if (exDateChanged) {
    // POST derives status from the ex-date — keep PATCH consistent when the
    // admin moves the ex-date without restating the status.
    data.status = statusFor(data.exDate as Date)
  }

  if (body.notes !== undefined) {
    data.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null
  }

  if (!Object.keys(data).length) return Response.json({ error: "nothing to update" }, { status: 400 })

  const updated = await db.corporateAction.update({ where: { id }, data })

  await audit("CORPORATE_ACTION_UPDATE", {
    actor: "admin",
    entityType: "CorporateAction",
    entityId: id,
    details: `${existing.company.ticker ?? existing.companyId} ${existing.actionType}: ${JSON.stringify({
      ...data,
      ratioNumerator: data.ratioNumerator?.toString(),
      ratioDenominator: data.ratioDenominator?.toString(),
      exDate: data.exDate?.toISOString().slice(0, 10),
    })}`,
  })
  invalidateServerCache()

  return Response.json({ ok: true, action: { ...updated, sharesPerShare: sharesPerShareOf(updated) } })
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdmin(req))) return await unauthorizedResponse()
  const id = new URL(req.url).searchParams.get("id")
  if (!id) return Response.json({ error: "id required" }, { status: 400 })

  const existing = await db.corporateAction.findUnique({ where: { id }, include: { company: { select: { ticker: true } } } })
  if (!existing) return Response.json({ error: "action not found" }, { status: 404 })

  await db.corporateAction.delete({ where: { id } })
  await audit("CORPORATE_ACTION_DELETE", {
    actor: "admin",
    entityType: "CorporateAction",
    entityId: id,
    details: `${existing.company.ticker ?? existing.companyId} ${existing.actionType} ex=${existing.exDate.toISOString().slice(0, 10)} source=${existing.sourceName}`,
  })
  invalidateServerCache()

  return Response.json({ ok: true })
}
