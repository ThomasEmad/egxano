import { describe, expect, it, vi } from "vitest"

// The SEO fallback must be a domain that actually SERVES the product. Until
// egx-scanner.com has DNS records (it is NXDOMAIN as of 2026-11-19), the live
// production host is the app's own vercel domain — NOT a stale preview URL.
// Modules read the env at import time — reset + stub.
describe("SEO fallback domain", () => {
  it("falls back to https://egxano.vercel.app when NEXT_PUBLIC_SITE_URL is unset", async () => {
    vi.resetModules()
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "")
    const { siteConfig } = await import("@/lib/seo-config")
    expect(siteConfig.url).toBe("https://egxano.vercel.app")

    const robots = (await import("@/app/robots")).default
    const r = robots()
    expect(r.sitemap).toBe("https://egxano.vercel.app/sitemap.xml")
    expect(r.host).toBe("https://egxano.vercel.app")
    vi.unstubAllEnvs()
  })
})
