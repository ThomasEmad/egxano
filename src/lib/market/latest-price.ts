// SQL-side "latest price per company" helpers.
//
// Several hot endpoints need only the LATEST (or latest two) MarketPrice rows
// per company. They used to pull the whole table (13k+ rows and growing every
// trading day) into lambda memory and group it in JS — megabytes of database
// egress per cold call on each serverless instance. Postgres does the
// selection with window functions instead and returns only ~1-2 rows per
// company (~30-60KB). Part of the 2026-11-10 egress diet.
//
// Semantics preserved from the JS implementations:
//   - rows with price <= 0 / NULL are ignored (a zero price is never a price)
//   - demo rows excluded unless explicitly allowed
//   - for `latestTwo`, rn=1 is the latest close and rn=2 the previous close

import { db } from "@/lib/db"

export interface PriceRow {
  companyId: string
  price: number
  asOf: Date
}

export interface TwoPrices {
  last: PriceRow
  prev: PriceRow | null
}

function inClause(companyIds: string[] | undefined, params: unknown[]): string {
  if (!companyIds?.length) return ""
  const placeholders = companyIds.map((_, i) => `$${params.push(companyIds[i])}`).join(",")
  return `AND mp."companyId" IN (${placeholders})`
}

/** Latest price per company — one row per company via DISTINCT ON. */
export async function latestPricesPerCompany(
  companyIds?: string[],
  opts: { includeDemo?: boolean } = {},
): Promise<Map<string, PriceRow>> {
  const params: unknown[] = []
  const demoFilter = opts.includeDemo ? "" : `AND mp."isDemoData" = false`
  const rows = await db.$queryRawUnsafe<PriceRow[]>(
    `SELECT DISTINCT ON (mp."companyId") mp."companyId" AS "companyId", mp.price, mp."asOf" AS "asOf"
     FROM "MarketPrice" mp
     WHERE mp.price IS NOT NULL AND mp.price > 0 ${demoFilter} ${inClause(companyIds, params)}
     ORDER BY mp."companyId", mp."asOf" DESC`,
    ...params,
  )
  return new Map(rows.map((r) => [r.companyId, r]))
}

/** Latest two prices per company (last close + previous close). */
export async function latestTwoPerCompany(
  companyIds?: string[],
  opts: { includeDemo?: boolean } = {},
): Promise<Map<string, TwoPrices>> {
  const params: unknown[] = []
  const demoFilter = opts.includeDemo ? "" : `AND mp."isDemoData" = false`
  const rows = await db.$queryRawUnsafe<(PriceRow & { rn: number })[]>(
    `SELECT t."companyId", t.price, t."asOf", t.rn::int AS rn FROM (
       SELECT mp."companyId" AS "companyId", mp.price, mp."asOf" AS "asOf",
              ROW_NUMBER() OVER (PARTITION BY mp."companyId" ORDER BY mp."asOf" DESC) AS rn
       FROM "MarketPrice" mp
       WHERE mp.price IS NOT NULL AND mp.price > 0 ${demoFilter} ${inClause(companyIds, params)}
     ) t WHERE t.rn <= 2 ORDER BY t."companyId", t.rn`,
    ...params,
  )
  const out = new Map<string, TwoPrices>()
  for (const r of rows) {
    const entry = out.get(r.companyId) ?? { last: r as PriceRow, prev: null }
    if (r.rn === 2) entry.prev = r
    out.set(r.companyId, entry)
  }
  return out
}

/** Latest price per company + the price on-or-before `cutoff` (≈1y ago for
 *  change badges), falling back to the company's EARLIEST price when no row
 *  precedes the cutoff — exactly what the watchlist JS loop did. */
export async function latestAndBaselinePerCompany(
  companyIds: string[],
  cutoff: Date,
  opts: { includeDemo?: boolean } = {},
): Promise<Map<string, { last: PriceRow; base: PriceRow | null }>> {
  const out = new Map<string, { last: PriceRow; base: PriceRow | null }>()
  if (companyIds.length === 0) return out
  const demoFilter = opts.includeDemo ? "" : `AND mp."isDemoData" = false`
  const ph = (n: number) => companyIds.map((_, i) => `$${n + i + 1}`).join(",")

  const [latest, beforeCutoff, earliest] = await Promise.all([
    db.$queryRawUnsafe<PriceRow[]>(
      `SELECT DISTINCT ON (mp."companyId") mp."companyId" AS "companyId", mp.price, mp."asOf" AS "asOf"
       FROM "MarketPrice" mp
       WHERE mp.price IS NOT NULL AND mp.price > 0 ${demoFilter} AND mp."companyId" IN (${ph(0)})
       ORDER BY mp."companyId", mp."asOf" DESC`,
      ...companyIds,
    ),
    db.$queryRawUnsafe<PriceRow[]>(
      `SELECT DISTINCT ON (mp."companyId") mp."companyId" AS "companyId", mp.price, mp."asOf" AS "asOf"
       FROM "MarketPrice" mp
       WHERE mp.price IS NOT NULL AND mp.price > 0 ${demoFilter} AND mp."companyId" IN (${ph(0)}) AND mp."asOf" <= $${companyIds.length + 1}
       ORDER BY mp."companyId", mp."asOf" DESC`,
      ...companyIds,
      cutoff,
    ),
    db.$queryRawUnsafe<PriceRow[]>(
      `SELECT DISTINCT ON (mp."companyId") mp."companyId" AS "companyId", mp.price, mp."asOf" AS "asOf"
       FROM "MarketPrice" mp
       WHERE mp.price IS NOT NULL AND mp.price > 0 ${demoFilter} AND mp."companyId" IN (${ph(0)})
       ORDER BY mp."companyId", mp."asOf" ASC`,
      ...companyIds,
    ),
  ])

  const beforeMap = new Map(beforeCutoff.map((r) => [r.companyId, r]))
  const earliestMap = new Map(earliest.map((r) => [r.companyId, r]))
  for (const last of latest) {
    const base = beforeMap.get(last.companyId) ?? earliestMap.get(last.companyId) ?? null
    out.set(last.companyId, { last, base })
  }
  return out
}
