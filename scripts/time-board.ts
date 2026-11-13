import { getCachedMarketSignals } from "@/lib/technical/signals-service"
const t0 = Date.now()
const out = await getCachedMarketSignals()
console.log("compute ms:", Date.now() - t0, "universe:", out.universe, "scored:", out.scored, "dist:", JSON.stringify(out.distribution))
const cana = out.rows.find((r) => r.ticker === "CANA")
console.log("CANA:", JSON.stringify({ signal: cana?.signal, score: cana?.score, lastClose: cana?.lastClose, changePct: cana?.changePct, tier: cana?.marketTier }))
console.log("CANA plan:", JSON.stringify(cana?.tradePlan, null, 0)?.slice(0, 300))
console.log("CANA reasons:", cana?.reasons.slice(0, 3).map((r) => r.ar))
