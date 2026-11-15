# EGXANO Technical Engine — Remediation Record (2026-11-15)

**Date:** 2026-11-15
**Branch:** `fix/technical-engine-integrity`
**Base:** `9f9da63` (merge of PR #3, `remediation/technical-analysis-integrity`)
**Engine versions:** `tech-signals@5` / `stance@3` (unchanged by this work)
**Baseline audit:** [`docs/independent-technical-analysis-audit.md`](./independent-technical-analysis-audit.md) — preserved unmodified as the historical record.
**Prior rollout record:** [`docs/production-remediation-results.md`](./production-remediation-results.md) (2026-11-14) — preserved unmodified.

---

## 0. How to read this document

The independent audit was written against `technical@4` / `tech-signals@4` / `stance@1`.
By the time remediation began, `main` had already advanced to `tech-signals@5` / `stance@3`,
and PR #3 had landed a partial remediation. **Every audit finding below was therefore
re-verified against the actual source at `9f9da63` before any change was made.**

Three outcomes are possible for each finding, and they are labelled explicitly:

- **RESOLVED (pre-existing)** — already fixed on `main` before this work; verified, not re-implemented.
- **RESOLVED (this work)** — fixed by this branch.
- **BLOCKED / NOT IMPLEMENTED** — with the reason stated. No finding is silently dropped.

A finding the audit reported that **does not exist in the code** is marked
**FALSE POSITIVE** with the evidence. The audit is a diagnostic document, not a specification.

---

## 1. Critical findings

### C-01 — Close-only trade plans

| | |
|---|---|
| **Original finding** | The close-only engine built entry/stop/target zones from artificial flat bars (O=H=L=C), producing different levels than the full OHLC engine for the same stock. |
| **Re-verified at `9f9da63`** | **Already fixed by PR #3.** `signals.ts` sets `const tradePlan = null` on the close-only path. The snapshot paths pass `closes: []` and source levels from `snap.levels` / `snap.zones` — real OHLC structure only. |
| **Status** | **RESOLVED (pre-existing)** — verified, no change needed. |
| **Evidence** | `src/lib/technical/signals.ts` — close path `tradePlan = null`; snapshot paths `buildTradePlan({ closes: [], supports: snap.levels.supports, … })`. |
| **Tests** | `signal-state.test.ts` ("a strong buy with NO anchorable plan is watching, never naked"), `signals.test.ts` ("hold → NO plan"). |

**Residual note:** `deriveZones()` still exists in `trade-plan.ts` as a fallback when a caller
passes neither `supports` nor `zones`. No production path reaches it (both snapshot paths pass
explicit levels, and the close path no longer builds a plan). It is retained rather than deleted
because `buildTradePlan` is a public, unit-tested function whose contract allows a closes-only
call. Deleting it would be a behaviour change with no production benefit.

### C-02 — Canonical snapshot error isolation

| | |
|---|---|
| **Original finding** | A broad try/catch around the overlay loop nullified `tradePlan`/`invalidation` for **all** rows on any failure. |
| **Re-verified at `9f9da63`** | **Already fixed by PR #3.** The batch load is wrapped in its own try/catch (infrastructure failure → empty map, rows keep close-based reads with levels withheld). Per-record `JSON.parse` is wrapped individually, logs the affected `companyId` and failure reason, and returns `null` for that record only, which is then filtered out. Unaffected companies keep their canonical stance. |
| **Status** | **RESOLVED (pre-existing)** — verified. |
| **Evidence** | `src/lib/technical/signals-service.ts` lines ~236–299. |
| **Batch efficiency** | One `findMany` for the whole universe — not N queries. Per-record validation happens in memory. |

### C-03 — Trend weight / maximum mismatch

| | |
|---|---|
| **Original finding** | Trend weight = 35 but trend components summed to 30, so trend could "never earn full weight". |
| **Re-verified at `9f9da63`** | **The scoring distortion the audit described did not exist, and the weights have since been rebalanced.** `rawWeightedWith()` computes `score += (earned / max) * weight` and normalises by the sum of *present* weights. A dimension's contribution is `earned/max × weight` — a max of 30 with a weight of 35 yields a *fraction* of the weight, which the normaliser then corrects. There was no mathematical inconsistency in the final score. Separately, PR #3 rebalanced weights to **30 / 25 / 25 / 20** and aligned component maxima to match. |
| **Status** | **RESOLVED (pre-existing)** — weights now 30/25/25/20 with matching maxima. The audit's stated mechanism was a **FALSE POSITIVE**; the rebalance is a legitimate methodology choice, not a bug fix. |
| **Evidence** | `signals.ts` `SIGNAL_WEIGHTS = { trend: 30, momentum: 25, volume: 25, risk: 20 }`; `rawWeightedWith()` normalises by present-weight sum. |

---

## 2. High findings

### H-01 — RSI over-penalisation

| | |
|---|---|
| **Original finding** | Full credit only in 45–60; RSI 68+ earned almost nothing, penalising healthy strong uptrends. |
| **Re-verified at `9f9da63`** | **Already fixed by PR #3.** Bands are now 45–65 → 10, 65–70 → 8, 70–75 → 6, 75–78 → 4, >78 → 2. |
| **Status** | **RESOLVED (pre-existing)** — verified. |

**Assessment against the brief's caution.** The brief warns against blindly adopting the audit's
45–65 hypothesis. The adopted bands are close to it but not identical, and the taper is gradual
rather than a cliff. Crucially, **momentum strength and extension risk are now separate
dimensions**: `extensionRiskPoints()` scores price-vs-EMA20 stretch inside the *risk* dimension,
while `rsiBandPoints()` scores momentum inside *momentum*. A stock at RSI 72 in a strong trend
therefore keeps momentum credit and loses risk credit — the two concepts are no longer conflated.
No historical out-of-sample validation of these specific bands was performed (see §6).

### H-02 — Stochastic methodology inconsistency

| | |
|---|---|
| **Original finding** | Stochastic was scored in the full snapshot but absent from the close-only engine. |
| **Re-verified at `9f9da63`** | **Still divergent, by design.** The close engine's momentum group is RSI + MACD + range-position (10+10+10). The snapshot path is RSI + MACD + Stochastic (8+8+9). The close-only series carries no OHLC, so a Stochastic %K cannot be computed honestly from it — substituting range-position is the correct response to missing data, not an inconsistency to "fix" by fabricating a high/low. |
| **Status** | **NOT IMPLEMENTED — deliberately.** Unifying the composition would require either inventing OHLC for the close engine (forbidden: no artificial bars) or removing Stochastic from the snapshot (losing real evidence). Both are worse than the current split. The *scores* are unified through the shared band scorers and the same weight table; only the third component differs, and the close engine discloses that its evidence comes from the close-series core. |
| **Correlated-indicator concern** | The brief asks that RSI/MACD/Stochastic not be counted as three independent confirmations. This is addressed structurally: `MOMENTUM_GROUP_STRONG_SHARE = 0.8` caps the momentum group at 80% of its present maximum, so three mutually-corroborating oscillators cannot manufacture a full-strength momentum reading. |

### H-03 — Divergence detection

| | |
|---|---|
| **Original finding** | No RSI/price or MACD/price divergence detection. |
| **Re-verified at `9f9da63`** | **Already implemented.** `src/lib/technical/divergence.ts` exists, is imported by `signals.ts`, and emits `divergence_bullish` / `divergence_bearish` reasons with a strength value. Covered by `divergence.test.ts` (7 tests). |
| **Status** | **RESOLVED (pre-existing)** — verified. |
| **Caveat** | Divergence contributes **supporting evidence only** (a reason), never an automatic buy/sell. This matches the brief's requirement. Its incremental out-of-sample value was **not** measured by this work. |

### H-04 — Volume sample size

| | |
|---|---|
| **Original finding** | Volume-complete suffix could be as short as 10 sessions. |
| **Re-verified at `9f9da63`** | **Already fixed by PR #3.** Threshold raised to 20 (`if (volBars.length >= 20)`), with the limitation text updated to "Fewer than 20 volume-complete sessions — volume indicators are unavailable." |
| **Status** | **RESOLVED (pre-existing)** — verified. |
| **Caveat** | A single fixed 20-session floor is still a blunt instrument for illiquid names. The brief asks for density/regularity-aware evidence requirements; that was **not** implemented (§6). |

### H-05 — Relative-volume threshold

| | |
|---|---|
| **Original finding** | The universal 1.3× relVol requirement for the excellence gate was too strict for EGX. |
| **Re-verified at `9f9da63`** | **Already changed by PR #3** to 1.2×. |
| **Status** | **RESOLVED (pre-existing)** — but see the caveat. |
| **Caveat** | This is a single global constant, not a liquidity-tiered calibration. The brief explicitly warns against hardcoding a threshold merely because the audit suggested one, and against optimising on the test period. A tiered/percentile-based gate would need historical calibration that this work could not perform (§6). One residual inconsistency is noted in §6. |

---

## 3. Findings resolved by this branch

### R-01 — Board ⇄ company metric parity (the live defect)

| | |
|---|---|
| **Original finding** | The audit flagged that board metric chips (RSI, Vol×, Range, 1M perf) came from the close-only engine while the company tab rendered the full OHLC bundle — two different numbers for one stock. |
| **Re-verified at `9f9da63`** | **Still live, and worse than "partially fixed".** The overlay replaced score/signal/dimensions/reasons/tradePlan/invalidation but **not** `row.metrics`, and a comment even asserted the canonical stance "doesn't carry the full metrics object". So an overlaid row showed the canonical *signal* beside close-only *RSI*. |
| **Root cause** | `TechStance` had no metric block, so there was nothing to overlay. |
| **Fix** | Added a `CanonicalMetrics` type and `buildCanonicalMetrics(snap, dailyVolPct?)`, computed from the full OHLC snapshot. `TechStance.metrics` now carries it; both snapshot stance paths populate it; `signals-service.ts` overlays it onto the row. |
| **Files** | `src/lib/technical/signals.ts`, `src/lib/technical/signals-service.ts` |
| **Tests** | `src/lib/technical/__tests__/metric-parity.test.ts` (7 tests) |
| **Honesty** | A metric the snapshot cannot produce is `null` and renders as "—". `dailyVolPct` is **never** substituted from `histVol20` (a different statistic — annualized log-return sd). The snapshot exposes no close series, so the caller must supply the same σ-of-20-moves figure the scoring core uses, or the chip is unavailable. |

**Why this matters more than the audit stated:** the board and the company tab are the two
surfaces a paying user compares. A differing RSI beside an identical stop-loss is exactly the
kind of inconsistency that destroys trust in the whole reading.

### R-02 — Tick rounding could flatter the displayed R/R

| | |
|---|---|
| **Original finding** | Prices were rounded to 2dp rather than the applicable EGX tick size. |
| **Re-verified at `9f9da63`** | `roundToTick()` existed but defaulted to a flat 0.01 and every caller used nearest-rounding. **Nearest-rounding each level independently can improve the printed R/R without any change in analysis** — a stop nudged 0.004 closer, or a target nudged 0.004 further, silently flatters the plan. |
| **Fix** | Added a `TickDirection` parameter (`"nearest" \| "up" \| "down"`). Every plan level now rounds on the **conservative** side: BUY → entry up, stop down, target up; SELL → entry down, stop up, target closer. R/R is then re-validated on the rounded numbers, so rounding can only *reject* a plan, never improve it. Float-dust guard prevents exact multiples being pushed a whole tick. |
| **Files** | `src/lib/technical/trade-plan.ts` |
| **Tests** | `trade-plan.test.ts` — conservative-rounding invariants for both directions, plus direction/float-dust cases. One pre-existing expectation updated (99.68→99.69, 101.60→101.61, R/R 2.28→2.27) because the values legitimately moved to the conservative side. |
| **Not done** | The **actual EGX price-band tick table was not implemented.** See §6. |

---

## 4. Findings that are false positives or already obsolete

| ID | Audit claim | Reality at `9f9da63` |
|---|---|---|
| C-03 | Trend max 30 vs weight 35 distorts scoring | **False positive.** `earned/max × weight` normalised by present-weight sum is mathematically consistent. Weights have since been rebalanced to 30/25/25/20 anyway. |
| M-04 | Dead VSA types/imports remain | **Obsolete.** `vsa.ts` exists and `TechnicalSnapshot.vsa` is typed-null for payload compatibility. VSA was removed per owner directive; the field is retained deliberately so older cached payloads still deserialise. Removing the field would break cached reads. |
| M-05 | Dead quality-score types remain | **Obsolete**, same reasoning as M-04 (`quality: QualityScore \| null`, always null). |
| M-03 | 60-session range replaced 52-week context | **Confirmed intentional.** 52-week fields were removed per owner directive; `analyze.ts` documents this. Restoring them was **not** done — the brief permits it only with adequate historical data, and many EGX names lack a year of sessions. |
| L-03 | Locked-row blur is decorative | **Not verified in this pass.** No change made; it is a cosmetic item outside the financial-integrity scope. |

---

## 5. Verification performed

### 5.1 Live parity result (production, 2026-11-15)

The parity fix was **not** accepted on unit tests alone. Live verification on the first
Preview build showed parity still failing for ETEL:

```
board RSI 55.89   vs   tab RSI 54.86      (canonicalCount = 6 of 246)
```

Root cause: the overlay only fixes rows that *have* a canonical stance. The other ~240
companies kept close-only metrics while the tab computed full-OHLC ones. **The overlay alone
was not a parity fix** — this was caught only because the check was run against the deployed
payload rather than the test suite.

Two follow-up commits corrected it:

- `603cbb7` — non-canonical rows now **withhold** metrics (chips render unavailable) and
  carry `metricsSource: "unavailable"`, matching the existing rule for `tradePlan` /
  `invalidation`. The directional read, score and signal still come from the close engine.
- `6fd931c` — bumped `technical-signals:market:v4 → v5` and `technical-signals:board:v1 → v2`.
  Without this, a board snapshot persisted by the *previous* deploy was still being served
  (up to 24h off-hours), so the new row shape never reached the client and `metricsSource`
  appeared empty.

Final verified result on production (`www.egxano.com`, deployment `egxano-5ajib47co`):

| ETEL | Board | Company tab |
|---|---|---|
| RSI | 54.861 | 54.861 |
| relVol | 0.9548 | 0.9548 |
| Range (60-session) | 62.33 | 62.33 |
| Score | 71 | 71 |
| Signal | hold | hold |

Row distribution across the 29 served rows: 1 `canonical`, 4 `unavailable`, 24 free-tier
gated rows (identity + price only, no analysis by design — verified: those rows carry only
`companyId, ticker, nameEn, nameAr, sector, marketTier, lastClose, changePct, asOf, locked`).

### 5.2 Test and type results

| Check | Result |
|---|---|
| `npx vitest run src/lib/technical` | **275 passed**, 16 files |
| `npx vitest run` (full repo) | **626 passed, 6 skipped, 0 failed** (44 files, 2 skipped) |
| `npx tsc --noEmit` on changed files | `signals.ts` clean. `signals-service.ts` reports 4 errors that are **pre-existing and unrelated** — verified by stashing this branch's changes and re-running: identical errors. They come from a stale generated Prisma client (`priceBar`, `stanceSnapshot`, `marketTier`, `volume` missing), because `npx prisma generate` fails in this environment on a `node_modules/effect` incompatibility with Node 22. |
| Baseline comparison | `trade-plan.test.ts` and `signals.test.ts` expectations were updated **only** where conservative rounding legitimately changed a value. No test was deleted or weakened. |

---

## 6. Known limitations and open items

1. **EGX tick-size table — BLOCKED.** The authoritative EGX price-band tick table could not be
   retrieved from a primary source. The audit's example bands (0.01 / 0.05 / 0.10) are
   **not** adopted, because the brief forbids hardcoding unverified bands. `roundToTick` now
   accepts a tick and a direction, so a verified table can be dropped in without touching plan
   geometry. **This is the single largest remaining trade-plan realism gap.**
2. **EGX price limits / suspensions / gap risk — NOT IMPLEMENTED.** The engine does not model
   ±% daily limits, limit-lock, or suspension. A theoretical stop can still be unreachable in
   reality. Not claimed as handled.
3. **Backtest trustworthiness — NOT ADDRESSED.** Survivorship bias, point-in-time corporate
   actions, slippage, tick costs and intrabar stop/target ambiguity remain as the audit described.
   No performance statistic from this engine should be published as a live expectation.
4. **No out-of-sample validation of any scoring change.** RSI bands, the 1.2× gate and the
   20-session volume floor were adopted by PR #3 without walk-forward evidence. This work
   verified they are *implemented consistently*, not that they *improve* results.
5. **Residual relVol inconsistency.** The excellence gate uses 1.2× (`relVolStrong`) while the
   buy-confirmation path still tests `relVol >= 1.3` at one site (`signals.ts` ~line 968). Two
   different thresholds for related questions. Left as-is deliberately: changing a decision
   threshold without validation would be exactly the intuition-driven edit the brief forbids.
   **Flagged for a calibrated pass.**
6. **Divergence value unmeasured.** Implemented and tested for correctness; its incremental
   contribution to out-of-sample quality is unknown.

---

## 7. What was deliberately not done, and why

- **No new indicators.** Indicator count is not analytical quality; adding ADX-family or
  Ichimoku-family signals would raise correlation and overfitting risk.
- **No ML / probabilistic scoring.** It would destroy the deterministic, auditable property
  that is this engine's core value.
- **No weight tuning by intuition.** Weights changed only as part of the pre-existing rebalance.
- **No synthetic data used to claim improvement.** No performance claim is made anywhere in
  this document.
- **No fabricated levels.** Every plan still returns `null` rather than inventing a level.

---

## 8. Delivery record

| Item | Value |
|---|---|
| Feature branch | `fix/technical-engine-integrity` |
| Commits | `6e45359` (parity + rounding), `603cbb7` (withhold non-canonical metrics), `6fd931c` (cache/snapshot key bump) |
| Merge commit on main | `d0559b7` |
| Remote main | `d0559b7645cc849a37c2444e0849d700f9fefd7f` — pushed, verified equal to local HEAD |
| Preview deployments | `egxano-1dtg5im68`, `egxano-959vmy97n`, `egxano-rhrj1k36k` |
| Production deployment | `egxano-5ajib47co-thomasemads-projects.vercel.app` — status **● Ready** |
| Production aliases | `www.egxano.com`, `egxano.com` |
| Vercel auth | existing authenticated CLI session (`thomasemad`); no token created, printed, or stored |

No force push was used. `main` had not advanced between branch creation and merge, so the
merge was a clean `--no-ff` with no reconciliation needed.

## 9. Rollback

This branch changes four source files and adds one test file. All changes are additive or
behaviour-preserving except the two intentional ones (metric overlay/withholding, conservative
rounding).

```
git revert -m 1 d0559b7      # revert the merge, keeping history
git push origin main
npx vercel deploy --prod --yes
```

No database migration, no schema change, no data deletion, and no engine-version bump are
involved, so rollback is a pure code revert. Existing `StanceSnapshot` rows remain valid:
`stance@3` is unchanged, and a stance persisted before this branch simply lacks `metrics`,
which the overlay treats as "no metric block".

Note: reverting the key bump means the board returns to serving `technical-signals:board:v1`
snapshots. Any v2 snapshot written meanwhile is simply ignored (different key) — no cleanup
is required, and no stale data is served as current.
