import { describe, expect, it, vi } from "vitest"

// Audit P2: the SEO fallback domain must be the product domain, not the stale
// vercel preview host. Modules read the env at import time — reset + stub.
describe("SEO fallback domain", () => {
  it("falls back to https://egx-scanner.com when NEXT_PUBLIC_SITE_URL is unset", async () => {
    vi.resetModules()
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "")
    const { siteConfig } = await import("@/lib/seo-config")
    expect(siteConfig.url).toBe("https://egx-scanner.com")

    const robots = (await import("@/app/robots")).default
    const r = robots()
    expect(r.sitemap).toBe("https://egx-scanner.com/sitemap.xml")
    expect(r.host).toBe("https://egx-scanner.com")
    vi.unstubAllEnvs()
  })
})
