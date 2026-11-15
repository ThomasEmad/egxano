// Opportunity Quality Score tests — pins the DOCUMENTED methodology:
//  • weights sum to exactly 1, every component 0-1;
//  • THE HARD RULE: ineligible rows return oqs null + the exact noteAr — the
//    score ranks eligible rows only and can never qualify an ineligible one;
//  • every component's band map (documented numbers, hardcoded here so the
//    contract is pinned, not re-derived from the implementation);
//  • the anti-chasing caps: upside component saturates at 15%, RR at 2.5;
//  • the noteAr names the two strongest components by contribution.
import { describe, expect, it } from "vitest"
import {
  computeOpportunityScore,
  OQS_WEIGHTS,
  UPSIDE_COMPONENT_CAP_PCT,
  RISK_REWARD_COMPONENT_CAP,
  EXECUTION_READINESS_BY_STATE,
  LIQUIDITY_TIER_SCORES,
  dataFreshnessScore,
  volumeConfirmationScore,
  relativeStrengthScore,
  resistanceClearanceScore,
  riskRewardScore,
  upsideScore,
  type OpportunityScoreInput,
} from "../opportunity-score"

const base: OpportunityScoreInput = {
  eligible: true,
  score: 62,
  positiveReasons: 2,
  negativeReasons: 1,
  signalState: "confirmed",
  trendLabel: "up",
  relativeStrengthPct: 0,
  relVol: 1.2,
  upsidePctToT1: 8,
  riskReward: 1.8,
  obstacleCount: 1,
  liquidityTier: "normal",
  state: "actionable",
  dataAgeSessions: 0,
}

const inp = (over: Partial<OpportunityScoreInput> = {}): OpportunityScoreInput => ({ ...base, ...over })
const r3 = (x: number): number => Math.round(x * 1000) / 1000 // components are stored rounded to 3 dp
const num = (r: { oqs: number | null }): number => {
  expect(r.oqs).not.toBeNull()
  return r.oqs as number
}

describe("OQS_WEIGHTS — documented weight table", () => {
  it("sums to exactly 1 across the ten components", () => {
    const keys = Object.keys(OQS_WEIGHTS)
    expect(keys).toHaveLength(10)
    const sum = keys.reduce((s, k) => s + OQS_WEIGHTS[k as keyof typeof OQS_WEIGHTS], 0)
    expect(sum).toBeCloseTo(1, 10)
  })

  it("every weight is positive and ≤ 0.2 (no single component dominates)", () => {
    for (const k of Object.keys(OQS_WEIGHTS)) {
      const w = OQS_WEIGHTS[k as keyof typeof OQS_WEIGHTS]
      expect(w).toBeGreaterThan(0)
      expect(w).toBeLessThanOrEqual(0.2)
    }
  })

  it("caps are exported with their documented values", () => {
    expect(UPSIDE_COMPONENT_CAP_PCT).toBe(15)
    expect(RISK_REWARD_COMPONENT_CAP).toBe(2.5)
  })
})

describe("HARD RULE — the score ranks eligible opportunities only", () => {
  it("an ineligible row returns oqs: null, components: null and the exact noteAr", () => {
    const r = computeOpportunityScore(inp({ eligible: false }))
    expect(r.oqs).toBeNull()
    expect(r.components).toBeNull()
    expect(r.noteAr).toBe("غير مؤهلة — لا يتم ترتيبها")
  })

  it("an ineligible row is null regardless of how strong its inputs are", () => {
    const monster = computeOpportunityScore(
      inp({ eligible: false, score: 100, relVol: 2.5, upsidePctToT1: 40, riskReward: 4, obstacleCount: 0, trendLabel: "up", state: "actionable" }),
    )
    expect(monster.oqs).toBeNull()
    expect(monster.components).toBeNull()
  })

  it("a 3%-upside INELIGIBLE setup can never out-rank a plain eligible one", () => {
    const ineligible = computeOpportunityScore(inp({ eligible: false, upsidePctToT1: 3, score: 95 }))
    const eligible = computeOpportunityScore(inp({ upsidePctToT1: 3, score: 45, relVol: 0.8, obstacleCount: 2, state: "observation" }))
    expect(ineligible.oqs).toBeNull()
    expect(eligible.oqs).not.toBeNull()
    // ranking with nulls excluded — the ineligible row cannot appear at all
    const rank = [ineligible, eligible].map((r) => r.oqs ?? -1).sort((a, b) => b - a)
    expect(rank[0]).toBe(eligible.oqs)
  })
})

describe("component maps — exact documented numbers", () => {
  it("dataFreshness: 0→1.0, 1→0.7, 2→0.45, 3→0.3, ≥4→0.15", () => {
    expect(dataFreshnessScore(0)).toBe(1.0)
    expect(dataFreshnessScore(1)).toBe(0.7)
    expect(dataFreshnessScore(2)).toBe(0.45)
    expect(dataFreshnessScore(3)).toBe(0.3)
    expect(dataFreshnessScore(4)).toBe(0.15)
    expect(dataFreshnessScore(9)).toBe(0.15)
    expect(dataFreshnessScore(-1)).toBe(1.0)
  })

  it("volumeConfirmation bands incl. the climax down-weight", () => {
    expect(volumeConfirmationScore(null)).toBe(0.4)
    expect(volumeConfirmationScore(0.5)).toBe(0.15)
    expect(volumeConfirmationScore(0.7)).toBe(0.45)
    expect(volumeConfirmationScore(0.99)).toBe(0.45)
    expect(volumeConfirmationScore(1.0)).toBe(0.8)
    expect(volumeConfirmationScore(2.0)).toBe(0.8)
    expect(volumeConfirmationScore(2.1)).toBe(1.0)
    expect(volumeConfirmationScore(3.0)).toBe(1.0)
    expect(volumeConfirmationScore(3.5)).toBe(0.5) // climax — NOT auto-credit
  })

  it("relativeStrength piecewise: (−10→0), (0→0.5), (+15→1), null→0.5", () => {
    expect(relativeStrengthScore(null)).toBe(0.5)
    expect(relativeStrengthScore(-15)).toBe(0)
    expect(relativeStrengthScore(-10)).toBe(0)
    expect(relativeStrengthScore(0)).toBe(0.5)
    expect(relativeStrengthScore(5)).toBeCloseTo(0.5 + 5 / 30, 9)
    expect(relativeStrengthScore(15)).toBe(1)
    expect(relativeStrengthScore(40)).toBe(1)
  })

  it("resistanceClearance: 0→1.0, 1→0.65, 2→0.4, ≥3→0.2", () => {
    expect(resistanceClearanceScore(0)).toBe(1.0)
    expect(resistanceClearanceScore(1)).toBe(0.65)
    expect(resistanceClearanceScore(2)).toBe(0.4)
    expect(resistanceClearanceScore(3)).toBe(0.2)
    expect(resistanceClearanceScore(7)).toBe(0.2)
    expect(resistanceClearanceScore(-1)).toBe(0.2) // unknown treated conservatively
  })

  it("riskReward: capped at 2.5, ≤0→0, null→0.25", () => {
    expect(riskRewardScore(null)).toBe(0.25)
    expect(riskRewardScore(0)).toBe(0)
    expect(riskRewardScore(-1)).toBe(0)
    expect(riskRewardScore(1.0)).toBeCloseTo(1 / 2.5, 9)
    expect(riskRewardScore(1.5)).toBeCloseTo(1.5 / 2.5, 9)
    expect(riskRewardScore(2.5)).toBe(1)
    expect(riskRewardScore(4)).toBe(1) // CAP: beyond 2.5 earns no more
  })

  it("upside: capped at 15%, ≤0→0, null→0.3", () => {
    expect(upsideScore(null)).toBe(0.3)
    expect(upsideScore(0)).toBe(0)
    expect(upsideScore(7.5)).toBe(0.5)
    expect(upsideScore(15)).toBe(1)
    expect(upsideScore(40)).toBe(1) // CAP: more upside ≠ proportionally more quality
  })

  it("executionReadiness state map: actionable 1.0, conditional 0.6, observation 0.35, early 0.2, missed/invalidated 0", () => {
    expect(EXECUTION_READINESS_BY_STATE.actionable).toBe(1.0)
    expect(EXECUTION_READINESS_BY_STATE.conditional).toBe(0.6)
    expect(EXECUTION_READINESS_BY_STATE.observation).toBe(0.35)
    expect(EXECUTION_READINESS_BY_STATE.early).toBe(0.2)
    expect(EXECUTION_READINESS_BY_STATE.missed).toBe(0)
    expect(EXECUTION_READINESS_BY_STATE.invalidated).toBe(0)
  })

  it("unknown state/tier fall back conservatively at runtime (documented)", () => {
    expect(EXECUTION_READINESS_BY_STATE["mystery"]).toBeUndefined()
    expect(LIQUIDITY_TIER_SCORES.liquid).toBe(1.0)
    expect(LIQUIDITY_TIER_SCORES.normal).toBe(0.65)
    expect(LIQUIDITY_TIER_SCORES.thin).toBe(0.2)
  })

  it("structure from trendLabel: up 1.0 / side 0.5 / down 0.1", () => {
    expect(computeOpportunityScore(inp({ trendLabel: "up" })).components!.structure).toBe(1)
    expect(computeOpportunityScore(inp({ trendLabel: "side" })).components!.structure).toBe(0.5)
    expect(computeOpportunityScore(inp({ trendLabel: "down" })).components!.structure).toBe(0.1)
  })

  it("liquidity tier flows through unchanged", () => {
    expect(computeOpportunityScore(inp({ liquidityTier: "liquid" })).components!.liquidity).toBe(1)
    expect(computeOpportunityScore(inp({ liquidityTier: "normal" })).components!.liquidity).toBe(0.65)
    expect(computeOpportunityScore(inp({ liquidityTier: "thin" })).components!.liquidity).toBe(0.2)
  })

  it("executionReadiness maps the state deterministically through the composite", () => {
    expect(computeOpportunityScore(inp({ state: "actionable" })).components!.executionReadiness).toBe(1)
    expect(computeOpportunityScore(inp({ state: "conditional" })).components!.executionReadiness).toBe(0.6)
    expect(computeOpportunityScore(inp({ state: "observation" })).components!.executionReadiness).toBe(0.35)
    expect(computeOpportunityScore(inp({ state: "early" })).components!.executionReadiness).toBe(0.2)
    expect(computeOpportunityScore(inp({ state: "missed" })).components!.executionReadiness).toBe(0)
    expect(computeOpportunityScore(inp({ state: "invalidated" })).components!.executionReadiness).toBe(0)
  })

  it("dataAgeSessions penalizes staleness through the composite", () => {
    expect(computeOpportunityScore(inp({ dataAgeSessions: 0 })).components!.dataFreshness).toBe(1)
    expect(computeOpportunityScore(inp({ dataAgeSessions: 1 })).components!.dataFreshness).toBe(0.7)
    expect(computeOpportunityScore(inp({ dataAgeSessions: 5 })).components!.dataFreshness).toBe(0.15)
  })
})

describe("evidence — score share, reason balance, signal state", () => {
  it("score share bands follow the @5 decision thresholds (70/62/55/45/35)", () => {
    const ev = (score: number) =>
      computeOpportunityScore(inp({ score, positiveReasons: 3, negativeReasons: 0, signalState: "confirmed" })).components!.evidence
    // with a fully positive reason balance and a confirmed state: 0.6·share + 0.4
    expect(ev(85)).toBe(r3(0.6 * 1.0 + 0.4))
    expect(ev(70)).toBe(r3(0.6 * 1.0 + 0.4))
    expect(ev(62)).toBe(r3(0.6 * 0.85 + 0.4))
    expect(ev(55)).toBe(r3(0.6 * 0.6 + 0.4))
    expect(ev(45)).toBe(r3(0.6 * 0.4 + 0.4))
    expect(ev(35)).toBe(r3(0.6 * 0.25 + 0.4))
    expect(ev(30)).toBe(r3(0.6 * 0.1 + 0.4))
  })

  it("is monotone in the row score (a higher score never lowers evidence)", () => {
    let prev = -1
    for (const s of [20, 36, 45, 50, 55, 61, 62, 69, 70, 90]) {
      const e = computeOpportunityScore(inp({ score: s })).components!.evidence
      expect(e).toBeGreaterThanOrEqual(prev)
      prev = e
    }
  })

  it("reason balance: all-positive = 1, all-negative = 0, both-zero = neutral 0.5", () => {
    const e = (pos: number, neg: number) => computeOpportunityScore(inp({ positiveReasons: pos, negativeReasons: neg })).components!.evidence
    const scoreTerm = 0.6 * 0.85
    expect(e(3, 0)).toBe(r3(scoreTerm + 0.2 * 1 + 0.2))
    expect(e(0, 3)).toBe(r3(scoreTerm + 0.2 * 0 + 0.2))
    expect(e(0, 0)).toBe(r3(scoreTerm + 0.2 * 0.5 + 0.2))
  })

  it("signalStateShare: confirmed 1.0, watching 0.5, wait 0.2", () => {
    const e = (st: "confirmed" | "watching" | "wait") => computeOpportunityScore(inp({ signalState: st })).components!.evidence
    const scoreTerm = 0.6 * 0.85
    const balanceTerm = 0.2 * (2 / 3)
    expect(e("confirmed")).toBe(r3(scoreTerm + balanceTerm + 0.2 * 1.0))
    expect(e("watching")).toBe(r3(scoreTerm + balanceTerm + 0.2 * 0.5))
    expect(e("wait")).toBe(r3(scoreTerm + balanceTerm + 0.2 * 0.2))
  })
})

describe("composite + noteAr", () => {
  it("canonical strong row: hand-computed composite = 96 with the exact breakdown", () => {
    const r = computeOpportunityScore(
      inp({
        score: 78,
        positiveReasons: 3,
        negativeReasons: 0,
        signalState: "confirmed",
        trendLabel: "up",
        relativeStrengthPct: 8,
        relVol: 2.2,
        upsidePctToT1: 12,
        riskReward: 2.5,
        obstacleCount: 0,
        liquidityTier: "liquid",
        state: "actionable",
        dataAgeSessions: 0,
      }),
    )
    // evidence: 0.6·1.0 + 0.2·1 + 0.2·1 = 1.0 | structure 1.0 | RS 0.5+8/30=0.767
    // vol 1.0 | clearance 1.0 | upside 12/15=0.8 | RR 1.0 | liquidity 1.0
    // readiness 1.0 | freshness 1.0
    expect(r.components).toEqual({
      evidence: 1,
      structure: 1,
      relativeStrength: 0.767,
      volumeConfirmation: 1,
      resistanceClearance: 1,
      upside: 0.8,
      riskReward: 1,
      liquidity: 1,
      executionReadiness: 1,
      dataFreshness: 1,
    })
    // weighted: 0.15+0.12+0.0767+0.12+0.12+0.08+0.12+0.06+0.05+0.06 = 0.9567 → 96
    expect(r.oqs).toBe(96)
    // top contributions: evidence 0.15, then the 0.12 tie → declaration order: structure
    expect(r.noteAr).toBe("الأقوى في التقييم: قوة الأدلة وبنية الاتجاه")
  })

  it("noteAr names the two strongest components by contribution (spec example)", () => {
    // engineered so تأكيد الحجم (0.12) and مسافة المقاومة (0.12) are the top two:
    // evidence 0.15×0.76=0.114, RR 0.12 ties but loses the declaration-order tiebreak
    const r = computeOpportunityScore(
      inp({
        score: 55,
        positiveReasons: 2,
        negativeReasons: 0,
        signalState: "confirmed",
        trendLabel: "side",
        relativeStrengthPct: null,
        relVol: 2.5,
        upsidePctToT1: 10,
        riskReward: 2.5,
        obstacleCount: 0,
        liquidityTier: "normal",
        state: "actionable",
        dataAgeSessions: 0,
      }),
    )
    expect(r.noteAr).toBe("الأقوى في التقييم: تأكيد الحجم ومسافة المقاومة")
  })

  it("noteAr always keeps the factual prefix (no probabilities, no promises)", () => {
    const r = computeOpportunityScore(inp())
    expect(r.noteAr.startsWith("الأقوى في التقييم:")).toBe(true)
    expect(r.noteAr).not.toMatch(/احتمال|نسبة نجاح|مضمون|سيرتفع/)
  })

  it("oqs stays within 0-100 for extreme inputs", () => {
    const max = num(computeOpportunityScore(inp({ score: 100, relVol: 2.5, upsidePctToT1: 99, riskReward: 9, obstacleCount: 0 })))
    const min = num(computeOpportunityScore(inp({ score: 0, relVol: 0.1, upsidePctToT1: 0, riskReward: 0, obstacleCount: 9, trendLabel: "down", state: "invalidated", liquidityTier: "thin", dataAgeSessions: 9, signalState: "wait", negativeReasons: 9, positiveReasons: 0, relativeStrengthPct: -30 })))
    expect(max).toBeLessThanOrEqual(100)
    expect(max).toBeGreaterThanOrEqual(0)
    expect(min).toBeGreaterThanOrEqual(0)
    expect(min).toBeLessThanOrEqual(100)
  })

  it("ranks honestly: more obstacles, staleness, thin liquidity and weak volume each LOWER the score", () => {
    const ref = num(computeOpportunityScore(inp()))
    expect(num(computeOpportunityScore(inp({ obstacleCount: 3 })))).toBeLessThan(ref)
    expect(num(computeOpportunityScore(inp({ dataAgeSessions: 4 })))).toBeLessThan(ref)
    expect(num(computeOpportunityScore(inp({ liquidityTier: "thin" })))).toBeLessThan(ref)
    expect(num(computeOpportunityScore(inp({ relVol: 0.5 })))).toBeLessThan(ref)
    expect(num(computeOpportunityScore(inp({ riskReward: 1.0 })))).toBeLessThan(ref)
  })

  it("deterministic: identical input → deep-equal output", () => {
    const a = computeOpportunityScore(inp())
    const b = computeOpportunityScore(inp())
    expect(a).toEqual(b)
  })

  it("sanitizes non-finite numerics deterministically (no NaN poisoning)", () => {
    const dirty = computeOpportunityScore(inp({ score: Number.NaN, relVol: Number.NaN, upsidePctToT1: Number.NaN, riskReward: Number.NaN, obstacleCount: Number.NaN, dataAgeSessions: Number.NaN }))
    const clean = computeOpportunityScore(inp({ score: 0, relVol: null, upsidePctToT1: null, riskReward: null, obstacleCount: -1, dataAgeSessions: 9 }))
    expect(dirty).toEqual(clean)
    expect(Number.isFinite(dirty.oqs as number)).toBe(true)
  })
})
