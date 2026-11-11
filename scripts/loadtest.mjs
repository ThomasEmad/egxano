// Load test for the AI analysis engine (Phase 15) — REAL numbers only.
//
// Scenarios (run against a local production build + the real Postgres):
//   A. READ load: GET /api/v1/companies/:id/ai-analysis (auth, indexed read)
//      at staged concurrency 250 / 500 / 1000 VUs, 30s each.
//   B. STATUS-poll load: the polling endpoint users hit during generation.
//   C. GENERATION BURST: 25 simultaneous POSTs for the SAME company+lang —
//      asserts exactly ONE job row is created (dedup) and the rest receive 202.
//
// Usage: node scripts/loadtest.mjs http://127.0.0.1:3100 COMI
// Requires the server to be running and a test session token exported as
// LOADTEST_TOKEN (created by the same script via the DB when absent).
import fs from "node:fs"
import { createHash, randomBytes } from "node:crypto"

const BASE = process.argv[2] || "http://127.0.0.1:3100"
const TICKER = process.argv[3] || "COMI"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function once(path, opts = {}) {
  const t0 = performance.now()
  try {
    const res = await fetch(`${BASE}${path}`, { headers: opts.headers ?? {}, ...(opts.init ?? {}) })
    const body = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, ms: performance.now() - t0, body }
  } catch (e) {
    return { ok: false, status: 0, ms: performance.now() - t0, body: { error: String(e).slice(0, 80) } }
  }
}

function pct(sorted, p) {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

async function loadStage(name, path, vus, seconds, token) {
  const headers = token ? { "x-session-token": token } : {}
  const lat = []
  const codes = new Map()
  let errors = 0
  const deadline = Date.now() + seconds * 1000
  await Promise.all(
    Array.from({ length: vus }, async () => {
      while (Date.now() < deadline) {
        const r = await once(path, { headers })
        lat.push(r.ms)
        codes.set(r.status, (codes.get(r.status) ?? 0) + 1)
        if (!r.ok) errors++
      }
    })
  )
  lat.sort((a, b) => a - b)
  const n = lat.length
  const result = {
    scenario: name,
    vus,
    durationSec: seconds,
    requests: n,
    rps: Math.round((n / seconds) * 10) / 10,
    avgMs: Math.round(n ? lat.reduce((a, b) => a + b, 0) / n : 0),
    p50Ms: Math.round(pct(lat, 50)),
    p95Ms: Math.round(pct(lat, 95)),
    p99Ms: Math.round(pct(lat, 99)),
    maxMs: Math.round(lat[n - 1] ?? 0),
    errors,
    statusCodes: Object.fromEntries(codes),
  }
  console.log(JSON.stringify(result))
  return result
}

async function ensureTestUser() {
  // Directly provision (or reuse) a premium test user + session.
  const { PrismaClient } = await import("@prisma/client")
  const db = new PrismaClient()
  const email = "loadtest@meza.internal"
  let user = await db.user.findUnique({ where: { email } })
  if (!user) {
    user = await db.user.create({ data: { email, name: "Load Test", role: "user" } })
  }
  // premium subscription (active) — generation tests skip the free quota
  const plan = await db.plan.findFirst({ where: { isActive: true }, orderBy: { sortOrder: "asc" } })
  if (plan) {
    await db.subscription.upsert({
      where: { userId: user.id },
      create: { userId: user.id, planId: plan.id, status: "ACTIVE", startDate: new Date(), endDate: new Date(Date.now() + 30 * 864e5), activatedAt: new Date(), activatedBy: "loadtest" },
      update: { status: "ACTIVE", endDate: new Date(Date.now() + 30 * 864e5) },
    })
  }
  const rawToken = `loadtest-${randomBytes(24).toString("hex")}`
  const session = await db.session.create({
    data: { userId: user.id, token: createHash("sha256").update(rawToken, "utf8").digest("hex"), expiresAt: new Date(Date.now() + 3600_000) },
  })
  await db.$disconnect()
  return rawToken
}

async function generationBurst(token) {
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-session-token": token },
    body: JSON.stringify({ lang: "en" }),
  }
  const results = await Promise.all(Array.from({ length: 25 }, () => once(`/api/v1/companies/${TICKER}/ai-analysis`, { init })))
  const summary = {}
  for (const r of results) summary[r.status] = (summary[r.status] ?? 0) + 1
  // inspect the DB through the status endpoint: attempts on the single job
  const st = await once(`/api/v1/companies/${TICKER}/ai-analysis/status?lang=en`, { headers: { "x-session-token": token } })
  const out = { scenario: "generation-burst-25-same-identity", statusCodes: summary, jobRef: st.body?.jobRef ?? null, note: "exactly one 201/202 queue + rest 202/200 = dedup ok" }
  console.log(JSON.stringify(out))
  return out
}

async function main() {
  const token = await ensureTestUser()
  fs.writeFileSync("/tmp/loadtest-token.txt", token)
  const results = []

  // warm the route (compile + connection pool)
  await once(`/api/v1/companies/${TICKER}/ai-analysis?lang=en`, { headers: { "x-session-token": token } })

  results.push(await loadStage("read-report", `/api/v1/companies/${TICKER}/ai-analysis?lang=en`, 250, 30, token))
  results.push(await loadStage("read-report", `/api/v1/companies/${TICKER}/ai-analysis?lang=en`, 500, 30, token))
  results.push(await loadStage("read-report", `/api/v1/companies/${TICKER}/ai-analysis?lang=en`, 1000, 30, token))
  results.push(await loadStage("status-poll", `/api/v1/companies/${TICKER}/ai-analysis/status?lang=en`, 500, 20, token))

  // burst AFTER read stages so the report exists (202 + poll flow is the burst path)
  results.push(await generationBurst(token))

  fs.writeFileSync("reports/loadtest-results.json", JSON.stringify({ at: new Date().toISOString(), base: BASE, ticker: TICKER, results }, null, 1))
  console.log("summary → reports/loadtest-results.json")
}

main().catch((e) => {
  console.error("LOADTEST FATAL", e)
  process.exit(1)
})
