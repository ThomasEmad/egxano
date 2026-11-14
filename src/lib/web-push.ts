import { setVapidDetails, sendNotification, WebPushError } from "web-push"
import { db } from "@/lib/db"
import { ensurePushTables } from "@/lib/db-schema-bootstrap"
import { WEB_PUSH_SEND_TIMEOUT_MS, deviceFailureClass, truncateForLog } from "@/lib/alerts/outbox-logic"

// Web Push delivery for price alerts — the piece that lets notifications
// reach the user's browser EVEN WHEN the site is closed. The service
// worker (public/sw.js) receives the encrypted message and shows the OS
// notification; this module only stores endpoints and sends payloads.
//
// Safety rules:
//   * Missing VAPID env vars → warn ONCE and no-op. Push is an enhancement;
//     it must never throw into a request path or fail alert evaluation.
//   * The VAPID PRIVATE KEY is read from env here and handed to web-push only.
//     It is never logged, audited, returned or persisted anywhere.
//   * 404/410 from the push service mean the subscription is dead (browser
//     uninstalled / endpoint expired) and 400 means the subscription's
//     encryption keys are invalid — all three are terminal for the DEVICE row
//     and the row is deleted so sends stay fast. 403/429/5xx/network errors
//     are transient: the row is kept (the outbox retry ladder decides what
//     happens next — see src/lib/alerts/outbox-dispatch.ts).
//   * Every send carries a socket timeout: a hung push-service connection
//     must not eat the drain budget or the caller's request (audit F-12).

export interface PushPayload {
  title: string
  body: string
  /** Relative URL to open when the notification is clicked (e.g. /company/COMI). */
  url?: string
}

export interface PushSendSummary {
  sent: number
  removed: number
  /** True when push is disabled (env missing) or the send round failed wholesale. */
  skipped: boolean
  /** Subscription rows found for the user BEFORE sending (0 = no devices). */
  subscribers: number
  /** First transient device error message (truncated, no keys/endpoints). */
  lastError?: string
}

let configured = false
let disabled = false

function ensureConfigured(): boolean {
  if (configured) return true
  if (disabled) return false
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) {
    // Log once per instance — a per-send warning would spam every evaluation.
    disabled = true
    console.warn("web-push: WEB_PUSH_VAPID_* env vars missing — push notifications disabled")
    return false
  }
  try {
    // Subject must be a URL or mailto: contact for the push service.
    setVapidDetails(process.env.WEB_PUSH_CONTACT || "mailto:alerts@egxano.vercel.app", publicKey, privateKey)
    configured = true
  } catch (e) {
    disabled = true
    console.warn("web-push: VAPID configuration rejected — push disabled:", e instanceof Error ? e.message.slice(0, 120) : String(e))
  }
  return configured
}

/** Public application server key for the client-side pushManager.subscribe(). */
export function getVapidPublicKey(): string | null {
  return process.env.WEB_PUSH_VAPID_PUBLIC_KEY || null
}

/**
 * Send a push payload to every subscription of a user. Terminal endpoints
 * (404/410 gone, 400 invalid keys) are pruned. Never throws — callers treat
 * push as best-effort. Per-device outcomes are aggregated into the summary
 * (sent / removed / lastError); per-device retry decisions live in the
 * outbox dispatcher.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<PushSendSummary> {
  if (!ensureConfigured()) return { sent: 0, removed: 0, skipped: true, subscribers: 0 }

  try {
    await ensurePushTables()
    const subs = await db.pushSubscription.findMany({ where: { userId } })
    if (subs.length === 0) return { sent: 0, removed: 0, skipped: false, subscribers: 0 }

    const json = JSON.stringify(payload)
    let sent = 0
    let lastError: string | undefined
    const dead: string[] = []

    await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            json,
            { timeout: WEB_PUSH_SEND_TIMEOUT_MS }
          )
          sent++
        } catch (e) {
          const status = e instanceof WebPushError ? e.statusCode : undefined
          const failure = deviceFailureClass(status)
          if (failure === "gone" || failure === "invalid") {
            // Subscription gone (uninstalled / endpoint expired) or invalid
            // (push service rejects the encryption keys) — prune the row.
            dead.push(sub.id)
            return
          }
          // Transient push-service error: keep the row, capture compactly.
          if (!lastError) {
            lastError = `HTTP ${status ?? "?"}: ${truncateForLog(e instanceof Error ? e.message : String(e), 100)}`
          }
          console.warn(`push send failed (${status}) endpoint=${sub.endpoint.slice(0, 48)}:`, e instanceof Error ? e.message.slice(0, 120) : String(e))
        }
      })
    )

    let removed = 0
    if (dead.length > 0) {
      const res = await db.pushSubscription.deleteMany({ where: { id: { in: dead }, userId } })
      removed = res.count
    }
    return { sent, removed, skipped: false, subscribers: subs.length, ...(lastError ? { lastError } : {}) }
  } catch (e) {
    // Tables missing / DB hiccup — push silently degrades to the in-app feed.
    console.warn("push delivery skipped:", e instanceof Error ? e.message.slice(0, 160) : String(e))
    return { sent: 0, removed: 0, skipped: true, subscribers: 0 }
  }
}
