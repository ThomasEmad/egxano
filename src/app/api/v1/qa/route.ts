import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { answerQuestion } from "@/lib/ai/answer-engine"
import { getActivePlanId } from "@/lib/subscription"
import { PLANS } from "@/lib/plans/entitlements"
import { hashToken } from "@/lib/secure-compare"
import { getClientIp } from "@/lib/rate-limit"

// POST /api/v1/qa — grounded Q&A over verified DB data.
// Quotas (honest, no fake "AI") come from the plans entitlements so the
// marketing copy can never drift: anonymous 10/day per IP · FREE 20/day ·
// PRO 60/day · PRO_PLUS 120/day.
// The engine is deterministic over verified DB rows (no LLM spend per answer),
// so the generous quotas cost only DB reads; the old 3/day anonymous cap was
// the #1 "the AI is broken" report — three questions and a 429 reads as breakage.
//
// Security notes:
//   • session tokens are stored SHA-256-hashed (auth.ts) — every lookup must
//     hash the raw header token first, otherwise logged-in users silently fall
//     back to the anonymous quota bucket;
//   • the quota bucket uses getClientIp() (trusted-proxy aware) — reading
//     x-forwarded-for directly would let a client rotate fake IPs to bypass
//     the anonymous daily quota.

const RATE = new Map<string, { day: string; count: number }>()
const ANONYMOUS_LIMIT = 10

function headerToken(req: NextRequest): string | null {
  return req.headers.get("x-session-token") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null
}

function bucketKey(req: NextRequest): string {
  const token = headerToken(req)
  // hash before using as a bucket key too — a raw token in a map key is a
  // memory-resident secret copy we don't need
  if (token) return `u:${hashToken(token)}`
  return `ip:${getClientIp(req)}`
}

export async function POST(req: NextRequest) {
  let body: { question?: unknown; companyId?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "INVALID_PAYLOAD", message: "Body must be JSON." }, { status: 400 })
  }
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 300) : ""
  const companyId = typeof body.companyId === "string" && body.companyId.length > 10 ? body.companyId : null
  if (question.length < 3) {
    return Response.json({ error: "INVALID_PAYLOAD", message: "Question is too short." }, { status: 400 })
  }

  // quota check / bump
  const key = bucketKey(req)
  const today = new Date().toISOString().slice(0, 10)
  const entry = RATE.get(key) ?? { day: today, count: 0 }
  if (entry.day !== today) {
    entry.day = today
    entry.count = 0
  }

  // resolve tier for the limit (token → user → plan entitlements)
  const token = headerToken(req)
  let limit: number = ANONYMOUS_LIMIT
  if (token) {
    // sessions store hashed tokens — hash the raw header token before lookup
    const userId = await db.session
      .findUnique({ where: { token: hashToken(token) }, select: { userId: true } })
      .then((s) => s?.userId ?? null)
    if (userId) limit = PLANS[await getActivePlanId(userId)].limits.qaPerDay
  }

  if (entry.count >= limit) {
    return Response.json(
      { error: "QUOTA_EXCEEDED", message: `استهلكت حصة أسئلة اليوم (${limit}) — باقة برو أو برو بلس بتمنحك حصة أكبر بكثير.`, limit, resetAt: `${today}T23:59:59Z` },
      { status: 429 }
    )
  }

  try {
    const answer = await answerQuestion(question, { companyId })
    entry.count += 1
    RATE.set(key, entry)
    return Response.json({ ...answer, usage: { used: entry.count, limit } })
  } catch (err) {
    console.error("qa-error", err)
    return Response.json({ error: "QA_FAILED", message: "حصل خطأ أثناء تجهيز الإجابة — حاول تاني." }, { status: 500 })
  }
}
