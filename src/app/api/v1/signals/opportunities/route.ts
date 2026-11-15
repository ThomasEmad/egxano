import { NextRequest } from "next/server"
import {
  getCachedMarketSignals,
  buildOpportunityDigestV1,
  OPPORTUNITY_DIGEST_VERSION,
  OPPORTUNITY_DIGEST_CAP,
  OPPORTUNITY_DIGEST_MISSED_CAP,
  type MarketSignalsOutput,
  type OpportunityDigestResponse,
} from "@/lib/technical/signals-service"
import { readBoardSnapshot } from "@/lib/technical/board-snapshot"
import { cached, peekCacheAgeMs } from "@/lib/server-cache"
import { getSessionUser, USER_SESSION_COOKIE } from "@/lib/auth"
import { getActivePlanId } from "@/lib/subscription"
import { isPaidPlanId } from "@/lib/plans/entitlements"
import { marketRegime, REGIME_META, EMPTY_REGIME_INPUT } from "@/lib/technical/board-gates"

// GET /api/v1/signals/opportunities — the opportunity@1 "فرص اليوم" digest.
//
// opportunity@1 (upgraded from the legacy conviction-tier digest): qualifying
// rows (eligible — STRICT opportunity gates: > 5% remaining upside to the
// ladder's T1 AND RR ≥ 1.5 on real plan numbers) ranked by OQS DESC (ties →
// higher upsidePctToT1, then ticker), followed by a small informative tail of
// non-eligible rows (conditional / observation with rejectionReasonsAr,
// clearly separated by `section`), total capped at 5 — NEVER padded. Missed
// rows (the NO-CHASE verdict) travel separately in missedRows (cap 3).
// qualifying === 0 carries the exact honest empty-state noteAr — no
// manufactured opportunities.
//
// PURE CORE: all selection/sorting/gating logic lives in
// src/lib/technical/signals-service.ts (buildOpportunityDigestV1) and is
// pinned by unit tests. This route is glue only: auth + payload sourcing +
// response.
//
// AUTH: identical to the signals board route — x-session-token /
// Authorization header first, then the HttpOnly USER_SESSION_COOKIE fallback
// (same live-bug rationale: same-origin fetches ship the cookie, so the
// caller's real tier resolves without touching the shared client layer).
// Plan resolution via getActivePlanId (src/lib/subscription.ts).
//
// ENTITLEMENT: paid callers (Pro / Pro Quarterly / legacy paid rows) receive
// the full digest rows (view, levels, targets, OQS). Free/anonymous callers
// receive the SAME companies passed through gateRowForFree — locked identity
// rows (ticker/name/sector/tier/last price, locked:true), the board's exact
// free gating. No paid analysis field crosses the wire.
//
// PAYLOAD SOURCE: the whole-market computation is cached tier-independent and
// SHARED with the board (same cache key), plus the persisted board snapshot
// for cold starts — the digest never triggers a second full-market compute.
// A payload computed before the regime layer (no regimeInput) degrades to the
// neutral regime, which never penalizes a row.
//
// cache-control: private — the payload is PLAN-DEPENDENT (paid rows vs locked
// identity rows) and must never be stored by a shared/CDN cache; 60s matches
// the board's freshness window.

export const maxDuration = 60

export async function GET(req: NextRequest) {
  // ---- auth (identical to the board route) ----
  const headerToken = req.headers.get("x-session-token") ?? req.headers.get("authorization")
  const rawToken = headerToken
    ? headerToken.startsWith("Bearer ")
      ? headerToken.slice(7)
      : headerToken
    : (req.cookies.get(USER_SESSION_COOKIE)?.value ?? null)
  const userId = await getSessionUser(rawToken)
  const plan = userId ? await getActivePlanId(userId) : "FREE"
  const paid = isPaidPlanId(plan)

  // ---- payload sourcing (shared with the board; snapshot-first on cold starts) ----
  let full: MarketSignalsOutput | null = null
  const cacheKey = "technical-signals:served:v1"
  const age = peekCacheAgeMs(cacheKey)
  if (age !== null) {
    full = (await cached(cacheKey, 10 * 60_000, () => getCachedMarketSignals())) as MarketSignalsOutput
  } else {
    const snap = await readBoardSnapshot()
    if (snap) {
      full = snap
      // Warm the in-memory cache for subsequent requests (single-flight inside).
      void getCachedMarketSignals().catch(() => {})
    } else {
      full = (await cached(cacheKey, 10 * 60_000, () => getCachedMarketSignals())) as MarketSignalsOutput
    }
  }

  // ---- regime + opportunity@1 digest (pure core) ----
  const regimeInput = full.regimeInput ?? EMPTY_REGIME_INPUT
  const regime = marketRegime(regimeInput)
  const digest = buildOpportunityDigestV1(full.rows, regime, {
    cap: OPPORTUNITY_DIGEST_CAP,
    missedCap: OPPORTUNITY_DIGEST_MISSED_CAP,
    free: !paid,
  })

  const payload: OpportunityDigestResponse = {
    version: OPPORTUNITY_DIGEST_VERSION,
    regime,
    regimeNoteAr: REGIME_META[regime].noteAr,
    breadthPct: regimeInput.breadthBullishShare === null ? null : Math.round(regimeInput.breadthBullishShare * 1000) / 10,
    medianScore: regimeInput.medianScore,
    asOf: full.pricedAsOf,
    computedAt: full.computedAt,
    qualifying: digest.qualifying,
    rows: digest.rows,
    missedRows: digest.missedRows,
    ...(digest.emptyNoteAr !== undefined ? { emptyNoteAr: digest.emptyNoteAr } : {}),
    plan,
  }

  return Response.json(payload, {
    headers: {
      "cache-control": "private, max-age=60",
    },
  })
}
