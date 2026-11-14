// Production read-only fetcher for section B (universe / tier mapping).
//  1. Paginate GET /api/v1/companies (page & pageSize<=50, sort=ticker) until
//     total is covered → docs/notes/data/companies-snapshot.json
//  2. GET /api/v1/technical/signals (anonymous) → facets (tiers/styles/sectors)
//     + free rows → docs/notes/data/signals-facets.json
//  3. Enumerate ticker→tier via signals filters ?tier=<T>&sector=<S> (the OTC
//     tier filter is retired and falls back to "all", so OTC is NOT directly
//     filterable — disclosed in the audit). Each slice's rows are capped at
//     24 locked + free tickers; slices are chosen small enough to be complete,
//     and matched.total cross-checks completeness per slice.
import { mkdirSync, writeFileSync } from "node:fs"

const BASE = "https://egxano.vercel.app/api/v1"
const OUT = "/tmp/egx-work/docs/notes/data"
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" })
  const json = await res.json()
  return { status: res.status, json, serverTiming: res.headers.get("server-timing") }
}

// ---- 1. companies pagination ----
async function fetchCompanies() {
  const pageSize = 50
  let page = 1
  const all = []
  let total = null
  let totalPages = null
  for (;;) {
    const { status, json } = await getJson(`${BASE}/companies?page=${page}&pageSize=${pageSize}`)
    if (status !== 200) throw new Error(`companies page ${page} HTTP ${status}`)
    total = json.total
    totalPages = json.totalPages
    all.push(...json.companies)
    console.log(`companies page ${page}/${totalPages} got=${json.companies.length} total=${total}`)
    if (page >= totalPages || json.companies.length === 0) break
    page++
    await sleep(500)
  }
  const snapshot = {
    fetchedAt: new Date().toISOString(),
    endpoint: "/api/v1/companies?page=N&pageSize=50 (default sort=marketCap; NOTE: sort=ticker SQL pagination returns 0 rows for pages>=2 on production — empirically observed)",
    paginationBugObserved: {
      test: "GET /companies?page=2&pageSize=50&sort=ticker&dir=asc",
      result: "total=246, companies=0 (also without dir; default sort pages work)",
    },
    total,
    fetched: all.length,
    note: "Response fields: id/ticker/isin/nameEn/nameAr/sector/industry/listingStatus/egxCategory/irUrl/isDemoData/counts/snapshot/marketPrice/marketCap. marketTier is NOT exposed by this endpoint (see audit).",
    companies: all,
  }
  writeFileSync(`${OUT}/companies-snapshot.json`, JSON.stringify(snapshot, null, 2))
  console.log(`companies snapshot saved: ${all.length}/${total}`)
  return snapshot
}

// ---- 2. signals facets ----
async function fetchSignalsFacets() {
  const { status, json, serverTiming } = await getJson(`${BASE}/technical/signals`)
  const facets = {
    fetchedAt: new Date().toISOString(),
    httpStatus: status,
    serverTiming,
    universe: json.universe,
    scored: json.scored,
    weakData: json.weakData,
    matched: json.matched,
    tiers: json.tiers,
    styles: json.styles,
    sectors: json.sectors,
    distribution: json.distribution,
    pricedAsOf: json.pricedAsOf,
    computedAt: json.computedAt,
    plan: json.plan,
    rowCount: Array.isArray(json.rows) ? json.rows.length : null,
    lockedRemaining: json.lockedRemaining,
    missingFreeTickers: json.missingFreeTickers,
    freeRows: (json.rows ?? []).filter((r) => !r.locked),
    lockedSampleRows: (json.rows ?? []).filter((r) => r.locked).slice(0, 30),
  }
  writeFileSync(`${OUT}/signals-facets.json`, JSON.stringify(facets, null, 2))
  console.log(`signals facets: universe=${facets.universe} scored=${facets.scored} weak=${facets.weakData} tiers=${JSON.stringify(facets.tiers)}`)
  return facets
}

// ---- 3. universe enumeration by sector × signal slices ----
// PRODUCTION FILTER FACTS (empirically verified 2026-11-14, deployed build):
//   • filters DO compose (?tier=EGX30&sector=Banks → 2 rows, all EGX30)
//   • ?tier=EGX70 falls back to "all" on the deployed build (term retired)
//   • ?tier=OTC is accepted and matched 0 rows (no priced OTC rows)
//   • deployed `sectors` facet is truncated (8 entries) → sector list comes
//     from the companies snapshot instead
// Enumeration: for each sector, slice by signal=buy/hold/sell (each small);
// every returned row carries its own marketTier. matched.weak per slice
// accounts for rows whose signal is null (they are counted even when their
// ticker is not visible under the 24-locked-row cap).
async function enumerateTiers(snapshot) {
  const sectors = [...new Set(snapshot.companies.map((c) => c.sector).filter(Boolean))].sort()
  const out = {
    fetchedAt: new Date().toISOString(),
    method: "sector × signal slice enumeration; row.marketTier read per row",
    productionFilterFacts: {
      tierSectorCompose: true,
      tierEgx70FilterRetired: "?tier=EGX70 falls back to all (deployed build)",
      tierOtcAccepted: "matched 0 rows on 2026-11-14 (no priced OTC rows)",
      sectorsFacetTruncated: "deployed facet lists 8 sectors; snapshot has more",
    },
    slices: [],
    byTicker: {},
    weakTotalFromSlices: 0,
  }
  let requestCount = 0

  const addRows = (sliceMeta, json) => {
    const rows = (json.rows ?? []).map((r) => ({
      ticker: r.ticker,
      marketTier: r.marketTier,
      sector: r.sector,
      locked: r.locked === true,
      signal: r.signal ?? null,
      asOf: r.asOf ?? null,
    }))
    for (const r of rows) {
      const prev = out.byTicker[r.ticker]
      if (!prev) out.byTicker[r.ticker] = { ...r, slices: [sliceMeta.sector] }
      else if (!r.locked && prev.locked) out.byTicker[r.ticker] = { ...r, slices: prev.slices }
      else prev.slices.push(sliceMeta.sector)
    }
    out.slices.push({ ...sliceMeta, matched: json.matched ?? null, rowsReturned: rows.length })
    return json.matched ?? { total: 0 }
  }

  async function get(url) {
    requestCount++
    const { status, json } = await getJson(url)
    return { status, json }
  }

  for (const sector of sectors) {
    // plain sector slice: totals + weak count for this sector
    let { status, json } = await get(`${BASE}/technical/signals?sector=${encodeURIComponent(sector)}`)
    if (status === 200) {
      const m = addRows({ sector, signal: null }, json)
      out.weakTotalFromSlices += m.weak ?? 0
      if (m.total > (out.slices.at(-1).rowsReturned ?? 0)) {
        // capped → partition by signal
        for (const sig of ["buy", "hold", "sell"]) {
          const r2 = await get(`${BASE}/technical/signals?sector=${encodeURIComponent(sector)}&signal=${sig}`)
          if (r2.status === 200) addRows({ sector, signal: sig }, r2.json)
          await sleep(200)
        }
      }
    } else {
      out.slices.push({ sector, error: `HTTP ${status}` })
    }
    await sleep(200)
  }

  // direct per-tier verification slices (tier+sector compose on deployed build)
  out.tierVerify = { EGX30: {}, MAIN: {}, OTC: {} }
  for (const tier of ["EGX30", "MAIN", "OTC"]) {
    const r = await get(`${BASE}/technical/signals?tier=${tier}`)
    if (r.status === 200) {
      out.tierVerify[tier] = { matched: r.json.matched ?? null, tiersFacet: r.json.tiers ?? null, rowsReturned: (r.json.rows ?? []).length }
      addRows({ sector: null, tier }, r.json)
    }
    await sleep(200)
  }

  writeFileSync(`${OUT}/tier-enumeration.json`, JSON.stringify(out, null, 2))
  const byTier = {}
  for (const v of Object.values(out.byTicker)) byTier[v.marketTier] = (byTier[v.marketTier] ?? 0) + 1
  console.log(`tier enumeration: distinct tickers=${Object.keys(out.byTicker).length}, byTier=${JSON.stringify(byTier)}, slices=${out.slices.length}, requests=${requestCount}`)
  return out
}

const companies = await fetchCompanies()
const facets = await fetchSignalsFacets()
const tiers = await enumerateTiers(companies)
console.log("ALL DONE")
