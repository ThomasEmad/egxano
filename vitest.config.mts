import { defineConfig } from "vitest/config"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.dirname(fileURLToPath(import.meta.url))

// The Prisma schema is PostgreSQL (since the Supabase/Neon migration), so the
// old pinned `file:prisma/test.db` SQLite URL no longer validates. Tests use a
// DEDICATED, schema-only Postgres project instead of shell DATABASE_URL:
//   1. TEST_DATABASE_URL env var if set (CI override),
//   2. the repo .env DATABASE_URL (Neon — an empty project reserved for
//      schema pushes and integration tests, never production),
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

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL || envFromFile("DATABASE_URL") || `file:${path.join(root, "prisma", "test.db")}`,
      ADMIN_PASSCODE: process.env.ADMIN_PASSCODE || "test-admin-passcode",
      CRON_SECRET: process.env.CRON_SECRET || "test-cron-secret",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
    },
  },
})
