import { describe, expect, it } from "vitest"
import {
  applyRegimeGate,
  buildOpportunitiesDigest,
  CONVICTION_THRESHOLDS,
  convictionTier,
  EMPTY_REGIME_INPUT,
  marketRegime,
  OPPORTUNITIES_CAP,
  REGIME_GATE_NOTE_AR,
  REGIME_META,
  REGIME_THRESHOLDS,
  stopDistanceSane,
  type MarketRegimeInput,
} from "../board-gates"
import type { MarketSignalRow } from "../signals-service"

// =============================================================================
// Board-gates contract tests — every threshold in CONVICTION_THRESHOLDS /
// REGIME_THRESHOLDS is pinned at its exact boundary, and the digest
// ordering/cap/free-stripping rules are pinned end-to-end.
// =============================================================================

/** Synthetic board row — the fields the gates actually read. */
function row(over: Partial<MarketSignalRow> & { ticker: string }): MarketSignalRow {
  return {
    version: "test",
    score: 80,
    signal: "buy",
    signalState: "confirmed",
    setup: null,
    dimensions: [],
    reasons: [
      { code: "trend_up", tone: "positive", ar: "اتجاه صاعد", en: "uptrend" },
      { code: "momentum_up", tone: "positive", ar: "زخم إيجابي", en: "positive momentum" },
    ],
    styleFits: [],
    invalidation: null,
    tradePlan: {
      bias: "buy",
      entryLow: 9.9,
      entryHigh: 10.2,
      entryPct: 0.5,
      stop: 9.0,
      stopPct: -5.0,
      targetLow: 11.5,
      targetHigh: 12.0,
      targetPct: 16,
      riskReward: 2.5,
      textAr: "اختبار",
      textEn: "test",
      basisAr: "اختبار",
    },
    limitations: [],
    companyId: `id-${over.ticker}`,
    nameEn: over.ticker,
    nameAr: null,
    sector: "بنوك",
    marketTier: "MAIN",
    sessions: 120,
    lastClose: 10,
    asOf: "2026-11-12",
    changePct: 0,
    metrics: {
      rsi14: 55,
      ema20: 9.8,
      ema50: 9.5,
      macdLine: 1,
      macdHist: 0.2,
      relVol: 1.2,
      perfW1: 2,
      perfM1: 5,
      perfM3: 9,
      rangePos60: 65,
      dailyVolPct: 2,
      obvSlope20: 1,
    },
    ...over,
  } as MarketSignalRow
}

/** Watching row: no trade plan, carries the watched setup with provisional levels. */
function watchingRow(over: Partial<MarketSignalRow> & { ticker: string }): MarketSignalRow {
  return row({
    signal: "hold",
    signalState: "watching",
    tradePlan: null,
    setup: {
      direction: "buy",
      activation: { kind: "close_above", level: 10.5, basisAr: "أعلى مقاومة", volumeConditionAr: "حجم ≥ 1.5×" },
      provisionalEntry: { low: 10.4, high: 10.6, basisAr: "تقديري" },
      provisionalStop: { level: 9.5, basisAr: "تقديري" },
      provisionalTarget: { low: 11.8, high: 12.0, basisAr: "تقديري" },
      provisionalRiskReward: 2.5,
      provisionalBasisAr: "تقديري",
      recomputeNoteAr: "تُعاد الحسابات عند التفعيل",
      preEntryInvalidation: { level: 9.4, conditionAr: "إغلاق تحت 9.4 يلغي", reasonAr: "كسر هيكلي" },
      postEntryNoteAr: "الخروج يتبع الوقف",
      vetoReasons: [{ code: "near_resistance_veto", tone: "negative", ar: "مقاومة ملاصقة", en: "resistance" }],
    },
    ...over,
  })
}

describe("CONVICTION_THRESHOLDS — documented constants", () => {
  it("exposes the documented owner-approved values", () => {
    expect(CONVICTION_THRESHOLDS).toEqual({
      SCORE_A: 70,
      SCORE_B: 55,
      RR_A: 2,
      RR_B: 1.5,
      STOP_MIN_PCT: 1,
      STOP_MAX_PCT: 10,
      NOISE_FACTOR: 0.5,
      POSITIVE_MIN_A: 2,
      DOMINANCE_A: 1,
      POSITIVE_MIN_B: 1,
      DOMINANCE_B: 0,
    })
  })
})

describe("convictionTier — score pillar boundaries", () => {
  it("score exactly 70 earns A, one tick below drops to B", () => {
    expect(convictionTier(row({ ticker: "A70" }))).toBe("A")
    expect(convictionTier(row({ ticker: "A69", score: 69.99 }))).toBe("B")
    expect(convictionTier(row({ ticker: "A71", score: 71 }))).toBe("A")
  })

  it("score exactly 55 earns B, below drops to C", () => {
    expect(convictionTier(row({ ticker: "B55", score: 55 }))).toBe("B")
    expect(convictionTier(row({ ticker: "C54", score: 54.9 }))).toBe("C")
  })

  it("null score (weak data) is never evidence-grade", () => {
    expect(convictionTier(row({ ticker: "NULL", score: null }))).toBe("C")
  })

  it("the weakest pillar caps the tier (a 90-score read with a weak plan is not A)", () => {
    expect(convictionTier(row({ ticker: "CAP", score: 90, tradePlan: { ...(row({ ticker: "x" }).tradePlan as object), riskReward: 1.6 } as MarketSignalRow["tradePlan"] }))).toBe("B")
  })
})

describe("convictionTier — plan pillar boundaries (RR + stop sanity)", () => {
  it("RR exactly 2.0 earns A, below drops to B", () => {
    const rr = (v: number) => row({ ticker: "RR", tradePlan: { ...(row({ ticker: "x" }).tradePlan as object), riskReward: v } as MarketSignalRow["tradePlan"] })
    expect(convictionTier(rr(2.0))).toBe("A")
    expect(convictionTier(rr(1.99))).toBe("B")
    expect(convictionTier(rr(1.5))).toBe("B")
    expect(convictionTier(rr(1.49))).toBe("C")
  })

  it("watching rows read the watched-setup provisional RR + stop", () => {
    expect(convictionTier(watchingRow({ ticker: "W1" }))).toBe("A")
    const weakSetup = watchingRow({ ticker: "W2", setup: { ...(watchingRow({ ticker: "x" }).setup as object), provisionalRiskReward: 1.5 } as MarketSignalRow["setup"] })
    expect(convictionTier(weakSetup)).toBe("B")
    const noRrSetup = watchingRow({ ticker: "W3", setup: { ...(watchingRow({ ticker: "x" }).setup as object), provisionalRiskReward: null } as MarketSignalRow["setup"] })
    expect(convictionTier(noRrSetup)).toBe("C")
  })

  it("a row with neither plan nor setup has no plan quality to vouch for", () => {
    expect(convictionTier(row({ ticker: "NP", signalState: "watching", tradePlan: null, setup: undefined }))).toBe("C")
  })
})

describe("stopDistanceSane — noise/absurdity band", () => {
  it("absolute band: [1%, 10%] inclusive, outside is insane", () => {
    expect(stopDistanceSane(1.0, null)).toBe(true)
    expect(stopDistanceSane(10.0, null)).toBe(true)
    expect(stopDistanceSane(0.99, null)).toBe(false)
    expect(stopDistanceSane(10.01, null)).toBe(false)
    expect(stopDistanceSane(-5, null)).toBe(true) // buy stops are negative — distance is absolute
    expect(stopDistanceSane(null, null)).toBe(false)
  })

  it("noise floor: stop must clear NOISE_FACTOR × dailyVolPct when volatility is known", () => {
    // dailyVolPct = 4 → floor 2%: a 1.5% stop is inside the noise band
    expect(stopDistanceSane(1.5, 4)).toBe(false)
    expect(stopDistanceSane(2.0, 4)).toBe(true)
    // a quiet name (dailyVolPct 1.6 → floor 0.8) keeps the 1% absolute floor
    expect(stopDistanceSane(1.0, 1.6)).toBe(true)
    expect(stopDistanceSane(0.9, 1.6)).toBe(false)
    // unknown/negative volatility is ignored (absolute band still applies)
    expect(stopDistanceSane(5, null)).toBe(true)
    expect(stopDistanceSane(5, -1)).toBe(true)
  })
})

describe("convictionTier — evidence pillar (positive-reason dominance)", () => {
  const reasons = (tones: Array<"positive" | "negative" | "neutral">) =>
    tones.map((t, i) => ({ code: `r${i}`, tone: t, ar: "سبب", en: "reason" }))

  it("A needs ≥2 positives AND strictly more positives than negatives", () => {
    expect(convictionTier(row({ ticker: "E1", reasons: reasons(["positive", "positive"]) }))).toBe("A")
    expect(convictionTier(row({ ticker: "E2", reasons: reasons(["positive", "positive", "neutral"]) }))).toBe("A")
    // 2 positives vs 1 negative still dominates strictly → A
    expect(convictionTier(row({ ticker: "E3", reasons: reasons(["positive", "positive", "negative"]) }))).toBe("A")
    // a single positive never earns A
    expect(convictionTier(row({ ticker: "E4", reasons: reasons(["positive"]) }))).toBe("B")
  })

  it("B needs ≥1 positive and positives ≥ negatives; else C", () => {
    expect(convictionTier(row({ ticker: "E5", reasons: reasons(["positive"]) }))).toBe("B")
    expect(convictionTier(row({ ticker: "E6", reasons: reasons(["positive", "negative"]) }))).toBe("B")
    // a 2-2 tie fails A's strict dominance but keeps B
    expect(convictionTier(row({ ticker: "E6B", reasons: reasons(["positive", "positive", "negative", "negative"]) }))).toBe("B")
    // negatives dominate → C
    expect(convictionTier(row({ ticker: "E7", reasons: reasons(["negative", "negative", "positive"]) }))).toBe("C")
    // no positives at all → C
    expect(convictionTier(row({ ticker: "E8", reasons: reasons(["neutral", "negative"]) }))).toBe("C")
    expect(convictionTier(row({ ticker: "E9", reasons: [] }))).toBe("C")
  })
})

describe("marketRegime — classification boundaries", () => {
  const inp = (breadthBullishShare: number | null, medianScore: number | null): MarketRegimeInput => ({ breadthBullishShare, medianScore })

  it("documents the owner-approved thresholds", () => {
    expect(REGIME_THRESHOLDS).toEqual({ BULL_BREADTH: 0.6, BULL_MEDIAN_SCORE: 55, BEAR_BREADTH: 0.35, BEAR_MEDIAN_SCORE: 40 })
  })

  it("bull needs breadth ≥ 60% AND median ≥ 55 (both boundaries inclusive)", () => {
    expect(marketRegime(inp(0.6, 55))).toBe("bull")
    expect(marketRegime(inp(0.75, 62))).toBe("bull")
    // breadth one tick below → neutral even with a strong median
    expect(marketRegime(inp(0.599, 62))).toBe("neutral")
    // median one tick below → neutral even with full breadth
    expect(marketRegime(inp(0.9, 54.9))).toBe("neutral")
  })

  it("bear fires on breadth ≤ 35% OR median ≤ 40 (boundaries inclusive)", () => {
    expect(marketRegime(inp(0.35, 50))).toBe("bear")
    expect(marketRegime(inp(0.34, 50))).toBe("bear")
    expect(marketRegime(inp(0.5, 40))).toBe("bear")
    expect(marketRegime(inp(0.5, 39.9))).toBe("bear")
    // OR semantics: a collapsing median is a bear signal even with strong breadth
    expect(marketRegime(inp(0.6, 38))).toBe("bear")
    // high breadth with a middling median is NOT bear
    expect(marketRegime(inp(0.6, 55))).not.toBe("bear")
  })

  it("the in-between world is neutral", () => {
    expect(marketRegime(inp(0.5, 50))).toBe("neutral")
    expect(marketRegime(inp(0.36, 41))).toBe("neutral")
    expect(marketRegime(inp(0.59, 54))).toBe("neutral")
  })

  it("null/unmeasurable inputs degrade to neutral (unknown never penalizes)", () => {
    expect(marketRegime(EMPTY_REGIME_INPUT)).toBe("neutral")
    expect(marketRegime(inp(null, 80))).toBe("neutral")
    expect(marketRegime(inp(0.9, null))).toBe("neutral")
    expect(marketRegime(inp(Number.NaN, 80))).toBe("neutral")
  })
})

describe("applyRegimeGate — direction-aware downgrade rules", () => {
  it("buy rows in a bear regime downgrade one tier (A→B, B→C) with the exact note", () => {
    const b = applyRegimeGate("A", "bear", "buy")
    expect(b).toEqual({ tier: "B", gated: true, noteAr: REGIME_GATE_NOTE_AR.buy })
    expect(b.noteAr).toBe("بوابة السوق: الاتجاه العام هابط — خُفّضت قناعة هذه القراءة درجة")
    expect(applyRegimeGate("B", "bear", "buy")).toEqual({ tier: "C", gated: true, noteAr: REGIME_GATE_NOTE_AR.buy })
  })

  it("sell rows in a bull regime downgrade one tier", () => {
    const g = applyRegimeGate("A", "bull", "sell")
    expect(g).toEqual({ tier: "B", gated: true, noteAr: REGIME_GATE_NOTE_AR.sell })
    expect(applyRegimeGate("B", "bull", "sell")).toEqual({ tier: "C", gated: true, noteAr: REGIME_GATE_NOTE_AR.sell })
  })

  it("a C row cannot be reduced further — gated stays false (no dishonest note)", () => {
    expect(applyRegimeGate("C", "bear", "buy")).toEqual({ tier: "C", gated: false, noteAr: null })
    expect(applyRegimeGate("C", "bull", "sell")).toEqual({ tier: "C", gated: false, noteAr: null })
  })

  it("directions that agree with the regime are never penalized", () => {
    expect(applyRegimeGate("A", "bull", "buy")).toEqual({ tier: "A", gated: false, noteAr: null })
    expect(applyRegimeGate("A", "bear", "sell")).toEqual({ tier: "A", gated: false, noteAr: null })
  })

  it("neutral regime never penalizes", () => {
    expect(applyRegimeGate("A", "neutral", "buy")).toEqual({ tier: "A", gated: false, noteAr: null })
    expect(applyRegimeGate("A", "neutral", "sell")).toEqual({ tier: "A", gated: false, noteAr: null })
  })

  it("every regime carries an Arabic board-wide note", () => {
    for (const r of ["bull", "neutral", "bear"] as const) {
      expect(REGIME_META[r].noteAr.length).toBeGreaterThan(10)
    }
  })
})

describe("buildOpportunitiesDigest — state filter", () => {
  it("keeps confirmed and watching rows, drops wait/hold rows", () => {
    const rows = [
      row({ ticker: "CONF" }),
      watchingRow({ ticker: "WATCH" }),
      row({ ticker: "HOLD", signal: "hold", signalState: "wait", tradePlan: null, setup: null }),
    ]
    const d = buildOpportunitiesDigest(rows, "neutral", { free: false })
    expect(d.qualifying).toBe(2)
    expect(d.rows.map((r) => ("locked" in r ? "?" : r.ticker))).toEqual(["CONF", "WATCH"])
    expect(d.rows[0]).toMatchObject({ signalState: "confirmed", direction: "buy" })
    expect(d.rows[1]).toMatchObject({ signalState: "watching", direction: "buy", activationKind: "close_above", activationLevel: 10.5 })
  })

  it("excludes degraded rows with no actionable payload (confirmed without plan, watching without setup)", () => {
    const rows = [
      row({ ticker: "NOP", signalState: "confirmed", tradePlan: null, setup: null }),
      watchingRow({ ticker: "NOS", setup: null }),
    ]
    const d = buildOpportunitiesDigest(rows, "neutral", { free: false })
    expect(d.qualifying).toBe(0)
    expect(d.rows).toEqual([])
  })

  it("excludes non-directional states (hold with a stale plan payload)", () => {
    const d = buildOpportunitiesDigest([row({ ticker: "HOLDPLAN", signal: "hold", signalState: "wait" })], "neutral", { free: false })
    expect(d.qualifying).toBe(0)
  })

  it("watching rows keep their setup direction (sell setups gate as sells)", () => {
    const sellSetup = watchingRow({
      ticker: "SELLSETUP",
      setup: { ...(watchingRow({ ticker: "x" }).setup as object), direction: "sell" } as MarketSignalRow["setup"],
    })
    const d = buildOpportunitiesDigest([sellSetup], "bull", { free: false })
    expect(d.rows[0]).toMatchObject({ direction: "sell", gated: true })
  })

  it("legacy rows without the three-state layer qualify from their payload", () => {
    const legacyPlan = row({ ticker: "LEGACY", signalState: undefined })
    const d1 = buildOpportunitiesDigest([legacyPlan], "neutral", { free: false })
    expect(d1.qualifying).toBe(1)
    expect(d1.rows[0]).toMatchObject({ signalState: "confirmed" })
    const legacySetup = watchingRow({ ticker: "LEGACY2", signalState: undefined })
    const d2 = buildOpportunitiesDigest([legacySetup], "neutral", { free: false })
    expect(d2.qualifying).toBe(1)
    expect(d2.rows[0]).toMatchObject({ signalState: "watching" })
  })
})

describe("buildOpportunitiesDigest — ordering", () => {
  it("tiers sort A first, then score desc, then ticker asc within a tie", () => {
    const rows = [
      row({ ticker: "B_LOW", score: 60, tradePlan: { ...(row({ ticker: "x" }).tradePlan as object), riskReward: 1.8 } as MarketSignalRow["tradePlan"] }),
      row({ ticker: "C_SCORE", score: 40 }),
      row({ ticker: "A2", score: 85 }),
      row({ ticker: "B_HIGH", score: 68, tradePlan: { ...(row({ ticker: "x" }).tradePlan as object), riskReward: 1.8 } as MarketSignalRow["tradePlan"] }),
      row({ ticker: "A1", score: 75 }),
    ]
    const d = buildOpportunitiesDigest(rows, "neutral", { free: false })
    expect(d.rows.map((r) => ("locked" in r ? "?" : r.ticker))).toEqual(["A2", "A1", "B_HIGH", "B_LOW", "C_SCORE"])
  })

  it("null scores sort last within their tier", () => {
    const rows = [row({ ticker: "NULLS", score: null }), row({ ticker: "SCORED", score: 62 })]
    const d = buildOpportunitiesDigest(rows, "neutral", { free: false })
    expect(d.rows.map((r) => ("locked" in r ? "?" : r.ticker))).toEqual(["SCORED", "NULLS"])
  })
})

describe("buildOpportunitiesDigest — regime gating inside the digest", () => {
  it("buys in a bear regime lose one tier and surface the note", () => {
    const d = buildOpportunitiesDigest([row({ ticker: "BEARBUY" })], "bear", { free: false })
    expect(d.rows[0]).toMatchObject({ ticker: "BEARBUY", tier: "B", gated: true, noteAr: REGIME_GATE_NOTE_AR.buy })
  })

  it("sells in a bull regime lose one tier", () => {
    const sellPlan = row({ ticker: "BULLSELL", signal: "sell", tradePlan: { ...(row({ ticker: "x" }).tradePlan as object), bias: "sell" } as MarketSignalRow["tradePlan"] })
    const d = buildOpportunitiesDigest([sellPlan], "bull", { free: false })
    expect(d.rows[0]).toMatchObject({ ticker: "BULLSELL", tier: "B", gated: true, noteAr: REGIME_GATE_NOTE_AR.sell })
  })

  it("neutral regime leaves tiers untouched and notes null", () => {
    const d = buildOpportunitiesDigest([row({ ticker: "NEUTRAL" })], "neutral", { free: false })
    expect(d.rows[0]).toMatchObject({ tier: "A", gated: false, noteAr: null })
  })
})

describe("buildOpportunitiesDigest — cap (never padded, never exceeding 5)", () => {
  const many = Array.from({ length: 7 }, (_, i) => row({ ticker: `T${i}`, score: 80 - i }))

  it("caps at OPPORTUNITIES_CAP and reports the true qualifying count", () => {
    expect(OPPORTUNITIES_CAP).toBe(5)
    const d = buildOpportunitiesDigest(many, "neutral", { free: false })
    expect(d.qualifying).toBe(7)
    expect(d.rows.length).toBe(5)
    expect(d.rows.map((r) => ("locked" in r ? "?" : r.ticker))).toEqual(["T0", "T1", "T2", "T3", "T4"])
  })

  it("returns fewer than the cap when fewer qualify — never padded", () => {
    const d = buildOpportunitiesDigest(many.slice(0, 3), "neutral", { free: false })
    expect(d.qualifying).toBe(3)
    expect(d.rows.length).toBe(3)
  })

  it("an empty qualifying set is an honest empty digest", () => {
    const d = buildOpportunitiesDigest([], "neutral", { free: false })
    expect(d).toEqual({ qualifying: 0, rows: [] })
  })

  it("the gate can reorder the digest (a gated A buy drops below an ungated A sell in a bear regime)", () => {
    const buyTop = row({ ticker: "BUYTOP", score: 90 }) // A → B (buy in bear)
    const sellTop = row({
      ticker: "SELLTOP",
      signal: "sell",
      score: 80,
      tradePlan: { ...(row({ ticker: "x" }).tradePlan as object), bias: "sell" } as MarketSignalRow["tradePlan"],
    }) // A stays A (sells are not penalized in a bear regime)
    const neutral = buildOpportunitiesDigest([buyTop, sellTop], "neutral", { free: false })
    expect(neutral.rows.map((r) => ("locked" in r ? "?" : r.ticker))).toEqual(["BUYTOP", "SELLTOP"])
    const bear = buildOpportunitiesDigest([buyTop, sellTop], "bear", { free: false })
    expect(bear.rows.map((r) => ("locked" in r ? "?" : r.ticker))).toEqual(["SELLTOP", "BUYTOP"])
    expect(bear.rows[1]).toMatchObject({ ticker: "BUYTOP", tier: "B", gated: true })
    expect(bear.rows[0]).toMatchObject({ ticker: "SELLTOP", tier: "A", gated: false })
  })
})

describe("buildOpportunitiesDigest — free stripping (server-side redaction)", () => {
  it("free callers receive locked identity rows — the board's exact gating", () => {
    const d = buildOpportunitiesDigest([row({ ticker: "COMI" }), watchingRow({ ticker: "WATCHFREE" })], "neutral", { free: true })
    expect(d.qualifying).toBe(2)
    expect(d.rows.length).toBe(2)
    const keys = Object.keys(d.rows[0])
    for (const forbidden of ["signal", "score", "tier", "gated", "noteAr", "metrics", "reasons", "tradePlan", "entryLow", "entryHigh", "stop", "riskReward", "signalState", "setup", "activationLevel"]) {
      expect(keys).not.toContain(forbidden)
    }
    expect(d.rows[0]).toMatchObject({ ticker: "COMI", locked: true, lastClose: 10, changePct: 0 })
  })

  it("no paid payload survives JSON serialization of a free digest", () => {
    const d = buildOpportunitiesDigest([row({ ticker: "COMI", score: 88 })], "bear", { free: true })
    const json = JSON.stringify(d)
    expect(json).not.toContain('"score"')
    expect(json).not.toContain('"riskReward"')
    expect(json).not.toContain('"activationLevel"')
    expect(json).not.toContain('"noteAr"')
    expect(json).not.toContain('"tier"')
  })

  it("the qualifying count still travels for free callers (the filter ran for real)", () => {
    const many = Array.from({ length: 7 }, (_, i) => row({ ticker: `F${i}`, score: 80 - i }))
    const d = buildOpportunitiesDigest(many, "neutral", { free: true })
    expect(d.qualifying).toBe(7)
    expect(d.rows.length).toBe(5)
    for (const r of d.rows) expect("locked" in r && r.locked).toBe(true)
  })
})
