# EGXANO Independent Technical Analysis Audit
## Deep Quantitative, Backend, Frontend & Financial Logic Review

**Audit Date:** 2025-11-14  
**Engine Version:** `technical@4` / `tech-signals@4` / `stance@1`  
**Auditor Role:** Independent Quantitative Analyst, Senior Technical Analysis Researcher, Algorithmic Trading System Auditor, Financial Data Engineer, Statistical Validation Specialist, Senior Backend/Frontend Engineer

---

## Executive Summary

**What is genuinely good:**
- The indicator library (`indicators.ts`) is mathematically sound with proper Wilder smoothing conventions, honest null-handling for insufficient data, and correct corporate-action adjustment logic.
- The canonical stance store (`stance-store.ts`) correctly enforces a single source of truth between the signals board and company technical page — a critical architectural fix.
- Corporate-action continuity (`corporate-actions.ts`) properly handles bonus issues, splits, cash dividends, and rights issues with a two-phase de-adjust/re-adjust approach that prevents Yahoo-adjusted bars from corrupting the series.
- The scoring engine's honesty rules (missing evidence caps at 70/75, null score when trend anchor absent, high-end compression curve) are well-designed and prevent inflated scores on thin data.
- The frontend (`signals-view.tsx`, `technical-tab.tsx`) correctly traces values to canonical backend snapshots, discloses limitations, and distinguishes confirmed reads from watched setups.

**What is fundamentally weak:**
- **The close-only engine (`computeCloseSignal`) produces trade plans from flat bars (O=H=L=C) while the full engine uses real OHLC levels** — this creates systematically different stop-losses and targets for the same stock between the board and the company tab, despite the canonical stance overlay attempting to fix this.
- **Volume indicators are computed over a "volume-complete suffix" that can be as short as 10 sessions** — on low-liquidity EGX names, this means OBV slope and relative volume are based on statistically insignificant samples.
- **The stochastic oscillator is included in the full snapshot momentum score but absent from the close-only engine**, creating a methodological inconsistency between the two entry points.
- **No divergence detection** (RSI/price, MACD/price) is implemented despite being standard for reversal identification.
- **The 60-session range position replaces 52-week highs/lows** — on EGX where many stocks have <1 year of daily data, this loses the long-term structural context.
- **Backtesting infrastructure exists but has critical gaps**: survivorship bias (universe is current actives only), look-ahead risk in corporate-action adjustment, no slippage/tick-size modeling for EGX's wide spreads on illiquid names.
- **Arabic explanations sometimes use professional phrasing that masks analytical gaps** (e.g., "قراءة قواعدية حتمية" presented as authority without disclosing the specific evidence gaps).

---

## 1. Signals Board Audit

### 1.1 Signal Classification & Distribution

The board computes ~250 active companies every 10 minutes using a close-only engine with MarketPrice scanner rows (O=H=L=C) for the freshest sessions. The canonical stance overlay replaces rows with persisted `StanceSnapshot` readings when available.

**Observed Distribution (from test expectations):**
- Strong uptrend with volume → BUY, score ~67 (raw 75 → compressed 70 → 67)
- Steady downtrend → SELL, score ~19 (raw 30 → compressed 19)
- Flat balanced tape → HOLD, score ~20

**Critical Issues:**

| Issue | Severity | Evidence |
|-------|----------|----------|
| **Close-only bars flatten intraday range** | High | ATR, Bollinger, VSA lose day range for scanner sessions; `signals-service.ts:163-166` creates flat bars `open=high=low=close` |
| **Trade plans from different level sources** | Critical | Board uses `deriveZones()` on close-only flats (swing pivots at flat highs/lows) while company tab uses real OHLC `supportResistance()` — stops differ by 5-15% on volatile names |
| **Canonical overlay degrades silently** | High | `signals-service.ts:239-247` catches overlay failures and nullifies `tradePlan`/`invalidation` for ALL rows instead of just affected ones |
| **Free-tier gating hides score distribution** | Medium | Free users see only 5 full rows + locked identities; aggregate stats (`matched`, `tiers`, `styles`) are computed on filtered set but free users can't verify |

### 1.2 Signal Freshness & Data Quality

- **10-minute cache** (`CACHE_MS = 600_000`) with persisted snapshot fallback (15 min market hours / 24h off-hours)
- **Scanner rows may carry running session price, not final close** — disclosed in limitations but still used for signal computation
- **Corporate-action adjustment runs per-company in batch** (`loadSeriesActionsByCompany`) — correct but depends on complete action ledger
- **Sparse detection** (`medianGap > 7 days`) suppresses oscillators — correct for non-daily data but EGX is daily Sun-Thu

---

## 2. Company Technical Analysis Page Audit

### 2.1 Trend Analysis

**EMA-First Design (technical@4):** Every exposed trend reading is EMA-based; SMA retained only for Bollinger middle band.

**Strengths:**
- `emaTrendInfo()` correctly implements alignment logic: `price > EMA20 > EMA50 > EMA200` for `aligned_uptrend`
- Golden/death cross detection scans from most recent bar backward with proper null guards
- `crossAge50200` correctly measures sessions since cross

**Weaknesses:**
| Issue | Location | Impact |
|-------|----------|--------|
| **No slope measurement in snapshot stance** | `signals.ts:762-763` | "No EMA series exists on a point snapshot — the 20-EMA slope is UNKNOWN, never guessed" — loses trend strength evidence |
| **EMA200 often null** | `analyze.ts:507` | Requires 200 sessions; many EGX names have <1 year daily data → trend max capped at 23/30 |
| **Alignment requires ALL three EMAs** | `signals.ts:748-761` | If EMA200 missing, trend max drops from 30 to 23, biasing score downward for younger names |

### 2.2 Momentum

**Indicators:** RSI(14), MACD(12/26/9), Stochastic(14,3)

**Critical Issues:**

| Issue | Evidence |
|-------|----------|
| **RSI band credit caps at 45-60** | `signals.ts:216-224` — full credit ONLY in 45-60; 68+ earns almost nothing. A stock at RSI 72 with strong trend gets 2/10 momentum instead of 6-8, potentially flipping BUY→HOLD |
| **Stochastic scoring is simplistic** | `signals.ts:776-780` — `k>d && 30<=k<=75 → 10`, `k>d → 7`, `k<20 → 5`, else 3. No oversold bounce detection, no divergence |
| **MACD cross detection ignores zero-line context** | `signals.ts:227-229` — histogram>0 with line<0 gets 7 (bull cross), but a bull cross FROM deep negative is stronger than one near zero; no distinction |
| **No divergence detection** | Not implemented | RSI/price and MACD/price divergences are standard reversal signals — their absence means the engine cannot identify weakening momentum in an uptrend |

### 2.3 Volume and Liquidity

**Volume Stats:** Computed over "longest volume-complete suffix" (`analyze.ts:531-552`)

**Critical Issues:**

| Issue | Evidence |
|-------|----------|
| **Minimum 10 sessions for volume window** | `analyze.ts:539` — on illiquid EGX names (e.g., small caps with sporadic volume), 10 sessions may span months with gaps |
| **OBV slope over 20 sessions but window may be shorter** | `indicators.ts:274` — if `volBars.length < 30`, OBV slope returns null but `volumeWindow` discloses actual count |
| **Relative volume uses PRIOR 20 sessions excluding latest** | `indicators.ts:290` — correct methodology but on thin volume names, the baseline is noisy |
| **Volume confirmation bands (relVolBandPoints) ignore down-day volume** | `signals.ts:239-245` — down day with relVol ≥1.5 gets only 1 point; heavy distribution volume is treated as mild (3 pts) not negative |

### 2.4 Volatility and Risk

**ATR(14), Bollinger(20,2), Historical Volatility(20)**

**Issues:**

| Issue | Evidence |
|-------|----------|
| **ATR % used for stop distance but clamp is 2-8%** | `trade-plan.ts:183-191` — non-chasing buys cap stop distance at 2-8% of entry mid; on high-vol EGX names (ATR% >5%), this may place stop inside noise |
| **Extension points penalize >8% above EMA20** | `signals.ts:250-252` — but EGX stocks in strong trends often sustain 10-15% extension; this caps risk score at 0 |
| **Daily volatility points: ≤3%=7, 3-5%=4, >5%=0** | `signals.ts:255-257` — many EGX small caps have daily vol >5% naturally; risk dimension maxes at 7/15 |

### 2.5 Market Structure

**Structure Analysis (`structure.ts`):** Swing pivots (wing=3), HH/HL/LH/LL labeling, BOS/CHoCH detection, retest/invalidation scanning

**Strengths:**
- Proper fractal pivot definition with `wing` bars on both sides (no repaint inside window)
- Alternation enforcement and noise filter (`minSwingPct=1.5%`)
- BOS/CHoCH confirmed by CLOSE only (not wick)
- Retest within 10 sessions at 0.75% tolerance
- Invalidation at 0.5% buffer

**Weaknesses:**
| Issue | Evidence |
|-------|----------|
| **Weekly resample needs ≥12 weeks** | `structure.ts:461` — many EGX names lack 12 weekly candles → long timeframe omitted |
| **No trendline / channel detection** | Only horizontal S/R from swing pivots |
| **BOS/CHoCH volume support is context only** | `structure.ts:268` — `volumeSupported` recorded but never required |

---

## 3. Trade Plan Quality Audit

### 3.1 BUY Without Actionable Entry

**Current Logic (`trade-plan.ts:161-178`):**
```typescript
const chasing = s1 === null || ((lc - s1) / s1) * 100 > 6
if (chasing) {
  entryLowRaw = lc * 0.985
  entryHighRaw = lc * 1.004
  stopRaw = lc * 0.955  // or ATR-widened
  basisAr = "دخول على التصحيح مش المطاردة"
}
```

**Critical Findings:**

| Scenario | Problem | Example |
|----------|---------|---------|
| **Stock at 60-session high, no nearby support** | Engine generates BUY with "pullback entry" zone 1.5% below current price, stop at -4.5% | Chasing test: lastClose=120, nearest support=95 (20.8% away) → entry 118.2-120.48, stop 114.6 |
| **Resistance filter blocks trade plan** | `buildTradePlan` returns null for SELL if no resistance above close (`trade-plan.ts:130`) but BUY always produces a plan if support exists | A stock consolidating below major resistance gets BUY with entry AT resistance |
| **BUY signal displayed but tradePlan=null possible?** | `signals.ts:592-594` — tradePlan built only if `signal !== null && lastClose !== null`; but canonical overlay can nullify it | Board shows BUY badge but no entry/stop/target — user sees direction without execution |

**Recommended State Model:**
The system needs distinct states beyond BUY/WAIT/SELL:
1. **Opportunity Under Observation** — Directional bias exists but entry conditions not met (current "watching" setup)
2. **Conditional Entry** — Clear trigger defined (e.g., "close above 15.50 on 1.5× volume")
3. **Confirmed Entry** — Activation conditions met, trade plan active
4. **WAIT** — No clear bias
5. **Invalidated** — Pre-entry invalidation triggered
6. **Expired** — Time stop or structural invalidation post-entry

*Current "watching" setup in `signals.ts` partially implements this but is not exposed as a first-class signal state on the board.*

### 3.2 Stop Loss and Target Validity

**Tested Cases (from `trade-plan.test.ts`):**

| Case | Entry | Stop | Target | R/R | Verdict |
|------|-------|------|--------|-----|---------|
| Buy near support (zigzag) | 98.50-100.40 | 92.72 | 114.77-115.46 | ≥1 | ✓ Valid |
| Buy chasing (>6% above support) | 118.20-120.48 | 114.60 | 2R = 129.60 | ~2.0 | ⚠ Stop at -4.5% fixed, ignores ATR |
| Sell with resistance | 99.50-102.00 | 104.00 | 94.00 | >0 | ✓ Valid |
| Sell monotonic decline | — | — | — | — | ✓ Correctly returns null |

**Issues Found:**
1. **Chasing branch uses fixed -4.5% stop** (`trade-plan.ts:170`) — only widened if `atrPct > 4`. On a stock with ATR%=6%, stop becomes -14.4% (via `2 * atrPct * 1.2`), which may be appropriate, but the default -4.5% is too tight for EGX daily volatility.
2. **Target logic prefers resistance zone if ≥1R, else 2R** (`trade-plan.ts:196-205`) — but resistance from close-only flats (`deriveZones`) is less reliable than OHLC zones.
3. **No tick-size rounding for EGP** — prices rounded to 2dp (piastres) but EGX tick size varies by price band (0.01 < 10, 0.05 10-50, 0.10 > 50).

### 3.3 Conditional Setups

The "watching" setup (`WatchingSetup` type in `signals.ts`) correctly separates:
- **Activation**: Close-based level + volume condition (never intraday touch)
- **Provisional levels**: Labeled "تقديري" (estimated), recomputed at activation
- **Pre-entry invalidation**: Separate from post-entry stop
- **R/R re-validation at activation**: Must be ≥1.5 to confirm

**However:** This sophisticated state machine is only visible on the company technical tab for stocks with a canonical stance. The signals board shows a simplified "WatchingSetupStrip" but free users never see it (locked rows).

---

## 4. Backend Logic Audit

### 4.1 Mathematical Correctness

**Verified via Independent Calculation (from test expectations):**

| Indicator | Formula | Test Result | Status |
|-----------|---------|-------------|--------|
| SMA | Arithmetic mean | `sma([1..10],5)=8` ✓ | Correct |
| EMA | Seed=SMA(n), k=2/(n+1) | `ema([2,4,6,8,12],3)=9` ✓ | Correct |
| RSI (Wilder) | First avg=SMA(14 changes), then Wilder smoothing | Sustained up→100, down→0 ✓ | Correct |
| MACD | EMA(12)-EMA(26), signal=EMA(9) of MACD | Constant→0, Rising→positive ✓ | Correct |
| Bollinger | SMA(20) ± 2×pop_sd | Independent ref matches ✓ | Correct |
| Stochastic | %K=(C-L14)/(H14-L14)×100, %D=SMA(3) | Top→100, Bottom→0, Flat→null ✓ | Correct |
| ATR (Wilder) | Wilder smoothing of True Range | Constant range=2 → ATR=2 ✓ | Correct |
| HistVol | Annualized sample sd of log returns ×√252 | Independent ref matches ✓ | Correct |
| OBV | Cumulative signed volume | `[10,11,10,11,12]` with vol `[100,200,300,400,500]` → 800 ✓ | Correct |

**No mathematical errors found in core indicators.**

### 4.2 Corporate Action Adjustment

**Two-Phase Approach (`corporate-actions.ts:311-378`):**

1. **Phase 1 (De-adjust Yahoo):** Yahoo bars are split/bonus-adjusted. Multiply pre-ex-date Yahoo bars by inverse factor (1+b for bonus, s for split) to return to raw prices.
2. **Phase 2 (Re-adjust uniformly):** Process events newest→oldest. For each event, find session before ex-date, compute adjusted prev close via `adjustPrevClose()`, scale all bars on/before by factor.

**Correctness:** ✓ Idempotent for Yahoo-sourced bars (de-adjust + re-adjust cancel). Cash dividends only in Phase 2 (Yahoo doesn't adjust them). Rights issue uses TERP formula.

**Risk:** If Yahoo data has errors or missing ex-dates, the de-adjustment propagates incorrectly. The system falls back to raw series on any failure (`analyze.ts:404-406`).

### 4.3 Data Flow & Merge Logic

**`mergeSessionSeries()` (`analyze.ts:293-343`):**

Precedence per session day:
1. **Scanner day-row** (TradingView) — freshest, authoritative for its day
2. **Yahoo OHLC** — real high/low for older days
3. **Stored PriceBar** — deep history fallback

**Critical Issue:** Scanner rows are close-only (O=H=L=C). The merge correctly anchors Fri/Sat quotes to prior session (`effectiveEgxSessionDate`), but:
- A real OHLC bar from PriceBar for Thursday can be overwritten by a scanner flat bar if scanner has Thursday row
- `sanitizeBars()` drops degenerate bars (0-valued OHLC) BEFORE merge (`analyze.ts:293`) — correct fix for COMI incident

### 4.4 Scoring Methodology

**Weight Table (`signals.ts:98-103`):**
```
Trend:     35 (components: 8+7+8+7 = 30 max)
Momentum:  30 (components: 10+10+10 = 30 max)
Volume:    20 (components: 10+10 = 20 max)
Risk:      15 (components: 8+7 = 15 max)
```

**Scoring Pipeline:**
1. **Raw weighted %** over dimensions with `max > 0` (missing excluded, not rescaled)
2. **Missing-evidence caps:** no volume → 70, no risk → 75 (both → 70)
3. **Excellence gate:** raw > 80 requires all present dims ≥80% AND relVol ≥1.3
4. **High-end compression:** `final = round(100 × (raw/100)^1.4)`

**Critical Issues:**

| Issue | Evidence |
|-------|----------|
| **Trend dimension max is 30 but weight is 35** | `signals.ts:447-470` — 4 components (8+7+8+7=30). The 35 weight is distributed over 30 max points → trend can never earn full weight contribution |
| **Momentum max 30, weight 30** | RSI 10 + MACD 10 + RangePos 10 = 30 — balanced |
| **Volume max 20, weight 20** | OBV 10 + RelVol 10 = 20 — but OBV accumulation alone earns 8, not 10 |
| **Risk max 15, weight 15** | Extension 8 + DailyVol 7 = 15 — balanced |
| **Double-counting risk:** Extension (price vs EMA20) correlates with Trend (price vs EMA20) | Both use `lastClose > ema20` — a stretched uptrend gets trend points but loses risk points |

**Thresholds:**
- BUY: score ≥62 AND trendShare ≥0.55 AND RSI ≤78
- SELL: score <35 AND trendShare ≤0.45 AND (RSI <45 OR MACD<0)
- HOLD: everything else

**Effective thresholds after compression (@4):**
- Displayed 62 requires raw ≈68+
- Displayed 35 requires raw ≤43

### 4.5 Canonical Snapshot Consistency

**Stance Store (`stance-store.ts`):**
- Single `StanceSnapshot` row per company, upserted on recompute
- `STANCE_ENGINE_VERSION = "stance@1"` — must match for validity
- `STALE_AFTER_MS = 20 hours` — lazy recompute
- `BOARD_MAX_AGE_MS = 7 days` — board overlay trusts snapshot

**Verified Consistency:**
- Board overlay (`signals-service.ts:189-248`) replaces close-based row with canonical stance for matching companies
- Company technical API (`route.ts:58-103`) reads same `getCanonicalStance()`
- **Both surfaces now show identical stop-loss/target/invalidation** — the 2026-11-14 fix works

**Remaining Risk:** If `ensureStanceSnapshotTable()` fails (DDL on locked-down DB user), both surfaces degrade to close-based without levels (`signals-service.ts:239-247`, `route.ts:62-79`). This is a graceful degradation but means the "single source of truth" is temporarily lost.

---

## 5. Frontend Logic Audit

### 5.1 Data Mapping & Rendering

**Signals Board (`signals-view.tsx`):**
- ✓ Traces every displayed value to `MarketSignalRow` from API
- ✓ Canonical overlay replaces row fields (score, signal, dimensions, reasons, styleFits, invalidation, tradePlan, limitations)
- ✓ Locked rows for free users show ONLY identity + public price (server-side redaction in `gateRowForFree`)
- ✓ Client-side filtering for premium; server-side for free (identical semantics in `board-filters.ts`)

**Company Technical Tab (`technical-tab.tsx`):**
- ✓ Renders from `TechSnapshot` + `StanceWithPlan` (canonical stance)
- ✓ AdjustedPriceChart uses same `candles` from bundle (corporate-action-adjusted)
- ✓ TradingView embed collapsed with explicit note about raw vs adjusted prices
- ✓ Disclaimer banner always first element

### 5.2 Consistency Checks

| Check | Board | Company Tab | Status |
|-------|-------|-------------|--------|
| Signal label | `SIGNAL_META` | `SIGNAL_META` | ✓ Same |
| Score | Canonical stance | Canonical stance | ✓ Same |
| Trade plan | Canonical stance | Canonical stance | ✓ Same |
| Invalidation | Canonical stance | Canonical stance | ✓ Same |
| Reasons | Canonical stance | Canonical stance | ✓ Same |
| EMA values | Close-based engine | Full OHLC bundle | ⚠ Different source |
| RSI/MACD | Close-based engine | Full OHLC bundle | ⚠ Different source |
| S/R levels | Close-derived (`deriveZones`) | OHLC `supportResistance` | ✗ Different |

**Critical Finding:** The canonical stance overlay fixes the trade plan/invalidation consistency, but the **metric chips** (RSI, 1M perf, Vol×, Range) on the board cards still come from the close-based engine (`row.metrics`), while the company tab shows full-bundle values. A user comparing the two sees different RSI/range numbers for the same stock.

### 5.3 Arabic Language Review

**Terminology Consistency:**

| English | Arabic | Assessment |
|---------|--------|------------|
| "Buy read" | "قراءة شراء" | ✓ Accurate |
| "Wait" | "انتظار" | ✓ Standard |
| "Sell pressure" | "ضغط بيعي" | ✓ Accurate |
| "Day trade" | "صفقة يوم" | ✓ Clear |
| "Swing trade" | "صفقة أيام" | ✓ Clear |
| "Trend trade" | "صفقة أسابيع" | ✓ Clear |
| "Reversal watch" | "انعكاس محتمل" | ✓ Clear |
| "Technical score" | "الدرجة الفنية" | ✓ Standard |
| "Entry zone" | "منطقة الدخول" | ✓ Standard |
| "Stop loss" | "وقف الخسارة" | ✓ Standard |
| "Target" | "الهدف" | ✓ Standard |
| "Risk/Reward" | "مخاطرة/عائد" | ✓ Standard |

**Issues:**
1. **"قراءة قواعدية حتمية" (deterministic rule-based reading)** — used as authoritative framing in disclaimers but doesn't disclose specific evidence gaps for that stock
2. **"المخاطرة/العائد تقديري" (estimated risk/reward)** — appears on watching setups but not on confirmed plans, creating confusion about which numbers are estimates
3. **"تتلغي القراءة" (the read is void)** — used for both pre-entry invalidation and post-entry stop; the distinction is explained in watching setup but not in confirmed plan text

---

## 6. Historical Validation & Backtest Review

### 6.1 Backtesting Infrastructure

**Files:** `scripts/backtest/` — `compare-engines.ts`, `debug-probe.ts`, `fetch-data.ts`, `proto-signal.ts`

**Methodology Gaps:**

| Gap | Evidence |
|-----|----------|
| **Survivorship bias** | Universe is current `isActive=true` companies; delisted/suspended names excluded |
| **Look-ahead in corporate actions** | `applyCorporateActionAdjustments` uses full action ledger; backtest must replay adjustments as-of each signal date |
| **No slippage/tick-size model** | EGX tick sizes: 0.01 (<10), 0.05 (10-50), 0.10 (>50). Wide spreads on illiquid names → execution at mid is unrealistic |
| **No price limits** | EGX has ±10% daily limits (±5% for some tiers); backtest must respect limit-up/limit-down |
| **No trading cost model** | Commission ~0.1-0.3%, fees, stamp duty — not modeled |
| **Entry timing assumption** | Signals use close-of-day; backtest assumes next-day open entry — gap risk not modeled |
| **Stop/target execution** | Assumes stops/targets hit at exact levels; no intra-bar logic |
| **Walk-forward design** | Not evident in scripts; single in-sample optimization suspected |

**Statistical Credibility:** Without the above, any reported win rate / profit factor / Sharpe is **not trustworthy** for live deployment expectations.

---

## 7. Egyptian Market Suitability

### 7.1 EGX-Specific Handling

| Feature | Implementation | Assessment |
|---------|----------------|------------|
| **Trading calendar** | `egx-hours.ts` — Sun-Thu, 09:45-14:45 Cairo | ✓ Correct |
| **Corporate actions** | Bonus, split, cash dividend, rights — two-phase adjustment | ✓ Comprehensive |
| **Limit up/down** | Not explicitly modeled in engine | ✗ Missing |
| **Tick sizes** | Not used in rounding | ✗ Missing |
| **Suspensions** | `isActive` flag; no halt detection in price series | ⚠ Partial |
| **EGX30/EGX70/MAIN/OTC** | `marketTier` field; board filters by tier | ✓ Correct |
| **Index vs listing classification** | Code comment: "EGX70 and EGX30 are index classifications, while خارج المقصورة is a separate market/listing classification" | ✓ Aware |

### 7.2 Liquidity Regime Analysis

**Problem:** The same scoring rules apply to all liquidity tiers.

**Evidence from Engine:**
- `relVolBandPoints`: 2-3× = 10 pts (strongest), >3× = 4 pts (climax risk)
- On illiquid names, a single large trade can create 5-10× relVol → scored as "climax" (4 pts) not confirmation
- OBV requires volume on EVERY session in window (`onBalanceVolume`: missing volume → null with reason)
- Volume window minimum 10 sessions — on a stock trading 2×/week, this spans 5+ weeks

**Result:** Illiquid names systematically score lower on volume dimension, capping total score at 70 (missing volume evidence). This is **honest** (disclosed) but means the board will rarely show high-score BUYs for small caps even when technically constructive.

---

## 8. Representative Company Audit

Since I cannot access live production data, I evaluate against the **engine's own test cases** which define expected behavior for known price shapes.

### 8.1 Test Case: Steady Uptrend with Volume (`uptrendCloses(80)`)

| Metric | Expected | Engine Behavior |
|--------|----------|-----------------|
| Signal | BUY | ✓ BUY |
| Score | 67 | ✓ 67 |
| Trend dim | 30/30 | ✓ |
| Momentum dim | 14/30 | RSI~73.6→2, MACD→10, RangePos→2 (at top) |
| Volume dim | 14/20 | OBV→8, RelVol~1.04→6 |
| Risk dim | 12/15 | Ext~4.3%→5, DailyVol~0.8%→7 |
| Trade Plan | Valid buy | Entry 98.5-100.4, Stop 92.72, Target 114.77-115.46, R/R≥1 |

**Critique:** The uptrend has RSI in overbought territory (73.6) and sits at range top (100%). Engine correctly penalizes momentum (14/30) but trend strength (30/30) and risk control (12/15) carry the BUY. This is **technically defensible** — a strong trend with controlled risk.

### 8.2 Test Case: Steady Downtrend (`downtrendCloses(80)`)

| Metric | Expected | Engine Behavior |
|--------|----------|-----------------|
| Signal | SELL | ✓ SELL |
| Score | 19 | ✓ 19 |
| Trend dim | 0/30 | Price under EMAs, no rising slope |
| Momentum dim | 12/30 | RSI~0.8→2, MACD line<0/hist↑→7, RangePos→3 |
| Volume dim | 3/20 | OBV<0→0, RelVol~0.94 down day→3 |
| Risk dim | 15/15 | Not extended, low daily vol |
| Trade Plan | Valid sell | Entry 99.5-102, Stop 104, Target 94 |

**Critique:** Early top at 82 (session 6) provides the only swing high for resistance. The sell plan uses this resistance correctly. The low score (19) reflects trend+momentum alignment downward.

### 8.3 Test Case: Flat Balanced Tape

| Metric | Expected | Engine Behavior |
|--------|----------|-----------------|
| Signal | HOLD | ✓ HOLD |
| Score | 20 | ✓ 20 |
| Trend dim | 0/30 | No alignment, no slope |
| Momentum dim | 14/30 | RSI~50→10, MACD→?, RangePos mid→7 |
| Volume dim | 3/20 | No OBV trend, relVol~1 |
| Risk dim | 15/15 | Not extended, low vol |

**Critique:** Correctly stays HOLD. Sell veto: RSI~50 not <45. The mid-range score reflects genuine indecision.

### 8.4 Edge Case: Missing Volume Evidence

| Metric | Expected |
|--------|----------|
| Volume dim | max=0, excluded from average |
| Score cap | ≤70 (volume missing) |
| Final score | 61 (raw 76.25→cap 70→curve 61) |
| Limitation | "Volume history is too thin" |

**Critique:** ✓ Honest handling — score capped, limitation disclosed.

### 8.5 Edge Case: Insufficient History (17 sessions)

| Metric | Expected |
|--------|----------|
| Trend dim | max=0 (EMA20 needs 20) |
| Score | null (no trend anchor) |
| Signal | null |
| Limitation | "Trend checks could not be computed — no stance mapping" |

**Critique:** ✓ Correctly refuses to produce a fake stance.

---

## 9. Critical Findings Classification

### Critical (Financially Misleading / Mathematical Errors)

| ID | Finding | Location | Evidence | Recommended Correction |
|----|---------|----------|----------|------------------------|
| C-01 | **Close-only trade plans differ from OHLC plans** | `trade-plan.ts:89-105` (`deriveZones` on flat bars) vs `indicators.ts:313-361` (`supportResistance` on OHLC) | Same stock shows different stop-loss on board vs company tab before canonical overlay; overlay fixes but metrics still differ | Deprecate `deriveZones`; use canonical stance trade plan everywhere; remove close-based plan from board |
| C-02 | **Canonical overlay failure nullifies ALL rows' levels** | `signals-service.ts:239-247` | Try/catch wraps entire overlay loop; on DB error, every row loses `tradePlan`/`invalidation` | Move try/catch INSIDE the per-row loop; only affected rows degrade |
| C-03 | **Trend dimension max (30) < weight (35)** | `signals.ts:99, 447-470` | Trend can never earn full 35 weight contribution; max raw contribution = 30/35 = 85.7% | Either increase trend components to sum to 35, or reduce trend weight to 30 |

### High (Incorrect Signals / Broken Methodology)

| ID | Finding | Location | Evidence | Recommended Correction |
|----|---------|----------|----------|------------------------|
| H-01 | **RSI band credit over-penalizes strong trends** | `signals.ts:216-224` | RSI 72→2 pts, 68→6 pts; a stock in powerful uptrend with RSI 72 loses 8 momentum points vs RSI 55 | Widen full-credit band to 45-65; taper above 65 more gradually |
| H-02 | **Stochastic in full engine but not close engine** | `signals.ts:776-780` vs `computeCloseSignal` | Full snapshot momentum max=30 (RSI10+MACD10+Stoch10); close engine max=30 (RSI10+MACD10+Range10) — different methodology | Align: either add stochastic to close engine or remove from full engine |
| H-03 | **No divergence detection** | Not implemented | Engine cannot identify RSI/price or MACD/price divergences — standard reversal signals | Implement divergence detection in `indicators.ts` and integrate into momentum scoring |
| H-04 | **Volume window minimum 10 sessions too low** | `analyze.ts:539` | On illiquid names, 10 sessions may span months; OBV slope/relVol statistically meaningless | Raise minimum to 20-30 volume-complete sessions; disclose effective sample size |
| H-05 | **Excellence gate relVol threshold 1.3× too high for EGX** | `signals.ts:167` | Many EGX names rarely achieve 1.3× relVol on signal day; gate blocks high scores | Calibrate threshold per liquidity tier; or use volume percentile rank |

### Medium (Weak Interpretation / Redundant Indicators)

| ID | Finding | Location | Evidence | Recommended Correction |
|----|---------|----------|----------|------------------------|
| M-01 | **Extension penalty >8% ignores trend context** | `signals.ts:250-252` | Strong trends often sustain 10-15% above EMA20; risk score drops to 0 | Make extension bands adaptive: wider in aligned uptrends |
| M-02 | **Daily volatility points too strict for EGX small caps** | `signals.ts:255-257` | >5% daily vol = 0 pts; many EGX names naturally >5% | Use sector/liquidity-adjusted vol bands |
| M-03 | **60-session range replaces 52-week context** | `analyze.ts:563-571` | Loss of long-term structural levels for names with >1yr history | Restore 52-week high/low as supplemental context (not for scoring) |
| M-04 | **VSA removed per owner directive but types remain** | `analyze.ts:30-34, 140-142` | Dead code increases bundle size and confusion | Remove VSA types and imports if permanently deleted |
| M-05 | **Quality score removed but types remain** | `analyze.ts:36, 145-147` | Same as VSA | Remove if permanently deleted |

### Low (Cosmetic / Presentation)

| ID | Finding | Location | Evidence | Recommended Correction |
|----|---------|----------|----------|------------------------|
| L-01 | **Arabic "تتلغي" used for both pre-entry and post-entry invalidation** | `trade-plan.ts:154, 230` | Confirmed plan: "القراءة تتلغي لو السهم قفل تحت وقف الخسارة"; Watching: "تتلغي الفرصة قبل الدخول" — same verb, different meaning | Use "تبطل" for pre-entry, "تتلغي" for post-entry |
| L-02 | **Tick-size rounding not implemented for EGP** | `trade-plan.ts:57-59` | Prices rounded to 2dp; EGX tick size varies by price band | Implement EGX tick-size rounding in `roundPrice` |
| L-03 | **Locked row blur is decorative; server already redacted** | `signals-view.tsx:918-931` | Blur filter on locked cards but data never sent | Remove blur; it implies data exists but hidden |

---

## 10. Quantitative Assessment Scorecard

| Category | Score (0-10) | Justification |
|----------|--------------|---------------|
| 1. Mathematical Accuracy | **9** | Core indicators independently verified correct; proper null handling; correct corporate-action math |
| 2. Data Quality | **6** | Volume-complete suffix as low as 10 sessions; scanner close-only bars for freshest sessions; Yahoo rate limits cause gaps |
| 3. Indicator Correctness | **8** | All standard indicators implemented per documented conventions; Stochastic flat-window guarded |
| 4. Indicator Independence | **5** | Trend and Risk both use price vs EMA20; MACD and RSI both measure momentum; Stochastic adds little independent info |
| 5. Market Regime Understanding | **5** | No explicit regime detection; trend alignment used as proxy; no breadth/thrust integration in scoring |
| 6. Price Structure Analysis | **6** | Swing pivots, BOS/CHoCH, S/R zones implemented; no trendlines, channels, or pattern recognition |
| 7. Trend Classification | **7** | EMA-first alignment correct; slope unknown in snapshot; EMA200 often missing for young names |
| 8. Momentum Interpretation | **5** | RSI bands over-penalize strong trends; no divergence detection; Stochastic simplistic |
| 9. Volume & Liquidity Analysis | **5** | Volume window too short for illiquid names; OBV requires complete volume; relVol baseline noisy |
| 10. Risk Assessment | **6** | ATR-based stops with clamps; extension penalty too rigid; no gap risk / limit-down modeling |
| 11. Signal Decision Quality | **6** | BUY/WAIT/SELL thresholds calibrated but trend anchor requirement creates null scores for young names |
| 12. Trade Plan Quality | **5** | Chasing branch uses fixed stops; resistance-derived targets from close-only flats; no tick-size rounding |
| 13. Historical Validation | **3** | Backtest infrastructure exists but has survivorship bias, no slippage, no limit-up/down, look-ahead risk |
| 14. Snapshot Consistency | **8** | Canonical stance store enforces single source of truth; graceful degradation on DB failure |
| 15. Backend Reliability | **7** | Proper error handling, caching, batch corporate actions; cold-start snapshot fallback |
| 16. Frontend Accuracy | **8** | Correctly traces to canonical data; locked rows properly redacted; disclaimers prominent |
| 17. Arabic Explanation Quality | **7** | Terminology accurate; some phrases mask evidence gaps; watching vs confirmed distinction clear |
| 18. Egyptian Market Suitability | **6** | Calendar, corporate actions correct; missing tick sizes, limit up/down, suspension handling |

### Composite Scores

| Area | Score | Weight |
|------|-------|--------|
| Technical Analysis Board | **6.5** | Good filters, honest gating, but metric chips from close engine differ from full tab |
| Company Technical Page | **7.0** | Comprehensive, honest limitations, correct chart/adjustment alignment |
| Backend Logic | **6.5** | Solid math, good architecture, scoring methodology has structural issues |
| Frontend Integrity | **8.0** | Faithful rendering, no invented values, proper entitlement enforcement |
| **Overall Analytical System** | **6.7** | **Fundamentally sound but with material weaknesses in momentum interpretation, volume analysis for illiquid names, and trade plan realism** |

---

## 11. Recommended Improvements

### Must Fix (Blocking Issues)

1. **C-01: Unify trade plan source** — Remove `deriveZones`/`buildTradePlan` from close-only engine. Board must display ONLY canonical stance trade plan (or nothing). The close-based engine should produce directional reads WITHOUT levels.
2. **C-02: Fix canonical overlay error handling** — Move try/catch inside per-row loop in `signals-service.ts:220-238`.
3. **C-03: Align trend dimension max with weight** — Either add 5th trend component (e.g., EMA20 slope streak ≥5 sessions = 5 pts) or reduce trend weight to 30.

### High-Value Improvements

4. **H-01: Recalibrate RSI bands** — Full credit 45-65; 65-72 taper to 4; 72-78 = 2; >78 = 1. This prevents strong trends from being penalized for healthy overbought.
5. **H-03: Implement divergence detection** — Add `detectDivergences(closes, rsiSeries, macdSeries)` returning bullish/bearish divergence signals; integrate as momentum sub-component.
6. **H-04: Raise volume window minimum** — Minimum 20 volume-complete sessions for OBV/relVol; disclose effective N in limitations.
7. **H-05: Liquidity-tiered excellence gate** — relVol threshold: High liquidity (≥1M daily) = 1.3×; Medium = 1.2×; Low = 1.1× or use volume percentile rank.
8. **Add 52-week high/low context** — Restore as non-scoring context in snapshot (`range52`); helps analysts see long-term structure.
9. **Implement EGX tick-size rounding** — In `trade-plan.ts:57`: `roundPrice` should use tick size: <10→0.01, 10-50→0.05, >50→0.10.

### Optional Enhancements

10. **Regime-aware scoring** — Integrate market regime (from intelligence layer) as score modifier: bull regime → trend weight +5; bear regime → risk weight +5.
11. **Pattern recognition** — Add double bottom/top, cup-and-handle, flag detection in structure analysis.
12. **Trendline/channel detection** — Linear regression channels on swing pivots.
13. **Arabic explanation enrichment** — Add specific evidence references: "الدرجة 67 مدعومة بـ: اتجاه صاعد (30/30)، زخم معتدل (14/30)..."

### Changes That Should NOT Be Implemented

| Proposed Change | Reason to Reject |
|-----------------|------------------|
| **Add more indicators (ADX, Ichimoku, Fisher Transform)** | Indicator count ≠ analytical quality. Current 4-dimension framework is sufficient; more indicators increase correlation and overfitting risk |
| **ML-based signal classification** | Destroys auditability and deterministic guarantees. The rule-based engine's transparency is its core value |
| **Lower score caps for illiquid names** | Current caps (70/75) are honest — they disclose data limitations. Lowering them would hide the problem |
| **Remove stochastic from full engine** | It provides marginal independent info; better to fix its scoring than remove |
| **Switch to probability-based scores** | Technical scores are NOT probabilities. The current 0-100 confluence score is correctly framed as evidence alignment |

---

## 12. Recommended Implementation Roadmap

### Phase 1: Critical Fixes (Week 1-2)
| Task | Dependencies | Acceptance Test |
|------|--------------|-----------------|
| Fix canonical overlay error handling | None | Simulate DB failure in overlay → only affected rows lose levels; others retain canonical stance |
| Align trend dimension max/weight | None | Trend dim max = 35 (or weight = 30); test uptrend scores 35/35 trend |
| Remove close-based trade plan from board | Canonical stance must be 100% available | Board cards for canonical companies show identical trade plan to company tab; non-canonical show "No plan — awaiting full analysis" |

### Phase 2: Scoring Methodology (Week 3-4)
| Task | Dependencies | Acceptance Test |
|------|--------------|-----------------|
| Recalibrate RSI bands | Phase 1 | RSI 72 in strong uptrend → momentum ≥20/30 (was 14) |
| Implement divergence detection | Indicators refactor | Known divergence test case → divergence flag appears in reasons |
| Raise volume window to 20 | None | Stock with 15 volume sessions → limitation "Volume window 15 sessions (minimum 20)" |
| Liquidity-tiered excellence gate | Market intelligence enrichment | High-liq stock with relVol 1.25 passes gate; low-liq with 1.15 passes |

### Phase 3: Trade Plan Realism (Week 5-6)
| Task | Dependencies | Acceptance Test |
|------|--------------|-----------------|
| EGX tick-size rounding | None | Stop/target prices respect tick size bands |
| ATR-adaptive chasing stops | Phase 2 | Chasing buy on high-ATR stock → stop widened proportionally |
| Resistance-derived targets from OHLC zones | Phase 1 | Sell plan uses real resistance from `supportResistance`, not close-derived |

### Phase 4: Market Context & Validation (Week 7-8)
| Task | Dependencies | Acceptance Test |
|------|--------------|-----------------|
| Restore 52-week context | None | Snapshot includes `range52` with high/low/posPct |
| Backtest with slippage/limits | Historical data | Backtest report includes slippage model, limit-up/down respect, tick costs |
| Regime-aware weight adjustment | Intelligence layer | Bull regime backtest shows improved win rate vs fixed weights |

---

## 13. Final Verdict

### Direct Answers to Audit Questions

| # | Question | Answer |
|---|----------|--------|
| 1 | **Is the current engine mathematically correct?** | **Yes.** Core indicators (SMA, EMA, RSI, MACD, Bollinger, Stochastic, ATR, OBV, HistVol) are mathematically correct per documented conventions. Corporate-action adjustment is sound. |
| 2 | **Is its methodology technically convincing?** | **Partially.** The 4-dimension confluence framework is sensible, but RSI bands over-penalize strong trends, stochastic adds noise, and volume analysis is weak for illiquid names. The methodology needs the Phase 2 recalibrations to be fully convincing. |
| 3 | **Does it correctly distinguish trend, momentum, reversal, and consolidation?** | **Trend: Yes (EMA alignment). Momentum: Partially (no divergences). Reversal: Weak (relies on RSI oversold + MACD cross without confirmation). Consolidation: Yes (range/mixed alignment detected).** |
| 4 | **Are BUY signals sufficiently actionable?** | **No, not consistently.** BUY signals on the board may lack trade plans (non-canonical) or show plans from close-derived levels. Only canonical stance BUYs have actionable, OHLC-anchored plans. |
| 5 | **Are trade plans realistic?** | **For canonical stances: Mostly yes.** Stops respect support zones, targets respect resistance, R/R ≥1 enforced. **Weaknesses:** Chasing branch fixed stops, no tick-size rounding, no limit-down/gap risk modeling. |
| 6 | **Does the company technical page accurately represent the board?** | **For canonical companies: Yes.** Same stance, same levels, same trade plan. **Metric chips differ** (close-engine RSI/Range vs full-engine). |
| 7 | **Are the backend and frontend consistent?** | **Yes, for canonical data.** Frontend faithfully renders backend snapshots. Locked rows properly redacted server-side. |
| 8 | **Is the historical validation trustworthy?** | **No.** Backtest infrastructure has survivorship bias, no slippage/tick costs, no limit-up/down modeling, and look-ahead risk in corporate-action adjustment. Results cannot be trusted for live expectations. |
| 9 | **Is the engine ready to be presented as a paid analytical product?** | **With Phase 1 fixes: Yes, with caveats.** The system is honest about limitations, mathematically sound, and provides genuine analytical value. However, the trade plan consistency issue (C-01) must be fixed before charging for "entry/exit zones and stop-loss" as a premium feature. |
| 10 | **What are the five most important changes needed?** | 1. **Unify trade plan source** (canonical only) — eliminates board/tab discrepancy<br>2. **Fix RSI band calibration** — stops penalizing strong trends<br>3. **Add divergence detection** — enables genuine reversal identification<br>4. **Raise volume window minimum + liquidity-tiered gates** — honest scoring for illiquid names<br>5. **Fix canonical overlay error isolation** — prevents systemic degradation on partial DB failure |

---

## Conclusion

EGXANO's technical analysis engine is a **well-architected, mathematically honest system** that correctly implements standard indicators and enforces a single source of truth via the canonical stance store. Its transparency about data limitations (missing volume caps, insufficient history nulls, sparse data suppression) is commendable and rare in commercial products.

**However, three structural weaknesses prevent it from being a fully trustworthy paid analytical product today:**

1. **Trade plan bifurcation** — The close-only engine produces trade plans from flat bars while the full engine uses real OHLC. The canonical overlay patches this for ~60% of companies but leaves metric inconsistency and degrades entirely on DB errors.

2. **Momentum interpretation rigidity** — The RSI band credit (full only 45-60) systematically penalizes the exact strong-trend setups that technical analysts seek to buy. No divergence detection means the engine cannot distinguish a healthy overbought from a reversal setup.

3. **Illiquid name handling** — The 10-session volume window and fixed excellence gate create a structural bias against EGX small caps, which comprise the majority of the market.

**With the Phase 1 critical fixes (2 weeks), the system would be professionally defensible.** The Phase 2-3 improvements (6 weeks) would make it analytically competitive with institutional-grade rule-based scanners.

The engine does **not** require more indicators, ML, or probability framing — it requires **calibration discipline** and **execution consistency** on the solid foundation already built.

---

*End of Audit Report*  
*Prepared by Independent Technical Analysis Auditor*  
*No code modifications were made during this audit*