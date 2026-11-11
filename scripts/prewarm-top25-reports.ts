// Prewarm AI reports — enqueue report generation for the TOP 25 companies by
// market cap (site ordering: /api/v1/companies?sort=marketCap), both languages.
//
// Uses the app's own requestReport() so reportKeys, dedup, identity and the
// AiAnalysisEvent trail are exactly what a user request would produce.
// skipQuota + requestedBy=null ⇒ "system" enqueue, no free-tier charge.
//
// Jobs then drain via /api/v1/cron/ai-worker (server-side, prod env keys).
//
// Run:  set -a; source .env.local; set +a; npx tsx scripts/prewarm-top25-reports.ts
import { requestReport } from "../src/lib/ai/jobs/enqueue"
import { db } from "../src/lib/db"

const PROD = "https://meza-ashy.vercel.app"
const LANGS = ["ar", "en"] as const
const TOP_N = 25

interface CompanyRow { ticker: string; nameEn: string; marketCap: number | null }

async function top25(): Promise<CompanyRow[]> {
  const res = await fetch(`${PROD}/api/v1/companies?sort=marketCap&pageSize=${TOP_N}`)
  if (!res.ok) throw new Error(`companies API ${res.status}`)
  const d = (await res.json()) as { companies?: CompanyRow[] }
  const items = d.companies ?? []
  if (items.length < TOP_N) throw new Error(`expected ${TOP_N}, got ${items.length}`)
  return items.slice(0, TOP_N)
}

async function main(): Promise<void> {
  const companies = await top25()
  console.log(`Top ${companies.length} by market cap — from ${PROD}`)
  console.log(`Enqueueing ${companies.length * LANGS.length} report jobs (${LANGS.join(" + ")})...\n`)

  const tally = { queued: 0, cache_hit: 0, generating: 0, no_data: 0, not_found: 0 }
  const queuedList: string[] = []

  for (const lang of LANGS) {
    for (const c of companies) {
      try {
        const r = await requestReport(c.ticker, lang, { isPremium: true, requestedBy: null, skipQuota: true })
        if (r.kind === "quota_exhausted") {
          // should never happen with skipQuota — treat as fatal
          throw new Error(`quota_exhausted for ${c.ticker} ${lang} — skipQuota not honored?`)
        }
        tally[r.kind] = (tally[r.kind] ?? 0) + 1
        if (r.kind === "queued") {
          queuedList.push(`${c.ticker}:${lang}`)
          console.log(`  [queued]     ${c.ticker.padEnd(6)} ${lang}`)
        } else if (r.kind === "cache_hit") {
          console.log(`  [ready]      ${c.ticker.padEnd(6)} ${lang}  (completed artifact already exists)`)
        } else if (r.kind === "generating") {
          console.log(`  [active]     ${c.ticker.padEnd(6)} ${lang}  (job already running)`)
        } else if (r.kind === "no_data") {
          console.log(`  [NO_DATA]    ${c.ticker.padEnd(6)} ${lang}  (no verified financial statements)`)
        } else {
          console.log(`  [NOT_FOUND]  ${c.ticker.padEnd(6)} ${lang}`)
        }
      } catch (e) {
        console.log(`  [ERROR]      ${c.ticker.padEnd(6)} ${lang}  ${e instanceof Error ? e.message.slice(0, 120) : e}`)
      }
    }
  }

  const pending = await db.aiAnalysisJob.count({ where: { status: "PENDING" } })
  const processing = await db.aiAnalysisJob.count({ where: { status: "PROCESSING" } })
  console.log("\n=== Summary ===")
  console.log(tally, { queuedList: queuedList.length })
  console.log(`DB queue now: PENDING=${pending} PROCESSING=${processing}`)
  void queuedList
}

void main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("FATAL:", e); process.exit(1) })
