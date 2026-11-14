// Tier diff: seed lists (src/lib/market/tiers.ts) vs production snapshot.
// Inputs: docs/notes/data/companies-snapshot.json, signals-facets.json,
//         tier-enumeration.json
// Output: docs/notes/data/tier-diff.json + human-readable stdout summary
import { readFileSync, writeFileSync } from "node:fs"

const DATA = "/tmp/egx-work/docs/notes/data"
const tiersTs = readFileSync("/tmp/egx-work/src/lib/market/tiers.ts", "utf8")

function extractList(name) {
  const m = tiersTs.match(new RegExp(`export const ${name} = \\[([^\\]]+)\\]`, "s"))
  return m[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean)
}

const EGX30_SEED = extractList("EGX30_TICKERS")
const EGX70_SEED = extractList("EGX70_TICKERS")

const companies = JSON.parse(readFileSync(`${DATA}/companies-snapshot.json`, "utf8"))
const facets = JSON.parse(readFileSync(`${DATA}/signals-facets.json`, "utf8"))
const enu = JSON.parse(readFileSync(`${DATA}/tier-enumeration.json`, "utf8"))

const coByTicker = new Map(companies.companies.map((c) => [c.ticker.toUpperCase(), c]))
const tierOfTicker = new Map(Object.entries(enu.byTicker).map(([t, v]) => [t, v.marketTier]))

// (a) seed tickers with no matching company row
const seedMissing = { EGX30: [], EGX70: [] }
for (const t of EGX30_SEED) if (!coByTicker.has(t)) seedMissing.EGX30.push(t)
for (const t of EGX70_SEED) if (!coByTicker.has(t)) seedMissing.EGX70.push(t)

// (b) companies whose PRODUCTION tier is EGX30/EGX70 but not in the seeds
const extraVsSeed = { EGX30: [], EGX70: [] }
for (const [t, tier] of tierOfTicker) {
  if (tier === "EGX30" && !EGX30_SEED.includes(t)) extraVsSeed.EGX30.push(t)
  if (tier === "EGX70" && !EGX70_SEED.includes(t)) extraVsSeed.EGX70.push(t)
}
// also: seeds mismatching production tier (seed says EGX70, production says MAIN etc.)
const tierMismatch = []
for (const [t, tier] of tierOfTicker) {
  if (EGX30_SEED.includes(t) && tier !== "EGX30") tierMismatch.push({ ticker: t, seed: "EGX30", production: tier })
  if (EGX70_SEED.includes(t) && tier !== "EGX70") tierMismatch.push({ ticker: t, seed: "EGX70", production: tier })
}

// (c) counts per tier
const countsPerTier = {
  productionFacet: facets.tiers, // EGX30/EGX70/MAIN (+OTC when >0)
  productionUniverse: facets.universe,
  productionScored: facets.scored,
  productionWeak: facets.weakData,
  enumeratedByTicker: Object.values(enu.byTicker).reduce((a, v) => ((a[v.marketTier] = (a[v.marketTier] ?? 0) + 1), a), {}),
  tierVerifySlices: enu.tierVerify,
}

// (d) OTC: production facet + listingStatus distribution of the snapshot
const listingStatusCounts = {}
for (const c of companies.companies) {
  const s = c.listingStatus ?? "null"
  listingStatusCounts[s] = (listingStatusCounts[s] ?? 0) + 1
}
const otcRows = Object.entries(enu.byTicker).filter(([, v]) => v.marketTier === "OTC").map(([t]) => t)
const noPriceCompanies = companies.companies.filter((c) => !c.marketPrice).map((c) => ({
  ticker: c.ticker,
  listingStatus: c.listingStatus,
  sector: c.sector,
  nameEn: c.nameEn,
}))

// companies present in snapshot but never seen in the signals enumeration
const snapshotOnly = companies.companies.map((c) => c.ticker.toUpperCase()).filter((t) => !tierOfTicker.has(t))

const diff = {
  generatedAt: new Date().toISOString(),
  seedSource: "src/lib/market/tiers.ts (egxbot.com + egx.com.eg, November 2026)",
  seedSizes: { EGX30: EGX30_SEED.length, EGX70: EGX70_SEED.length },
  seedLists: { EGX30: EGX30_SEED, EGX70: EGX70_SEED },
  a_seedTickersWithNoCompanyRow: seedMissing,
  b_productionTierNotInSeed: extraVsSeed,
  seedVsProductionTierMismatch: tierMismatch,
  c_countsPerTier: countsPerTier,
  d_otc: {
    productionTierFacetOTC: facets.tiers?.OTC ?? 0,
    enumeratedOTCTickers: otcRows,
    snapshotListingStatusCounts: listingStatusCounts,
    activeCompaniesWithNoMarketPrice: noPriceCompanies,
    note: "OTC tier filter is accepted by the deployed API and matched 0 rows; OTC companies have no priced row in the signals universe.",
  },
  snapshotTickersNeverSeenInSignals: snapshotOnly,
}
writeFileSync(`${DATA}/tier-diff.json`, JSON.stringify(diff, null, 2))

console.log("=== TIER DIFF SUMMARY ===")
console.log("seeds:", JSON.stringify(diff.seedSizes))
console.log("(a) seed tickers with NO company row:", JSON.stringify(seedMissing))
console.log("(b) production-tier rows not in seed:", JSON.stringify(extraVsSeed))
console.log("    seed↔production tier mismatches:", tierMismatch.length ? JSON.stringify(tierMismatch) : "none")
console.log("(c) counts per tier:", JSON.stringify(countsPerTier.productionFacet), "enumerated:", JSON.stringify(countsPerTier.enumeratedByTicker))
console.log("(d) OTC:", JSON.stringify({ facet: diff.d_otc.productionTierFacetOTC, listingStatus: listingStatusCounts }))
console.log("snapshot-only tickers (not in signals universe):", JSON.stringify(snapshotOnly))
console.log("active companies with no marketPrice:", JSON.stringify(noPriceCompanies))
