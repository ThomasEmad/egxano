// =============================================================================
// GET  /api/v1/companies/[id]/briefing — metadata + access decision (NO audio
// bytes ever: the client fetches the script and gate state, then POSTs to get
// the WAV).
// POST /api/v1/companies/[id]/briefing — play: auth required; resolves the
// plan, opens/keeps the FREE 24h per-stock trial, generates the narration on
// first play (synchronously — it fits the 60s budget) and streams audio bytes.
// =============================================================================

import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { findCompanyByKey } from "@/lib/company-lookup"
import { getOptionalUser } from "@/lib/optional-auth"
import { checkRateLimit } from "@/lib/rate-limit"
import {
  getBriefingFor,
  registerBriefingPlay,
  resolveBriefingAccess,
  resolveUserPlan,
  trialExpired,
  TRIAL_HOURS,
  type BriefingContent,
  type BriefingStatus,
} from "@/lib/briefing/service"

// Route budget: 60s covers POST's synchronous generation (snapshot + one TTS
// call); GET is a plain row read and finishes far inside it.
export const maxDuration = 60

const COMPANY_SELECT = { id: true, ticker: true, nameAr: true, isActive: true } as const

async function resolveCompany(id: string) {
  const company = await findCompanyByKey(id, COMPANY_SELECT)
  if (!company || !company.isActive) return null
  return company
}

// ------------------------------------------------------------------ GET

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const company = await resolveCompany(id)
  if (!company) return Response.json({ error: "NOT_FOUND" }, { status: 404 })

  const { userId } = await getOptionalUser(req)
  // Read-only: never build the snapshot or synthesize here — first play (POST)
  // owns generation. A FAILED row keeps its scriptAr so the client can fall
  // back to browser speech synthesis.
  const row = await db.stockBriefing.findUnique({ where: { companyId: company.id } })
  const status: BriefingStatus = row && row.status === "READY" && row.audio ? "READY" : row ? "FAILED" : "MISSING"

  const access = await resolveBriefingAccess(userId, company.id, status)

  return Response.json({
    ok: true,
    ticker: company.ticker,
    nameAr: company.nameAr ?? company.ticker,
    scriptAr: row?.scriptAr ?? "",
    status,
    hasAudio: !!row?.audio,
    durationSec: row?.durationSec ?? null,
    access: {
      plan: access.plan,
      allowed: access.allowed,
      trialExpiresAt: access.trialExpiresAt ? access.trialExpiresAt.toISOString() : null,
      reason: access.reason,
    },
    updatedAt: row ? row.updatedAt.toISOString() : null,
  })
}

// ------------------------------------------------------------------ POST (play)

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { userId } = await getOptionalUser(req)
  if (!userId) {
    // Listening requires an account so the 24h trial can be tracked per user.
    return Response.json(
      {
        error: "LOGIN_REQUIRED",
        reason: "LOGIN_REQUIRED",
        message: "سجّل دخول عشان تشغّل البريفينج المسموع — التجربة المجانية ليوم كامل لكل سهم بتتسجل على حسابك.",
      },
      { status: 401 },
    )
  }

  const company = await resolveCompany(id)
  if (!company) return Response.json({ error: "NOT_FOUND" }, { status: 404 })

  // Cheap spend-guard on TTS generation/play bursts (per user; in-memory limiter).
  const limit = await checkRateLimit(`briefing-play:${userId}`, 30, 10 * 60_000)
  if (!limit.allowed) {
    return Response.json(
      { reason: "RATE_LIMITED", message: "في طلبات كتير على المشغّل — استنى دقيقة وجرّب تاني." },
      { status: 429 },
    )
  }

  const plan = await resolveUserPlan(userId)

  if (plan === "FREE") {
    // Upsert keeps the ORIGINAL firstPlayedAt (update: {}) — the 24h window
    // opens at the first play and never slides forward.
    const firstPlayedAt = await registerBriefingPlay(userId, company.id)
    if (trialExpired(firstPlayedAt)) {
      return Response.json(
        {
          reason: "TRIAL_EXPIRED",
          message: "تجربة اليوم لسهم دي خلصت — البريفينج المسموع بلا حدود مع باقة برو.",
          upgradeUrl: "/premium",
          trialExpiresAt: firstPlayedAt
            ? new Date(firstPlayedAt.getTime() + TRIAL_HOURS * 3_600_000).toISOString()
            : null,
        },
        { status: 403 },
      )
    }
  }

  // PRO / PRO_PLUS → serve directly; FREE inside the window → serve.
  // Generation happens synchronously here (script + one TTS call fits 60s).
  let result: BriefingContent | null
  try {
    result = await getBriefingFor(company.id, { includeAudio: true })
  } catch (e) {
    console.error("[briefing-route] generation failed:", e instanceof Error ? e.message : e)
    return Response.json(
      { reason: "FAILED", message: "حصلت مشكلة وأنا بنجهّز القراءة الصوتية — جرّب تاني بعد شوية." },
      { status: 503 },
    )
  }
  if (!result) return Response.json({ error: "NOT_FOUND" }, { status: 404 })

  if (result.audio) {
    const body = new Uint8Array(result.audio)
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(body.byteLength),
        // Per-user, per-trial content — never cached by any intermediary.
        "Cache-Control": "private, no-store",
      },
    })
  }

  // Synthesis failed → client falls back to browser speech with scriptAr from GET.
  return Response.json(
    { reason: "FAILED", message: result.errorMessage ?? "الصوت مش متاح دلوقتي — القراءة النصية متاحة تحت." },
    { status: 503 },
  )
}
