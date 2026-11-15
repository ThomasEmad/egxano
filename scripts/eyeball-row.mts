// eyeball one real row — the board's actual published Arabic text quality
import { computeCompanySignalV2 } from "@/lib/signals/engine"
import type { Bar } from "@/lib/signals/types"

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"

async function yahooBars(ticker: string): Promise<Bar[]> {
  const symbol = ticker.endsWith(".CA") ? ticker : `${ticker}.CA`
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`yahoo ${res.status}`)
  const d: any = await res.json()
  const r = d?.chart?.result?.[0]
  const ts: number[] = r.timestamp ?? []
  const q = r.indicators?.quote?.[0] ?? {}
  const bars: Bar[] = []
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i]
    if (![o, h, l, c].every((v: any) => Number.isFinite(v) && v > 0)) continue
    bars.push({ ts: new Date(ts[i] * 1000).toISOString().slice(0, 10), open: o, high: h, low: l, close: c, volume: Number.isFinite(q.volume?.[i]) ? q.volume[i] : null })
  }
  return bars
}

async function main() {
  for (const t of ["COMI", "TMGH", "ABUK"]) {
    const bars = await yahooBars(t)
    const row = computeCompanySignalV2({
      bars,
      identity: { companyId: "x", ticker: t, nameEn: t, nameAr: null, sector: "s", marketTier: "MAIN" },
      todaySession: bars[bars.length - 1].ts,
    })
    console.log(`\n=== ${t} (${row.asOf}) state=${row.state} type=${row.type} score=${row.score}`)
    if (row.plan) console.log(`plan: entry ${row.plan.entryLow}-${row.plan.entryHigh} stop ${row.plan.stop} T1 ${row.plan.target1} T2 ${row.plan.target2} RR ${row.plan.riskReward}`)
    if (row.setup) console.log(`setup: activation ${row.setup.activation} (gap ${row.setup.activationGapPct}%) prov RR ${row.setup.provisional.riskReward}`)
    for (const e of row.evidence.slice(0, 6)) console.log(` • [${e.group ?? "-"}${e.points !== undefined && e.points > 0 ? " +" + e.points : ""}] ${e.ar}`)
    if (row.invalidationAr) console.log(` إلغاء: ${row.invalidationAr}`)
    if (row.quality.notesAr.length) console.log(` ملاحظات: ${row.quality.notesAr.join(" | ")}`)
    await new Promise((r) => setTimeout(r, 800))
  }
}
void main()
