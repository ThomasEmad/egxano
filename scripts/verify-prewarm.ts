// Verify prewarmed reports: count COMPLETED artifacts for the top 25 × langs.
import { db } from "../src/lib/db"

const TICKERS = ["COMI","SWDY","ETEL","TMGH","EGAL","QNBE","MFPC","HDBK","EAST","ABUK","ALCN","ORAS","EFIH","ADIB","EMFD","FWRY","SCTS","CANA","EFID","JUFO","PHDC","HRHO","OCDI","BIOC","VLMRA"]

async function main(): Promise<void> {
  const companies = await db.company.findMany({
    where: { ticker: { in: TICKERS } },
    select: { id: true, ticker: true },
  })
  const ids = companies.map((c) => c.id)
  const reports = await db.aiAnalysisReport.groupBy({
    by: ["companyId", "lang", "degraded"],
    where: { companyId: { in: ids }, status: "COMPLETED" },
    _count: { _all: true },
    _avg: { wordCount: true },
  })

  const byTicker = new Map(companies.map((c) => [c.id, c.ticker]))
  const grid = new Map<string, { ar: number; en: number; degAr: number; degEn: number; wordsAr: number; wordsEn: number }>()
  for (const r of reports) {
    const t = byTicker.get(r.companyId) ?? "?"
    const g = grid.get(t) ?? { ar: 0, en: 0, degAr: 0, degEn: 0, wordsAr: 0, wordsEn: 0 }
    if (r.lang === "ar") { g.ar += r._count._all; g.wordsAr = Math.round(r._avg.wordCount ?? 0); if (r.degraded) g.degAr += r._count._all }
    else { g.en += r._count._all; g.wordsEn = Math.round(r._avg.wordCount ?? 0); if (r.degraded) g.degEn += r._count._all }
    grid.set(t, g)
  }

  let full = 0, partial = 0, missing: string[] = [], degraded = 0
  console.log("ticker   ar  en  | words(ar) degraded(ar/en)")
  for (const t of TICKERS) {
    const g = grid.get(t) ?? { ar: 0, en: 0, degAr: 0, degEn: 0, wordsAr: 0, wordsEn: 0 }
    degraded += g.degAr + g.degEn
    const ok = g.ar > 0 && g.en > 0
    if (ok) full++; else { partial++; missing.push(t) }
    console.log(`${t.padEnd(8)} ${g.ar}   ${g.en}  | ${g.wordsAr}  ${g.degAr}/${g.degEn}`)
  }
  console.log(`\nFULL coverage (ar+en): ${full}/25 | partial: ${partial} ${missing.length ? missing.join(",") : ""} | degraded artifacts: ${degraded}`)

  const pending = await db.aiAnalysisJob.count({ where: { status: "PENDING" } })
  const processing = await db.aiAnalysisJob.count({ where: { status: "PROCESSING" } })
  const failed = await db.aiAnalysisJob.count({ where: { status: "FAILED" } })
  console.log(`Queue: PENDING=${pending} PROCESSING=${processing} FAILED=${failed}`)

  // newest completed AR sample
  const sample = await db.aiAnalysisReport.findFirst({
    where: { status: "COMPLETED", lang: "ar", company: { ticker: { in: TICKERS } } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, model: true, wordCount: true, degraded: true, company: { select: { ticker: true } }, content: true },
  })
  if (sample) {
    console.log(`\nSample newest AR: ${sample.company.ticker} model=${sample.model} words=${sample.wordCount} degraded=${sample.degraded} at=${sample.createdAt.toISOString()}`)
    console.log("first 160 chars:", sample.content?.slice(0, 160).replace(/\n/g, " "))
  }
}

void main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
