// Minimal ambient types for `web-push` v4 (plain-JS ESM, ships no .d.ts).
// Only the surface this app uses is declared. NOTE: the VAPID private key is
// passed straight through to setVapidDetails and is never logged or stored.

declare module "web-push" {
  /** The subscription shape the push service expects (endpoint + client keys). */
  export interface PushSubscriptionLike {
    endpoint: string
    keys: { p256dh: string; auth: string }
  }

  /** Thrown on non-2xx from the push service; carries the HTTP status. */
  export class WebPushError extends Error {
    statusCode: number
    headers: unknown
    body: unknown
    endpoint?: string
    constructor(message: string, statusCode: number, headers: unknown, body: unknown, endpoint?: string)
  }

  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void

  export function sendNotification(
    subscription: PushSubscriptionLike,
    payload?: string | Buffer | null,
    options?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>
}
