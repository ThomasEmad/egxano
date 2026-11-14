import { readFileSync } from "node:fs"
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgresql://p:p@localhost:5432/p"
import { computeCloseSignal } from "../../.cache/engine-baseline/signals"
import { validateSeries } from "../../src/lib/backtesting/data-quality"

const cfg = { warmupSessions: 80, dailyPriceLimitPct: 20, costPerSidePct: 0.3, minRiskReward: 1, timeStopSessions: 20, allowOverlappingTrades: false, sellFwdHorizonSessions: 5, minSessions: 150 }
const q = JSON.parse(readFileSync(".cache/bt/ORAS.json", "utf8"))
const v = validateSeries(q, cfg)
console.log("ok:", v.ok, v.reasons, "rows:", v.rows.length)
console.log("first rows:", JSON.stringify(v.rows.slice(0, 3)))
console.log("nullish closes:", v.rows.filter((r) => r.close === null || r.close === undefined || !Number.isFinite(r.close)).length)
console.log("null volumes:", v.rows.filter((r) => r.volume === null).length)
const out = computeCloseSignal(v.rows.slice(0, 100))
console.log("engine@99:", JSON.stringify({ signal: out.signal, score: out.score, sessions: out.sessions, limitations: out.limitations }))
const outFull = computeCloseSignal(v.rows)
console.log("engine@full:", outFull.signal, outFull.score)
