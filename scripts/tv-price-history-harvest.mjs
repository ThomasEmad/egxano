// TradingView daily-bar harvester — imports real daily OHLCV sessions for all
// active EGX companies into the PriceBar table (technical engine data source).
//
// Source: TradingView's public chart websocket (15-min delayed EGX data), the
// SAME authorized public source the platform already uses for the market
// snapshot and financials. No paywall bypass; delayed data only.
//
// Usage:
//   node scripts/tv-price-history-harvest.mjs --probe=COMI   # one ticker, dump raw bars
//   node scripts/tv-price-history-harvest.mjs --apply [--limit=N] [--tickers=A,B] [--workers=N]
//   Default is DRY RUN (writes reports/tv-price-bars-dryrun.json only).

import fs from "node:fs"
import path from "node:path"
import { chromium } from "playwright"
import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()
const APPLY = process.argv.includes("--apply")
const arg = (name, dflt) => {
  const m = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!m) return dflt
  if (m === `--${name}`) return true
  return m.split("=").slice(1).join("=")
}
const PROBE = arg("probe", null) // ticker name or true
const LIMIT = Number(arg("limit", 0)) || 0
const WORKERS = Math.max(1, Number(arg("workers", 3)))
const DELAY_MS = Math.max(300, Number(arg("delay-ms", 700)))
const OUT_DIR = path.join(process.cwd(), "reports")

// Runs INSIDE the browser. TV framing: ~m~<len>~m~<payload> where the payload
// is PLAIN JSON (single-encoded — verified against the live protocol) and
// ~h~N heartbeats must be echoed verbatim.
const PULL_BARS_FN = async (symbol) => {
  return await new Promise((resolve) => {
    const barCount = 400;
    const bars = [];
    let ws = null;
    const timer = setTimeout(() => { finish({ error: 'timeout-45s', bars: [] }); }, 45000);
    let done = false;
    function finish(r) { if (done) return; done = true; clearTimeout(timer); try { ws && ws.close(); } catch (e) {} resolve(r); }
    function frame(payload) { return '~m~' + payload.length + '~m~' + payload; }
    function send(obj) { ws.send(frame(JSON.stringify(obj))); }
    try {
      ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket?from=chart%2F&type=chart');
      ws.onopen = () => {
        send({ m: 'set_auth_token', p: ['unauthorized_user_token'] });
        send({ m: 'chart_create_session', p: ['cs_sym0', ''] });
        send({ m: 'resolve_symbol', p: ['cs_sym0', 'sds_sym_1', '=' + JSON.stringify({ adjustment: 'splits', session: 'regular', symbol: symbol })] });
        send({ m: 'create_series', p: ['cs_sym0', 'sds_1', 's1', 'sds_sym_1', '1D', barCount, ''] });
      };
      ws.onmessage = (ev) => {
        const data = String(ev.data);
        const hb = data.match(/~m~(\d+)~m~(~h~\d+)/);
        if (hb) { ws.send(frame(hb[2])); return; }
        const chunks = data.split('~m~');
        for (let i = 1; i < chunks.length - 1; i += 2) {
          const payload = chunks[i + 1];
          if (chunks[i] !== String(payload.length)) continue;
          let msg;
          try { msg = JSON.parse(payload); } catch (e) { continue; }
          if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch (e) { continue; } }
          if (!msg || !msg.m) continue;
          if (msg.m === 'timescale_update' || msg.m === 'du') {
            const up = msg.p && msg.p[1];
            if (up && up.sds_1 && up.sds_1.s) {
              for (const row of up.sds_1.s) {
                const v = Array.isArray(row) ? row : row && row.v;
                if (v) bars.push(v);
              }
            }
          } else if (msg.m === 'series_completed') {
            finish({ bars });
            return;
          } else if (msg.m === 'symbol_error' || msg.m === 'critical_error' || msg.m === 'series_failed') {
            finish({ error: msg.m + ':' + JSON.stringify(msg.p).slice(0, 100), bars: [] });
            return;
          }
        }
      };
      ws.onerror = () => finish({ error: 'ws-error', bars: [] });
    } catch (e) { finish({ error: 'exception:' + e.message, bars: [] }); }
  });
}

function parseBar(row) {
  // TV 1D series row: [time, open, high, low, close, volume] with unix seconds
  // (float). Log one unexpected shape instead of silently mangling data.
  if (!Array.isArray(row) || row.length < 5) return null
  const [t, o, h, l, c, v] = row
  const time = typeof t === "number" ? new Date(t < 1e12 ? t * 1000 : t) : new Date(String(t))
  const nums = [o, h, l, c].map((x) => Number(x))
  if (isNaN(time.getTime()) || nums.some((x) => !Number.isFinite(x) || x <= 0)) return null
  if (nums[1] < nums[2]) return null // high < low → corrupt
  return {
    ts: new Date(Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), time.getUTCDate())),
    open: nums[0],
    high: nums[1],
    low: nums[2],
    close: nums[3],
    volume: v === undefined || v === null || !Number.isFinite(Number(v)) ? null : Number(v),
  }
}

async function pullOne(page, symbol) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await page.evaluate(PULL_BARS_FN, symbol)
    if (res && res.bars && res.bars.length) {
      const parsed = res.bars.map(parseBar).filter(Boolean)
      if (parsed.length) return parsed
    }
    if (attempt === 3) return []
    await new Promise((r) => setTimeout(r, 4000 * attempt))
  }
  return []
}

async function main() {
  if (!APPLY && !PROBE) console.log("DRY RUN — no DB writes (pass --apply)")
  const tickersArg = arg("tickers", "")
  let companies
  const probeTicker = typeof PROBE === "string" ? PROBE.toUpperCase() : null
  if (probeTicker) {
    companies = await db.company.findMany({ where: { ticker: probeTicker }, select: { id: true, ticker: true, nameEn: true } })
  } else if (typeof tickersArg === "string" && tickersArg) {
    const set = tickersArg.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
    companies = await db.company.findMany({ where: { ticker: { in: set } }, select: { id: true, ticker: true, nameEn: true } })
  } else {
    companies = await db.company.findMany({
      where: { isActive: true, listingStatus: { not: "DELISTED" } },
      select: { id: true, ticker: true, nameEn: true },
      orderBy: { ticker: "asc" },
    })
  }
  if (LIMIT) companies = companies.slice(0, LIMIT)
  console.log(`companies: ${companies.length}`)
  if (!companies.length) {
    console.log("no matching companies")
    await db.$disconnect()
    return
  }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
  const results = {}
  const errors = []
  let idx = 0

  async function worker(wid) {
    const context = await browser.newContext()
    const page = await context.newPage()
    // TV's websocket edge checks the Origin header — put the page on-site first.
    await page.goto("https://www.tradingview.com/robots.txt", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {})
    while (true) {
      const i = idx++
      if (i >= companies.length) break
      const c = companies[i]
      const symbol = `EGX:${c.ticker}`
      try {
        const bars = await pullOne(page, symbol)
        const first = bars[0]?.ts?.toISOString().slice(0, 10) ?? null
        const last = bars[bars.length - 1]?.ts?.toISOString().slice(0, 10) ?? null
        results[c.ticker] = { count: bars.length, first, last }
        if (PROBE) {
          console.log(JSON.stringify({ ticker: c.ticker, rawSample: bars.slice(0, 2), lastBars: bars.slice(-3) }, null, 1))
        }
        if (bars.length && APPLY) {
          let written = 0
          for (let j = 0; j < bars.length; j += 100) {
            const chunk = bars.slice(j, j + 100).map((b) => ({
              companyId: c.id, ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close,
              volume: b.volume, currency: "EGP", sourceName: "tradingview@daily",
            }))
            const r = await db.priceBar.createMany({ data: chunk, skipDuplicates: true })
            written += r.count
          }
          results[c.ticker].written = written
        }
        if (!PROBE) console.log(`[w${wid}] ${c.ticker}: ${bars.length} bars ${first || ""}→${last || ""}${APPLY ? ` written=${results[c.ticker].written ?? 0}` : ""}`)
        if (!bars.length) errors.push({ ticker: c.ticker, error: "no bars" })
      } catch (e) {
        errors.push({ ticker: c.ticker, error: String(e).slice(0, 140) })
        console.log(`[w${wid}] ${c.ticker}: ERROR ${String(e).slice(0, 120)}`)
      }
      await new Promise((r) => setTimeout(r, DELAY_MS))
    }
    await context.close()
  }

  await Promise.all(Array.from({ length: Math.min(WORKERS, companies.length) }, (_, i) => worker(i)))
  await browser.close()

  if (!PROBE) {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const outFile = path.join(OUT_DIR, `tv-price-bars-${APPLY ? "apply" : "dryrun"}.json`)
    const okCount = Object.values(results).filter((r) => r && r.count > 0).length
    fs.writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), apply: APPLY, ok: okCount, results, errors }, null, 1))
    console.log(`summary written: ${outFile}`)
    console.log(`companies ok: ${okCount}, empty/error: ${errors.length}`)
  }
  await db.$disconnect()
}

main().catch(async (e) => {
  console.error("FATAL", e)
  await db.$disconnect()
  process.exit(1)
})
