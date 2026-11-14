// EGXANO service worker — deliberately conservative.
//
// Rules (in order):
//   1. /api/*            → NETWORK ONLY. Never cached, ever. Financial data
//                          must never be served stale from a cache.
//   2. /_next/static/*   → cache-first (content-hashed URLs are immutable).
//   3. page navigations  → network-first (3s timeout), fall back to the last
//                          cached copy, then to /offline.
//   4. everything else   → network, no caching.
//
// Updates: skipWaiting + clientsClaim so a new deployment takes effect on the
// next reload without a stuck old worker.

const VERSION = "egx-v1"
const STATIC_CACHE = `${VERSION}-static`
const PAGE_CACHE = `${VERSION}-pages`
const OFFLINE_URL = "/offline"

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

function withTimeout(request, ms) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ])
}

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/")) return // network only, never cache

  // immutable build assets — cache-first
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/logo")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(STATIC_CACHE).then((c) => c.put(req, copy))
            }
            return res
          })
      )
    )
    return
  }

  // page navigations — network-first with a cache + offline fallback
  if (req.mode === "navigate") {
    event.respondWith(
      withTimeout(req, 3000)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(PAGE_CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match(OFFLINE_URL)))
    )
  }
  // everything else: plain network (default)
})

// ---------------------------------------------------------------------------
// Web Push — price-alert notifications delivered EVEN WHEN the site is closed.
// The server (src/lib/web-push.ts) sends JSON: {title, body, url}. Every push
// must surface a notification — userVisibleOnly is part of the subscribe
// contract, and a swallowed push gets the subscription revoked by the browser.
// ---------------------------------------------------------------------------
self.addEventListener("push", (event) => {
  // Trust nothing: the payload is untrusted data from our own server channel.
  const data = { title: "تنبيه سعر", body: "", url: "/" }
  try {
    const parsed = event.data ? event.data.json() : null
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.title === "string" && parsed.title) data.title = parsed.title
      if (typeof parsed.body === "string") data.body = parsed.body
      if (typeof parsed.url === "string" && parsed.url) data.url = parsed.url
    }
  } catch {
    if (event.data) data.body = String(event.data.text()).slice(0, 200)
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/logo.png",
      badge: "/icon-64.png",
      data: { url: data.url },
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const raw = (event.notification.data && event.notification.data.url) || "/"
  // Same-origin absolute URL only — a notification can never redirect off-site.
  let target
  try {
    target = new URL(raw, self.location.origin)
    if (target.origin !== self.location.origin) target = new URL("/", self.location.origin)
  } catch {
    target = new URL("/", self.location.origin)
  }
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      const open = clients.find((c) => c.url === target.href)
      if (open) return open.focus()
      const anyWindow = clients[0]
      if (anyWindow) {
        try {
          await anyWindow.navigate(target.href)
        } catch {
          // navigate can be rejected (e.g. about:blank clients) — open instead
          await self.clients.openWindow(target.href)
        }
        return anyWindow.focus()
      }
      return self.clients.openWindow(target.href)
    })()
  )
})
