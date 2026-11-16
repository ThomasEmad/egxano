import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { isAdmin, unauthorizedResponse } from "@/lib/admin-auth"
import { audit } from "@/lib/audit"
import { invalidateServerCache } from "@/lib/server-cache"
import {
  clearAdminPriceOverride,
  getAdminPriceOverride,
  setAdminPriceOverride,
  unitMultiplier,
} from "@/lib/market/price-override"
import { effectiveEgxSessionDate } from "@/lib/market/egx-session"

// =============================================================================
// GET/PATCH /api/v1/admin/company-values — the owner's live value editor.
//
// Owner mandate (2026-11-16): the admin can edit ANY financial value by hand
// directly from the company page — the current price, recent candle bars, and
// the financial statement values — and every surface reflects the change LIVE
// (server caches invalidated on each write; the price override is applied at
// READ time so no ingestion can clobber it). Users never see any marker that
// a value was hand-set — the edited value IS the site's value. Every write is
// recorded in the audit log for the owner's own traceability.
// =============================================================================

const BAR_SELECT = { id: true, ts: true, open: true, high: true, low: true, close: true, volume: true, sourceName: true }

async function loadEditorPayload(companyId: string, reportId?: string | null) {
  const [company, latestPrice, bars] = await Promise.all([
    db.company.findUnique({ where: { id: companyId }, select: { id: true, ticker: true, nameEn: true, nameAr: true, sharesOutstanding: true } }),
    db.marketPrice.findFirst({ where: { companyId }, orderBy: { asOf: "desc" }, take: 1, select: { asOf: true, price: true, volume: true, sourceName: true } }),
    db.priceBar.findMany({ where: { companyId }, orderBy: { ts: "desc" }, take: 15, select: BAR_SELECT }),
  ])
  if (!company) return null

  const reports = await db.financialReport.findMany({
    where: { companyId, processingStatus: { in: ["VALIDATED", "APPROVED", "EXTRACTED"] }, deletedAt: null },
    orderBy: [{ periodEnd: "desc" }, { statementType: "asc" }],
    take: 10,
    select: { id: true, periodLabel: true, periodType: true, statementType: true, fiscalYear: true, periodEnd: true },
  })
  const chosen = reportId && reports.some((r) => r.id === reportId) ? reportId : reports[0]?.id ?? null
  const values = chosen
    ? await db.financialValue.findMany({
        where: { reportId: chosen },
        orderBy: [{ statementType: "asc" }, { displayOrder: "asc" }],
        select: { id: true, metricCode: true, originalLabel: true, value: true, unit: true, normalizedValue: true, statementType: true, group: true, extractionMethod: true },
      })
    : []

  const override = await getAdminPriceOverride(companyId)

  return {
    company,
    price: latestPrice
      ? { asOf: latestPrice.asOf.toISOString(), price: latestPrice.price, volume: latestPrice.volume, sourceName: latestPrice.sourceName }
      : null,
    override,
    bars: bars.map((b) => ({ ...b, ts: b.ts.toISOString().slice(0, 10) })),
    reports: reports.map((r) => ({ ...r, periodEnd: r.periodEnd.toISOString() })),
    selectedReportId: chosen,
    values,
  }
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return await unauthorizedResponse()
  const companyId = new URL(req.url).searchParams.get("companyId") ?? ""
  const reportId = new URL(req.url).searchParams.get("reportId")
  if (!companyId) return Response.json({ error: "INVALID_PAYLOAD", message: "companyId is required." }, { status: 400 })
  const payload = await loadEditorPayload(companyId, reportId)
  if (!payload) return Response.json({ error: "NOT_FOUND", message: "Company not found." }, { status: 404 })
  return Response.json(payload)
}

interface PatchBody {
  companyId?: unknown
  kind?: unknown
  // kind=price
  price?: unknown
  volume?: unknown
  clearOverride?: unknown
  // kind=bar
  ts?: unknown
  open?: unknown
  high?: unknown
  low?: unknown
  close?: unknown
  // kind=financial
  valueId?: unknown
  value?: unknown
}

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function PATCH(req: NextRequest) {
  if (!(await isAdmin(req))) return await unauthorizedResponse()

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return Response.json({ error: "INVALID_PAYLOAD", message: "Body must be JSON." }, { status: 400 })
  }

  const companyId = typeof body.companyId === "string" ? body.companyId : ""
  const kind = typeof body.kind === "string" ? body.kind : ""
  if (!companyId || !kind) return Response.json({ error: "INVALID_PAYLOAD", message: "companyId and kind are required." }, { status: 400 })

  const company = await db.company.findUnique({ where: { id: companyId }, select: { id: true, ticker: true } })
  if (!company) return Response.json({ error: "NOT_FOUND", message: "Company not found." }, { status: 404 })

  const tick = async (before: string, after: string, entity: string): Promise<void> => {
    await audit("ADMIN_VALUE_OVERRIDE", {
      actor: "admin-session",
      entityType: entity,
      entityId: `${company.ticker}:${entity}`,
      details: `${before} → ${after}`,
    })
    invalidateServerCache()
  }

  try {
    // ---- current price override ----
    if (kind === "price") {
      if (body.clearOverride === true) {
        await clearAdminPriceOverride(companyId)
        await tick("override", "market feed", "price")
        return Response.json({ ok: true, cleared: true })
      }
      const price = num(body.price)
      if (price === null || price <= 0) {
        return Response.json({ error: "VALIDATION", message: "price must be a positive number." }, { status: 400 })
      }
      const volume = body.volume === null || body.volume === undefined || body.volume === "" ? null : num(body.volume)
      if (volume !== null && volume <= 0) {
        return Response.json({ error: "VALIDATION", message: "volume must be a positive number or null." }, { status: 400 })
      }
      const feedRow = await db.marketPrice.findFirst({ where: { companyId }, orderBy: { asOf: "desc" }, take: 1, select: { price: true } })
      const ov = await setAdminPriceOverride(companyId, price, volume)
      // ALSO write the feed row for TODAY so the day-bucket series and any
      // direct MarketPrice reader see the value even before the override pass:
      // upsert the session-day MarketPrice + patch today's PriceBar close.
      const today = effectiveEgxSessionDate(new Date())
      const asOf = new Date(`${today}T00:00:00.000Z`)
      await db.marketPrice.upsert({
        where: { companyId_asOf: { companyId, asOf } },
        create: { companyId, asOf, price, volume, currency: "EGP", sourceName: "TRADINGVIEW_SCANNER", isDemoData: false, notes: "owner-set session price (audited)" },
        update: { price, volume, notes: "owner-set session price (audited)" },
      })
      const existingBar = await db.priceBar.findUnique({ where: { companyId_ts: { companyId, ts: asOf } } })
      if (existingBar) {
        await db.priceBar.update({
          where: { companyId_ts: { companyId, ts: asOf } },
          data: {
            close: price,
            high: Math.max(existingBar.high, price),
            low: Math.min(existingBar.low, price),
            volume: volume ?? existingBar.volume,
          },
        })
      } else {
        await db.priceBar.create({
          data: { companyId, ts: asOf, open: price, high: price, low: price, close: price, volume, currency: "EGP", sourceName: "TRADINGVIEW_SCANNER", isDemoData: false },
        })
      }
      await tick(String(feedRow?.price ?? "feed"), String(price), "price")
      return Response.json({ ok: true, override: ov })
    }

    // ---- one historical bar ----
    if (kind === "bar") {
      const ts = typeof body.ts === "string" && body.ts.length === 10 ? body.ts : ""
      const [open, high, low, close] = [num(body.open), num(body.high), num(body.low), num(body.close)]
      if (!ts || open === null || high === null || low === null || close === null) {
        return Response.json({ error: "VALIDATION", message: "bar needs ts + open/high/low/close numbers." }, { status: 400 })
      }
      if (high < low || high < Math.max(open, close) || low > Math.min(open, close)) {
        return Response.json({ error: "VALIDATION", message: "bar geometry invalid: low ≤ open/close ≤ high." }, { status: 400 })
      }
      const volume = body.volume === undefined ? undefined : body.volume === null || body.volume === "" ? null : num(body.volume)
      const asOf = new Date(`${ts}T00:00:00.000Z`)
      const prev = await db.priceBar.findUnique({ where: { companyId_ts: { companyId, ts: asOf } }, select: { open: true, high: true, low: true, close: true, volume: true } })
      await db.priceBar.upsert({
        where: { companyId_ts: { companyId, ts: asOf } },
        create: { companyId, ts: asOf, open, high, low, close, volume: volume ?? null, currency: "EGP", sourceName: "ADMIN_EDIT", isDemoData: false },
        update: { open, high, low, close, ...(volume === undefined ? {} : { volume }), sourceName: "ADMIN_EDIT" },
      })
      await tick(
        prev ? `O${prev.open} H${prev.high} L${prev.low} C${prev.close}` : "new bar",
        `O${open} H${high} L${low} C${close}`,
        `bar:${ts}`,
      )
      return Response.json({ ok: true })
    }

    // ---- one financial statement value ----
    if (kind === "financial") {
      const valueId = typeof body.valueId === "string" ? body.valueId : ""
      const value = num(body.value)
      if (!valueId || value === null) {
        return Response.json({ error: "VALIDATION", message: "financial edit needs valueId + a finite value." }, { status: 400 })
      }
      const row = await db.financialValue.findUnique({ where: { id: valueId }, select: { id: true, companyId: true, reportId: true, metricCode: true, value: true, unit: true, normalizedValue: true } })
      if (!row || row.companyId !== companyId) {
        return Response.json({ error: "NOT_FOUND", message: "Financial value not found for this company." }, { status: 404 })
      }
      const mult = unitMultiplier(row.unit)
      await db.financialValue.update({
        where: { id: valueId },
        data: { value, normalizedValue: value * mult, extractionMethod: "MANUAL_ENTRY" },
      })
      await tick(`${row.metricCode}=${row.value}`, `${row.metricCode}=${value}`, "financial")
      // live metric refresh: the calculated-metrics read model rebuilds NOW so
      // ratios/valuation pages reflect the edited figure immediately
      const { recomputeCompany } = await import("@/lib/financial/recompute")
      void recomputeCompany(companyId)
        .catch(() => {})
        .finally(() => invalidateServerCache())
      return Response.json({ ok: true })
    }

    return Response.json({ error: "INVALID_PAYLOAD", message: `unknown kind "${kind}".` }, { status: 400 })
  } catch (e) {
    console.error("admin company-values PATCH error", e)
    return Response.json({ error: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "failed." }, { status: 500 })
  }
}

