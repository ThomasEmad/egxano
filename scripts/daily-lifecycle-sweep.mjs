// Daily plan-lifecycle sweep — generates transition alerts for every company
// whose persisted canonical stance is actionable (signalState "confirmed",
// or "watching" with a WatchingSetup).
//
// WHAT IT DOES (one pass):
//   1. lists the actionable stances (StanceSnapshot joined to Company, the
//      same single-source-of-truth rows the signals board reads);
//   2. recomputes each company's plan lifecycle over the recent PriceBar
//      window via the EXACT lifecycle-service read path
//      (src/lib/technical/lifecycle-service.ts — stance freshness gate,
//      420-day bar lookback, 21-session warmup, deterministic walk);
//   3. diffs each fresh view against the PREVIOUS persisted snapshot
//      (src/lib/notifications/lifecycle-alerts.ts — one alert per transition,
//      nothing on unchanged states, first observation is a baseline);
//   4. appends the new alerts to the bounded recent-alerts feed and updates
//      the per-company snapshot map — both persisted in the existing generic
//      `Setting` KV table (NO schema changes; same pattern as the board
//      snapshot, see src/lib/notifications/lifecycle-alerts-store.ts);
//   5. prints the run summary as this job's log.
//
// WHY tsx: the lifecycle engine is TypeScript inside the repo
// (src/lib/technical/lifecycle.ts + lifecycle-service.ts) and this script
// imports it instead of re-implementing it (zero logic drift). Run it with
// the repo's bundled tsx loader:
//
//   npx tsx scripts/daily-lifecycle-sweep.mjs               # DRY-RUN (default)
//   npx tsx scripts/daily-lifecycle-sweep.mjs --apply       # write state + alerts
//   npx tsx scripts/daily-lifecycle-sweep.mjs --apply --limit=50
//   npx tsx scripts/daily-lifecycle-sweep.mjs --feed-cap=100 --apply
//
// (bun also works: `bun scripts/daily-lifecycle-sweep.mjs` — it transpiles
// TS imports natively; plain `node` does NOT.)
//
// ENV: DATABASE_URL (PrismaClient reads it directly) — the same
// CANDLE_DB_URL secret the candles-refresh workflow uses. Exit code 0 on a
// clean run, 1 when any company's compute failed (the error lines are in
// the log) or the environment is missing.
//
// SCHEDULING: after the daily candles refresh + stance recompute
// (candles-refresh.yml: candles 13:30 UTC, then 6 stance-refresh batches) —
// see PRODUCTION_RUNBOOK.md for the exact line.
//
// OWNERSHIP: this script writes ONLY the two `lifecycle-sweep:*` Setting
// rows. It never touches PriceBar (the candles pipeline owns it),
// StanceSnapshot (the stance-refresh cron owns it), MarketPrice, or the
// NotificationOutbox (the user-scoped Web-Push delivery ledger).

import { db } from "../src/lib/db"
import { getCompanyLifecycle } from "../src/lib/technical/lifecycle-service"
import { runLifecycleSweep, EMPTY_BY_TYPE } from "../src/lib/notifications/lifecycle-sweep"
import {
  readLifecycleStateMap,
  writeLifecycleStateMap,
  readLifecycleAlertFeed,
  writeLifecycleAlertFeed,
} from "../src/lib/notifications/lifecycle-alerts-store"
import { ALERT_FEED_CAP } from "../src/lib/notifications/lifecycle-alerts"

// --- CLI -------------------------------------------------------------------
const args = process.argv.slice(2)
// Convention (import-missing-candles.mjs): DEFAULT IS DRY-RUN — nothing is
// written unless --apply is passed. --dry-run is accepted as an explicit
// synonym so scheduled invocations can self-document.
const apply = args.includes("--apply")
const dryRunFlag = args.includes("--dry-run")
const limitArg = args.find((a) => a.startsWith("--limit="))
const feedCapArg = args.find((a) => a.startsWith("--feed-cap="))
const maxCompanies = limitArg ? Math.max(1, Number(limitArg.slice("--limit=".length)) || 0) : Infinity
const feedCap = feedCapArg ? Math.max(1, Number(feedCapArg.slice("--feed-cap=".length)) || ALERT_FEED_CAP) : ALERT_FEED_CAP
const dryRun = apply ? false : true
void dryRunFlag

if (!process.env.DATABASE_URL) {
  console.error("[lifecycle_sweep] DATABASE_URL is not set in the environment — cannot reach the DB.")
  process.exit(1)
}

console.log(`[lifecycle_sweep] mode: ${dryRun ? "DRY-RUN (no writes — pass --apply to persist)" : "APPLY"}`)

// --- production deps -------------------------------------------------------

/** Companies with an actionable persisted stance, ticker-ordered for a
 *  stable run. The stance rows are the canonical single source of truth the
 *  board reads; "wait" rows and payload-less rows are filtered here so the
 *  sweep never queries bars for companies it cannot track.
 *
 *  @returns {Promise<{ companyId: string, ticker: string | null }[]>}
 */
async function listCompanies() {
  const rows = await db.stanceSnapshot.findMany({
    select: { companyId: true, stanceJson: true, company: { select: { ticker: true } } },
    orderBy: { company: { ticker: "asc" } },
  })
  const out = []
  for (const r of rows) {
    try {
      const stance = JSON.parse(r.stanceJson)
      const state = stance?.signalState
      if (state !== "confirmed" && state !== "watching") continue
      if (state === "watching" && !stance?.setup) continue // engine invariant: no setup → nothing to track
      out.push({ companyId: r.companyId, ticker: r.company?.ticker ?? null })
    } catch {
      // unparseable stance row — skip it (the stance-refresh cron owns that row's health)
    }
  }
  return out
}

/** @type {import("../src/lib/notifications/lifecycle-sweep").SweepDeps} */
const deps = {
  listCompanies,
  // The lifecycle-service read path — identical to the /api/v1/signals/lifecycle
  // route: canonical-stance freshness gate, 420-day bars, warmup gate, walk.
  async computeOne(companyId, ticker) {
    const res = await getCompanyLifecycle(companyId, { ticker })
    if (!res) return null
    return { companyId: res.companyId, ticker: res.ticker, signalState: res.signalState, view: res.lifecycle }
  },
  loadStateMap: () => readLifecycleStateMap(),
  saveStateMap: (map) => writeLifecycleStateMap(map, new Date().toISOString()),
  loadRecentAlerts: () => readLifecycleAlertFeed(),
  saveRecentAlerts: (alerts) => writeLifecycleAlertFeed(alerts, new Date().toISOString()),
  now: () => new Date(),
}

// --- run -------------------------------------------------------------------

const started = Date.now()
try {
  const summary = await runLifecycleSweep(deps, { dryRun, feedCap, maxCompanies })
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`[lifecycle_sweep] done in ${secs}s (${summary.startedAt} → ${summary.finishedAt})`)
  console.log(`  companies listed:   ${summary.companiesLoaded}`)
  console.log(`  tracked:            ${summary.tracked}`)
  console.log(`  skipped (no view):  ${summary.skipped}`)
  console.log(`  new alerts:         ${summary.alertsNew}${dryRun ? " (dry-run — nothing written)" : ""}`)
  for (const [type, n] of Object.entries(summary.byType)) {
    if (n > 0 && type in EMPTY_BY_TYPE) console.log(`    ${type.padEnd(12)} ${n}`)
  }
  console.log(`  state map ${summary.stateSaved ? "persisted" : dryRun ? "NOT persisted (dry-run)" : "persist FAILED"}`)
  console.log(`  alert feed ${summary.feedSaved ? "persisted" : "unchanged"}`)
  if (summary.errors.length > 0) {
    console.error(`[lifecycle_sweep] ${summary.errors.length} company error(s):`)
    for (const e of summary.errors) console.error(`  - ${e}`)
  }
  await db.$disconnect()
  process.exit(summary.errors.length > 0 ? 1 : 0)
} catch (err) {
  console.error(`[lifecycle_sweep] FAILED:`, err?.message ?? err)
  await db.$disconnect().catch(() => {})
  process.exit(1)
}
