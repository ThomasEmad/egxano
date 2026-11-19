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
// PRO 60/day (retired PRO_PLUS resolves to PRO).
// The quota day is the CALENDAR DAY IN AFRICA/CAIRO (the audience is
// Egyptian; a UTC day key reset the bucket at 02:00 Cairo). The counter is
// bumped BEFORE the answer is produced and refunded on failure — parallel
// requests each take their own slot (no check-then-act burst past the cap)
// and a failed answer never consumes quota. The in-memory map evicts
// stale-day entries when it outgrows a cheap size cap (a full DB-backed
// quota is out of scope here).
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
/** Cheap memory bound — when the map outgrows this, stale-day entries are swept. */
const RATE_MAX_ENTRIES = 10_000
/** The quota day boundary is Cairo-local, not UTC (audience is Egyptian). */
const CAIRO_TZ = "Africa/Cairo"

/** Calendar-day key in Africa/Cairo (YYYY-MM-DD) — not the server's/UTC day. */
function cairoDayKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CAIRO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

/** ISO instant of the NEXT Cairo midnight — when every bucket resets. */
function cairoDayEndIso(date: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: CAIRO_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]))
  const msIntoDay = ((Number(parts.hour) % 24) * 60 + Number(parts.minute)) * 60_000 + Number(parts.second) * 1000
  return new Date(date.getTime() + 86_400_000 - msIntoDay).toISOString()
}

/** Drop entries whose day key is stale (called when the map hits its cap). */
function sweepStaleEntries(today: string): void {
  for (const [k, e] of RATE) if (e.day !== today) RATE.delete(k)
}

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

  // quota check / bump — day key is Cairo-local (see header note)
  const key = bucketKey(req)
  const today = cairoDayKey()
  if (RATE.size >= RATE_MAX_ENTRIES) sweepStaleEntries(today)
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
      { error: "QUOTA_EXCEEDED", message: `استهلكت حصة أسئلة اليوم (${limit}) — الحصة بتتجدد بكرة، وباقة برو بتمنحك حصة أكبر.`, limit, resetAt: cairoDayEndIso() },
      { status: 429 }
    )
  }

  // Count BEFORE answering: parallel requests each see and take their own
  // slot (the old check-then-act let a simultaneous burst slip past the cap),
  // and a failed answer refunds its slot — errors never consume quota.
  entry.count += 1
  RATE.set(key, entry)
  try {
    const answer = await answerQuestion(question, { companyId })
    return Response.json({ ...answer, usage: { used: entry.count, limit } })
  } catch (err) {
    entry.count -= 1
    console.error("qa-error", err)
    return Response.json({ error: "QA_FAILED", message: "حصل خطأ أثناء تجهيز الإجابة — حاول تاني." }, { status: 500 })
  }
}
