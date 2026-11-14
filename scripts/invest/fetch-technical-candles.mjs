// Fetch the canonical technical bundle (adjusted daily OHLC candles) for the
// FREE-entitlement tickers (anonymous access allowed by the entitlement gate)
// and one non-free ticker to empirically confirm the 403 gate.
//   GET /api/v1/companies/<KEY>/technical   (KEY = ticker works via findCompanyByKey)
//   → { companyId, ticker, plan, snapshot, hash, candles: [{t,o,h,l,c}], stance, ... }
import { writeFileSync } from "node:fs"

const BASE = "https://egxano.vercel.app/api/v1/companies"
const OUT = "/tmp/egx-work/docs/notes/data/history-samples"
const FREE = ["COMI", "ETEL", "TMGH", "ABUK", "EFID"]
const GATED = ["HDBK"]

for (const ticker of [...FREE, ...GATED]) {
  const url = `${BASE}/${encodeURIComponent(ticker)}/technical`
  try {
    const res = await fetch(url, { cache: "no-store" })
    const json = await res.json()
    writeFileSync(`${OUT}/technical-candles-${ticker}.json`, JSON.stringify(json, null, 2))
    const n = Array.isArray(json?.candles) ? json.candles.length : 0
    console.log(JSON.stringify({
      ticker,
      httpStatus: res.status,
      candles: n,
      first: n ? json.candles[0]?.t : null,
      last: n ? json.candles[n - 1]?.t : null,
      snapSessions: json?.snapshot?.sessions ?? null,
      snapAsOf: json?.snapshot?.asOf ?? null,
      error: json?.error ?? null,
    }))
  } catch (e) {
    console.log(JSON.stringify({ ticker, error: String(e) }))
  }
  await new Promise((r) => setTimeout(r, 600))
}
console.log("DONE")
