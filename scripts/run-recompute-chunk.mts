// Resumable chunked recompute runner — survives sandbox process kills.
// Done-company ids are appended to /tmp/recompute-done.txt after each success,
// so re-running with the same --limit resumes where it stopped.
//
// Usage: bun scripts/run-recompute-chunk.mts --limit=90
import { PrismaClient } from "@prisma/client"
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs"
import { recomputeCompany } from "../src/lib/financial/recompute"

const db = new PrismaClient()
const DONE_FILE = "/tmp/recompute-done.txt"
const argv = process.argv.slice(2)
const opt = (name) => {
  const a = argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split("=").slice(1).join("=") : undefined
}
const LIMIT = parseInt(opt("limit") ?? "60", 10)

const done = new Set<string>(
  existsSync(DONE_FILE) ? readFileSync(DONE_FILE, "utf8").split("\n").map((s) => s.trim()).filter(Boolean) : []
)

const companies = await db.company.findMany({
  where: { isActive: true },
  select: { id: true, ticker: true },
  orderBy: { id: "asc" },
})
const pending = companies.filter((c) => !done.has(c.id)).slice(0, LIMIT)
console.log(`total=${companies.length} done=${done.size} running=${pending.length}`)

let ok = 0, failed = 0
for (const c of pending) {
  const t0 = Date.now()
  try {
    const res = await recomputeCompany(c.id)
    appendFileSync(DONE_FILE, c.id + "\n")
    ok++
    process.stdout.write(`OK ${c.ticker} (${Date.now() - t0}ms, metrics=${res?.metrics ?? "?"})\n`)
  } catch (e) {
    failed++
    console.log(`FAIL ${c.ticker}: ${String(e?.message ?? e).slice(0, 160)}`)
  }
}
console.log(`CHUNK DONE: ok=${ok} failed=${failed} remaining=${companies.length - done.size - ok}`)
await db.$disconnect()
