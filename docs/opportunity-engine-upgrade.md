# EGXANO — Opportunity Intelligence Engine Upgrade (2026-11-15)

**Branch:** `task/opportunity-engine` (on top of origin/main `97047d7`)
**Directive:** "Opportunity Intelligence Engine — a real-time, high-conviction Egyptian stock opportunity detection & trade planning system"
**Companion documents:** [`docs/notes/opportunity-validation.md`](./notes/opportunity-validation.md) (§12 historical validation, full numbers), the repo's prior remediation records (`technical-engine-remediation-2026-11-15.md`, `independent-technical-analysis-audit.md`).

**How to read:** every section separates **Implemented & verified** (in code, tested) from **Not available / theoretical** (data or deployment limits). Nothing here promises profit; every number is reproducible from the named scripts.

---

## 1. Existing system limitations (what this upgrade started from)

- **Targets could skip nearer resistance.** The plan builder took "the next structural zone" but nothing verified the *path* from entry to target; a target above a strong nearer supply band could be displayed with the nearer obstacle unmentioned.
- **No hard upside eligibility.** A BUY with a technically valid plan could ship with 1–4% realistic upside; nothing rejected it.
- **Chasing was possible.** A confirmed row kept its plan even when price had already run past the entry zone; nothing recomputed *remaining* upside from the current price.
- **One target, one label.** No T1/T2 ladder, no per-target evidence ("why does this level exist"), no conservative-edge rule.
- **All states collapsed into BUY/WAIT/SELL + watching.** No opportunity lifecycle: nothing distinguished an early constructive build-up from a ready entry, a conditional trigger, an expired window, or a missed chase.
- **"Real-time" was a UI impression.** The SSE stream re-broadcasts a 15-minute-delayed snapshot every 5s; intraday confirmations did not exist and nothing claimed them honestly.
- **Ranking was score-first.** The board sorted by technical score; score alone could surface setups whose geometry was untradeable.

## 2. Root causes

1. The plan builder (`trade-plan.ts` @5) was a *geometry* tool with no *policy* layer above it — eligibility, path obstacles and no-chase had no home.
2. Zones existed (`zones.ts` supply/demand bands) but were never scored for strength (touches, recency, rejection wicks, volume, failed breakouts) nor composed into an obstacle path.
3. The engine's confirmations were daily-close based by design (honest for EOD data), but the UI never separated "confirmed" from "this exact moment is actionable", so users read WAIT rules as the whole product.
4. No validation harness for *policy* changes — the backtest framework measured engine-v2 as a whole, not eligibility rules in isolation.

## 3. Actual data-feed capabilities and latency (verified, not assumed)

| source | what it provides | latency | cadence in production |
|---|---|---|---|
| Yahoo chart API (`interval=1d`, `live-bars.ts`) | ~2y daily OHLCV per ticker, on demand | EOD session data; intraday-last-bar drift possible | in-memory 15-min cache; never persisted |
| TradingView EGX scanner → `public/data/market-ticker.json` (`scripts/refresh-market-snapshot.mjs`) | index levels + top movers (price, changePct, volume) | **~15 minutes delayed** | script-refreshed snapshot; DB `MarketPrice` is the durable fallback |
| `/api/v1/market/stream` (SSE) | re-broadcast of the same delayed snapshot | 15-min delayed | every 5s per connection, 10-min stream lifetime |
| Yahoo chart API intraday (`interval=5m` — **new, `intraday-context.ts`**) | real 5-minute OHLCV bars, ~recent sessions | **~15 minutes delayed (same vendor delay for EGX)** | on-demand, 5-min cache, evidence-only |
| GitHub Actions `candles-refresh.yml` 13:30 UTC | daily candles → stance batches → lifecycle/opportunity sweep | EOD | daily, after close |

- **No licensed real-time feed exists.** Nothing in the platform is tick-level; the SSE ticker is honestly labeled delayed in the code and now in the intraday layer's Arabic note ("بيانات اليوم اللحظي مصدرها متأخر (~15 دقيقة) — ليست أسعارًا لحظية فورية").
- **No artificial OHLC is constructed anywhere** — the close-only engine's plan path is already disabled (`tradePlan = null`), the resistance map skips flat O=H=L=C bars, and the intraday layer abstains (`available:false`) rather than fabricate bars from a last-price field.
- **Upgrade path (not implemented, not purchased):** a licensed low-latency EGX feed (or EGX direct market-data membership) would upgrade the conditional-entry layer from "delayed evidence + user-watched trigger" to system-verified intraday confirmation. No dependency was added without approval, per the directive.

## 4. New analytical methodology (all deterministic, versioned `opportunity@1`)

Five new pure modules, each unit-tested, none touching the `tech-signals@5 / stance@3` semantics:

- **`resistance-map.ts` (`resistance-map@1`)** — swing-pivot zones (fractal wing 3, loose comparisons) clustered (1.5% tolerance, 2% max span, ±0.6% band buffer) from **real OHLC only**. Zone strength 0–100 = touches (cap 6) 30 + recency fade 25 + rejection wicks 20 + touch-volume vs series median 15 + failed-breakout history 10. APIs: `nearestSupplyAbove`, `nearestSupportBelow`, `obstaclesBetween`, `majorResistance/majorSupport`.
- **`opportunity-targets.ts`** — T1/T2/T3 ladder from the map. T1 = nearest meaningful supply (strength ≥ 20 or touches ≥ 2) at its **conservative near edge** (never the optimistic far edge), tick-rounded up for buys. T2 = next stronger rung ≥2% beyond T1; T3 only for dominant (≥60) zones or major confirmed swing highs. Arabic `whyAr` per target cites the zone's real evidence (touches, wick sessions, failed breakouts, volume ratio, recency). `measured_move` fallback only when no zone exists on the target side, and labeled as such.
- **`opportunity.ts` (`opportunity@1`)** — the classifier (Section 5) computing upside **from the worst executable entry** (`entryHigh` for buys) to T1, the strict gates, no-chase, and every Arabic reason from the actual computed numbers.
- **`opportunity-score.ts`** — OQS 0–100 (Section 10); returns `null` for ineligible rows by construction.
- **`intraday-context.ts`** — Yahoo 5m bars, evidence-only (Section 8).

## 5. Opportunity lifecycle (7 states, deterministic transitions)

`early → observation → conditional → actionable → invalidated / missed / none` (plus lifecycle pass-through `invalidated`/`expired`):

1. **early (فرصة مبكرة)** — evidence-only (improving RS / accumulation flags); carries **no levels, no direction, never eligible**.
2. **observation (تحت المراقبة)** — watching setup whose trigger geometry fails a gate; shows what is pending and the trigger-time numbers.
3. **conditional (دخول مشروط)** — watching setup whose activation level implies a valid provisional plan passing both gates; `provisional:true`, levels recomputed on activation, never counted as eligible.
4. **actionable (فرصة شراء جاهزة)** — confirmed + valid plan + upside >5% from entryHigh + RR ≥ 1.5 + **not left-behind** (no-chase below).
5. **invalidated** — lifecycle event pass-through with the event's Arabic note.
6. **missed (الفرصة فاتت — العائد المتبقي غير كافٍ)** — the no-chase rule: entry zone left behind AND remaining upside **from lastClose** < 5%. Found and fixed during this work: the first implementation checked no-chase only on *ineligible* rows; the tests caught that an eligible-by-entry-zone row could still ship actionable with negative remaining upside. The check now precedes any actionable promotion (directive §3.4).
7. **none** — honest emptiness: "لا توجد فرصة مؤهلة حاليًا وفق بوابتي العائد (5% المتبقية حتى الهدف الأول) والمخاطرة (RR ≥ 1.5) — تُعاد القراءة حسابيًا مع كل إغلاق يومي ولا تُصنَّع فرصة."

Hold/wait rows are never opportunities; a naked read never exists.

## 6. Target calculation methodology

- Targets come **only** from the resistance map's real structure (zone near-edge / confirmed major high) or, as a labeled fallback, a measured move. No target is generated because it is 5/10/15% away — the 5% rule is a **filter**, never a generator.
- The ladder never skips a nearer meaningful zone: T1 is the first obstacle above the executable entry. If the technically-justified T1 offers only 3%, the row is **rejected with the reason** ("فرصة غير مؤهلة لمعيار العائد: العائد المتوقع حتى الهدف الأول 3.43% من أعلى الدخول التنفيذي (129.26)، وهو أقل من الحد الأدنى 5%") — and, when applicable, the breakout/retest re-entry is what the conditional state watches instead.
- Every target carries `whyAr` citing actual evidence, e.g. COMI T1: "الهدف الأول عند 133.69 — الحافة السفلى لمنطقة عرض تمتد من 133.69 إلى 135.31، سبق أن ظهر عندها ضغط بيعي في 32 جلسات، آخرها 37 جلسات مضت، 13 منها بذيول عليا واضحة، وصمدت أمام 4 محاولة اختراق فاشلة."

## 7. Strict 5% qualification results

- **Gate semantics:** strictly greater than 5.00% (exactly 5.00 fails — pinned by tests, with a float-dust guard rounding to 4dp before comparison). RR ≥ 1.5 (1.5 passes, 1.49 fails) on the same plan numbers.
- **Historical qualification rate (frozen window):** 1,546 plan-valid candidates → **397 qualifying (25.7%)**; 1,149 honestly rejected.
- **5% audit (§12):** all 116 entered trades checked at their actual eligible entry time from the conservative fill — **0 violations**, minimum upside-at-fill **5.05%**.
- **Live snapshot examples:** COMI rejected at 3.43% remaining; ETEL rejected at 0.79% (Section 12).
- No entry price or target is ever nudged to pass; rejection states carry the exact numbers.

## 8. Intraday trigger behavior (honest)

- **What exists now:** conditional entries carry a precise trigger (level + volume condition + invalidation) that the **user watches on the delayed price**; `intraday-context.ts` fetches real 5m bars and reports evidence — volume expansion vs session baseline, whether the last delayed intraday close is beyond a trigger level, session VWAP — each labeled delayed and **explicitly not a confirmation** ("لا يُعد هذا تأكيد تفعيل رسمي"). It never affects eligibility; it never fabricates bars; it abstains when Yahoo is unreachable.
- **What does not exist:** system-verified intraday activation (needs a licensed low-latency feed — Section 3 upgrade path). The engine's own confirmations remain daily-close-based; "actionable NOW" always means "all daily-based conditions are satisfied now, trigger pending/at hand", not tick-verified.
- The 5-second SSE loop is a UI convenience over delayed data; no opportunity state transitions on it (no stale-data alerts, no per-refresh recomputation storms).

## 9. Risk and execution logic

- Stops remain structural (swing ± 1.5×ATR, sanity band [0.5×, 3.5×ATR]) from the validated @5 builder; the opportunity layer adds the **path check**: obstacles between entry and T1 feed OQS resistanceClearance, and the entry/stop/target all pass conservative tick rounding.
- Every displayed plan keeps its reason (`basisAr`); the plan is void if price closes outside it (unchanged contract), and gap risk is disclosed (a stop is never a guaranteed loss cap).
- Pre-entry cancellation (invalidation level) and post-entry stop are distinct states (watching setup vs lifecycle), as required.
- Liquidity feeds OQS (`liquid/normal/thin`) from relative volume conventions; execution readiness is a score component, never a gate override.

## 10. Ranking methodology

- **OQS 0–100** with documented weights: evidence .15, structure .12, volumeConfirmation .12, resistanceClearance .12, riskReward .12, relativeStrength .10, upside .10 (capped 15% — anti-chasing), liquidity .06, dataFreshness .06, executionReadiness .05.
- **Hard rule by construction:** `eligible:false → oqs:null` — an ineligible row can never out-rank; a 3%-upside setup scores nothing regardless of its other qualities.
- Digest order: qualifying by OQS DESC (ties → upside, → ticker), then a clearly separated informative tail (conditional/observation with rejection reasons), missed rows in their own list; caps preserved; free-tier stripping identical to the board.

## 11. Historical validation results (full numbers in `docs/notes/opportunity-validation.md`)

- Same frozen window/universe/split/costs as `baseline-results-v2.json`; the replayed signal stream is the **frozen baseline engine** (the in-tree engine drifted post-remediation — see §18).
- Funnel: 4,727 decision sessions → 1,546 buy signals → 397 qualifying → 116 trades entered.
- **5% audit: 0 violations, min 5.05% at fill.**
- Outcomes: T1-before-stop 45.5%, stop 42.5%, T2 18.9% (of 37 with T2), ambiguous 0, false-breakout 51.7%, median 6.5 sessions to T1, MFE +8.4% / MAE −3.5%.
- Pooled: PF 2.11, expectancy +3.3%, win 54.9%, maxDD −67.2% — **vs v2 baseline PF 3.63, expectancy +4.7%, maxDD −19.9% on 43 trades**.
- Walk-forward: TRAIN PF 3.59 (83 trades); VALIDATION PF 0.98 (20 trades); TEST PF 0.13 (10 trades) — out-of-sample cells statistically empty; no live claims.
- **Honest verdict:** the eligibility gates *prove* the 5% rule but did **not** improve risk-adjusted quality vs v2 on this window — they widen frequency and enforce eligibility; quality differentiation is carried by OQS/conviction/regime. Documented as measured; nothing was tuned to flatter the result.

## 12. Before/after representative companies (actual snapshot 2026-11-12, frozen-window data, `scripts/backtest/opportunity-examples.ts`)

| company | tier | last close | OLD engine (frozen @4) | NEW opportunity@1 | why |
|---|---|---|---|---|---|
| **COMI** | EGX30 Banks | 128.75 | **buy**, score 71, plan entry 127.14–129.26, stop 123.84, target 136.92 (RR 2.0) | **REJECTED — فرصة غير مؤهلة لمعيار العائد** | old target 136.92 **skipped** the strong supply zone 133.69–135.31 (strength 85, 32 touches, 4 failed breakouts); T1 = 133.69 → upside **3.43%** < 5% from entryHigh 129.26 |
| **ETEL** | EGX30 Telecom | 133.00 | **buy**, score 73, plan RR **1.13** (!), target 137.78 | **REJECTED** | T1 = 134.59 — supply band 134.59–136.21, strength 95, touched the **same session**, volume 1.89× median; upside **0.79%**; the old plan itself violated the RR floor |
| POUL | EGX70 Food | — | sell, score 24 | none (no directional opportunity off a weak sell) | honest abstention |
| HDBK | EGX70 Banks | — | hold 54 | none | hold is never an opportunity |
| AALR | MAIN Construction | — | hold 55 | none | hold is never an opportunity |

COMI is the directive's own §2 example made real: the technically-justified first obstacle yields 3.43%, so the stock leaves the qualifying list with the exact reason shown to the user — the old 136.92 target would have passed an eligibility check it never faced.

## 13. Performance measurements

- Opportunity layer cost per ticker (map + ladder + classify, 244-session bars): **0.3–7.7 ms** (examples script) — candidates-only wiring means a full 246-ticker board adds ≈1–2 s worst case, and holds/wait rows are skipped entirely (no cost).
- Validation replay (4,727 decision sessions × map+ladder+classify with no lookahead) completes in the runner's normal batch time; no new DB writes are introduced by the layer (only the two snapshot keys and one new Setting KV, §14).
- No change to the board's read path shape: same single `findMany` batch for stances, same snapshot-first cold-start fallback.

## 14. API and database changes

- **No new Prisma models.** Persistence stays: Setting-KV snapshots (`technical-signals:board:v2→v3`, `technical-signals:market:v5→v6` — keys bumped for the new persisted row shape) + new `opportunity-sweep:state:v1` for the alerts baseline; the alerts feed row (`lifecycle-sweep:alerts:v1`) now carries `kind: "lifecycle" | "opportunity"` items, backward-compatible (absent kind reads as lifecycle).
- **`GET /api/v1/signals/opportunities`** → `opportunity@1`: `regime + regimeNoteAr`, `qualifying` count, ranked `rows` (OQS DESC), `missedRows` (cap 3), `emptyNoteAr` when nothing qualifies; free/anonymous gating identical to the board (`gateRowForFree` on locked rows).
- **`GET /api/v1/companies/[id]/technical`** → adds the per-company `opportunity` block (same numbers as the strip — one canonical state).
- Alerts: the daily sweep emits opportunity-transition alerts (`actionable_ready`, `conditional_entry`, `invalidated`, `missed`, `upside_dropped`) with the same dedup identity `(kind, company, type, date)`, baseline-on-first-observation, dry-run default — no duplicate notifications on refresh.

## 15. UI changes

- **Opportunity cards** (strip + company technical tab) answer, in order: ما هي الفرصة؟ (state badge: فرصة شراء جاهزة / دخول مشروط / تحت المراقبة / فرصة مبكرة / الفرصة فاتت) · لماذا؟ · جاهزة الآن؟ · الدخول/الوقف/الهدف الأول (+T2) · العائد المتبقي (الرقم الفعلي) · ما الذي قد يفشل؟ · راقب ماذا؟ · آخر تحديث. Technical evidence (per-target `whyAr`, OQS components) lives in an expandable section.
- Board sections: جاهزة الآن / بانتظار تفعيل / غير مؤهلة (collapsed) / فاتت — with the honest empty card when nothing qualifies.
- No probabilities, no promises; conclusions first, numbers behind expanders.

## 16. Regression test results

- Full suite: **827 passed / 6 skipped (833), tsc clean** — including all pre-existing integrity suites (financial integrity, metric parity, conservative rounding, signals/trade-plan contracts). Baseline before this branch: 626 passed.
- Added: resistance-map 42, opportunity classifier 35, OQS 29, intraday-context 27, opportunity-alerts 52, backtest opportunity-replay 16, integration/digest/API/UI tests from the glue work.
- The fixture work surfaced and fixed a **real bug** (no-chase gap, §5.6) — tests did their job.

## 17. Deployment information

- Branch `task/opportunity-engine` — one commit (or a short series) on top of origin/main `97047d7`; **push blocked by missing credentials in this sandbox** (same constraint as previous sessions). Preview/Production verification therefore **not yet executed**; the deployment step is: push → Vercel preview → run the post-deploy battery (the parity session's pattern) → promote.
- Scheduling unchanged: candles-refresh 13:30 UTC gains the opportunity sweep step after stance batches (the sweep script ships with this branch); Vercel crons untouched.

## 18. Remaining limitations (honest)

1. **Data latency is unchanged (§3):** all "live" behavior runs on ~15-min-delayed snapshots or EOD bars; conditional entries are user-watched triggers, not system-verified fills. A licensed feed is the required upgrade and needs owner approval/cost decision.
2. **In-tree engine plan-drift on historical data:** the post-remediation `signals.ts` returns null plans on the frozen window's buys (44/44 null on COMI) where the baseline engine planned 67/67 — production actionable lists will be **sparser** than the replay suggests; if plan-validity stays near zero on live data, the strict plan validation (RR/rounding) is the first suspect to review. The replay therefore used the frozen engine for comparability.
3. **The eligibility gates are proven, not profitable-by-proof:** on the frozen window they did not beat v2 risk-adjusted (§11). The OQS ranking has **no historical validation of its ordering quality yet** (it ranks; whether top-ranked outperforms lower-ranked is unmeasured) — that is the next validation target.
4. **Out-of-sample cells are tiny** (20/10 trades) — no statistical claim is made.
5. **Repo archaeology:** during this work the sandbox's local clone was found replaced (stale Vercel-mirror snapshot, unrelated history); the full lineage incl. the previous session's seven commits was recovered from the remote's side branches; recovery bundles + prior Arabic reports are archived under `download/recovery/`. The local `bun.lock` needed a non-frozen install (drift predates this branch; the lockfile change is not committed).
6. **Screenshot phase:** the directive's referenced screenshot was not attached to the session; current-behavior reproduction was done from the code, the engine's actual outputs, and the remediation/audit records instead.
7. Divergence/unification, buy-side only replay coverage of conditional states (watching setups are unit-tested but not replayed), and sector segments' small samples remain open items.
