import { cached } from "@/lib/server-cache"
import { publicCacheControl } from "@/lib/public-cache"
import { db } from "@/lib/db"
import { MARKET_SNAPSHOT_SETTING_KEY } from "@/lib/market/refresh"
import { getIntelligence, rebuildIntelligence } from "@/lib/market/intelligence/service"

// GET /api/v1/market/intelligence — the whole-market intelligence snapshot:
// breadth (A/D, traded value, A/D line), regime with evidence, market pulse,
// turnover concentration, sector rotation, anomalies and the opportunity /
// risk radars. Computed from the freshest scanner snapshot + PriceBar volume
// baselines + stored daily history + the daily enrichment job.
//
// All delayed data (≥15 min) — the response carries `delayMinutes` and `asOf`.
// This is now the ONLY breadth source the dashboard renders (hero cells,
// market summary and the intelligence strip share one fetch), so the stored
// snapshot must not lag the freshest market snapshot: the refresh pipeline
// rebuilds intelligence best-effort after every pull, and when that step
// fails the route below self-heals once per cache window instead of serving
// yesterday's build all day (the cold-start path still wins for FRESH
// snapshots — no compute is paid when the stored build is current).

export const maxDuration = 30

/** How far the stored intelligence may lag the freshest market snapshot
 * before one rebuild is paid. Just above the refresh cadence so a refresh
 * whose rebuild is still in flight doesn't double-compute. */
const MAX_LAG_MS = 10 * 60_000

export async function GET() {
  const intel = await cached("market-intelligence", 60_000, async () => {
    const stored = await getIntelligence()
    if (!stored) {
      // First run after deployment: build once on demand instead of erroring.
      return rebuildIntelligence()
    }
    // Self-heal: the refresh pipeline rebuilds intelligence best-effort after
    // every snapshot pull, and when that step fails this route used to serve
    // the old build all day. Probe the SAME source rebuildIntelligence() reads
    // (the DB Setting row — not the file fallback, so a newer file can never
    // trigger rebuilds that keep returning the same older DB build), and retry
    // once per cache window when the stored build lags. Session-freshness is
    // still driven by the ticker/sectors routes (getFreshMarketSnapshot's
    // staleness kick); this route only rebuilds its own view. Fully fail-soft:
    // any error in the probe or the rebuild falls back to the stored build
    // (cached() only guards refreshes AFTER a first successful build, so a
    // throw here would 500 a cold instance that could have answered).
    try {
      const snapRow = await db.setting.findUnique({ where: { key: MARKET_SNAPSHOT_SETTING_KEY }, select: { value: true } })
      let snapshotAsOf = Number.NaN
      if (snapRow?.value) {
        try {
          const raw = JSON.parse(snapRow.value) as { asOf?: unknown }
          if (typeof raw.asOf === "string") snapshotAsOf = Date.parse(raw.asOf)
        } catch {
          // unparsable snapshot row — nothing to compare, keep the stored build
        }
      }
      const storedAsOf = Date.parse(stored.asOf)
      if (Number.isFinite(snapshotAsOf) && Number.isFinite(storedAsOf) && snapshotAsOf - storedAsOf > MAX_LAG_MS) {
        return (await rebuildIntelligence()) ?? stored
      }
    } catch {
      // keep serving the stored build — never trade a usable snapshot for a 500
    }
    return stored
  })
  if (!intel) {
    return Response.json({ error: "INTELLIGENCE_UNAVAILABLE", message: "No market snapshot has been stored yet — trigger a market refresh first." }, { status: 503 })
  }
  return Response.json(intel, { headers: { "Cache-Control": publicCacheControl(60) } })
}
