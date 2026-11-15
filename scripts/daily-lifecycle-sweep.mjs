// Daily plan-lifecycle sweep — generates transition alerts for every company
// whose persisted canonical stance is actionable (signalState "confirmed",
// or "watching" with a WatchingSetup).
//
// WHAT IT DOES (one pass, TWO alert layers — owner directive §10):
//   1. lists the actionable stances (StanceSnapshot joined to Company, the
//      same single-source-of-truth rows the signals board reads);
//   2. recomputes each company's plan lifecycle over the recent PriceBar
//      window via the EXACT lifecycle-service read path
//      (src/lib/technical/lifecycle-service.ts — stance freshness gate,
//      420-day bar lookback, 21-session warmup, deterministic walk);
//      the stance row and the fetched bars are CAPTURED from that same read
//      (memoized deps below) — the second layer reuses them with ZERO extra
//      queries;
//   3. [lifecycle layer] diffs each fresh view against the PREVIOUS persisted
//      snapshot (src/lib/notifications/lifecycle-alerts.ts — one alert per
//      transition, nothing on unchanged states, first observation is a
//      baseline);
//   4. [opportunity layer] for the SAME companies, builds the resistance map +
//      structural target ladder from the SAME captured bars
//      (src/lib/technical/resistance-map.ts + opportunity-targets.ts),
//      classifies the opportunity view (src/lib/technical/opportunity.ts),
//      diffs it against the PREVIOUS opportunity snapshot
//      (src/lib/notifications/opportunity-alerts.ts, Setting row
//      `opportunity-sweep:state:v1`) and emits the transition alerts
//      (none→actionable, observation→conditional, actionable→invalidated,
//      any→missed, eligible→upside-dropped-below-5%). Companies whose bars are
//      insufficient for an honest resistance map are SKIPPED (abstention, no
//      alert — never alert on stale/insufficient data);
//   5. appends the new alerts of BOTH kinds to the bounded SHARED recent-alerts
//      feed (each item carries a kind discriminator; existing readers — the
//      alerts route and the bell UI — pass whole items through unchanged) and
//      updates the per-company snapshot maps — all persisted in the existing
//      generic `Setting` KV table (NO schema changes; same pattern as the board
//      snapshot, see src/lib/notifications/lifecycle-alerts-store.ts);
//   6. prints both run summaries as this job's log.
//
// WHY tsx: the technical engine is TypeScript inside the repo
// (src/lib/technical/*.ts) and this script imports it instead of
// re-implementing it (zero logic drift). Run it with the repo's bundled tsx
// loader:
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
// clean run, 1 when any company's compute failed (the error lines are in the
// log) or the environment is missing.
//
// SCHEDULING: after the daily candles refresh + stance recompute
// (candles-refresh.yml: candles 13:30 UTC, then 6 stance-refresh batches) —
// see PRODUCTION_RUNBOOK.md for the exact line. The opportunity layer runs in
// the SAME invocation right after the lifecycle layer (same companies, same
// fetched bars) — no scheduling change.
//
// OWNERSHIP: this script writes ONLY the three `*-sweep:*` Setting rows
// (lifecycle state, opportunity state, the shared alerts feed). It never
// touches PriceBar (the candles pipeline owns it), StanceSnapshot (the
// stance-refresh cron owns it), MarketPrice, or the NotificationOutbox (the
// user-scoped Web-Push delivery ledger).

import { db } from "../src/lib/db"
import { getCompanyLifecycle, defaultLifecycleDeps } from "../src/lib/technical/lifecycle-service"
import { runLifecycleSweep, EMPTY_BY_TYPE } from "../src/lib/notifications/lifecycle-sweep"
import { runOpportunitySweep, OPPORTUNITY_EMPTY_BY_TYPE } from "../src/lib/notifications/opportunity-sweep"
import {
  readLifecycleStateMap,
  writeLifecycleStateMap,
  readLifecycleAlertFeed,
  writeLifecycleAlertFeed,
  readOpportunityStateMap,
  writeOpportunityStateMap,
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

/**
 * Shared fetch cache for one sweep invocation: the lifecycle pass's
 * computeOne captures the stance payload and the EXACT bars its
 * getCompanyLifecycle call already loaded (memoized LifecycleDeps — no second
 * query), and the opportunity pass reads the captured rows back. One DB read
 * per company feeds BOTH alert layers.
 *
 * @type {Map<string, object>} companyId → { companyId, ticker, signalState,
 *   view, bars, stance }
 */
const capturedRows = new Map()

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
  // The stance + bars it loads are captured (memoized deps) for the
  // opportunity layer — ZERO extra fetches.
  async computeOne(companyId, ticker) {
    const captured = { stance: null, bars: null }
    const memoDeps = {
      loadStance: async (cid) => {
        const loaded = await defaultLifecycleDeps.loadStance(cid)
        captured.stance = loaded
        return loaded
      },
      loadBars: async (cid, fromTs) => {
        const bars = await defaultLifecycleDeps.loadBars(cid, fromTs)
        captured.bars = bars
        return bars
      },
    }
    const res = await getCompanyLifecycle(companyId, { ticker, deps: memoDeps })
    if (!res) return null
    capturedRows.set(companyId, {
      companyId: res.companyId,
      ticker: res.ticker,
      signalState: res.signalState,
      view: res.lifecycle,
      bars: captured.bars ?? [],
      stance: captured.stance?.stance ?? null,
    })
    return { companyId: res.companyId, ticker: res.ticker, signalState: res.signalState, view: res.lifecycle }
  },
  loadStateMap: () => readLifecycleStateMap(),
  saveStateMap: (map) => writeLifecycleStateMap(map, new Date().toISOString()),
  loadRecentAlerts: () => readLifecycleAlertFeed(),
  saveRecentAlerts: (alerts) => writeLifecycleAlertFeed(alerts, new Date().toISOString()),
  now: () => new Date(),
}

/** @type {import("../src/lib/notifications/opportunity-sweep").OpportunitySweepDeps} */
const opportunityDeps = {
  listCompanies,
  // Shared-cache read: the lifecycle pass already fetched everything this
  // layer needs. A company the lifecycle pass could not compute (null view or
  // a contained error) has no cache entry → skipped here too (its error, if
  // any, is already in the lifecycle summary).
  async computeOne(companyId) {
    const row = capturedRows.get(companyId)
    if (!row) return null
    return {
      companyId: row.companyId,
      ticker: row.ticker,
      signalState: row.signalState,
      view: row.view,
      bars: row.bars,
      score: row.stance?.score ?? null,
      tradePlan: row.stance?.tradePlan ?? null,
      setup: row.stance?.setup ?? null,
    }
  },
  loadStateMap: () => readOpportunityStateMap(),
  saveStateMap: (map) => writeOpportunityStateMap(map, new Date().toISOString()),
  loadRecentAlerts: () => readLifecycleAlertFeed(),
  saveRecentAlerts: (alerts) => writeLifecycleAlertFeed(alerts, new Date().toISOString()),
  now: () => new Date(),
}

// --- run -------------------------------------------------------------------

const started = Date.now()
try {
  const summary = await runLifecycleSweep(deps, { dryRun, feedCap, maxCompanies })
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`[lifecycle_sweep] lifecycle layer done in ${secs}s (${summary.startedAt} → ${summary.finishedAt})`)
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
    console.error(`[lifecycle_sweep] ${summary.errors.length} lifecycle company error(s):`)
    for (const e of summary.errors) console.error(`  - ${e}`)
  }

  // --- opportunity layer (owner directive §10) — same companies, same bars.
  // In APPLY mode it loads the feed the lifecycle layer just saved, so both
  // kinds merge into one row; in DRY-RUN nothing is persisted by either layer.
  const oppSummary = await runOpportunitySweep(opportunityDeps, { dryRun, feedCap, maxCompanies })
  const oppSecs = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`[lifecycle_sweep] opportunity layer done in ${oppSecs}s (${oppSummary.startedAt} → ${oppSummary.finishedAt})`)
  console.log(`  companies listed:      ${oppSummary.companiesLoaded}`)
  console.log(`  classified + diffed:   ${oppSummary.tracked}`)
  console.log(`  skipped (no row):      ${oppSummary.skipped}`)
  console.log(`  abstained (insufficient bars/map): ${oppSummary.abstained}`)
  console.log(`  new alerts:            ${oppSummary.alertsNew}${dryRun ? " (dry-run — nothing written)" : ""}`)
  for (const [type, n] of Object.entries(oppSummary.byType)) {
    if (n > 0 && type in OPPORTUNITY_EMPTY_BY_TYPE) console.log(`    ${type.padEnd(18)} ${n}`)
  }
  console.log(`  opportunity state map ${oppSummary.stateSaved ? "persisted" : dryRun ? "NOT persisted (dry-run)" : "persist FAILED"}`)
  console.log(`  alert feed ${oppSummary.feedSaved ? "persisted" : "unchanged"}`)
  if (oppSummary.errors.length > 0) {
    console.error(`[lifecycle_sweep] ${oppSummary.errors.length} opportunity company error(s):`)
    for (const e of oppSummary.errors) console.error(`  - ${e}`)
  }

  await db.$disconnect()
  process.exit(summary.errors.length + oppSummary.errors.length > 0 ? 1 : 0)
} catch (err) {
  console.error(`[lifecycle_sweep] FAILED:`, err?.message ?? err)
  await db.$disconnect().catch(() => {})
  process.exit(1)
}
