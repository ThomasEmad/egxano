import { NextRequest } from "next/server"
import { isAdmin } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { buildProviderChain } from "@/lib/ai/orchestrator/adapters"
import { breakerSnapshot } from "@/lib/ai/orchestrator/adapters"

// POST /api/v1/admin/ai-probe — provider-side connectivity diagnostics for the
// AI chat-completions path. Admin-only. Never returns or logs the API key.
//
// Motivation (2026-11-07): production showed GET {baseUrl}/models succeeding
// (84 live models, self-healing discovery working) while every POST
// /chat/completions timed out — regardless of prompt size — with a key that
// never produced an HTTP status. This probe separates the layers:
//   which:"fake"  — a syntactically-valid but WRONG nvapi-shaped key. If it
//     401s fast, the POST path and the auth edge are reachable from this
//     runtime; if it hangs too, the egress/WAF path itself is broken.
//   which:"real"  — the configured key against a tiny prompt, then sized
//     prompts, isolating inference latency from auth/WAF.

export const maxDuration = 30

// GET /api/v1/admin/ai-probe — the AI health snapshot, no live calls:
// which providers form the chain, which are configured, circuit-breaker
// state, and 24h success/failure per provider from the usage ledger.
// Answers "why is the AI down?" in one glance instead of guesswork.
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }
  const chain = buildProviderChain().map((a) => ({ id: a.id, kind: a.kind, configured: a.configured(), models: a.models() }))
  const since = new Date(Date.now() - 24 * 3600_000)
  let usage24h: { provider: string; ok: number; fail: number; lastErrorKind: string | null; lastErrorAt: Date | null }[] = []
  try {
    const rows = await db.aiProviderUsage.groupBy({
      by: ["provider", "ok"],
      where: { createdAt: { gte: since }, kind: { in: ["chat", "report", "probe"] } },
      _count: { _all: true },
      _max: { createdAt: true },
    })
    const merged = new Map<string, { ok: number; fail: number }>()
    for (const r of rows) {
      const m = merged.get(r.provider) ?? { ok: 0, fail: 0 }
      if (r.ok) m.ok += r._count._all
      else m.fail += r._count._all
      merged.set(r.provider, m)
    }
    const lastFail = await db.aiProviderUsage.findFirst({
      where: { createdAt: { gte: since }, ok: false },
      orderBy: { createdAt: "desc" },
      select: { provider: true, errorKind: true, createdAt: true },
    })
    usage24h = [...merged.entries()].map(([provider, m]) => ({
      provider,
      ok: m.ok,
      fail: m.fail,
      lastErrorKind: lastFail && lastFail.provider === provider ? lastFail.errorKind : null,
      lastErrorAt: lastFail && lastFail.provider === provider ? lastFail.createdAt : null,
    }))
  } catch {
    // ledger unavailable (fresh DB / migration lag) — the chain view still works
  }
  return Response.json({
    chain,
    breakers: breakerSnapshot(),
    usage24h,
    checkedAt: new Date().toISOString(),
  })
}

const PROBE_TIMEOUT_MS = 22_000

function fakeNvapiKey(): string {
  // Syntactically valid JWT shape (header.payload.signature) with a
  // deliberately wrong signature. NOT a real credential of any kind.
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
  return `nvapi-${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "probe", exp: 9999999999 })}.cHJvYmUtZmFrZS1zaWduYXR1cmU`
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }
  const baseUrl = (
    process.env.AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/"
  )
    .trim()
    .replace(/\/+$/, "")
  const realKey = (process.env.AI_API_KEY || "").trim()
  const model = (process.env.AI_MODEL || "gemini-3.8-flash").trim()

  const body = (await req.json().catch(() => ({}))) as {
    which?: string
    stream?: boolean
    sizeKB?: number
    model?: string
  }
  const which = body.which === "fake" ? "fake" : "real"
  const stream = Boolean(body.stream)
  const sizeKB = Math.min(Math.max(Number(body.sizeKB) || 0, 0), 200)
  const useModel = typeof body.model === "string" && body.model.trim() ? body.model.trim() : model

  const filler = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(4200)
  const userContent =
    sizeKB > 0
      ? `${filler.slice(0, sizeKB * 1024)}\nReply with the single word OK.`
      : "Reply with the single word OK."

  const payload = {
    model: useModel,
    messages: [{ role: "user", content: userContent }],
    stream,
    max_tokens: 8,
  }
  const key = which === "fake" ? fakeNvapiKey() : realKey
  const started = Date.now()
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const text = (await res.text()).slice(0, 200)
    return Response.json({
      probe: { which, stream, sizeKB, model: useModel },
      baseUrlHost: new URL(baseUrl).host,
      latencyMs: Date.now() - started,
      status: res.status,
      responseHead: text,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return Response.json({
      probe: { which, stream, sizeKB, model: useModel },
      baseUrlHost: new URL(baseUrl).host,
      latencyMs: Date.now() - started,
      status: null,
      error: /abort|timeout/i.test(msg) ? "TIMEOUT (no HTTP response within budget)" : msg.slice(0, 200),
    })
  }
}
