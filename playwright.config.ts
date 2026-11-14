import { defineConfig, devices } from "@playwright/test"

/**
 * EGXANO black-box regression suite (2026-11-14 audit).
 *
 * All tests are READ-ONLY (GET requests / UI navigation) — safe to run against
 * production, a preview deployment or a local dev server. Point the suite at a
 * deployment with:
 *
 *   EGXANO_BASE_URL=https://egxano.vercel.app npx playwright test
 *
 * No credentials are read, hardcoded or needed: every check below is written
 * from the anonymous visitor's perspective (the entitlement boundary itself).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.EGXANO_BASE_URL || "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
})
