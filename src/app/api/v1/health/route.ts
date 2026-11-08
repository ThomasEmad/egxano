import { db } from "@/lib/db"
import { after } from "next/server"

// GET /api/v1/health — system health for monitoring/load balancers.
// Checks the database round-trip and reports process vitals so an external
// watchdog can distinguish "up" from "up but starving".
//
// The external ~5-minute health cron doubles as the AI job queue's heartbeat:
// each ping opportunistically drains pending report jobs (fire-and-forget via
// after(), throttled, and fully conditional-claim safe). The response itself
// is unchanged and stays fast.
const BOOT = Date.now()
let lastWorkerKick = 0

export async function GET() {
  const t0 = Date.now()
  if (Date.now() - lastWorkerKick > 90_000 && process.env.AI_HEALTH_KICK !== "0") {
    lastWorkerKick = Date.now()
    after(async () => {
      try {
        const { processPendingJobs, sweepJobs } = await import("@/lib/ai/jobs/worker")
        await sweepJobs()
        await processPendingJobs(2)
      } catch (e) {
        console.error("health worker kick failed:", e instanceof Error ? e.message.slice(0, 200) : e)
      }
    })
  }
  try {
    const [companies] = await Promise.all([db.company.count()])
    const dbMs = Date.now() - t0
    const mem = process.memoryUsage()
    return Response.json(
      {
        ok: true,
        service: "meza",
        database: "connected",
        dbLatencyMs: dbMs,
        companies,
        uptimeSec: Math.round((Date.now() - BOOT) / 1000),
        memoryRssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        version: process.env.npm_package_version ?? "unknown",
        time: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (e) {
    return Response.json(
      { ok: false, database: "error", message: e instanceof Error ? e.message : "unknown" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    )
  }
}
