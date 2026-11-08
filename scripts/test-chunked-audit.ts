// Local end-to-end test of the chunked audit (mirrors the cron route loop).
import { startOrResumeChunkedAudit } from "../src/lib/audit/audit-runner"

async function main(): Promise<void> {
  const t0 = Date.now()
  let runId: string | undefined
  let done = false
  let iter = 0
  while (!done && iter < 10) {
    iter++
    const r = await startOrResumeChunkedAudit({ type: "daily", chunkSize: 120, resumeRunId: runId })
    runId = r.runId
    console.log(`chunk ${iter}: done=${r.done} checked=${r.checkedSoFar} issues=${r.issuesSoFar} remaining=${r.remaining} last=${r.lastTicker}`)
    if (r.done) {
      console.log("summary:", JSON.stringify(r.summary ? { durationSec: r.summary.durationSec, companiesChecked: r.summary.companiesChecked } : null))
      done = true
    }
  }
  console.log(`total wall: ${((Date.now() - t0) / 1000).toFixed(1)}s, iterations: ${iter}, runId: ${runId}`)
}

void main().then(() => process.exit(0)).catch((e) => { console.error("FATAL:", e); process.exit(1) })
