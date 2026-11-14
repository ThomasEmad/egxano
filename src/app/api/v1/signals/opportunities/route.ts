import { NextRequest } from "next/server"
import { getCachedMarketSignals, type MarketSignalsOutput } from "@/lib/technical/signals-service"
import { readBoardSnapshot } from "@/lib/technical/board-snapshot"
import { cached, peekCacheAgeMs } from "@/lib/server-cache"
import { getSessionUser, USER_SESSION_COOKIE } from "@/lib/auth"
import { getActivePlanId } from "@/lib/subscription"
import { isPaidPlanId } from "@/lib/plans/entitlements"
import {
  buildOpportunitiesDigest,
  marketRegime,
  OPPORTUNITIES_CAP,
  REGIME_META,
  EMPTY_REGIME_INPUT,
  type OpportunitiesResponse,
} from "@/lib/technical/board-gates"

// GET /api/v1/signals/opportunities — "فرص اليوم" digest.
//
// The ordered, capped opportunities strip: confirmed + watching rows only,
// tier-sorted (conviction A first), regime-gated, MAX 5 rows returned. The
// gate decides how many qualify; if fewer than 5 qualify, FEWER are returned —
// the digest is never padded with weaker rows.
//
// PURE CORE: all selection/sorting/gating logic lives in
// src/lib/technical/board-gates.ts (buildOpportunitiesDigest) and is pinned by
// unit tests. This route is glue only: auth + payload sourcing + response.
//
// AUTH: identical to the signals board route — x-session-token /
// Authorization header first, then the HttpOnly USER_SESSION_COOKIE fallback
// (same live-bug rationale: same-origin fetches ship the cookie, so the
// caller's real tier resolves without touching the shared client layer).
// Plan resolution via getActivePlanId (src/lib/subscription.ts).
//
// ENTITLEMENT: paid callers (Pro / Pro Quarterly / legacy paid rows) receive
// the full digest rows (tier, levels, activation). Free/anonymous callers
// receive the SAME qualifying companies passed through gateRowForFree —
// locked identity rows (ticker/name/sector/tier/last price, locked:true),
// the board's exact free gating. No paid analysis field crosses the wire.
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

  // ---- regime + digest (pure core) ----
  const regimeInput = full.regimeInput ?? EMPTY_REGIME_INPUT
  const regime = marketRegime(regimeInput)
  const digest = buildOpportunitiesDigest(full.rows, regime, { cap: OPPORTUNITIES_CAP, free: !paid })

  const payload: OpportunitiesResponse = {
    version: full.version,
    regime,
    regimeNoteAr: REGIME_META[regime].noteAr,
    breadthPct: regimeInput.breadthBullishShare === null ? null : Math.round(regimeInput.breadthBullishShare * 1000) / 10,
    medianScore: regimeInput.medianScore,
    asOf: full.pricedAsOf,
    computedAt: full.computedAt,
    qualifying: digest.qualifying,
    rows: digest.rows,
    plan,
  }

  return Response.json(payload, {
    headers: {
      "cache-control": "private, max-age=60",
    },
  })
}
