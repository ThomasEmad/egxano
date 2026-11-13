// =============================================================================
// Briefing TTS — Arabic speech synthesis via the z-ai sandbox SDK.
//
// BACKEND-ONLY: this module is imported exclusively from server code
// (service.ts / route handlers). Never import it from a client component.
//
// Verified endpoint facts (do not drift):
//   • `zai.audio.tts.create` accepts input ≤1024 chars per call (the briefing
//     script is capped at 900 — see script.ts — so one call serves a briefing).
//   • `response_format: "wav"` works; "mp3" returns 400 — never use it.
//   • Output WAV is 24kHz mono 16-bit ≈ 48KB/sec (duration estimate in script.ts).
//   • Voice "kazi" handles Egyptian-Arabic copy cleanly.
//
// Failure contract: synthArabic NEVER throws — any failure (SDK init, network,
// timeout, empty payload) resolves to null so the caller can persist a FAILED
// row and the client can fall back to browser speech synthesis.
// =============================================================================

/** The SDK instance type, derived from the package's own declarations. */
type ZAIClient = Awaited<ReturnType<(typeof import("z-ai-web-dev-sdk"))["default"]["create"]>>

export const BRIEFING_VOICE = "kazi"
const TTS_TIMEOUT_MS = 25_000
/** Server-side guard mirroring the endpoint's hard input limit. */
const MAX_TTS_INPUT_CHARS = 1024

// Singleton: one SDK client per server process (cheap init, reused across
// briefings). The in-flight promise is cached so parallel requests share a
// single init; a failed init resets so the next request can retry.
let clientPromise: Promise<ZAIClient> | null = null

async function getZaiClient(): Promise<ZAIClient | null> {
  if (!clientPromise) {
    clientPromise = import("z-ai-web-dev-sdk").then((m) => m.default.create())
  }
  try {
    return await clientPromise
  } catch (e) {
    // Reset so a later request retries init instead of caching the failure.
    clientPromise = null
    console.error("[briefing-tts] SDK init failed:", e instanceof Error ? e.message : e)
    return null
  }
}

/** Reject after `ms` — the SDK has no built-in timeout and must not hang the route. */
function withTimeout<T>(promise: Promise<T>, ms: number, label = "TTS"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export interface SynthResult {
  audio: Buffer
  voice: string
}

/**
 * Synthesize Arabic narration → WAV bytes. Never throws; null = "no audio
 * this time" (caller records FAILED and the client falls back to
 * window.speechSynthesis).
 */
export async function synthArabic(text: string): Promise<SynthResult | null> {
  const input = typeof text === "string" ? text.trim() : ""
  if (!input) return null
  try {
    const client = await getZaiClient()
    if (!client) return null

    const response = (await withTimeout(
      client.audio.tts.create({
        input: input.slice(0, MAX_TTS_INPUT_CHARS),
        voice: BRIEFING_VOICE,
        speed: 1.0,
        response_format: "wav", // mp3 is NOT supported by this endpoint (400)
        stream: false,
      }),
      TTS_TIMEOUT_MS,
    )) as { arrayBuffer: () => Promise<ArrayBuffer> }

    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!bytes.length) return null
    return { audio: Buffer.from(bytes), voice: BRIEFING_VOICE }
  } catch (e) {
    console.error("[briefing-tts] synthesis failed:", e instanceof Error ? e.message : e)
    return null
  }
}
