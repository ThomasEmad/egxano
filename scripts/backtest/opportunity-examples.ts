// OPPORTUNITY EXAMPLES — representative companies for the upgrade report §12
// + a micro-benchmark of the opportunity layer's per-ticker compute cost (§13).
//
//   npx tsx scripts/backtest/opportunity-examples.ts
//
// Uses the SAME frozen window data (.cache/bt) and the SAME loader/adjustment
// path as run-opportunity-validation.ts (validateSeries), the frozen engine for
// the "before" stance (old close-path language + plan), and the pure
// opportunity@1 modules for the "after" view. No lookahead: full history is
// the dataset, exactly like the production board sees it today.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { DEFAULT_BACKTEST_CONFIG } from "../../src/lib/backtesting/constants"
import { validateSeries, type CachedQuote } from "../../src/lib/backtesting/data-quality"
import { buildResistanceMap } from "../../src/lib/technical/resistance-map"
import { buildTargetLadder } from "../../src/lib/technical/opportunity-targets"
import { classifyOpportunity } from "../../src/lib/technical/opportunity"
import { computeCloseSignal } from "../../.cache/engine-baseline/signals"

const ROOT = path.resolve(import.meta.dirname, "../..")
const BT = path.join(ROOT, ".cache/bt")

// One per tier/sector family: EGX30 banks, EGX30 telecom, EGX70 food, EGX70 banks, MAIN construction.
const TICKERS = ["COMI", "ETEL", "POUL", "HDBK", "AALR"]

interface RowLike { ts: string; close: number; open?: number | null; high?: number | null; low?: number | null; volume?: number | null }

for (const t of TICKERS) {
  const qPath = path.join(BT, `${t}.json`)
  if (!existsSync(qPath)) { console.log(JSON.stringify({ ticker: t, skipped: "no cached quote" })); continue }
  const quote = JSON.parse(readFileSync(qPath, "utf8")) as CachedQuote
  const v = validateSeries(quote, DEFAULT_BACKTEST_CONFIG)
  if (!v.ok) { console.log(JSON.stringify({ ticker: t, skipped: v.reasons.join("; ") })); continue }
  const rows = v.rows as unknown as RowLike[]
  const bars = rows.map((r) => ({ ts: r.ts, open: r.open ?? r.close, high: r.high ?? r.close, low: r.low ?? r.close, close: r.close, volume: r.volume ?? null }))
  const lastClose = rows[rows.length - 1].close

  const tMap = performance.now()
  const map = buildResistanceMap(bars)
  const tAfterMap = performance.now()

  const stance = computeCloseSignal(rows.map((r) => ({ ts: r.ts, close: r.close, volume: r.volume ?? null })))
  const plan = stance.tradePlan
  const ladder = plan && plan.bias === "buy"
    ? buildTargetLadder(map, "buy", plan.entryLow, plan.entryHigh, lastClose)
    : null
  const view = classifyOpportunity({
    lastClose,
    signalState: stance.signal === "buy" ? "confirmed" : "wait",
    score: stance.score ?? 0,
    direction: plan?.bias ?? null,
    tradePlan: plan,
    setup: null,
    lifecycleView: null,
    zones: map.zones,
    ladder,
  })
  const tEnd = performance.now()

  console.log(JSON.stringify({
    ticker: t,
    asOf: stance.asOf,
    lastClose,
    // "before" — the frozen v2 close-path engine's own output
    before: {
      engineVersion: stance.version,
      signal: stance.signal,
      score: stance.score,
      tradePlan: plan && { bias: plan.bias, entryLow: plan.entryLow, entryHigh: plan.entryHigh, stop: plan.stop, targetLow: plan.targetLow, targetHigh: plan.targetHigh, riskReward: plan.riskReward, targetKind: plan.targetKind, basisAr: plan.basisAr },
      topReasonsAr: stance.reasons.slice(0, 2).map((r) => r.ar),
    },
    // "after" — opportunity@1 on the same data
    supplyZones: map.available
      ? map.zones.filter((z) => z.kind === "supply").slice(0, 2).map((z) => ({ low: z.low, high: z.high, strength: z.strength, touches: z.touches, lastTouchTs: z.lastTouchTs }))
      : null,
    ladder: ladder ? ladder.targets.map((x) => ({ label: x.label, price: x.price, kind: x.kind, strength: x.strength, whyAr: x.whyAr })) : null,
    view: {
      state: view.state,
      eligible: view.eligible,
      upsidePctToT1: view.upsidePctToT1,
      qualifies5: view.qualifies5,
      rrOk: view.rrOk,
      stateNoteAr: view.stateNoteAr,
      rejectionReasonsAr: view.rejectionReasonsAr,
      watchNextAr: view.watchNextAr,
    },
    perfMs: { map: +(tAfterMap - tMap).toFixed(2), classify: +(tEnd - tAfterMap).toFixed(2) },
  }, null, 1))
}
