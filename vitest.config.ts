import { defineConfig } from "vitest/config"
import { readFileSync } from "node:fs"
import path from "node:path"

const root = __dirname ?? path.dirname(import.meta.url.replace(/^file:\/\//, ""))

// ── Database-backed tests (auth/access sessions) ─────────────────────────────
// The Prisma schema is PostgreSQL, so a SQLite `file:` URL fails validation.
// Tests use a DEDICATED schema-only Postgres project (Neon) — never production:
//   1. TEST_DATABASE_URL env var if set (CI override),
//   2. the repo .env DATABASE_URL (Neon test project),
//   3. last resort: the legacy SQLite path (kept so the error message stays
//      actionable if .env is missing).
function envFromFile(key: string): string | undefined {
  try {
    const text = readFileSync(path.join(root, ".env"), "utf8")
    const m = text.match(new RegExp(`^${key}=(.*)$`, "m"))
    return m ? m[1].trim().replace(/^"|"$/g, "") : undefined
  } catch {
    return undefined
  }
}

// DB round-trips over a real network need more than the 5s default — 20s keeps
// the suite deterministic without weakening any assertion.
const TIMEOUT = 20_000

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(root, "src") },
  },
  test: {
    environment: "node",
    testTimeout: TIMEOUT,
    hookTimeout: TIMEOUT,
    // Only the real application sources — `scripts/staging/egx-vercel` is a
    // stale full-repo backup that would otherwise run its own copies of every
    // test suite against the same DB (and double every failure).
    include: ["src/**/*.test.ts"],
    // engine.test.mts runs under node:test (node's own runner), not vitest —
    // vitest only sees "no test suite" there.
    exclude: ["**/node_modules/**", "src/lib/analytics/__tests__/engine.test.mts"],
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ||
        envFromFile("DATABASE_URL") ||
        `file:${path.join(root, "prisma", "test.db")}`,
      ADMIN_PASSCODE: process.env.ADMIN_PASSCODE || "test-admin-passcode",
      CRON_SECRET: process.env.CRON_SECRET || "test-cron-secret",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
})
