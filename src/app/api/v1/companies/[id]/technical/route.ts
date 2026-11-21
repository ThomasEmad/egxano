import { NextRequest } from "next/server"
import { findCompanyByKey } from "@/lib/company-lookup"
import { buildTechnicalBundleWithContext } from "@/lib/market/intelligence/context"
import { computeStanceFromSnapshot, type TechStance } from "@/lib/technical/signals"
import { getCachedMarketSignals, companyOpportunityFromRows } from "@/lib/technical/signals-service"
import { getCompanySignalV2Cached } from "@/lib/signals/board-service"
import { cached } from "@/lib/server-cache"
import { getCanonicalStance } from "@/lib/technical/stance-store"
import { getSessionUser, USER_SESSION_COOKIE } from "@/lib/auth"
import { getActivePlanId } from "@/lib/subscription"
import { isFreeSignalTicker, isPaidPlanId } from "@/lib/plans/entitlements"

// GET /api/v1/companies/[id]/technical — THE canonical technical analysis.
//
// SINGLE SOURCE OF TRUTH (2026-11-14): the stance (reading + trade plan +
// invalidation) is computed ONCE and PERSISTED via the canonical stance store.
// The /signals board reads the exact same persisted row, so the board's stop
// and the company page's stop are the same number by construction — the old
// close-based-plan-vs-snapshot-plan discrepancy is structurally impossible.
//
// ENTITLEMENT GATE (backend, not UI): free/anonymous users may read technical
// analysis ONLY for the fixed free-access set. Any other ticker returns 403
// with ZERO payload — no levels, no zones, no chart data, no ticker list leak.
// Cached 10 minutes per company; a recompute/price import clears the cache.

export const maxDuration = 30

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const company = await findCompanyByKey(id, { id: true, ticker: true })
  if (!company) return Response.json({ error: "NOT_FOUND" }, { status: 404 })

  // ---- entitlement gate (fixed free set) ----
  // TOKEN SOURCES: header first, then the HttpOnly session cookie (same
  // fallback rationale as the /signals board — 2026-11-14 live-bug fix: the
  // client's company-technical fetch ships without the header, which 403'd
  // paying subscribers on every non-free ticker; the same-origin cookie
  // restores the real tier, and logout clears the cookie server-side).
  const headerToken = req.headers.get("x-session-token") ?? req.headers.get("authorization")
  const token = headerToken
    ? headerToken.startsWith("Bearer ")
      ? headerToken.slice(7)
      : headerToken
    : (req.cookies.get(USER_SESSION_COOKIE)?.value ?? null)
  const userId = await getSessionUser(token)
  const plan = userId ? await getActivePlanId(userId) : "FREE"
  const paid = isPaidPlanId(plan)
  if (!paid && !isFreeSignalTicker(company.ticker ?? "")) {
    return Response.json(
      {
        error: "PREMIUM_REQUIRED",
        message: "التحليل الفني الكامل لكل الشركات متاح مع باقة Pro.",
        plan,
      },
      { status: 403, headers: { "cache-control": "no-store" } },
    )
  }

  const payload = await cached(`technical-tab:${company.id}`, 10 * 60_000, async () => {
    const bundle = await buildTechnicalBundleWithContext(company.id)
    // THE canonical persisted stance — identical to what the /signals board
    // displays for this ticker (same row, same levels, same invalidation).
    // DEGRADE, NEVER 500 (2026-11-14 post-deploy fix): if the snapshot store
    // is unavailable (bootstrap DDL failed, transient DB error) the SAME
    // stance is recomputed in-memory from the identical bundle — the tab
    // keeps rendering instead of dying; the number just isn't persisted.
    let canonical: { stance: TechStance; dataAsOf: Date; persisted: boolean }
    try {
      canonical = await getCanonicalStance(company.id)
    } catch (e) {
      console.error(
        "canonical stance store unavailable — computing in-memory:",
        e instanceof Error ? e.message.slice(0, 200) : e,
      )
      canonical = {
        stance: computeStanceFromSnapshot(bundle.snapshot),
        dataAsOf: bundle.snapshot.asOf ? new Date(bundle.snapshot.asOf) : new Date(0),
        persisted: false,
      }
    }
    // The market board read for this ticker (10-min cached whole-market pass —
    // cheap to touch here). Since the board now overlays the same canonical
    // stance, boardSignal and stance agree by construction. The SAME row also
    // carries the opportunity layer (opportunity@1) for candidate rows — the
    // strip and this tab render the identical layer for one ticker (single
    // source, built on the company's stored daily candles in the board's
    // shared compute; null when the row is not a candidate — honest "none").
    let boardSignal: { signal: "buy" | "hold" | "sell"; score: number; asOf: string | null } | null = null
    let opportunity: import("@/lib/technical/signals-service").RowOpportunity | null = null
    try {
      const board = await getCachedMarketSignals()
      const row = board.rows.find((r) => r.ticker === company.ticker)
      if (row?.signal && row.score !== null) {
        boardSignal = { signal: row.signal, score: row.score, asOf: row.asOf ?? null }
      }
      if (row && company.ticker) {
        opportunity = companyOpportunityFromRows(board.rows, company.ticker)
      }
    } catch {
      boardSignal = null
      opportunity = null
    }
    // The REBUILT engine's row (tech-signals@7) for this company — the SAME
    // row the /signals board publishes, so the company tab's stance card and
    // the board can never disagree again (one engine, one score, one plan).
    // SINGLE-COMPANY compute (2026-11-16): the route used to wait on the
    // whole-universe board build and cold-started into 504s — a company page
    // must never pay for the entire market. null only when the single-company
    // compute is unavailable — the v1 stance card keeps rendering as fallback.
    let signalsV2: import("@/lib/signals/types").SignalRowV2 | null = null
    try {
      signalsV2 = await getCompanySignalV2Cached(company.id)
    } catch {
      signalsV2 = null
    }
    return {
      snapshot: bundle.snapshot,
      hash: bundle.hash.slice(0, 16),
      // Adjusted daily candles for the client chart (corporate-action
      // continuity) — compact series, already capped in the bundle.
      candles: bundle.candles,
      stance: canonical.stance,
      stanceDataAsOf: canonical.dataAsOf.toISOString(),
      boardSignal,
      opportunity,
      signalsV2,
    }
  })

  return Response.json({ companyId: company.id, ticker: company.ticker, plan, ...payload })
}
