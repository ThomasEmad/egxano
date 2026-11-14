import { getVapidPublicKey } from "@/lib/web-push"

// GET /api/v1/push/public-key — the VAPID **public** application server key.
// Public by design (every Web Push client needs it before subscribe()); the
// private key never leaves the server env. Served from the SERVER env var so
// the UI works whether or not NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY was exposed at
// build time.

export async function GET() {
  return Response.json(
    { publicKey: getVapidPublicKey() },
    { headers: { "Cache-Control": "no-store" } }
  )
}
