import { marketValuationScreen } from "@/lib/financial/scores"
import { cached } from "@/lib/server-cache"
import { serveWithSnapshot } from "@/lib/shared-snapshot"

// GET /api/v1/dashboard/valuation — market-wide valuation screen:
// companies ranked by discount vs their sector median P/E & P/B.
//
// marketValuationScreen calls computeCompanyScores per active filer
// (~250 companies × several queries each) — uncached this took ~14s and
// dominated every dashboard visit. The screen changes only when filings,
// metric recompute or market snapshots change, so a 5-minute stale-while-
// revalidate cache (invalidated by the pipeline via invalidateServerCache)
// keeps first paint fast and data honest.
//
// Cold-start (2026-11-14): a freshly-scaled instance used to re-pay the full
// ~14–29s build. The computed screen now persists as a shared read model and
// a cold instance serves it instantly (max 30 min old) while the real build
// refreshes in the background — never stale-served-as-fresh beyond that bound.
export async function GET() {
  const t0 = Date.now()
  const { value: results, source } = await serveWithSnapshot({
    cacheKey: "dashboard:valuation",
    ttlMs: 5 * 60_000,
    settingKey: "dashboard:valuation:snapshot:v1",
    snapshotMaxAgeMs: 30 * 60_000,
    build: () => marketValuationScreen(24),
  })
  return Response.json(
    { results },
    { headers: { "server-timing": `valuation;dur=${Date.now() - t0},source=${source}` } },
  )
}
