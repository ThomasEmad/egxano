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
