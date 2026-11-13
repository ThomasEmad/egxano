// =============================================================================
// Analytical Quality Score (0-100) — measures ANALYTICAL COMPLETENESS and
// EVIDENTIAL QUALITY. This is NOT the probability of a successful trade and
// must never be presented as predictive accuracy.
//
// Dimensions and weights (fixed by the methodology; change only with a
// QUALITY_VERSION bump + docs/market-intelligence/ANALYTICAL_QUALITY_SCORE.md
// update):
//   price_data_validity   15 — session count, freshness, density (non-sparse)
//   market_structure      15 — swing structure available, trend states, events
//   volume_liquidity      15 — volume block computed with a real baseline
//   multi_tf_agreement    10 — short/medium/long structure states present
//   price_action_context  10 — candle-level context (ATR/VSA readable)
//   market_sector_context 10 — market/sector context section present
//   risk_invalidation     10 — volatility + zone invalidations available
//   evidence_traceability 10 — every section carries reasons/limitations
//   critical_review        5 — conflicting evidence explicitly identified
//   TOTAL                100
//
// Bands: ≥90 high · 80-89 good · 65-79 incomplete · <65 weak.
// GATE VETO: when critical data validation fails (no bars, stale data, or a
// sparse series too short for the oscillator family), the score is capped at
// 60 and `gateVeto` explains it — a high-quality label can never be issued on
// unvalidated data regardless of the arithmetic.
// =============================================================================

import type { TechnicalSnapshot } from "./analyze"

export const QUALITY_VERSION = "quality@1"

export interface QualityDimension {
  key: string
  label: string
  labelAr: string
  weight: number
  earned: number
  reason: string
}

export interface QualityScore {
  version: string
  score: number
  band: "high" | "good" | "incomplete" | "weak" | "blocked"
  gateVeto: string | null
  dimensions: QualityDimension[]
  conflicts: string[]
}

export interface QualityInputs {
  /** market/sector context section present (injected by the intelligence layer) */
  contextPresent: boolean
  /** market/sector context is itself fresh and complete */
  contextComplete: boolean
  /** epoch ms of "now" for freshness math (injectable for tests) */
  nowMs?: number
}

const round2 = (x: number) => Math.round(x * 100) / 100

export function scoreQuality(snap: TechnicalSnapshot, inputs: QualityInputs): QualityScore {
  const dims: QualityDimension[] = []
  const conflicts: string[] = []
  let gateVeto: string | null = null

  // --- 1. Price data validity & freshness (15) ---
  let dataEarned = 0
  let dataReason = "no price data"
  if (snap.sessions > 0) {
    const countScore = Math.min(9, (snap.sessions / 120) * 9) // full at ≥120 sessions
    const freshnessDays = freshnessDaysOf(snap.asOf, inputs.nowMs)
    const freshScore = freshnessDays === null ? 3 : freshnessDays <= 5 ? 6 : freshnessDays <= 10 ? 4 : freshnessDays <= 30 ? 2 : 0
    dataEarned = round2(countScore + freshScore)
    dataReason = `${snap.sessions} sessions; last session ${snap.asOf ?? "unknown"} (${freshnessDays ?? "?"} days ago)`
    if (snap.sparse) {
      dataEarned = round2(dataEarned * 0.6)
      dataReason += "; sparse (non-daily) series — weighted down"
    }
    if (freshnessDays !== null && freshnessDays > 30) {
      gateVeto = `Last price session is ${Math.round(freshnessDays)} days old — data freshness gate failed.`
    }
  }
  if (snap.sessions < 35) {
    gateVeto = gateVeto ?? `Only ${snap.sessions} sessions retained — too short for the analytical family.`
  }
  dims.push(dim("price_data_validity", "Price data validity & freshness", "صلاحية وحداثة بيانات السعر", 15, dataEarned, dataReason))

  // --- 2. Market structure (15) ---
  const st = snap.structure
  let structureEarned = 0
  let structureReason = "structure analysis unavailable"
  if (st?.available) {
    const swingScore = Math.min(6, st.swings.length * 1.5) // full at ≥4 swings
    const trendScore = (st.trend.medium !== null ? 4 : 0) + (st.trend.short !== null ? 2 : 0) + (st.trend.long !== null ? 2 : 0)
    const eventScore = st.events.length ? 3 : 1
    structureEarned = round2(swingScore + trendScore + eventScore)
    structureReason = `${st.swings.length} swings; medium trend ${st.trend.medium ?? "n/a"}; ${st.events.length} structural event(s)`
  }
  dims.push(dim("market_structure", "Market structure analysis", "تحليل هيكل السوق", 15, structureEarned, structureReason))

  // --- 3. Volume & liquidity (15) ---
  let volumeEarned = 0
  let volumeReason = "volume indicators unavailable"
  if (snap.volume.relVol !== null && snap.volume.volMa20 !== null) {
    volumeEarned = 15
    volumeReason = `relative volume ${snap.volume.relVol}× with a 20-session baseline` + (snap.volume.volumeWindow ? ` over ${snap.volume.volumeWindow} volume-complete sessions` : "")
  } else if (snap.volume.volMa20 !== null || snap.volume.obv !== null) {
    volumeEarned = 8
    volumeReason = "partial volume block (OBV or baseline present, relative volume missing)"
  }
  dims.push(dim("volume_liquidity", "Volume & liquidity analysis", "تحليل الحجم والسيولة", 15, volumeEarned, volumeReason))

  // --- 4. Multi-timeframe agreement (10) ---
  const states = [st?.trend.short, st?.trend.medium, st?.trend.long]
  const present = states.filter((s) => s !== null).length
  const mtfEarned = present === 3 ? 10 : present === 2 ? 6 : present === 1 ? 3 : 0
  dims.push(dim("multi_tf", "Multi-timeframe agreement", "اتساق الأطر الزمنية", 10, mtfEarned, `${present}/3 timeframes classified`))

  // --- 5. Price action context (10) ---
  let paEarned = 0
  let paReason = "candle-level context unavailable"
  if (snap.volatility.atr14 !== null) {
    paEarned = 6
    paReason = "ATR and range context available"
    if ((snap.vsa?.events.length ?? 0) > 0) {
      paEarned = 10
      paReason += `; ${snap.vsa?.events.length} volume-spread event(s) with candle evidence`
    } else if (snap.vsa?.available) {
      paEarned = 8
      paReason += "; VSA scan ran (no qualifying events)"
    }
  }
  dims.push(dim("price_action", "Price action context", "سياق حركة السعر", 10, paEarned, paReason))

  // --- 6. Market & sector context (10) ---
  const ctxEarned = inputs.contextPresent ? (inputs.contextComplete ? 10 : 6) : 0
  dims.push(
    dim(
      "market_context",
      "Market & sector context",
      "سياق السوق والقطاع",
      10,
      ctxEarned,
      inputs.contextPresent
        ? inputs.contextComplete
          ? "market regime, breadth and sector context present and complete"
          : "market/sector context present but partial"
        : "market/sector context not yet attached",
    ),
  )

  // --- 7. Risk & invalidation (10) ---
  let riskEarned = 0
  let riskReason = "no volatility or invalidation context"
  if (snap.volatility.atrPct !== null) riskEarned += 4
  if (snap.levels.supports.length || snap.levels.resistances.length) riskEarned += 3
  if ((snap.zones?.zones.length ?? 0) > 0) riskEarned += 3
  riskReason =
    riskEarned >= 10
      ? "volatility, S/R levels and zone invalidations all available"
      : `volatility ${snap.volatility.atrPct !== null ? "ok" : "missing"}, levels ${snap.levels.supports.length + snap.levels.resistances.length}, zones ${snap.zones?.zones.length ?? 0}`
  dims.push(dim("risk", "Risk & invalidation analysis", "المخاطر ومستويات الإبطال", 10, Math.min(10, riskEarned), riskReason))

  // --- 8. Evidence traceability (10) ---
  const traceableSections = [
    snap.trend.alignment !== null || snap.trend.ema20 !== null,
    snap.momentum.rsi14 !== null || snap.momentum.macd.macd !== null,
    snap.volume.relVol !== null || snap.volume.obv !== null,
    st?.available === true,
    (snap.vsa?.available ?? false) || snap.volatility.atr14 !== null,
    (snap.zones?.zones.length ?? 0) > 0 || snap.levels.supports.length > 0,
  ]
  const traceEarned = Math.round((traceableSections.filter(Boolean).length / traceableSections.length) * 10)
  dims.push(dim("traceability", "Evidence traceability", "قابلية تتبع الأدلة", 10, traceEarned, `${traceableSections.filter(Boolean).length}/6 sections carry computed evidence`))

  // --- 9. Critical review (5) — identify conflicting evidence explicitly ---
  let reviewEarned = 2 // checks ran
  let reviewReason = "consistency checks ran; no conflicts detected"
  const trendUp = snap.trend.alignment === "aligned_uptrend" || st?.trend.medium === "uptrend"
  const trendDown = snap.trend.alignment === "aligned_downtrend" || st?.trend.medium === "downtrend"
  const rsi = snap.momentum.rsi14
  if (trendUp && rsi !== null && rsi < 45) {
    conflicts.push("price trend is up but RSI is weak — momentum does not confirm the trend")
    reviewEarned = 5
    reviewReason = "trend/momentum conflict explicitly flagged"
  }
  if (trendDown && rsi !== null && rsi > 55) {
    conflicts.push("price trend is down but RSI is strong — momentum does not confirm the trend")
    reviewEarned = 5
    reviewReason = "trend/momentum conflict explicitly flagged"
  }
  const lastEvent = st?.events[0]
  if (lastEvent && !lastEvent.invalidated) {
    const stDir = lastEvent.direction === "bullish" ? "up" : "down"
    if (trendUp && stDir === "down") {
      conflicts.push("latest structural event is bearish while the swing trend is up")
      reviewEarned = 5
      reviewReason = "structure/trend conflict explicitly flagged"
    }
    if (trendDown && stDir === "up") {
      conflicts.push("latest structural event is bullish while the swing trend is down")
      reviewEarned = 5
      reviewReason = "structure/trend conflict explicitly flagged"
    }
  }
  if (snap.structure?.trend.consistency === "mixed") {
    conflicts.push("timeframes disagree on trend direction")
    reviewEarned = 5
    reviewReason = "multi-timeframe disagreement explicitly flagged"
  }
  dims.push(dim("critical_review", "Critical review & counterarguments", "المراجعة النقدية والاعتراضات", 5, reviewEarned, reviewReason))

  // --- aggregate + gate ---
  let score = Math.round(dims.reduce((s, d) => s + d.earned, 0))
  let band: QualityScore["band"]
  if (gateVeto) {
    score = Math.min(score, 60)
    band = "blocked"
  } else if (score >= 90) band = "high"
  else if (score >= 80) band = "good"
  else if (score >= 65) band = "incomplete"
  else band = "weak"

  return { version: QUALITY_VERSION, score, band, gateVeto, dimensions: dims, conflicts }
}

function dim(key: string, label: string, labelAr: string, weight: number, earned: number, reason: string): QualityDimension {
  return { key, label, labelAr, weight, earned: Math.min(weight, round2(earned)), reason }
}

function freshnessDaysOf(asOf: string | null, nowMs?: number): number | null {
  if (!asOf) return null
  // Deterministic within a UTC day: whole-day difference between "today" and
  // the last session date. Sub-day drift would make the snapshot hash (and
  // therefore the report cache identity) unstable between two builds of the
  // same data — the analysis is meant to age out by DAY, not by millisecond.
  const nowDay = Math.floor((nowMs ?? Date.now()) / 86_400_000)
  const lastDay = Math.floor(new Date(asOf + "T00:00:00Z").getTime() / 86_400_000)
  return nowDay - lastDay
}
