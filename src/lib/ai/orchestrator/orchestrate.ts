// =============================================================================
// Orchestrator — one entry point for grounded AI generation with provider
// fallback, breaker/rate-limit gates, cost guards, and usage accounting.
// =============================================================================

import { db } from "@/lib/db"
import {
  AiUnavailableError,
  breakerAllows,
  breakerRecord,
  buildProviderChain,
  rateLimitAllows,
  withGenerationSlot,
  type AiProviderAdapter,
  classifyError,
  type AttemptInfo,
  type GenerateRequest,
  type GenerateResult,
} from "./adapters"

export * from "./adapters"

/** Setting key that flips ALL AI generation off instantly (emergency stop). */
export const KILL_SWITCH_KEY = "ai_kill_switch"
/** Setting key: hard daily spend ceiling in USD (estimated cost accounting). */
export const SPEND_CAP_KEY = "ai_daily_spend_cap_usd"

const SETTING_CACHE_MS = 30_000
let settingCache: { at: number; kill: boolean; capUsd: number | null } | null = null

async function readGuardSettings(): Promise<{ kill: boolean; capUsd: number | null }> {
  if (settingCache && Date.now() - settingCache.at < SETTING_CACHE_MS) {
    return { kill: settingCache.kill, capUsd: settingCache.capUsd }
  }
  try {
    const rows = await db.setting.findMany({
      where: { key: { in: [KILL_SWITCH_KEY, SPEND_CAP_KEY] } },
      select: { key: true, value: true },
    })
    const kill = rows.find((r) => r.key === KILL_SWITCH_KEY)?.value?.trim().toLowerCase() === "true"
    const capRaw = rows.find((r) => r.key === SPEND_CAP_KEY)?.value
    const capUsd = capRaw && Number.isFinite(Number(capRaw)) ? Number(capRaw) : null
    settingCache = { at: Date.now(), kill, capUsd }
    return { kill, capUsd }
  } catch {
    // Settings table unreadable → fail OPEN for kill switch (AI stays on);
    // the generation path itself will surface any real DB problem.
    return { kill: false, capUsd: null }
  }
}

export function _resetGuardCacheForTests(): void {
  settingCache = null
}

/** Today's accumulated AI spend (ok calls only), from usage accounting. */
export async function todaySpendUsd(): Promise<number> {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const agg = await db.aiProviderUsage.aggregate({
    _sum: { costUsdEst: true },
    where: { createdAt: { gte: start }, ok: true },
  })
  return agg._sum.costUsdEst ?? 0
}

export interface GuardStatus {
  kill: boolean
  capUsd: number | null
  spendUsd: number
  capReached: boolean
}

export async function guardStatus(): Promise<GuardStatus> {
  const { kill, capUsd } = await readGuardSettings()
  let spendUsd = 0
  try {
    spendUsd = await todaySpendUsd()
  } catch {
    spendUsd = 0
  }
  return { kill, capUsd, spendUsd, capReached: capUsd !== null && spendUsd >= capUsd }
}

/** Rough cost estimate: free-tier providers cost 0; configurable per-1M rates. */
function estimateCostUsd(providerId: string, model: string, tokensIn?: number, tokensOut?: number): number | null {
  if (!tokensIn && !tokensOut) return null
  const tableJson = process.env.AI_COST_TABLE_JSON || ""
  if (!tableJson) return null // no pricing table configured → cannot estimate
  try {
    const table = JSON.parse(tableJson) as Record<string, { in?: number; out?: number }>
    const key = Object.keys(table).find((k) => model.includes(k) || providerId.includes(k))
    if (!key) return null
    const rates = table[key]
    const inCost = ((tokensIn ?? 0) / 1_000_000) * (rates.in ?? 0)
    const outCost = ((tokensOut ?? 0) / 1_000_000) * (rates.out ?? 0)
    return Math.round((inCost + outCost) * 1e6) / 1e6
  } catch {
    return null
  }
}

async function recordUsage(args: {
  providerId: string
  model?: string
  kind: "report" | "chat" | "probe"
  ok: boolean
  errorKind?: AttemptInfo["kind"]
  tokensIn?: number
  tokensOut?: number
  latencyMs?: number
  companyId?: string
  reportKey?: string
}): Promise<void> {
  try {
    await db.aiProviderUsage.create({
      data: {
        provider: args.providerId,
        model: args.model ?? null,
        kind: args.kind,
        ok: args.ok,
        errorKind: args.errorKind ?? null,
        tokensIn: args.tokensIn ?? null,
        tokensOut: args.tokensOut ?? null,
        latencyMs: args.latencyMs ?? null,
        costUsdEst: estimateCostUsd(args.providerId, args.model ?? "", args.tokensIn, args.tokensOut),
        companyId: args.companyId ?? null,
        reportKey: args.reportKey ?? null,
      },
    })
  } catch {
    // accounting must never break generation
  }
}

export interface OrchestrateOptions extends GenerateRequest {
  kind: "report" | "chat" | "probe"
  companyId?: string
  reportKey?: string
  /** per-provider requests-per-minute cap (0 = unlimited) */
  providerRpm?: number
  /** ms budget for the WHOLE orchestration (defaults to timeoutMs) */
  totalBudgetMs?: number
  /** called for every failed attempt (diagnostics surface to the caller) */
  onAttempt?: (info: AttemptInfo) => void
  /** fixed chain override (tests) */
  chainOverride?: AiProviderAdapter[]
}

/**
 * Generate text via the provider chain: guards → per-provider breaker/rate
 * gates → generate → exponential backoff between providers → usage records.
 * Throws AiUnavailableError when every path is exhausted or a guard trips.
 */
export async function orchestrate(opts: OrchestrateOptions): Promise<GenerateResult> {
  // ---- 1. Hard guards (kill switch / daily spend cap) ----
  const { kill, capUsd } = await readGuardSettings()
  if (kill) {
    await recordUsage({ providerId: "guard", kind: opts.kind, ok: false, errorKind: "error", companyId: opts.companyId, reportKey: opts.reportKey })
    throw new AiUnavailableError("kill_switch", "AI generation is disabled by the administrator kill switch")
  }
  if (capUsd !== null) {
    try {
      const spend = await todaySpendUsd()
      if (spend >= capUsd) {
        await recordUsage({ providerId: "guard", kind: opts.kind, ok: false, errorKind: "error", companyId: opts.companyId, reportKey: opts.reportKey })
        throw new AiUnavailableError("spend_cap", `Daily AI spend cap reached (${spend.toFixed(2)} / ${capUsd} USD)`)
      }
    } catch (e) {
      if (e instanceof AiUnavailableError) throw e
      // spend check DB hiccup → proceed (cost cap is best-effort protection)
    }
  }

  // ---- 2. Build the chain ----
  const chain = opts.chainOverride ?? buildProviderChain()
  if (!chain.length) throw new AiUnavailableError("no_provider", "No AI provider is configured")

  const started = Date.now()
  const totalBudget = opts.totalBudgetMs ?? opts.timeoutMs
  const backoffBase = Number(process.env.AI_FALLBACK_BACKOFF_MS || "") || 800
  const errors: AttemptInfo[] = []

  for (let p = 0; p < chain.length; p++) {
    const adapter = chain[p]
    const remaining = totalBudget - (Date.now() - started)
    if (remaining < 5_000) break
    // Budget sharing v7 (2026-11-13): the first provider keeps ~85% of the
    // remaining budget and later providers share the reserved remainder.
    // Why: the real production failure (Nov 11-13) was the primary NVIDIA
    // attempt being squeezed into a 15-27s slice of a 46s inline window while
    // it demonstrably needs 15-30s on grounded ~40KB report prompts — and the
    // 40% reserved for the fallback was wasted anyway when the fallback
    // (anonymous Pollinations) could not serve in its slice. A fixed floor of
    // 15s keeps small windows (status-kick donations) viable; the reserve
    // still guarantees the fallback a real shot on large windows.
    const reserve = p === 0 ? Math.max(10_000, Math.floor(totalBudget * 0.15)) : 0
    const share =
      p === 0
        ? Math.min(remaining, Math.max(15_000, remaining - reserve))
        : Math.min(remaining, Math.max(8_000, remaining))
    if (!adapter.configured()) continue
    if (!breakerAllows(adapter.id)) {
      errors.push({ providerId: adapter.id, kind: "error", message: "circuit breaker open", at: Date.now() })
      continue
    }
    const rpm = opts.providerRpm ?? (Number(process.env[`AI_PROVIDER_${adapter.id.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}_RPM`] || "") || 30)
    if (!rateLimitAllows(adapter.id, rpm)) {
      errors.push({ providerId: adapter.id, kind: "rate_limit", message: "provider RPM cap", at: Date.now() })
      continue
    }
    try {
      const result = await withGenerationSlot(
        () =>
          adapter.generate(
            { system: opts.system, user: opts.user, history: opts.history, timeoutMs: Math.min(opts.timeoutMs, Math.floor(share)) },
            opts.onAttempt
          ),
        Math.min(60_000, Math.floor(share) + 5_000)
      )
      breakerRecord(adapter.id, true)
      await recordUsage({
        providerId: result.providerId,
        model: result.model,
        kind: opts.kind,
        ok: true,
        tokensIn: result.usage?.promptTokens,
        tokensOut: result.usage?.completionTokens,
        latencyMs: result.latencyMs,
        companyId: opts.companyId,
        reportKey: opts.reportKey,
      })
      return result
    } catch (err) {
      breakerRecord(adapter.id, false)
      // v7: real generation failures MUST land in the error summary — before
      // this, the thrown message was the misleading "no provider accepted
      // the request" even when two providers had clearly failed with
      // timeouts, hiding the actionable reason from the audit trail.
      errors.push({
        providerId: adapter.id,
        kind: classifyError(err),
        message: (err instanceof Error ? err.message : String(err)).slice(0, 160),
        at: Date.now(),
      })
      await recordUsage({
        providerId: adapter.id,
        kind: opts.kind,
        ok: false,
        errorKind: classifyError(err),
        latencyMs: Date.now() - started,
        companyId: opts.companyId,
        reportKey: opts.reportKey,
      })
      if (!(err instanceof AiUnavailableError) || err.kind !== "concurrency") {
        // concurrency rejections are local, not provider failures
      }
      if (err instanceof AiUnavailableError) throw err
      if (p < chain.length - 1) {
        const backoff = Math.min(backoffBase * 2 ** p, 4_000) + Math.floor(Math.random() * 250)
        await new Promise((r) => setTimeout(r, backoff))
      }
    }
  }

  const summary = errors
    .slice(0, 6)
    .map((e) => `${e.providerId}:${e.kind}${e.message ? `(${e.message.slice(0, 80)})` : ""}`)
    .join("; ")
  throw new AiUnavailableError("all_providers_failed", `All AI providers failed — ${summary || "no provider accepted the request"}`)
}
