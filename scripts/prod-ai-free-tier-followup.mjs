// Follow-up: same test user → verify report status + counting semantics.
const BASE = "https://egxano.vercel.app"
const EMAIL = process.argv[2]
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

const login = await post("/api/v1/auth/login", { email: EMAIL, password: PASSWORD })
if (login.status !== 200) {
  console.log("LOGIN_FAILED", login.status, JSON.stringify(login.json).slice(0, 200))
  process.exit(1)
}
const token = login.json.token ?? login.json.sessionToken ?? login.json.accessToken
const me = (await get("/api/v1/subscription/me", token)).json
console.log("usage now:", JSON.stringify(me.smartAnalysisUsage ?? null))

// ZMID report state
const g = await get("/api/v1/companies/ZMID/ai-analysis?lang=ar", token)
console.log("ZMID GET:", g.status, "gen=", g.json.generation?.status ?? "none", "analysis=", g.json.analysis ? `READY (${g.json.analysis.wordCount}w, ${g.json.analysis.model}, degraded=${g.json.analysis.degraded})` : "null")

// POST same report → cache_hit + charge
const p2 = await post("/api/v1/companies/ZMID/ai-analysis", { lang: "ar" }, token)
console.log("POST ZMID:", p2.status, "cached=", p2.json.cached, "charged=", p2.json.charged, "usage=", JSON.stringify(p2.json.usage))

// POST a different company (any with stored report) → next unit
for (const t of ["CANA", "ETEL", "SWDY", "TMGH", "EAST"]) {
  const r = await get(`/api/v1/companies/${t}/ai-analysis`, token)
  if (r.status === 200 && r.json.analysis !== null) {
    const p3 = await post(`/api/v1/companies/${t}/ai-analysis`, { lang: "ar" }, token)
    console.log(`POST ${t}:`, p3.status, "cached=", p3.json.cached, "charged=", p3.json.charged, "usage=", JSON.stringify(p3.json.usage))
    break
  }
}

// POST the same ZMID again → must NOT charge twice
const p4 = await post("/api/v1/companies/ZMID/ai-analysis", { lang: "ar" }, token)
console.log("POST ZMID again:", p4.status, "cached=", p4.json.cached, "charged=", p4.json.charged, "usage=", JSON.stringify(p4.json.usage))

const me2 = (await get("/api/v1/subscription/me", token)).json
console.log("usage final:", JSON.stringify(me2.smartAnalysisUsage ?? null))
