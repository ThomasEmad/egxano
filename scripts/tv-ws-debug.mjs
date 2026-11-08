// One-off TV websocket protocol debugger — prints every message type received.
import { chromium } from "playwright"

const SYMBOL = process.argv[2] || "EGX:COMI"
const MODE = process.argv[3] || "double" // "double" = JSON-in-string, "single" = plain JSON

const FN = async ({ symbol, mode }) => {
  return await new Promise((resolve) => {
    const log = []
    let ws = null
    let done = false
    function finish(r) { if (done) return; done = true; try { ws && ws.close(); } catch (e) {} resolve(r) }
    function frame(p) { return '~m~' + p.length + '~m~' + p }
    function send(obj) {
      const enc = mode === 'double' ? JSON.stringify(JSON.stringify(obj)) : JSON.stringify(obj)
      log.push(['SEND', enc.slice(0, 100)])
      ws.send(frame(enc))
    }
    function sendRaw(str) { ws.send(frame(str)) }
    const timer = setTimeout(() => finish({ log }), 45000)
    ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket?from=chart%2F&type=chart')
    ws.onopen = () => {
      log.push(['OPEN'])
      send({ m: 'set_auth_token', p: ['unauthorized_user_token'] })
      send({ m: 'chart_create_session', p: ['cs_sym0', ''] })
      send({ m: 'resolve_symbol', p: ['cs_sym0', 'sds_sym_1', '=' + JSON.stringify({ adjustment: 'splits', session: 'regular', symbol: symbol })] })
      send({ m: 'create_series', p: ['cs_sym0', 'sds_1', 's1', 'sds_sym_1', '1D', 100, ''] })
    }
    ws.onmessage = (ev) => {
      const data = String(ev.data)
      // heartbeat frames ~h~N must be echoed verbatim
      const hb = data.match(/~m~(\d+)~m~(~h~\d+)/)
      if (hb) { ws.send(frame(hb[2])); log.push(['HB', hb[2]]); return }
      const chunks = data.split('~m~')
      for (let i = 1; i < chunks.length - 1; i += 2) {
        const payload = chunks[i + 1]
        if (chunks[i] !== String(payload.length)) { log.push(['BADFRAME', data.slice(0, 100)]); continue }
        let msg
        try { msg = JSON.parse(payload) } catch (e) { log.push(['PARSEFAIL', payload.slice(0, 150)]); continue }
        if (typeof msg === 'string') {
          try { msg = JSON.parse(msg) } catch (e) { log.push(['STR', msg.slice(0, 100)]); continue }
        }
        if (!msg || !msg.m) { log.push(['NOM', payload.slice(0, 100)]); continue }
        if (msg.m === 'timescale_update' || msg.m === 'du') {
          const node = msg.p && msg.p[1] ? msg.p[1] : {}
          const keys = Object.keys(node)
          let sample = null
          for (const k of keys) {
            if (node[k] && node[k].s && node[k].s.length) { sample = node[k].s.slice(0, 2); break }
          }
          log.push([msg.m, keys.join(','), JSON.stringify(sample).slice(0, 300)])
        } else {
          log.push([msg.m, JSON.stringify(msg.p).slice(0, 180)])
        }
        if (msg.m === 'series_completed') { clearTimeout(timer); finish({ log }); return }
        if (log.length > 60) { clearTimeout(timer); finish({ log }); return }
      }
    }
    ws.onerror = (e) => { log.push(['ERR', e && e.message ? e.message : 'ws-error']) }
    ws.onclose = (e) => { log.push(['CLOSE', e && e.code]); clearTimeout(timer); finish({ log }) }
  })
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
const page = await browser.newPage()
await page.goto(process.env.TV_PAGE || "https://www.tradingview.com/robots.txt", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {})
const { log } = await page.evaluate(FN, { symbol: SYMBOL, mode: MODE })
for (const row of log) console.log(JSON.stringify(row))
await browser.close()
