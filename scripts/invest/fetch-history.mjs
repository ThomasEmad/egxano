// Fetch /api/v1/market/history for a fixed set of EGX tickers from production
// (read-only GET) and save each raw JSON response under
// docs/notes/data/history-samples/<TICKER>.json
//
// The endpoint's real contract (src/app/api/v1/market/history/route.ts):
//   GET ?symbol=<TICKER>&interval=1D|1W|1M|3M|6M|1Y|5Y&range=1D|...|5Y
//   → { symbol, interval, range, data: [{timestamp, price}], asOf }
// range caps: 1D/1W→100 rows, everything else→500 rows (hard LIMIT).
import { mkdirSync, writeFileSync } from "node:fs"

const BASE = "https://egxano.vercel.app/api/v1/market/history"
const OUT_DIR = "/tmp/egx-work/docs/notes/data/history-samples"

// 10 tickers spanning the requested profiles:
//   COMI mega-cap | ETEL mega telecom | ABUK EGX30 | TMGH EGX30 real estate
//   HRHO mega fintech | HDBK EGX70 bank | SWDY EGX70 industrial
//   CANA recently volatile (0.5 bonus 2026-11-12) | MEPA + ZEOT low-liquidity EGX70 seeds
const TICKERS = ["COMI", "ETEL", "ABUK", "TMGH", "HRHO", "HDBK", "SWDY", "CANA", "MEPA", "ZEOT"]
const RANGE = "5Y" // biggest allowed window → LIMIT 500 rows

mkdirSync(OUT_DIR, { recursive: true })

const summary = []
for (const ticker of TICKERS) {
  const url = `${BASE}?symbol=${encodeURIComponent(ticker)}&interval=1D&range=${RANGE}`
  try {
    const res = await fetch(url, { cache: "no-store" })
    const json = await res.json()
    writeFileSync(`${OUT_DIR}/${ticker}.json`, JSON.stringify(json, null, 2))
    const n = Array.isArray(json?.data) ? json.data.length : 0
    const first = n ? json.data[0]?.timestamp : null
    const last = n ? json.data[n - 1]?.timestamp : null
    summary.push({ ticker, httpStatus: res.status, points: n, first, last, note: json?.note ?? null, error: json?.error ?? null })
    console.log(JSON.stringify(summary.at(-1)))
  } catch (e) {
    summary.push({ ticker, error: String(e) })
    console.log(JSON.stringify(summary.at(-1)))
  }
  await new Promise((r) => setTimeout(r, 400))
}
writeFileSync(`${OUT_DIR}/_fetch-summary.json`, JSON.stringify(summary, null, 2))
console.log("DONE", summary.length, "tickers →", OUT_DIR)
