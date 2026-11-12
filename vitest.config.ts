import { defineConfig } from "vitest/config"
import path from "path"

// DB-backed tests (auth/access sessions) hit a remote Postgres (Neon). The
// default 5s timeout is too tight for real network round-trips — 20s keeps
// the suite deterministic without weakening any assertion.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // engine.test.mts runs under node:test (node's own runner), not vitest —
    // vitest only sees "no test suite" there.
    exclude: ["**/node_modules/**", "src/lib/analytics/__tests__/engine.test.mts"],
  },
})
