import { cached } from "@/lib/server-cache"
import { publicCacheControl } from "@/lib/public-cache"
import { getIntelligence, rebuildIntelligence } from "@/lib/market/intelligence/service"

// GET /api/v1/market/intelligence — the whole-market intelligence snapshot:
// breadth (A/D, traded value, A/D line), regime with evidence, market pulse,
// turnover concentration, sector rotation, anomalies and the opportunity /
// risk radars. Computed from the freshest scanner snapshot + PriceBar volume
// baselines + stored daily history + the daily enrichment job.
//
// All delayed data (≥15 min) — the response carries `delayMinutes` and `asOf`.

export const maxDuration = 30

export async function GET() {
  const intel = await cached("market-intelligence", 60_000, async () => {
    const stored = await getIntelligence()
    if (stored) return stored
    // First run after deployment: build once on demand instead of erroring.
    return rebuildIntelligence()
  })
  if (!intel) {
    return Response.json({ error: "INTELLIGENCE_UNAVAILABLE", message: "No market snapshot has been stored yet — trigger a market refresh first." }, { status: 503 })
  }
  return Response.json(intel, { headers: { "Cache-Control": publicCacheControl(60) } })
}
