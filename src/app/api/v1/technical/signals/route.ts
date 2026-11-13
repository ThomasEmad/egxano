import { getCachedMarketSignals } from "@/lib/technical/signals-service"
import { cachedResponse } from "@/lib/public-cache"

// GET /api/v1/technical/signals — market-wide deterministic technical stances.
//
// Every row is a RULE-BASED READING of real traded prices (trend/momentum/
// volume/risk confluence, documented weights in src/lib/technical/signals.ts).
// It is a factual statement about which way the evidence points — disclosed as
// such in the UI — never a personalized investment recommendation.
//
// Public + edge-cached 10 minutes (same cache window as the computation).

export const maxDuration = 60

export async function GET() {
  return cachedResponse("technical-signals:public", 10 * 60_000, () => getCachedMarketSignals())
}
