# Notification Architecture — Price Alerts + Web Push delivery (post-outbox)

Date: 2026-11-14 · Status: **implemented in-tree** (`src/lib/alerts/*`, `src/lib/web-push.ts`, `src/lib/db-schema-bootstrap.ts`), covered by `alert-logic.test.ts` + `outbox-dispatch.test.ts`
Pre-upgrade audit: `docs/notes/notification-audit.md` (production probes read-only: VAPID configured, CRON_SECRET enforced, `/sw.js` served)

---

## 1. The problem being solved

The pre-outbox pipeline had a fatal window (audit F-01): an alert was atomically claimed (active → false), and if the serverless function died *before* `sendPushToUser` completed, the alert was consumed and the user never received anything. Atomic claim alone cannot fix this — the trigger event must be **durable**.

## 2. Transactional Outbox (implemented)

**Producer** (`src/lib/alerts/evaluate.ts` → `deactivateAndNotify`): per triggered alert, ONE database transaction:

1. **Atomic claim** — `updateMany({ where: { id, active: true } }, { active: false, triggeredAt: now })`; `count !== 1` ⇒ another evaluator won ⇒ stop (no push, no row).
2. **Publish** the delivery task — a `NotificationOutbox` row inserted **in the same transaction**, with `alertId` as a **UNIQUE event key**: a duplicate publish path is rejected by the database itself.
3. Commit. Either both the claim and the owed delivery exist, or neither — a kill at any point inside the transaction loses nothing (a later evaluator re-claims).

**Lifecycle** (`src/lib/alerts/outbox-logic.ts`, pure + unit-tested):

```
PENDING ──claim──▶ SENDING ──push accepted──▶ SENT
   ▲                  │  │
   │   backoff        │  └─ lease expired (serverless kill mid-send) → re-claimable
   └──────────────────┘
                      └─ maxAttempts (6) exhausted ──▶ DEAD (terminal; alert stays triggered)
```

- Backoff ladder on transient failures (`nextAttemptAtAfterFailure`); `isOutboxJobDue` implements the due predicate (PENDING: nextAttemptAt ≤ now; SENDING: lease expired; SENT/DEAD never due).
- Delivery semantics are **at-least-once**: a kill after the push service accepted the send but before SENT was written resends on the next drain — the user may rarely see one duplicate OS notification. Web Push has no delivery-ack API; at-least-once is the correct trade against silently losing alerts.

**Consumer / dispatcher** (`src/lib/alerts/outbox-dispatch.ts` → `drainOutbox`):

- Bounded concurrency, per-job **conditional atomic claim with a 2-minute lease** (`OUTBOX_LEASE_MS`) — two concurrent lambdas can both *see* a due row; only one wins (`count === 1`), the loser skips. Expired-lease SENDING rows are re-claimable — that is the recovery path for serverless kills mid-dispatch.
- Push results classified (`classifyOutboxSend`): accepted → SENT; 404/410 endpoint → subscription deactivated (safe stale-removal); transient provider failures → retry ladder; permanent failures → DEAD after 6 attempts.
- **Multi-device**: `sendPushToUser` fans out to every valid subscription for the user; one failed device does not block the others; per-subscription outcomes recorded, not aggregated.
- Observability: single-line structured logs; payloads, full subscription endpoints, and any VAPID/p256dh/auth key material are never logged.

## 3. Delivery paths (all four drain the same outbox)

| path | trigger | cadence |
|---|---|---|
| Inline dispatch | immediately after the trigger transaction commits | seconds (common case) |
| Snapshot-write sweep | every `runRefresh()` snapshot write | minutes during market hours |
| Polling sweep | `GET /api/v1/alerts` drains the polling user's own due jobs | ~60 s while the alerts page is open |
| Daily cron | `GET /api/v1/cron/alerts-push` — **drains FIRST, then evaluates** | 14:00 UTC daily (Vercel Hobby allows daily crons only) |

**Honest latency contract** (documented in code, repeated here): with zero traffic, the daily cron is the guaranteed floor — up to ~24 h between attempts, and a persistently failing job reaches DEAD ≈ 6 attempts later. No fire-and-forget promises inside serverless handlers; nothing relies on a process surviving the request.

## 4. Alert evaluation semantics (shared evaluator)

- One shared evaluation module for all three entry points (snapshot-write hook, daily cron, lazy poll) — `evaluateAndNotifyAllAlerts` / the user-scoped read path never fork the logic (`src/lib/alerts/logic.ts` + tests).
- Thresholds: ABOVE `price ≥ target`, BELOW `price ≤ target` (exact equality included); gap-crossings trigger (a price jumping across the target between snapshots is a hit).
- **Freshness rules**: the snapshot movers row wins; the MarketPrice fallback is only used under the documented freshness predicate — stale snapshots, phantom Fri/Sat sessions (anchored by `effectiveEgxSessionDate`), invalid prices and wrong corporate-action bases never trigger.
- Crossing-only vs already-beyond semantics preserved as production behaves today; reference price and creation time are on the alert row.

## 5. UI truth (alerts dashboard)

The dashboard reflects backend status distinctions (active / triggered / delivery pending / delivered to provider / failed) sourced from the outbox row state — "triggered" no longer implies "delivered". Failed deliveries show the failure class and the retry schedule rather than a silent success.

## 6. Failure-simulation coverage (tests)

Above/below/equality, price gap across the target, duplicate publish attempts (UNIQUE key), concurrent evaluator races (claim-loser pushless), crash after trigger before send (transaction rollback → alert stays active → re-claimed later), crash mid-dispatch (lease expiry → re-claim), retry ladder, dead-letter terminality, multi-subscription fan-out with per-device failure isolation, expired endpoint (404/410) removal, provider failure classification, and stale-snapshot rejection. Simulations run against isolated fixtures — never against production state.

## 7. Remaining limitations (disclosed)

1. OS display cannot be guaranteed server-side; the server can only confirm provider acceptance (semantics ladder documented in code).
2. Hobby-plan cron bounds the guaranteed retry floor at daily; sub-hour guarantees require a paid scheduler or external queue (deliberately not introduced without measured need).
3. Browser-visible SW receipt is unobservable from the server (no Web Push ack API).
