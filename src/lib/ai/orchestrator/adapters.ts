// =============================================================================
// AI orchestrator — provider registry, adapters, resilience primitives.
// =============================================================================
//
// Business logic (financial/technical engines, reports, jobs) depends ONLY on
// this module — never on a concrete provider. The existing integrations (the
// env-configured OpenAI-compatible chain used in production, additional
// configured providers, and the sandbox z-ai SDK) plug in as interchangeable
// adapters behind one interface.
//
// Provider configuration (env):
//   AI_PROVIDERS="id1,id2"            → additional providers beyond the primary
//   AI_PROVIDER_<ID>_BASE_URL         → endpoint (OpenAI-compatible)
//   AI_PROVIDER_<ID>_API_KEY|_KEYS    → credentials (comma list, rotated)
//   AI_PROVIDER_<ID>_MODELS           → explicit model priority chain
//   AI_PROVIDER_<ID>_THINKING         → on|off (NVIDIA reasoning)
//   AI_MAX_CONCURRENCY                → in-process generation cap (default 3)
//
// The legacy flat configuration (AI_API_KEY / AI_BASE_URL / AI_MODELS /
// AI_API_KEYS / AI_MODEL / AI_MODEL_FALLBACK) keeps working unchanged as the
// FIRST provider — the currently-deployed env needs no migration.

import {
  chatViaExternalApi,
  chatViaSandboxSdk,
  externalAiConfigured,
  _resetQuarantineForTests,
  type ExternalProviderConfig,
} from "@/lib/ai/provider"

export interface GenerateRequest {
  system: string
  user: string
  history?: { role: "user" | "assistant"; content: string }[]
  /** total budget across all attempts inside one provider */
  timeoutMs: number
}

export interface GenerateResult {
  content: string
  providerId: string
  model: string
  usage?: { promptTokens?: number; completionTokens?: number }
  latencyMs: number
}

export interface AttemptInfo {
  providerId: string
  model?: string
  kind: "timeout" | "rate_limit" | "auth" | "server" | "network" | "parse" | "empty" | "error"
  message: string
  at: number
}

export class AiUnavailableError extends Error {
  readonly kind: "kill_switch" | "spend_cap" | "all_providers_failed" | "no_provider" | "concurrency"
  constructor(kind: AiUnavailableError["kind"], message: string) {
    super(message)
    this.kind = kind
  }
}

/** Classify a provider failure for usage accounting and breaker decisions. */
export function classifyError(err: unknown): AttemptInfo["kind"] {
  const msg = err instanceof Error ? err.message : String(err)
  if (/timed? ?out|timeout|aborted/i.test(msg)) return "timeout"
  if (/RATE_LIMITED|429|rate.?limit|slot busy/i.test(msg)) return "rate_limit"
  if (/401|403|API key|unauthorized/i.test(msg)) return "auth"
  if (/JSON|parse|malformed/i.test(msg)) return "parse"
  if (/empty/i.test(msg)) return "empty"
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED/i.test(msg)) return "network"
  if (/5\d\d|server/i.test(msg)) return "server"
  return "error"
}

// ---------------------------------------------------------------------------
// Adapters — one interface, interchangeable implementations
// ---------------------------------------------------------------------------

export interface AiProviderAdapter {
  readonly id: string
  readonly kind: "openai-compatible" | "zai-sdk"
  configured(): boolean
  /** priority model chain (informational; the transport self-heals retirements) */
  models(): string[]
  generate(req: GenerateRequest, reportAttempt?: (info: AttemptInfo) => void): Promise<GenerateResult>
}

/** Adapter over the OpenAI-compatible transport (works for ANY such endpoint). */
export function createOpenAiAdapter(cfg: ExternalProviderConfig): AiProviderAdapter {
  return {
    id: cfg.id,
    kind: "openai-compatible",
    configured: () => cfg.apiKeys.length > 0 && Boolean(cfg.baseUrl),
    models: () => cfg.models ?? [],
    async generate(req, reportAttempt) {
      const started = Date.now()
      try {
        const res = await chatViaExternalApi(
          { system: req.system, user: req.user, history: req.history, timeoutMs: req.timeoutMs },
          cfg
        )
        if (!res.content.trim()) throw new Error("empty response from provider")
        return {
          content: res.content,
          providerId: cfg.id,
          model: res.model,
          usage: res.usage,
          latencyMs: Date.now() - started,
        }
      } catch (err) {
        reportAttempt?.({
          providerId: cfg.id,
          kind: classifyError(err),
          message: (err instanceof Error ? err.message : String(err)).slice(0, 400),
          at: Date.now(),
        })
        throw err
      }
    },
  }
}

/** Adapter over the sandbox z-ai SDK — the zero-key dev/sandbox path. */
export function createZaiSdkAdapter(): AiProviderAdapter {
  return {
    id: "zai-sdk",
    kind: "zai-sdk",
    configured: () => true, // safe to attempt; fails fast where the SDK cannot authenticate
    models: () => ["glm"],
    async generate(req, reportAttempt) {
      const started = Date.now()
      try {
        const res = await chatViaSandboxSdk({
          system: req.system,
          user: req.user,
          history: req.history,
          timeoutMs: req.timeoutMs,
        })
        if (!res.content.trim()) throw new Error("empty response from provider")
        return {
          content: res.content,
          providerId: "zai-sdk",
          model: res.model || "glm",
          latencyMs: Date.now() - started,
        }
      } catch (err) {
        reportAttempt?.({
          providerId: "zai-sdk",
          kind: classifyError(err),
          message: (err instanceof Error ? err.message : String(err)).slice(0, 400),
          at: Date.now(),
        })
        throw err
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Provider registry (env-driven, backward compatible)
// ---------------------------------------------------------------------------

function envList(env: NodeJS.ProcessEnv, name: string): string[] {
  return (env[name] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Builds the provider chain. Order = fallback order. Env-injectable for tests. */
export function buildProviderChain(env: NodeJS.ProcessEnv = process.env): AiProviderAdapter[] {
  const adapters: AiProviderAdapter[] = []

  // 1) Legacy/primary provider — exact legacy semantics.
  if ((env.AI_API_KEY || "").trim()) {
    const models = envList(env, "AI_MODELS")
    const chain = models.length
      ? models
      : [env.AI_MODEL || "auto", ...(env.AI_MODEL_FALLBACK ? [env.AI_MODEL_FALLBACK] : [])].filter(Boolean)
    adapters.push(
      createOpenAiAdapter({
        id: "primary",
        baseUrl: (env.AI_BASE_URL || "").trim() || "https://generativelanguage.googleapis.com/v1beta/openai/",
        apiKeys: [env.AI_API_KEY!.trim(), ...envList(env, "AI_API_KEYS")],
        models: chain,
        thinking: (env.AI_THINKING as "on" | "off") || undefined,
      })
    )
  }

  // 2) Additional providers: AI_PROVIDERS="id1,id2" with per-provider envs.
  for (const rawId of envList(env, "AI_PROVIDERS")) {
    const id = rawId.toUpperCase().replace(/[^A-Z0-9_]/g, "_")
    const keys = [(env[`AI_PROVIDER_${id}_API_KEY`] || "").trim(), ...envList(env, `AI_PROVIDER_${id}_API_KEYS`)].filter(Boolean)
    if (!keys.length) continue
    adapters.push(
      createOpenAiAdapter({
        id: rawId,
        baseUrl: (env[`AI_PROVIDER_${id}_BASE_URL`] || "").trim(),
        apiKeys: keys,
        models: envList(env, `AI_PROVIDER_${id}_MODELS`),
        thinking: (env[`AI_PROVIDER_${id}_THINKING`] as "on" | "off") || undefined,
      })
    )
  }

  // 3) Sandbox SDK last — on Vercel it cannot authenticate and fails fast;
  //    in the sandbox it is the zero-key path.
  if (!externalAiConfigured() || adapters.length === 0) {
    adapters.push(createZaiSdkAdapter())
  }
  return adapters
}

// ---------------------------------------------------------------------------
// Per-adapter circuit breaker + token-bucket rate limit (in-process)
// ---------------------------------------------------------------------------

interface BreakerState {
  consecutiveFailures: number
  openUntil: number
}

const breakerByProvider = new Map<string, BreakerState>()
const BREAKER_THRESHOLD = 4
const BREAKER_OPEN_MS = 3 * 60_000

function breaker(id: string): BreakerState {
  let s = breakerByProvider.get(id)
  if (!s) {
    s = { consecutiveFailures: 0, openUntil: 0 }
    breakerByProvider.set(id, s)
  }
  return s
}

export function breakerAllows(id: string): boolean {
  return breaker(id).openUntil <= Date.now()
}

export function breakerRecord(id: string, ok: boolean): void {
  const s = breaker(id)
  if (ok) {
    s.consecutiveFailures = 0
    s.openUntil = 0
    return
  }
  s.consecutiveFailures += 1
  if (s.consecutiveFailures >= BREAKER_THRESHOLD) {
    s.openUntil = Date.now() + BREAKER_OPEN_MS
    s.consecutiveFailures = 0
  }
}

export function breakerSnapshot(): Record<string, { open: boolean; failures: number }> {
  const out: Record<string, { open: boolean; failures: number }> = {}
  for (const [id, s] of breakerByProvider) out[id] = { open: s.openUntil > Date.now(), failures: s.consecutiveFailures }
  return out
}

const buckets = new Map<string, number[]>()
export function rateLimitAllows(id: string, rpm: number): boolean {
  if (rpm <= 0) return true
  const now = Date.now()
  const arr = (buckets.get(id) ?? []).filter((t) => now - t < 60_000)
  if (arr.length >= rpm) {
    buckets.set(id, arr)
    return false
  }
  arr.push(now)
  buckets.set(id, arr)
  return true
}

// ---------------------------------------------------------------------------
// Concurrency gate (in-process semaphore — the durable cap lives in the job
// worker's conditional claim; this keeps one lambda from stampeding)
// ---------------------------------------------------------------------------

const MAX_CONCURRENCY = Math.max(1, Number(process.env.AI_MAX_CONCURRENCY || "") || 3)
let active = 0
const waiters: (() => void)[] = []

export async function withGenerationSlot<T>(fn: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  if (active >= MAX_CONCURRENCY) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = waiters.indexOf(resolve)
        if (i >= 0) waiters.splice(i, 1)
        reject(new AiUnavailableError("concurrency", "AI concurrency queue timed out"))
      }, timeoutMs)
      waiters.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
  active++
  try {
    return await fn()
  } finally {
    active--
    waiters.shift()?.()
  }
}

export function activeGenerations(): number {
  return active
}

/** Test hook: reset all in-process orchestrator state. */
export function _resetOrchestratorStateForTests(): void {
  _resetQuarantineForTests()
  breakerByProvider.clear()
  buckets.clear()
  active = 0
  waiters.length = 0
}
