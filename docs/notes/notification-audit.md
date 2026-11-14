# Notification Pipeline Audit — Price Alerts + Web Push (EGXANO)

- Date: 2026-11-14
- Auditor scope: reliability audit of the price-alert → Web Push delivery pipeline on the production stack (Next.js 15 + Prisma + PostgreSQL (Neon) on Vercel serverless, Hobby plan).
- Method: static code audit of the clone in `/tmp/egx-work` (HEAD `1851804`), plus read-only probes of `https://egxano.vercel.app`. No source files were modified; nothing committed.
- Production probes (read-only, 2026-11-14): `GET /api/v1/push/public-key` → `{"publicKey":"BOzH6…kWo"}` (VAPID **is** configured in prod); `GET /api/v1/cron/alerts-push` unauthenticated → `401` (CRON_SECRET enforced); `GET /sw.js` → `200`; `GET /api/v1/alerts` unauthenticated → `401`.
- Production DB was NOT reachable; all findings are code-level evidence.

---

## 1. Architecture as built (text diagram)

```
                         ┌──────────────────────────────────────────────────────────┐
                         │  Three evaluators, ONE evaluator module                  │
                         │  src/lib/alerts/evaluate.ts                              │
                         └──────────────────────────────────────────────────────────┘
 (a) Lazy poll                (b) Snapshot-write hook                (c) Daily safety-net
 GET /api/v1/alerts           src/lib/market/refresh.ts              GET /api/v1/cron/alerts-push
 alerts/route.ts:47-88        runRefresh() → L308-313                cron/alerts-push/route.ts:51-52
 user-scoped                  all active alerts                      all active alerts
   │                            │                                      │
   │  getFreshMarketSnapshot()  │  snapshot just written               │  getFreshMarketSnapshot()
   ▼                            ▼                                      ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ evaluateAndNotifyAllAlerts(snapshot)  /  deactivateAndNotify(hits)           │
 │  1. findMany({ active: true })            evaluate.ts:117-121                │
 │  2. resolveAlertPrices:                   evaluate.ts:46-65                  │
 │       snapshot movers row  ── wins                                            │
 │       latest MarketPrice row (DISTINCT ON, NO age bound) ── fallback          │
 │  3. alertHit: ABOVE price>=target, BELOW price<=target   evaluate.ts:27-29    │
 │  4. ATOMIC CLAIM: updateMany({ where:{id, active:true} },                     │
 │        { data:{ active:false, triggeredAt:now } })       evaluate.ts:97-100   │
 │        count !== 1 → another evaluator won → return (no push)  L101           │
 │  5. sendPushToUser(userId, payload)                      L102                 │
 └──────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ src/lib/web-push.ts:66-107  sendPushToUser                                   │
 │  findMany ALL PushSubscription rows of user (L71)                            │
 │  Promise.allSettled per device (L78-94)                                      │
 │    404/410 → collect dead ids → deleteMany (L84-88, 96-100)                  │
 │    5xx / network error → console.warn, row kept, NO retry (L89-91)           │
 │  Never throws; outer catch → {skipped:true} (L102-106)                       │
 └──────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
                    Browser service worker public/sw.js:92-113
                    push event → showNotification (title/body/url)

 Refresh triggers for path (b):
   • Opportunistic kick via after() when snapshot >8 min stale in EGX window
     (Sun–Thu 09:00–16:00 Cairo) — snapshot.ts:27, 240-264
   • Inline refresh when >26 h stale inside the window — snapshot.ts:31, 206-238
   • Daily audit cron chains refreshMarketSnapshot — cron/audit/route.ts:93-101,
     scheduled "0 6 * * *" (vercel.json)
   • GET /api/v1/cron/market (external scheduler, maxDuration 60; NOT in vercel.json)

 vercel.json crons (Hobby = daily only):
   • 0 6 * * *   /api/v1/cron/audit?type=daily        (chains a market refresh)
   • 0 4 * * 1   /api/v1/cron/audit?type=weekly
   • 0 14 * * *  /api/v1/cron/alerts-push             (daily safety-net, maxDuration 60)

 Persistence:
   • PriceAlert: active Boolean, triggeredAt DateTime? — the ONLY record of a
     trigger (prisma/schema.prisma:958-972). No delivery state anywhere.
   • PushSubscription: userId/endpoint(unique)/p256dh/auth — NO relation to User
     (prisma/schema.prisma:982-991); table runtime-created by
     src/lib/db-schema-bootstrap.ts (CREATE TABLE IF NOT EXISTS, memoized).
```

## 2. Verified delivery flow (trace)

1. **Poll path (a)** — `GET /api/v1/alerts` (auth via `x-session-token`, `getSessionUser`, alerts/route.ts:30-32). Loads the user's alerts (L34-40), filters `active` (L43), resolves prices via `getFreshMarketSnapshot()` + `resolveAlertPrices` (L47-51), computes `hits` (L53-66), then `await deactivateAndNotify(hits)` **inside the request** (L86-88) before returning JSON (L108). Not fire-and-forget.
2. **Hook path (b)** — `runRefresh()` writes Setting snapshot + day-bucketed MarketPrice rows in one `$transaction` (refresh.ts:276-293), then **awaits** `evaluateAndNotifyAllAlerts(snapshot)` in a best-effort try/catch (L308-313); the summary return value is discarded. `runRefresh` is awaited by all its triggers (cron/market route:36; snapshot.ts inline L214 and `after()` callback L252-259; audit cron L96-97).
3. **Cron path (c)** — `GET /api/v1/cron/alerts-push`: bearer `CRON_SECRET` timing-safe match (L26-30), in-process single-flight `evalBusy` (L24, 37-43, 61), `maxDuration = 60` (L20), evaluates against `getFreshMarketSnapshot()` (L51-52), returns `{checked, triggered, sent}` (L54).
4. **Claim** — `updateMany({ where: { id, active: true } }, { data: { active: false, triggeredAt } })`; only `count === 1` proceeds to the push (evaluate.ts:97-102).
5. **Send** — `sendPushToUser` loads every `PushSubscription` of the user (web-push.ts:71), sends encrypted payload to each concurrently (L78-94), prunes 404/410 rows (L96-100), swallows everything else (L89-91, L102-106).
6. **Client** — `public/sw.js` push handler validates the JSON and calls `showNotification` inside `event.waitUntil` (sw.js:92-113); click handler is same-origin-safe (sw.js:115-144).

## 3. Findings

Severity rubric: **critical** = notification lost with no recovery path possible today; **high** = loss or wrong behavior likely under realistic conditions; **medium** = degraded observability/hygiene or partial loss; **low** = edge or cosmetic. Every row cites code read in this audit.

| # | Sev | Finding | Evidence (file:line) | Concrete failure scenario |
|---|-----|---------|----------------------|---------------------------|
| F-01 | **CRITICAL** | **Crash window between atomic claim and push send; the notification is lost forever and no record of the lost delivery exists.** The claim (`updateMany` → `active:false` + `triggeredAt`) commits BEFORE the send is attempted; `sendPushToUser` is best-effort and never throws; nothing is written between the two steps that a later process could recover from. | evaluate.ts:97-102 (`claim` then `sendPushToUser`); web-push.ts:64, 102-106 (never throws, outer catch → `{skipped:true}`); schema.prisma:966-967 (only `active`/`triggeredAt` — no delivery state); evaluate.ts:16-24 comment explicitly removes a PushLog/outbox | Vercel freezes/kills the lambda (maxDuration, OOM, Neon hiccup) after `claim.count===1` and before `sendNotification` resolves. The alert is now `active=false` — no evaluator will ever look at it again. User never gets the push; nothing in the DB says it was owed. |
| F-02 | **CRITICAL** | **No retry, no backoff, no dead-letter: transient web-push failures are swallowed.** A 5xx or network error from the push service is logged to console only, the subscription row is kept, the send is never re-attempted, and the alert stays deactivated. The failure never surfaces to any caller: the refresh hook discards the summary, the alerts GET discards the result. | web-push.ts:89-91 (warn + keep row, no retry); evaluate.ts:106 / refresh.ts:310 (summary discarded); alerts/route.ts:87 (result ignored); no DLQ/outbox table exists (grep: only `web-push.ts:71,98` touch `pushSubscription`) | FCM/GCM returns a transient 503 (or the TLS connection drops) for a single-device user at the exact moment their ABOVE alert crosses. `sent=0`, row kept, alert already `active=false`. Console.warn scrolls away with the lambda. Loss is permanent. |
| F-03 | HIGH | **Triggering against unbounded-stale recorded prices; no max-age gate anywhere.** `resolveAlertPrices` falls back to `latestPricesPerCompany` (DISTINCT ON latest row, no age filter) and the resulting `asOf` is recorded but never checked against any threshold before `alertHit`/claim. | evaluate.ts:56-62 (fallback chosen, `asOf` returned, never validated); latest-price.ts:42-45 (`DISTINCT ON … ORDER BY asOf DESC`, no `asOf > now()-X` predicate); no staleness check in evaluate.ts:127-135 or alerts/route.ts:53-88 | A company missing from the snapshot movers (filtered by the `\|changePct\|>50` plausibility cap, refresh.ts:138 / snapshot.ts:91; halted; or scanner gap) evaluates against its last MarketPrice row — possibly weeks old. A user creates an ABOVE alert slightly above that old price → immediate trigger on a price that is not current. |
| F-04 | HIGH | **Weekend / off-session refresh writes a "new" snapshot with unchanged prices; `asOf` is overwritten with fetch time, masking true data age.** The EGX session gate (`isEgxRefreshWindow`, Sun–Thu 09:00–16:00 Cairo) guards only the *opportunistic* kicks — `runRefresh()` itself has no session/weekday check, and the daily 06:00 UTC audit cron chains a refresh unconditionally, including Fri/Sat. `fetchedAt` becomes `asOf`/`pricesAsOf`; MarketPrice day-rows are stamped with the (weekend) day. | snapshot.ts:141-157 (window used only in `ensureFreshInline` L210 and kick gate L248); refresh.ts:188-293 (no session gate in `runRefresh`); refresh.ts:211, 250-252 (`fetchedAt` → `asOf`), 157-164 (`pricesAsOf=fetchedAt`, `delayMinutes:15` hardcoded); cron/audit/route.ts:93-101 (unconditional chained refresh); vercel.json (`0 6 * * *` runs daily incl. Fri/Sat); cron/market/route.ts (external scheduler, any-time contract) | Friday 06:00 UTC: scanner returns Thursday's close; a "fresh Friday" snapshot + Friday-dated MarketPrice rows are written with Thursday prices. Alerts created Thursday evening or Friday compare against a price that claims to be fresh; a BELOW target just under Thursday's close fires immediately on data that is >16 h old — and the UI shows "last recorded: 14 Nov" (date-only, page.tsx:232) making the stale data look current. |
| F-05 | MEDIUM | **Multi-device fan-out works (good) but per-device failures are untracked.** `sendPushToUser` sends to ALL subscriptions of the user and `Promise.allSettled` prevents one failing device from aborting the others — however a device that 5xx'd leaves no record: no per-device outcome, no retry list. Only 404/410 is acted on (row prune). | web-push.ts:71 (all rows), 78-94 (`allSettled`, per-device catch), 84-91 (404/410 → prune; else warn only), 96-100 | User has 3 devices; device B's push service 503s during the send. Devices A/C get the notification; B never will, and nothing distinguishes B from A in any record. Combined with F-02 the alert is marked done despite a device-level delivery gap. |
| F-06 | MEDIUM | **The `after()` opportunistic-refresh path runs the whole alert pipeline after the response, subject to the function's remaining lifetime.** The kick callback awaits `refreshMarketSnapshot` (which awaits the alert hook), but reader routes that trigger the kick export no `maxDuration`; a slow scanner (20 s fetch timeout) + Yahoo prev-close fetches + DB writes + push sends can outlive the window and be killed mid-hook. The hook itself IS awaited inside `runRefresh` (not a floating promise); the risk is the detached `after()` execution context. | snapshot.ts:240-264 (`after(async () => … refreshMarketSnapshot())`); refresh.ts:35 (`FETCH_TIMEOUT_MS = 20_000`); refresh.ts:225 (`yahooPrevCloseBefore` per ticker); alerts/route.ts (no `maxDuration` export — only cron/* routes set it, see grep of `maxDuration` in src/) | A user opens /alerts at session open with a >8-min-old snapshot → kick fires in `after()` → scanner is slow → function hits its duration cap mid `evaluateAndNotifyAllAlerts`, e.g. after some claims but before their sends → mixed loss (each post-claim kill = F-01). |
| F-07 | MEDIUM | **UI implies delivery on trigger.** The /alerts page's "Triggered" section is driven purely by `!active && triggeredAt`; the API exposes no delivery state (none exists), so a swallowed/failed push is indistinguishable from a delivered one. `hitNow` is computed by the API and typed in the UI but never rendered. The quota error message also hardcodes the wrong cap ("20 active alerts" vs actual FREE 5 / PRO 30 / PRO_PLUS 100). | page.tsx:78 (`fired` filter), 173-183 (section), 274-279 ("hit on …"); alerts/route.ts:67-81 (no delivery fields); page.tsx:37 (`hitNow` declared, never rendered — grep); page.tsx:529-530 ("20 تنبيهات نشطاً"/"20 active alerts") vs alerts/route.ts:160-175 (plan caps); page.tsx:412-427 (PushToggle shows only local On/Off) | Single-device user, push fails transiently (F-02). The page shows the alert under "Triggered … hit on 14 Nov 14:02" forever — the user believes they were notified. No UI surface would ever tell them delivery failed. |
| F-08 | MEDIUM | **No delivery observability: no metrics for sent/failed/pending, no audit trail for triggers or deliveries.** `audit()` (DB AuditLog) is called for ALERT_CREATED and PUSH_SUBSCRIBED only — not for triggers, sends, failures, or unsubscribes. Sent/failed counts are returned but discarded by the two request-path callers; only the daily cron logs them into an ephemeral JSON response. | lib/audit.ts:10-22 (infrastructure exists); alerts/route.ts:181-186 (ALERT_CREATED), subscribe/route.ts:52-56 (PUSH_SUBSCRIBED); no `audit(` in evaluate.ts / web-push.ts / unsubscribe/route.ts; refresh.ts:310 and alerts/route.ts:87 discard summaries; cron/alerts-push/route.ts:54 (counts live only in the HTTP response) | Product owner asks "were alerts delivered during last Thursday's session?" — the only trace is `triggeredAt` per alert. Whether a push was attempted, succeeded, or failed is unreconstructable; `console.warn` lines are the sole failure record and expire with lambda logs. |
| F-09 | MEDIUM | **Subscription hygiene gaps.** (a) `p256dh`/`auth` are validated only as non-empty strings — malformed keys are stored and then fail at send time with a 400-class error, which is NOT pruned (only 404/410 is), so the bad row is retried-and-failed forever with warn spam. (b) The client prefers the build-time `NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY` over the server route — if the two env vars diverge (key rotation), subscriptions made with the wrong key get 403 at every send and are never pruned. (c) `PushSubscription.userId` has no relation to `User` and the `User` model has no `pushSubscriptions` field — deleting a user orphans rows (no cascade, no cleanup code). (d) No cap on subscriptions per user. | subscribe/route.ts:31-36 (non-empty only); web-push.ts:84 (prune only 404/410), 91 (warn); page.tsx:348-349 (inline env precedence); schema.prisma:983-991 (no `@relation`/`onDelete`), 896-905 (User relations list has none for push); subscribe/route.ts:38-46 (unbounded upsert); web-push.ts:40-44 (missing VAPID → latched `disabled` per instance, silent skip) | (b) Key rotated server-side but `NEXT_PUBLIC_*` stale in an old client bundle → every new subscription fails 403 on every send; rows persist; user gets nothing, nothing prunes, nothing alerts. (c) A deleted account leaves `PushSubscription` rows pointing at a dead `userId` forever. |
| F-10 | LOW | **Duplicate alerts for the same (user, company, direction, target) are allowed** — POST creates unconditionally; the schema has no uniqueness beyond the PK. One price crossing then fans out N identical notifications. (The claim still dedupes per-alert correctly — this is user-visible duplication, not a race.) | alerts/route.ts:177-180 (bare `create`); schema.prisma:958-972 (no `@@unique` on business tuple) | User taps "Save" twice (or a retry after a timeout re-POSTs) → two active alerts, identical target → crossing produces two OS notifications. |
| F-11 | LOW | **GET /api/v1/alerts has no rate limit and the limiter is per-instance in-memory.** POST/DELETE are limited (`alerts-write` 30/10 min) but GET — which performs the full evaluation — is not; and `checkEndpointRateLimit` uses an in-process Map, so limits reset on every cold start and are per-lambda, not global. | alerts/route.ts:4, 138 (limit applied only in POST); rate-limit.ts:16-33, 47-48 (in-memory store), 119 (`alerts-write`); page.tsx:73 (`refetchInterval: 60_000` per open tab) | Many open tabs poll every 60 s; each poll runs `resolveAlertPrices` (a DISTINCT-ON query) + `getFreshMarketSnapshot`. Cost/load concern only — correctness of dedupe is unaffected (claim is DB-atomic). |
| F-12 | LOW | **No explicit timeout on `sendNotification`.** `sendPushToUser` calls the library without options; web-push 4.0.0 applies a socket timeout only when `options.timeout` is passed. A hung push-service connection blocks the device slot (and, in the awaited GET path, the user's response) until the platform kills the function — which also widens the F-01 window. | web-push.ts:81 (`sendNotification(sub, json)` — no third arg); node_modules/web-push/src/web-push-lib.js:217-218, 312-313, 351-352 (timeout honored only from `options.timeout`) | One dead endpoint stalls `Promise.allSettled` for the full function budget; the awaiting GET /api/v1/alerts response is delayed for every other user-visible work in that request and risks the F-01 kill mid-batch. |

### Verified-good (no finding, for the record)

- **Race-safety of the claim (checklist 6):** the conditional `updateMany … WHERE id AND active=true` is row-level atomic in Postgres; of N concurrent evaluators exactly one gets `count===1` and sends (evaluate.ts:97-101). Concurrent DELETE between read and claim degrades to `count!==1` → silent skip — safe. There is no edit route (only POST/DELETE, alerts/route.ts:133-203), so "edited mid-evaluation" is not reachable.
- **One-shot persistence (checklist 6):** later evaluations select `active: true` only (evaluate.ts:117-118; alerts/route.ts:43) — a persistent price never re-triggers a fired alert.
- **Fan-out does not abort (checklist 3):** `Promise.allSettled` per device (web-push.ts:78-94).
- **Dead-endpoint pruning:** 404/410 → `deleteMany` scoped to the user (web-push.ts:96-100).
- **Unsubscribe scoping:** delete is `WHERE endpoint AND userId` — knowing someone's endpoint cannot detach their device (unsubscribe/route.ts:37).
- **Service worker:** shows a notification on every push (`showNotification` in `event.waitUntil`, sw.js:105-112), same-origin-safe click navigation (sw.js:115-144), API routes never cached (sw.js:49).

## 4. Checklist answers (1-10), precisely

1. **Crash window — confirmed.** Claim at evaluate.ts:97-100 commits; send starts at L102. A kill/timeout between them loses the notification permanently; there is no row, queue entry, or log table that records "owed delivery" (schema.prisma:958-972 has no delivery state; no outbox table exists). The same window exists inside `sendPushToUser` per device (claim already committed while `sendNotification` is in flight; web-push.ts:78-94).
2. **No retry/backoff/dead-letter — confirmed.** Transient failures (any error that is not 404/410) → `console.warn` and move on (web-push.ts:89-91); the row survives, the alert does not reactivate, no counter, no nextAttempt. The outer catch (L102-106) additionally swallows DB-level failures as `{skipped:true}`. Callers discard the summary (refresh.ts:310; alerts/route.ts:87).
3. **Multi-device — yes, all subscriptions of the user are loaded and sent to (web-push.ts:71, 78-94); one failing device does not abort the loop (`allSettled`); per-device failure is NOT tracked anywhere** (console.warn only; the returned `sent` count is aggregate).
4. **Fire-and-forget — no floating promise found.** The alerts GET awaits `deactivateAndNotify` before responding (alerts/route.ts:87→108); the refresh hook awaits `evaluateAndNotifyAllAlerts` inside `runRefresh` (refresh.ts:310), and every refresh trigger awaits `runRefresh`. The one detached execution is the `after()` opportunistic kick (snapshot.ts:252-259): it runs after the HTTP response and is bounded by the function's max duration; reader routes export no `maxDuration`, so a slow refresh chain can be killed mid-hook (F-06). On Vercel, work not finished when the function is frozen/killed at the end of its duration does not resume.
5. **Freshness — partially guarded.** Snapshot-vs-file selection prefers the newer `asOf` and a 15 s lambda cache applies (snapshot.ts:169-202); the >26 h inline refresh + window gate protects the *snapshot* path — but the alert evaluation itself has **no max-age check**: the DB-price fallback picks the newest row regardless of age (latest-price.ts:42-45; evaluate.ts:56-62), and nothing verifies `priceAsOf` is recent before claiming (evaluate.ts:127-135). Weekend/phantom risk — **yes, Friday/Saturday can write a "new" snapshot**: `runRefresh` has no session gate and the daily 06:00 UTC audit cron chains it unconditionally (cron/audit/route.ts:93-101), while the session window (snapshot.ts:141-157) only gates kicks; `asOf`/`pricesAsOf` are stamped with fetch time (refresh.ts:157-164, 211, 250-252), masking the true age of the unchanged Thursday close.
6. **Duplicate prevention — the claim is genuinely race-safe** across the 3 concurrent evaluators (conditional UPDATE, DB row lock; evaluate.ts:97-101). Alert deleted mid-evaluation → `count!==1` → safe skip. No edit path exists. Same price persisting across refreshes → one-shot confirmed (active-only scans). Residual duplication: identical duplicate alerts are creatable (F-10) and the claim cannot protect a push that crashed after it (F-01).
7. **Subscription hygiene — see F-09.** Subscribe validates non-empty keys only; sends prune 404/410 but keep-and-warn every other failure; `PushSubscription` is unlinkable to `User` on delete (no relation, no cascade, no cleanup); subscriptions per user are unbounded; VAPID missing → per-instance latched disable (silent); VAPID mismatch via the `NEXT_PUBLIC_*` precedence creates permanently-failing rows. Positives: endpoint-unique upsert (subscribe/route.ts:40-46), user-scoped unsubscribe (unsubscribe/route.ts:37).
8. **UI truthfulness — the page shows only Triggered vs Active.** "تنبيهات مُطلقة / Triggered" is `!active && triggeredAt` (page.tsx:78, 173-183, 274-279); there is no Delivered/Failed/Pending state in the API (alerts/route.ts:67-81) and none rendered. Delivery is implied on trigger. Also `hitNow` is computed and typed but never displayed, and the quota message hardcodes "20" (page.tsx:529-530).
9. **Observability — effectively none.** No sent/failed/pending metrics, no DB audit trail for trigger or delivery events; only `console.warn` (web-push.ts:91, 104) and discarded summaries (refresh.ts:310; alerts/route.ts:87). The daily cron's JSON response carries `{checked, triggered, sent}` but is ephemeral. An `audit()` helper writing to AuditLog exists and is unused for this pipeline (lib/audit.ts:10-22).
10. **Cron gaps — precise answer.** The only scheduled safety-net is daily at 14:00 UTC (vercel.json; Hobby allows daily only). **It cannot recover a lost send today**: `evaluateAndNotifyAllAlerts` scans `active: true` only (evaluate.ts:117-118), and a triggered-but-undelivered alert is already `active=false`; there is no record to recover from — the sole trace is `triggeredAt`. A triggered-but-undelivered event therefore sits **forever** (until the user happens to open /alerts, where it is displayed as "Triggered" with no delivery information). The daily cron additionally runs off-window (14:00 UTC ≈ 16:00–17:00 Cairo, after close): it evaluates whatever snapshot exists and only kicks a refresh when >26 h stale — so it re-checks stale prices rather than guaranteeing fresh ones.

## 5. Proposed minimal Transactional Outbox design (design only — not implemented)

Goal: durable, recoverable, duplicate-resistant delivery on THIS stack (Prisma + Neon, Vercel serverless Hobby with daily crons, plus opportunistic dispatch on existing traffic), with the smallest additive surface. The codebase already proves the two patterns we reuse: the runtime table bootstrap (db-schema-bootstrap.ts) and the conditional-update atomic claim (evaluate.ts:97-101).

### 5.1 Additive model

```prisma
// prisma/schema.prisma (additive; no existing model changes needed)
model NotificationOutbox {
  id            String    @id @default(cuid())
  alertId       String    @unique            // 1:1 with a triggered PriceAlert; makes publish idempotent
  userId        String
  status        String    @default("PENDING") // PENDING | SENDING | SENT | DEAD
  attempts      Int       @default(0)
  nextAttemptAt DateTime  @default(now())
  leaseUntil    DateTime?                    // SENDING lease; re-claimable when expired
  payload       Json                          // frozen {title, body, url} at trigger time
  lastError     String?
  sentAt        DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([status, nextAttemptAt])            // drain query
  @@index([userId])                           // user-scoped drain from alerts GET
}
```

Because production migrations are unavailable from every environment, ship the table through the existing self-heal pattern: extend `src/lib/db-schema-bootstrap.ts` with a `CREATE TABLE IF NOT EXISTS "NotificationOutbox"` + the two indexes, named to match what Prisma would create (`NotificationOutbox_alertId_key`, `NotificationOutbox_status_nextAttemptAt_idx`, `NotificationOutbox_userId_idx`), memoized with failure-clearing exactly like `ensurePushTables` (db-schema-bootstrap.ts:17-51).

### 5.2 Publish: close the F-01 crash window with one transaction

In `deactivateAndNotify` (evaluate.ts:92-107), keep the exact atomic claim but wrap claim + outbox insert in a single interactive transaction:

```ts
const result = await db.$transaction(async (tx) => {
  const claim = await tx.priceAlert.updateMany({
    where: { id: hit.id, active: true },
    data: { active: false, triggeredAt: now },
  })
  if (claim.count !== 1) return "lost-race"
  await tx.notificationOutbox.create({
    data: { alertId: hit.id, userId: hit.userId, payload: pushPayloadFor(hit) },
    // duplicate publish attempt is impossible after count===1, but alertId unique
    // is the belt-and-braces against any future second publish path
  })
  return "published"
})
if (result === "published") fireAndTrackDispatch(hit.userId)   // 5.3
```

Properties: the alert deactivation and the delivery task are committed atomically — a kill at any point either leaves both absent (evaluator re-runs later, re-claims) or both present (drain will deliver). `triggeredAt` remains the UI timestamp; the outbox becomes the delivery ledger the product owner asked for. Dedupe semantics are unchanged and still race-safe (the claim is the sole gate for who publishes).

### 5.3 Dispatch strategy under Hobby-plan constraints

Three dispatch opportunities, all additive, none blocking a user response longer than a bounded budget:

1. **Inline opportunistic dispatch (hot path).** Immediately after a successful publish (any of the three evaluator call sites), attempt to deliver that user's due outbox rows with a small budget (e.g. max 10 rows / ~4 s). On success per row → `SENT` + `sentAt`; on transient failure → keep `PENDING`, increment `attempts`, set `lastError`, `nextAttemptAt = now + backoff`. This gives sub-second delivery in the common case, unchanged from today's behavior.
2. **Sweep on existing traffic.**
   - Tail of the refresh hook (refresh.ts:308-313 block): `drainDispatch({ limit: 20, timeBudgetMs: 5000 })` — every snapshot write sweeps what previous instances left pending. In-session kick cadence (≈8 min staleness threshold, snapshot.ts:27) bounds this to roughly one sweep per 8 minutes during Sun–Thu 09:00–16:00 Cairo.
   - Tail of `GET /api/v1/alerts` (after building the response payload, before returning): `drainDispatch({ userId, limit: 5 })` — the polling user (60 s interval, page.tsx:73) drains their own pending rows; strictly user-scoped so a user request never does cross-user work.
3. **Daily cron drain (the guaranteed floor).** Extend `/api/v1/cron/alerts-push` (or add `cron/outbox-drain` on the same 14:00 UTC slot): after the existing evaluation, loop `drainDispatch({ limit: 200 })` until there are no due rows or `maxDuration − 10 s` is reached, and finish with a reconciliation query that re-queues rows stuck in `SENDING` with `leaseUntil < now`.

**Honest latency analysis.** Delivery latency = time from trigger commit to the next dispatch opportunity that finds the row:
- Best case (the same request publishes then dispatches inline): seconds — unchanged from the current pipeline.
- Site with normal daytime traffic (refresh sweeps every ≤8 min in-session; alert polls every 60 s): retries land within minutes.
- **Worst case — zero traffic after the failure: one attempt per day**, anchored at the 14:00 UTC cron (Hobby cannot schedule anything more frequent; the 06:00 UTC audit cron can additionally run a sweep for free). A row that keeps failing climbs the backoff ladder in ~24 h steps: e.g. attempts at +0 s, +1 d, +2 d, +4 d, then `DEAD` after 5 attempts or 7 days (configurable). So max time-to-DEAD ≈ 5–7 days; max latency for a *successful* retry ≈ 24 h per attempt. This is a real, stated cost of the Hobby plan; the design converts "silently lost forever" into "at-least-once within a day, dead-lettered with a recorded error afterwards".

### 5.4 Idempotency and leases for serverless

- **Task claim:** `drainDispatch` selects due rows (`status = "PENDING" AND nextAttemptAt <= now`, or `status = "SENDING" AND leaseUntil < now`) by id, then claims with the codebase's proven conditional-update pattern: `updateMany({ where: { id: { in: ids }, status: "PENDING" } , data: { status: "SENDING", leaseUntil: now + 60 s, attempts: { increment: 1 } } })` — only rows whose update matched are dispatched by this instance, so concurrent lambdas (kicks from many instances) never double-send the same task. Expired `SENDING` rows are re-claimable — this is what recovers F-01-style kills mid-dispatch.
- **At-least-once semantics, stated honestly:** a lambda killed after `sendNotification` resolved but before `SENT` is written will resend on the next sweep — the user may rarely see one duplicate OS notification. That is the correct trade for a product that currently loses notifications silently; web push has no ack API to make it exactly-once.
- **Per-device handling stays in `sendPushToUser`** (it already fans out and prunes 404/410, web-push.ts:71-100). Extend its return type to `{ sent, removed, failedDevices: number, lastDeviceError?: string }` so the drain can decide: `sent ≥ 1` → mark `SENT` (delivery reached at least one device; per-device gaps visible in `lastError` if you want richer state later); `sent = 0 && failedDevices > 0` on a 4xx-class response that indicates a bad key (400) → mark `DEAD` with `lastError` (fixes the "invalid keys retried forever" gap, F-09a); otherwise `PENDING` + backoff. Add `options.timeout` to `sendNotification` (web-push 4.0.0 honors it; lib line 217-218) so a hung endpoint cannot eat the drain budget (F-12).
- **Dead-letter:** `DEAD` rows are kept, queryable (`status = "DEAD"`), and surfaced in the admin surface via the existing AuditLog habit; a `DEAD` row is re-armable only by the user creating a new alert (consistent with the one-shot product model, evaluate.ts:16-24).

### 5.5 UI states on /alerts

Replace the binary Triggered/Active split with three honest states, driven by a `delivery` field added to the `GET /api/v1/alerts` payload (1:1 join on `alertId`, left-joined so untriggered alerts carry `null`):

| State | Source | UI label (ar/en) |
|---|---|---|
| Active | `active = true` | نشِطة / Active (unchanged, page.tsx:185-204) |
| Delivered | outbox `status = "SENT"` (+ `sentAt`) | اتحققت ووصل الإشعار في … / Hit and delivered … |
| Triggered, delivery pending | outbox `PENDING`/`SENDING` with `attempts` > 0 | اتحققت — بنحاول نوصل الإشعار تاني / Hit — retrying delivery |
| Triggered, dead-lettered | outbox `DEAD` (+ `lastError`) | اتحققت لكن تعذّر إيصال الإشعار / Hit but delivery failed |

This directly answers F-07: "triggered" stops implying "delivered", and the user can see a failed delivery instead of assuming silence means nothing happened. Keep the existing triggeredAt timestamp; add `sentAt` when SENT. The PushToggle can also reflect server-side push health (public-key null → "push not configured on server", page.tsx:366-369 already covers the subscribe side).

### 5.6 Companion fixes (small, called out because the outbox alone does not fix them)

1. Bound the price fallback: reject/redeclare hits resolved from a `MarketPrice.asOf` older than a threshold (e.g. >48 h) instead of silently trusting it (F-03) — cheapest correct form: pass the resolved `asOf` through `resolveAlertPrices` into the hit check.
2. Gate `runRefresh`'s write step to EGX trading days (or carry the scanner's true data timestamp instead of `fetchedAt`) so Fri/Sat runs stop re-stamping Thursday's close as fresh (F-04).
3. Uniqueness or upsert on `(userId, companyId, direction, targetPrice)` for active alerts (F-10); validate `p256dh`/`auth` as base64url at subscribe (F-09a); make the server route the single source of the VAPID key (F-09b); add `userId` FK relation (or a cleanup pass) for `PushSubscription` (F-09c).
4. Add `audit("ALERT_TRIGGERED", …)` / daily outbox-depth summary to the cron response (F-08), and render or drop `hitNow` (F-07).

---

## Appendix A — Files read in full for this audit

`src/lib/alerts/evaluate.ts`; `src/app/api/v1/alerts/route.ts`; `src/app/api/v1/push/subscribe/route.ts`; `src/app/api/v1/push/unsubscribe/route.ts`; `src/app/api/v1/push/public-key/route.ts`; `src/app/api/v1/cron/alerts-push/route.ts`; `src/lib/web-push.ts`; `src/lib/db-schema-bootstrap.ts`; `src/lib/market/refresh.ts`; `src/lib/market/snapshot.ts`; `src/lib/market/latest-price.ts`; `public/sw.js`; `prisma/schema.prisma` (User/PriceAlert/PushSubscription/Session models); `src/app/alerts/page.tsx`; `vercel.json`; `src/lib/rate-limit.ts`; `src/lib/audit.ts`; `src/lib/db.ts`; `src/app/api/v1/cron/market/route.ts` + `cron/audit/route.ts` (refresh-chaining sections); `src/instrumentation.ts`; `node_modules/web-push/src/web-push-lib.js` (timeout handling only).

## Appendix B — Constraints honored

- Only this file was created under `docs/notes/`; no `src/**` changes; no commits. Pre-existing dirty working-tree files (5 unrelated modified files at checkout) were left untouched.
- Production probes were read-only HTTP GETs; no environment variables, secrets, or database connections were accessed.
