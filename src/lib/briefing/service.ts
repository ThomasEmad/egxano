// =============================================================================
// Briefing service — acquire → script → hash → cache → synthesize.
//
// Data acquisition reuses the EXACT builder the technical route uses
// (buildTechnicalBundleWithContext from src/lib/market/intelligence/context),
// which is also where corporate-action adjustment is applied — the briefing
// never re-adjusts the series. The snapshot is cached under its own key
// (`briefing-snapshot:<companyId>`, same 10-min TTL as the technical tab's
// cache) so repeated GET/POST calls don't rebuild the bundle, while the cache
// payload shape stays distinct from the technical-tab cache (no key collision).
//
// Caching identity: the script is deterministic (script.ts), so
// sha256(scriptAr) is the audio cache identity — a changed technical read
// changes the script → new hash → fresh narration; an unchanged script keeps
// the cached WAV (≤14 days old, per the refresh TTL).
//
// Concurrency: all check-then-act work runs inside withKeyLock(`briefing:<id>`)
// (single-process per-key mutex, same pattern as free-tier limits) so parallel
// play requests never spend the TTS quota twice for one company.
// =============================================================================

import { createHash } from "node:crypto"
import { db } from "@/lib/db"
import { cached } from "@/lib/server-cache"
import { withKeyLock } from "@/lib/key-lock"
import { buildTechnicalBundleWithContext } from "@/lib/market/intelligence/context"
import { PLANS, type PlanId } from "@/lib/plans/entitlements"
import { buildBriefingScript, estimateDurationSec } from "./script"
import { synthArabic } from "./tts"

/** Regenerate the WAV when the row is older than this, even if unchanged. */
const AUDIO_REFRESH_DAYS = 14
/** Trial window for FREE-plan users, derived from the entitlements table. */
export const TRIAL_HOURS = PLANS.FREE.limits.briefingTrialHours ?? 24

export type BriefingStatus = "READY" | "FAILED" | "MISSING"
export type BriefingAccessReason = "OK" | "LOGIN_REQUIRED" | "TRIAL_EXPIRED" | "GENERATING" | "FAILED"

export interface BriefingAccessInfo {
  plan: PlanId
  allowed: boolean
  trialExpiresAt: Date | null
  reason: BriefingAccessReason
}

export interface BriefingContent {
  ticker: string
  nameAr: string
  scriptAr: string
  status: BriefingStatus
  hasAudio: boolean
  durationSec: number | null
  voice: string | null
  updatedAt: Date | null
  errorMessage: string | null
  /** Present only when the caller asked to serve audio (POST). */
  audio: Buffer | null
}

// ------------------------------------------------------------- plan resolution

/**
 * Resolve the user's plan id (read-only mirror of isPremiumUser semantics:
 * ACTIVE subscription, not end-dated; plan name is one of FREE/PRO/PRO_PLUS).
 */
export async function resolveUserPlan(userId: string): Promise<PlanId> {
  try {
    const sub = await db.subscription.findUnique({
      where: { userId },
      select: { status: true, endDate: true, plan: { select: { name: true } } },
    })
    if (!sub || sub.status !== "ACTIVE") return "FREE"
    if (sub.endDate && new Date(sub.endDate) < new Date()) return "FREE"
    return sub.plan.name === "PRO" || sub.plan.name === "PRO_PLUS" ? sub.plan.name : "FREE"
  } catch {
    // Fail closed to FREE — the trial path keeps the feature usable.
    return "FREE"
  }
}

// ------------------------------------------------------------- access rules

/**
 * Access matrix for the briefing (spec: listening requires an account so the
 * 24h per-stock trial can be tracked):
 *   anonymous            → LOGIN_REQUIRED
 *   PRO / PRO_PLUS       → allowed (trial table untouched)
 *   FREE logged-in       → 24h window from the FIRST play per (user, stock)
 *   FAILED briefing      → not allowed (client falls back to browser speech)
 */
export async function resolveBriefingAccess(
  userId: string | null,
  companyId: string,
  status: BriefingStatus,
): Promise<BriefingAccessInfo> {
  const plan = userId ? await resolveUserPlan(userId) : "FREE"

  if (!userId) {
    return { plan: "FREE", allowed: false, trialExpiresAt: null, reason: "LOGIN_REQUIRED" }
  }
  if (status === "FAILED") {
    return { plan, allowed: false, trialExpiresAt: null, reason: "FAILED" }
  }
  if (plan !== "FREE") {
    return { plan, allowed: true, trialExpiresAt: null, reason: "OK" }
  }

  const trial = await db.briefingTrial.findUnique({
    where: { userId_companyId: { userId, companyId } },
    select: { firstPlayedAt: true },
  })
  if (!trial) {
    // Trial not started yet — the window opens at the FIRST play (POST).
    return { plan, allowed: true, trialExpiresAt: null, reason: "OK" }
  }
  const trialExpiresAt = new Date(trial.firstPlayedAt.getTime() + TRIAL_HOURS * 3_600_000)
  if (Date.now() < trialExpiresAt.getTime()) {
    return { plan, allowed: true, trialExpiresAt, reason: "OK" }
  }
  return { plan, allowed: false, trialExpiresAt, reason: "TRIAL_EXPIRED" }
}

// ------------------------------------------------------------- content

/**
 * Generate-or-serve the briefing for a company. Returns null when the company
 * does not exist or is inactive.
 *
 * @param opts.includeAudio include the WAV bytes in the result (POST only —
 *        GET responses must stay lightweight and never carry audio).
 * @param opts.force bypass the fresh-row shortcut (re-synthesize).
 */
export async function getBriefingFor(
  companyId: string,
  opts: { includeAudio?: boolean; force?: boolean } = {},
): Promise<BriefingContent | null> {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { id: true, ticker: true, nameAr: true, isActive: true },
  })
  if (!company || !company.isActive) return null

  return withKeyLock(`briefing:${company.id}`, async () => {
    const scriptAr = await ensureScript(company.id, company.ticker, company.nameAr)
    const textHash = createHash("sha256").update(scriptAr).digest("hex")
    const now = Date.now()

    const row = await db.stockBriefing.findUnique({ where: { companyId: company.id } })
    const fresh =
      !!row &&
      !opts.force &&
      row.textHash === textHash &&
      row.status === "READY" &&
      !!row.audio &&
      now - row.updatedAt.getTime() < AUDIO_REFRESH_DAYS * 86_400_000

    if (fresh && row) {
      return {
        ticker: company.ticker,
        nameAr: company.nameAr ?? company.ticker,
        scriptAr: row.scriptAr,
        status: "READY" as const,
        hasAudio: true,
        durationSec: row.durationSec,
        voice: row.voice,
        updatedAt: row.updatedAt,
        errorMessage: null,
        audio: opts.includeAudio && row.audio ? Buffer.from(row.audio) : null,
      }
    }

    // Synthesize (first narration, stale audio, or force refresh).
    const synth = await synthArabic(scriptAr)
    if (synth) {
      // Prisma Bytes input is typed Uint8Array<ArrayBuffer> — hand it a plain
      // view over the WAV bytes (Buffer carries an ArrayBufferLike backer).
      const audioBytes = new Uint8Array(synth.audio)
      const saved = await db.stockBriefing.upsert({
        where: { companyId: company.id },
        create: {
          companyId: company.id,
          scriptAr,
          textHash,
          audio: audioBytes,
          audioMime: "audio/wav",
          durationSec: estimateDurationSec(synth.audio.length),
          voice: synth.voice,
          status: "READY",
          errorMessage: null,
        },
        update: {
          scriptAr,
          textHash,
          audio: audioBytes,
          audioMime: "audio/wav",
          durationSec: estimateDurationSec(synth.audio.length),
          voice: synth.voice,
          status: "READY",
          errorMessage: null,
        },
      })
      return {
        ticker: company.ticker,
        nameAr: company.nameAr ?? company.ticker,
        scriptAr: saved.scriptAr,
        status: "READY" as const,
        hasAudio: true,
        durationSec: saved.durationSec,
        voice: saved.voice,
        updatedAt: saved.updatedAt,
        errorMessage: null,
        audio: opts.includeAudio ? synth.audio : null,
      }
    }

    // Synthesis failed — persist the script + FAILED marker (audio fields are
    // cleared so a stale WAV can never be served against a new script).
    const saved = await db.stockBriefing.upsert({
      where: { companyId: company.id },
      create: {
        companyId: company.id,
        scriptAr,
        textHash,
        status: "FAILED",
        errorMessage: "فشل توليد الصوت — جرّب تاني بعد شوية.",
      },
      update: {
        scriptAr,
        textHash,
        status: "FAILED",
        errorMessage: "فشل توليد الصوت — جرّب تاني بعد شوية.",
        audio: null,
        audioMime: null,
        durationSec: null,
        voice: null,
      },
    })
    return {
      ticker: company.ticker,
      nameAr: company.nameAr ?? company.ticker,
      scriptAr: saved.scriptAr,
      status: "FAILED" as const,
      hasAudio: false,
      durationSec: null,
      voice: null,
      updatedAt: saved.updatedAt,
      errorMessage: saved.errorMessage,
      audio: null,
    }
  })
}

/**
 * Build the technical snapshot through the SAME acquisition path as
 * /api/v1/companies/[id]/technical (buildTechnicalBundleWithContext — the
 * corporate-action-adjusted bundle), memoized 10 minutes per company like the
 * technical route's cache. The script is derived deterministically from it.
 */
async function ensureScript(companyId: string, ticker: string, nameAr: string | null): Promise<string> {
  const bundle = await cached(`briefing-snapshot:${companyId}`, 10 * 60_000, () =>
    buildTechnicalBundleWithContext(companyId),
  )
  const { scriptAr } = buildBriefingScript({ ticker, nameAr, snapshot: bundle.snapshot })
  return scriptAr
}

// ------------------------------------------------------------- play bookkeeping

/**
 * Open/keep the FREE-plan per-stock trial: the FIRST create stamps
 * firstPlayedAt; every later play updates nothing (`update: {}`) so the
 * original timestamp — and therefore the 24h window — never moves.
 */
export async function registerBriefingPlay(userId: string, companyId: string): Promise<Date | null> {
  try {
    const trial = await db.briefingTrial.upsert({
      where: { userId_companyId: { userId, companyId } },
      create: { userId, companyId },
      update: {},
    })
    return trial.firstPlayedAt
  } catch (e) {
    // Rare P2002 race between two parallel plays — the row exists, just read it.
    console.warn("[briefing] trial upsert race, falling back to read:", e instanceof Error ? e.message : e)
    const trial = await db.briefingTrial
      .findUnique({ where: { userId_companyId: { userId, companyId } }, select: { firstPlayedAt: true } })
      .catch(() => null)
    return trial?.firstPlayedAt ?? null
  }
}

/** True when the (user, stock) trial window has fully elapsed. */
export function trialExpired(firstPlayedAt: Date | null): boolean {
  if (!firstPlayedAt) return false
  return Date.now() >= firstPlayedAt.getTime() + TRIAL_HOURS * 3_600_000
}
