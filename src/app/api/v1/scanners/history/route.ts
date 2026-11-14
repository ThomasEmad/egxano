import { db } from "@/lib/db"

// GET /api/v1/scanners/history — recent scanner runs (audit of what was scanned,
// when, on which basis, and how many companies matched).
//
// 2026-11-14 audit fix: this public endpoint used to return each run's full
// `matchedCompanyIds` array — internal CUIDs with no public meaning, rendered
// verbatim as chips in the UI. The response now carries only the public
// TICKERS of the first few matches (the same companies any visitor can see by
// running the preset screen on the public page) plus the total match count.

const MAX_PUBLIC_TICKERS = 7

export async function GET() {
  const runs = await db.scannerRun.findMany({
    include: { rule: { select: { isPreset: true, presetKey: true } } },
    orderBy: { ranAt: "desc" },
    take: 20,
  })
  // Resolve tickers for the capped slice of matches in ONE query per run size
  // cap — collect the union of ids first, then map.
  const idUnion = new Set<string>()
  const perRunIds: string[][] = runs.map((r) => {
    const ids = JSON.parse(r.matchedCompanyIds) as string[]
    ids.slice(0, MAX_PUBLIC_TICKERS).forEach((id) => idUnion.add(id))
    return ids
  })
  const tickerById = new Map<string, string>()
  if (idUnion.size > 0) {
    const rows = await db.company.findMany({
      where: { id: { in: [...idUnion] } },
      select: { id: true, ticker: true },
    })
    for (const row of rows) tickerById.set(row.id, row.ticker)
  }
  return Response.json({
    runs: runs.map((r, i) => {
      const ids = perRunIds[i]
      return {
        id: r.id,
        ruleId: r.ruleId,
        ruleName: r.ruleName,
        isPreset: r.rule?.isPreset ?? false,
        periodBasis: r.periodBasis,
        matchedCount: r.matchedCount,
        // Public tickers only, capped — internal CUIDs never leave the server.
        matchedTickers: ids.slice(0, MAX_PUBLIC_TICKERS).map((id) => tickerById.get(id)).filter((t): t is string => Boolean(t)),
        ranAt: r.ranAt,
      }
    }),
  })
}
