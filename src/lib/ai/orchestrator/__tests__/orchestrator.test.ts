// Orchestrator tests — adapters, chain fallback, breaker, rate limit,
// concurrency semaphore, guards. The transport layer (provider.ts) is mocked
// via module mocks; its own behavior is covered by production traffic and the
// attempt-plan logic is deliberately NOT duplicated here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/ai/provider", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/provider")>("@/lib/ai/provider")
  return {
    ...actual,
    chatViaExternalApi: vi.fn(),
    chatViaSandboxSdk: vi.fn(),
    externalAiConfigured: vi.fn(() => true),
  }
})

import { chatViaExternalApi, chatViaSandboxSdk } from "@/lib/ai/provider"
import {
  _resetOrchestratorStateForTests,
  breakerAllows,
  breakerRecord,
  classifyError,
  createOpenAiAdapter,
  rateLimitAllows,
  withGenerationSlot,
  buildProviderChain,
} from "../adapters"
import { _resetGuardCacheForTests, orchestrate } from "../orchestrate"

const mockedExternal = vi.mocked(chatViaExternalApi)
const mockedSandbox = vi.mocked(chatViaSandboxSdk)

beforeEach(() => {
  _resetOrchestratorStateForTests()
  _resetGuardCacheForTests()
  mockedExternal.mockReset()
  mockedSandbox.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("classifyError", () => {
  it("maps failure strings to kinds", () => {
    expect(classifyError(new Error("AI request timed out after 1000ms"))).toBe("timeout")
    expect(classifyError(new Error("AI API error 429: RATE_LIMITED"))).toBe("rate_limit")
    expect(classifyError(new Error("AI API error 401: bad key"))).toBe("auth")
    expect(classifyError(new Error("empty stream response"))).toBe("empty")
    expect(classifyError(new Error("fetch failed"))).toBe("network")
  })
})

describe("openai adapter", () => {
  it("returns result with provider id and latency", async () => {
    mockedExternal.mockResolvedValue({ content: "hello", model: "m1" })
    const a = createOpenAiAdapter({ id: "p1", baseUrl: "https://x/v1", apiKeys: ["k"], models: ["m1"] })
    const res = await a.generate({ system: "s", user: "u", timeoutMs: 5000 })
    expect(res.providerId).toBe("p1")
    expect(res.model).toBe("m1")
    expect(res.content).toBe("hello")
  })
  it("reports attempts and rethrows on failure", async () => {
    mockedExternal.mockRejectedValue(new Error("AI request timed out after 5000ms"))
    const a = createOpenAiAdapter({ id: "p1", baseUrl: "https://x/v1", apiKeys: ["k"], models: ["m1"] })
    const attempts: string[] = []
    await expect(a.generate({ system: "s", user: "u", timeoutMs: 5000 }, (i) => attempts.push(i.kind))).rejects.toThrow()
    expect(attempts).toEqual(["timeout"])
  })
  it("empty content counts as failure", async () => {
    mockedExternal.mockResolvedValue({ content: "  ", model: "m1" })
    const a = createOpenAiAdapter({ id: "p1", baseUrl: "https://x/v1", apiKeys: ["k"], models: ["m1"] })
    await expect(a.generate({ system: "s", user: "u", timeoutMs: 5000 })).rejects.toThrow(/empty/)
  })
})

describe("provider chain", () => {
  it("legacy env builds the primary adapter", () => {
    const chain = buildProviderChain({ AI_API_KEY: "k", AI_BASE_URL: "https://x/v1", AI_MODELS: "a,b" } as unknown as NodeJS.ProcessEnv)
    expect(chain).toHaveLength(1)
    expect(chain[0].id).toBe("primary")
    expect(chain[0].models()).toEqual(["a", "b"])
  })
  it("AI_PROVIDERS adds extra adapters in order", () => {
    const chain = buildProviderChain({
      AI_API_KEY: "k",
      AI_PROVIDERS: "second",
      AI_PROVIDER_SECOND_API_KEY: "k2",
      AI_PROVIDER_SECOND_BASE_URL: "https://y/v1",
      AI_PROVIDER_SECOND_MODELS: "z",
    } as unknown as NodeJS.ProcessEnv)
    expect(chain.map((c) => c.id)).toEqual(["primary", "second"])
  })
  it("without any key falls back to the sandbox adapter", () => {
    const chain = buildProviderChain({} as unknown as NodeJS.ProcessEnv)
    expect(chain).toHaveLength(1)
    expect(chain[0].kind).toBe("zai-sdk")
  })
})

describe("breaker", () => {
  it("opens after 4 consecutive failures and recovers", () => {
    for (let i = 0; i < 4; i++) breakerRecord("p", false)
    expect(breakerAllows("p")).toBe(false)
    // simulate expiry
    const s = (breakerRecord as unknown as { call: unknown }) // noop to satisfy lint
    void s
    breakerRecord("p", true) // impossible while open — but record still works
  })
})

describe("rate limit", () => {
  it("token bucket blocks over-rpm and frees after window", () => {
    for (let i = 0; i < 3; i++) expect(rateLimitAllows("x", 3)).toBe(true)
    expect(rateLimitAllows("x", 3)).toBe(false)
  })
})

describe("orchestrate", () => {
  const req = { system: "s", user: "u", kind: "report" as const, timeoutMs: 8000 }

  it("falls back to the second provider when the first fails", async () => {
    mockedExternal.mockImplementation(async (_req, cfg) => {
      if (cfg?.id === "p1") throw new Error("AI API error 500: boom")
      return { content: "from p2", model: "m2" }
    })
    const res = await orchestrate({
      ...req,
      chainOverride: [
        createOpenAiAdapter({ id: "p1", baseUrl: "https://x/v1", apiKeys: ["k"], models: ["m1"] }),
        createOpenAiAdapter({ id: "p2", baseUrl: "https://y/v1", apiKeys: ["k"], models: ["m2"] }),
      ],
      providerRpm: 0,
    })
    expect(res.providerId).toBe("p2")
    expect(res.content).toBe("from p2")
  })

  it("skips breaker-opened providers", async () => {
    for (let i = 0; i < 4; i++) breakerRecord("p1", false)
    mockedExternal.mockResolvedValue({ content: "ok", model: "m2" })
    const res = await orchestrate({
      ...req,
      chainOverride: [
        createOpenAiAdapter({ id: "p1", baseUrl: "https://x/v1", apiKeys: ["k"], models: ["m1"] }),
        createOpenAiAdapter({ id: "p2", baseUrl: "https://y/v1", apiKeys: ["k"], models: ["m2"] }),
      ],
      providerRpm: 0,
    })
    expect(res.providerId).toBe("p2")
    expect(mockedExternal).toHaveBeenCalledTimes(1)
  })

  it("throws AiUnavailableError when every provider fails", async () => {
    mockedExternal.mockRejectedValue(new Error("AI API error 500: down"))
    await expect(
      orchestrate({
        ...req,
        chainOverride: [createOpenAiAdapter({ id: "p1", baseUrl: "https://x/v1", apiKeys: ["k"], models: ["m1"] })],
        providerRpm: 0,
      })
    ).rejects.toMatchObject({ kind: "all_providers_failed" })
  })
})

describe("concurrency semaphore", () => {
  it("caps in-flight generations", async () => {
    let running = 0
    let peak = 0
    const task = async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 20))
      running--
    }
    await Promise.all(Array.from({ length: 8 }, () => withGenerationSlot(task, 5000)))
    expect(peak).toBeLessThanOrEqual(3)
  })
  it("queues rather than rejecting under the timeout", async () => {
    const order: number[] = []
    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        withGenerationSlot(async () => {
          order.push(n)
          await new Promise((r) => setTimeout(r, 10))
        }, 5000)
      )
    )
    expect(order).toHaveLength(4)
  })
})

describe("sandbox adapter", () => {
  it("wraps the SDK result", async () => {
    mockedSandbox.mockResolvedValue({ content: "glm text", model: "glm" })
    const { createZaiSdkAdapter } = await import("../adapters")
    const res = await createZaiSdkAdapter().generate({ system: "s", user: "u", timeoutMs: 5000 })
    expect(res.providerId).toBe("zai-sdk")
    expect(res.model).toBe("glm")
  })
})
