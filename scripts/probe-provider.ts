import { chatComplete } from "../src/lib/ai/provider"

async function main(): Promise<void> {
  const t0 = Date.now()
  try {
    const r = await chatComplete({
      system: "Reply with one short sentence in Arabic.",
      user: "Go.",
      timeoutMs: 60_000,
    })
    console.log(`OK model=${r.model} in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${r.content.slice(0, 80)}`)
  } catch (e) {
    console.log(`FAIL in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, e instanceof Error ? e.message.slice(0, 160) : e)
  }
}

void main().then(() => process.exit(0))
