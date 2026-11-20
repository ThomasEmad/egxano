// Public API response cache — a thin layer over the SWR `cached()` helper
// for hot, mostly-static GET endpoints. With 10k concurrent visitors the
// SQLite database must not see a query per page view: popular reads are
// served from a process-local snapshot and refreshed single-flight in the
// background while stale data is returned (never a blocking recompute).
//
// `cachedResponse(key, ttlMs, build)` → Response with JSON body + public
// Cache-Control so proxies/CDNs can share the load too.

import { cached } from "@/lib/server-cache"

export function publicCacheControl(ttlSeconds: number): string {
  const swr = Math.max(ttlSeconds * 5, 300)
  // s-maxage lets the Vercel edge CDN serve repeat requests WITHOUT hitting a
  // serverless function (and therefore the database) — with 10k visitors this
  // collapses per-endpoint origin traffic to a handful of fetches per TTL.
  // The browser max-age stays short so a visitor's back-navigation still
  // revalidates quickly.
  const browserMaxAge = Math.min(ttlSeconds, 60)
  return `public, max-age=${browserMaxAge}, s-maxage=${ttlSeconds}, stale-while-revalidate=${swr}`
}

export async function cachedResponse(
  key: string,
  ttlMs: number,
  build: () => Promise<unknown>,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  const ttlSeconds = Math.round(ttlMs / 1000)
  try {
    const data = await cached(key, ttlMs, build)
    return Response.json(data, { headers: { "Cache-Control": publicCacheControl(ttlSeconds), ...extraHeaders } })
  } catch (err) {
    return Response.json(
      { error: "UPSTREAM", message: err instanceof Error ? err.message : "data unavailable" },
      { status: 500 }
    )
  }
}

/** Normalized query string for cache keys (order-insensitive). */
export function queryKey(req: Request, pick: string[], defaults: Record<string, string> = {}): string {
  const url = new URL(req.url)
  const parts = pick
    .map((k) => {
      const v = url.searchParams.get(k)?.trim() || defaults[k] || ""
      return `${k}=${v}`
    })
    .sort()
  return parts.join("&")
}

/**
 * Fingerprint of a table's write state (count + max id/timestamp), memoized
 * for one minute. Endpoints keyed with this fingerprint roll their cache key
 * over whenever the underlying table is written — which is how data written
 * from OUTSIDE the web server becomes visible fast:
 *
 *   GitHub Actions ops jobs and self-hosted scripts write directly to the
 *   production database; there is no channel to invalidate a web-server cache
 *   from there. A long edge cache (s-maxage) would otherwise serve the
 *   pre-write response for its full TTL — owner report 2026-11-20: the
 *   dividends apply inserted 30 rows successfully and the page stayed empty
 *   for hours because the edge kept serving the empty pre-import snapshot.
 *
 * With the fingerprint in the key, the first request after a write (within
 * the memoize window) computes a NEW key → edge miss → fresh data. The read
 * itself is a cheap aggregate, executed at most once per minute per instance.
 */
export async function tableFingerprint(key: string, read: () => Promise<string>): Promise<string> {
  return cached(`tf:${key}`, 60_000, read)
}
