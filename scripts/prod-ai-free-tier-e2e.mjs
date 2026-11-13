// Production E2E — free-tier AI analysis counting + generation (per owner's
// instruction: test FROM THE SITE on a company WITHOUT a stored analysis,
// never on ABUK). Read-only + one job; prints a compact verdict.
const BASE = "https://egxano.vercel.app"
const ts = Date.now().toString(36)
const EMAIL = `qa-free-tier-${ts}@egxano-test.com`
const PASSWORD = "QaPass-2026-egx!"

const post = async (path, body, token) => {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "x-session-token": token } : {}) },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(90_000),
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
const get = async (path, token) => {
  const res = await fetch(BASE + path, { headers: token ? { "x-session-token": token } : {}, signal: AbortSignal.timeout(60_000) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

const reg = await post("/api/v1/auth/register", { email: EMAIL, password: PASSWORD, name: "QA Free Tier" })
if (reg.status !== 201) {
  console.log("REGISTER_FAILED", reg.status, JSON.stringify(reg.json).slice(0, 200))
  process.exit(1)
}
const token = reg.json.token
const me0 = (await get("/api/v1/subscription/me", token)).json
console.log("registered:", EMAIL, "| usage:", JSON.stringify(me0.smartAnalysisUsage ?? null))

// 1) find a company WITHOUT a stored analysis (GET never triggers generation)
const candidates = ["CANA", "ETEL", "SWDY", "TMGH", "EAST", "ZMID", "ORWE", "CLHO", "PHDC", "ALCN"]
let target = null
for (const t of candidates) {
  const r = await get(`/api/v1/companies/${t}/ai-analysis`, token)
  if (r.status === 404) continue
  if (r.status === 200 && r.json.analysis === null) {
    target = t
    break
  }
  if (r.status === 200 && r.json.analysis !== null) console.log(`skip ${t}: analysis already stored`)
}
if (!target) {
  console.log("NO_CANDIDATE_WITHOUT_ANALYSIS (all probed had stored reports or were 404)")
  process.exit(0)
}
console.log("target (no stored analysis):", target)

// 2) POST — should consume 1 unit (queued or inline-completed)
const t0 = Date.now()
const p1 = await post(`/api/v1/companies/${target}/ai-analysis`, { lang: "ar" }, token)
console.log(`POST#1 ${target}: ${p1.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s | usage:`, JSON.stringify(p1.json.usage ?? null), "| charged:", p1.json.charged ?? "-", "| status:", p1.json.status ?? (p1.json.analysis ? "completed-inline" : "?"))
const reportKey1 = p1.json.reportKey ?? null

// 3) poll until completed (≤8 min; the 5-min GitHub Actions heartbeat wakes jobs)
let done = p1.json.analysis ? p1.json.analysis : null
if (!done) {
  for (let i = 0; i < 8 && !done; i++) {
    await new Promise((r) => setTimeout(r, 60_000))
    const g = await get(`/api/v1/companies/${target}/ai-analysis?lang=ar`, token)
    console.log(`poll#${i + 1}: ${g.status} gen=${g.json.generation?.status ?? "none"} analysis=${g.json.analysis ? "READY" : "null"}`)
    if (g.json.analysis) done = g.json.analysis
  }
}
if (done) {
  console.log("REPORT_READY:", JSON.stringify({ words: done.wordCount, model: done.model, degraded: done.degraded, stance: done.stance, lang: done.lang, completeness: !!done.completeness }))
} else {
  console.log("STILL_GENERATING after window — job queued; heartbeat will finish it (verdict: enqueue path OK)")
}

// 4) re-request the SAME report → cache_hit, charged:false, usage unchanged
const p2 = await post(`/api/v1/companies/${target}/ai-analysis`, { lang: "ar" }, token)
console.log(`POST#2 (same report): ${p2.status} cached=${p2.json.cached} charged=${p2.json.charged} usage=${JSON.stringify(p2.json.usage)}`)

// 5) a DIFFERENT company → charges the next unit (find one with a stored report is fine — cache_hit path)
let second = null
for (const t of candidates) {
  if (t === target) continue
  const r = await get(`/api/v1/companies/${t}/ai-analysis`, token)
  if (r.status === 200 && r.json.analysis !== null) {
    second = t
    break
  }
}
if (second) {
  const p3 = await post(`/api/v1/companies/${second}/ai-analysis`, { lang: "ar" }, token)
  console.log(`POST#3 (different ${second}): ${p3.status} cached=${p3.json.cached} charged=${p3.json.charged} usage=${JSON.stringify(p3.json.usage)}`)
} else {
  console.log("POST#3 skipped: no second candidate with a stored report")
}
console.log("EMAIL_FOR_RECORD:", EMAIL)
