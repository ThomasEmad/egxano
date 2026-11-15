import { describe, expect, it } from "vitest"
import {
  buildOpportunityDigestV1,
  buildOpportunityLayer,
  companyOpportunityFromRows,
  egxSessionsBetween,
  OPPORTUNITY_DIGEST_CAP,
  OPPORTUNITY_DIGEST_EMPTY_AR,
  OPPORTUNITY_DIGEST_MISSED_CAP,
  type MarketSignalRow,
  type RowOpportunity,
} from "../signals-service"
import type { OpportunityView } from "../opportunity"
import type { Bar } from "../indicators"

// =============================================================================
// Opportunity Intelligence integration tests — the service glue
// (buildOpportunityLayer) and the opportunity@1 digest core
// (buildOpportunityDigestV1) pinned end-to-end with REAL resistance maps:
// stored-candle bars → buildResistanceMap → buildTargetLadder →
// classifyOpportunity → computeOpportunityScore.
// =============================================================================

// ---- MarketSignalRow fixture (same fields the gates/digest read) ----
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
      entryLow: 99.9,
      entryHigh: 100.2,
      entryPct: 0.5,
      stop: 95.0,
      stopPct: -5.0,
      targetLow: 112.0,
      targetHigh: 114.0,
      targetPct: 13,
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
    sessions: 45,
    lastClose: 100,
    asOf: "2026-11-15",
    changePct: 0.5,
    metrics: {
      rsi14: 55,
      ema20: 99,
      ema50: 97,
      macdLine: 1,
      macdHist: 0.2,
      relVol: 1.8,
      volPct: null,
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

function watchingRow(over: Partial<MarketSignalRow> & { ticker: string }): MarketSignalRow {
  return row({
    signal: "hold",
    signalState: "watching",
    tradePlan: null,
    setup: {
      direction: "buy",
      activation: { kind: "close_above", level: 100.5, basisAr: "أعلى مقاومة قريبة", volumeConditionAr: "حجم ≥ 1.5×" },
      provisionalEntry: { low: 100.4, high: 100.6, basisAr: "تقديري" },
      provisionalStop: { level: 95.0, basisAr: "تقديري" },
      provisionalTarget: { low: 110.0, high: 112.0, basisAr: "تقديري" },
      provisionalRiskReward: 2.5,
      provisionalBasisAr: "تقديري",
      recomputeNoteAr: "تُعاد الحسابات عند التفعيل",
      preEntryInvalidation: { level: 94.5, conditionAr: "إغلاق تحت 94.5 يلغي", reasonAr: "كسر هيكلي" },
      postEntryNoteAr: "الخروج يتبع الوقف",
      vetoReasons: [{ code: "near_resistance_veto", tone: "negative", ar: "مقاومة ملاصقة", en: "resistance" }],
    },
    ...over,
  })
}

// ---- stored daily OHLC candles: a real ceiling at ~110 then a monotonic
// decline into 100 — pivot highs cluster into ONE supply zone above entry ----
let daySeq = 0
function fixtureDay(): string {
  return new Date(Date.UTC(2026, 5, 1 + daySeq++)).toISOString().slice(0, 10)
}
function ceilingBars(): Bar[] {
  daySeq = 0
  const bars: Bar[] = []
  const push = (o: number, h: number, l: number, c: number) =>
    bars.push({ ts: fixtureDay(), open: o, high: h, low: l, close: c, volume: 1000 })
  // 1-10: ramp 100 → 109.5 (no local pivot highs — each high exceeds the last)
  for (let i = 0; i < 10; i++) {
    const mid = 100 + i * 1.05
    push(mid, mid + 0.1, mid - 0.1, mid)
  }
  // 11-16: topping bars — probe 110-110.5, close below (rejection wicks)
  for (let i = 0; i < 6; i++) push(109, 110.2 + i * 0.06, 108.4, 108.8)
  // 17-45: monotonic decline 109 → 100 (no confirmed pivot highs inside)
  for (let i = 0; i < 29; i++) {
    const mid = 109 - i * 0.32
    push(mid, mid + 0.05, mid - 0.2, mid)
  }
  return bars
}

/** Flat close-only bars (O=H=L=C) — the scanner-overlay shape the map must skip. */
function flatBars(): Bar[] {
  daySeq = 0
  return Array.from({ length: 60 }, () => {
    const day = fixtureDay()
    return { ts: day, open: 100, high: 100, low: 100, close: 100, volume: 1000 }
  })
}

const TODAY = "2026-11-15"

describe("buildOpportunityLayer — candidate gate (cost discipline)", () => {
  it("a confirmed row builds the layer on the SAME stored candles", () => {
    const r = row({ ticker: "CONF" })
    const layer = buildOpportunityLayer({
      signalState: "confirmed",
      direction: "buy",
      lastClose: 100,
      score: 80,
      tradePlan: r.tradePlan,
      setup: null,
      reasons: r.reasons,
      relVol: 1.8,
      volPct: null,
      ema20: 99,
      ema50: 97,
      asOf: TODAY,
      todaySession: TODAY,
      bars: ceilingBars(),
    })
    expect(layer).not.toBeNull()
    expect(layer!.view.state).toBe("actionable")
    expect(layer!.view.eligible).toBe(true)
    expect(layer!.view.direction).toBe("buy")
    expect(layer!.view.upsidePctToT1).not.toBeNull()
    expect(layer!.view.upsidePctToT1!).toBeGreaterThan(5)
    // the ladder is real: T1 sits in the 110 ceiling zone, tick-rounded
    expect(layer!.ladder).not.toBeNull()
    expect(layer!.ladder!.targets[0].label).toBe("T1")
    expect(layer!.ladder!.targets[0].price).toBeGreaterThan(105)
    // eligible → OQS is a real 0-100 number; data age 0 (same session)
    expect(layer!.oqs).not.toBeNull()
    expect(layer!.oqs!).toBeGreaterThan(0)
    expect(layer!.oqs!).toBeLessThanOrEqual(100)
    expect(layer!.dataAgeSessions).toBe(0)
    // relVol 1.8 ≥ 1.5 → the board's own high-liquidity tier
    expect(layer!.liquidityTier).toBe("liquid")
  })

  it("a watching row WITH a setup classifies conditional on the activation basis", () => {
    const layer = buildOpportunityLayer({
      signalState: "watching",
      direction: "buy",
      lastClose: 100,
      score: 65,
      tradePlan: null,
      setup: watchingRow({ ticker: "W" }).setup ?? null,
      reasons: [],
      relVol: 1.2,
      volPct: null,
      ema20: 99,
      ema50: 97,
      asOf: TODAY,
      todaySession: TODAY,
      bars: ceilingBars(),
    })
    expect(layer).not.toBeNull()
    expect(layer!.view.state).toBe("conditional")
    expect(layer!.view.eligible).toBe(false) // provisional geometry never executes
    expect(layer!.view.provisional).toBe(true)
    // the module's hard rule: ineligible → oqs null
    expect(layer!.oqs).toBeNull()
    expect(layer!.oqsComponents).toBeNull()
  })

  it("wait rows and watching rows WITHOUT a setup get NO layer (skip for cost)", () => {
    const base = {
      direction: "buy" as const,
      lastClose: 100,
      score: 50,
      tradePlan: null,
      setup: null,
      reasons: [],
      relVol: 1.0,
      volPct: null,
      ema20: 99,
      ema50: 97,
      asOf: TODAY,
      todaySession: TODAY,
      bars: ceilingBars(),
    }
    expect(buildOpportunityLayer({ ...base, signalState: "wait" })).toBeNull()
    expect(buildOpportunityLayer({ ...base, signalState: "watching" })).toBeNull()
  })
})

describe("buildOpportunityLayer — honesty on the same bars", () => {
  it("close-only flat bars → unavailable map → honest no-target rejection (never fabricated)", () => {
    const layer = buildOpportunityLayer({
      signalState: "confirmed",
      direction: "buy",
      lastClose: 100,
      score: 80,
      tradePlan: row({ ticker: "FLAT" }).tradePlan,
      setup: null,
      reasons: [],
      relVol: 1.0,
      volPct: null,
      ema20: 99,
      ema50: 97,
      asOf: TODAY,
      todaySession: TODAY,
      bars: flatBars(),
    })
    expect(layer).not.toBeNull()
    expect(layer!.ladder).toBeNull()
    expect(layer!.view.state).toBe("none")
    expect(layer!.view.eligible).toBe(false)
    expect(layer!.oqs).toBeNull()
    expect(layer!.view.rejectionReasonsAr.length).toBeGreaterThan(0)
    expect(layer!.view.rejectionReasonsAr[0]).toContain("الهدف الأول غير متاح")
  })

  it("a close that left the entry behind with < 5% remaining is MISSED (no-chase)", () => {
    // missed fires when the gates FAIL (RR < 1.5 here) AND the entry zone is
    // left behind AND the remaining upside from the LAST close is < 5% —
    // the module's pinned rule (gates passing → actionable, never missed).
    const plan = row({ ticker: "MISSED" }).tradePlan!
    const layer = buildOpportunityLayer({
      signalState: "confirmed",
      direction: "buy",
      lastClose: 105, // beyond the entry zone yet within the staleness gap; remaining to the 110 wall < 5%
      score: 80,
      tradePlan: { ...plan, riskReward: 1.2 },
      setup: null,
      reasons: [],
      relVol: 1.0,
      volPct: null,
      ema20: 99,
      ema50: 97,
      asOf: TODAY,
      todaySession: TODAY,
      bars: ceilingBars(),
    })
    expect(layer).not.toBeNull()
    expect(layer!.view.state).toBe("missed")
    expect(layer!.view.missedAr).not.toBeNull()
    expect(layer!.view.eligible).toBe(false)
    expect(layer!.oqs).toBeNull()
  })

  // ---- the VLMRA bug pin (2026-11-15 owner report): a plan published at ~9.2
// served while the stock trades 24.47 printed a T1 (13.21) BELOW the live
// price. The stale-plan guard must rebuild around the current close and the
// ladder must never print a rung below the market. ----
function vlmraBars(): Bar[] {
  daySeq = 0
  const bars: Bar[] = []
  const push = (o: number, h: number, l: number, c: number) =>
    bars.push({ ts: fixtureDay(), open: o, high: h, low: l, close: c, volume: 1000 })
  // 1-40: the OLD plan's regime — a 9.0-9.6 low-base zigzag (real pivots)
  for (let i = 0; i < 40; i++) {
    const mid = 9.0 + (i % 4) * 0.2
    push(mid, mid + 0.1, mid - 0.1, mid)
  }
  // 41-50: a limit-up style re-rating rally 9.6 → ~24.3
  for (let i = 0; i < 10; i++) {
    const mid = 9.6 + (i + 1) * 1.47
    push(mid, mid + 0.2, mid - 0.2, mid)
  }
  // 51-55: topping cluster — probe ~24.9, close below (rejection wicks)
  for (let i = 0; i < 5; i++) push(24.4, 24.9 + i * 0.03, 24.2, 24.75)
  // 56-58: pullback toward a higher low
  push(24.4, 24.5, 23.2, 23.3)
  push(23.3, 23.6, 23.0, 23.15)
  push(23.2, 23.7, 23.1, 23.6)
  // 59: recovery to the current close
  push(23.6, 24.6, 23.5, 24.47)
  return bars
}

it("rebuilds a STALE plan around the current close — T1 never below the live price (VLMRA bug pin)", () => {
  const layer = buildOpportunityLayer({
    signalState: "confirmed",
    direction: "buy",
    lastClose: 24.47,
    score: 80,
    tradePlan: {
      bias: "buy",
      entryLow: 9.1,
      entryHigh: 9.3,
      entryPct: 0.5,
      stop: 8.6,
      stopPct: -6,
      targetLow: 13.21,
      targetHigh: 13.21,
      targetPct: 40,
      riskReward: 2.0,
      textAr: "",
      textEn: "",
      basisAr: "",
    },
    setup: null,
    reasons: [],
    relVol: 1.0,
    volPct: 1.0,
    ema20: 23,
    ema50: 15,
    asOf: TODAY,
    todaySession: TODAY,
    bars: vlmraBars(),
  })
  expect(layer).not.toBeNull()
  // the persisted plan (~9.2) sits ~160% below the market → rebuilt, never served
  expect(layer!.planRebuilt).toBe(true)
  expect(layer!.plan).not.toBeNull()
  expect(layer!.plan!.entryLow).toBeGreaterThan(20)
  expect(layer!.planRebuiltNoteAr).not.toBeNull()
  // and the ladder anchors ABOVE the live price — never 13.21 on a 24.47 stock
  expect(layer!.ladder).not.toBeNull()
  expect(layer!.ladder!.targets.length).toBeGreaterThan(0)
  for (const t of layer!.ladder!.targets) {
    expect(t.price).toBeGreaterThan(24.47)
  }
})

it("drops a watching setup whose activation is far from the current close (AMES bug pin)", () => {
  // a buy trigger at ~108 while the stock trades 54 — the trigger fired long
  // ago and the provisional levels are dead geometry: the layer must drop
  // the setup (observation, no levels) instead of serving it.
  const layer = buildOpportunityLayer({
    signalState: "watching",
    direction: "buy",
    lastClose: 54.15,
    score: 60,
    tradePlan: null,
    setup: {
      direction: "buy",
      activation: { kind: "close_above", level: 107.94, basisAr: "اختبار", volumeConditionAr: "اختبار" },
      provisionalEntry: { low: 107.94, high: 108.37, basisAr: "اختبار" },
      provisionalStop: { level: 50.05, basisAr: "اختبار" },
      provisionalTarget: { low: 130, high: 131, basisAr: "اختبار" },
      provisionalRiskReward: 0.06,
      provisionalBasisAr: "اختبار",
      recomputeNoteAr: "تُعاد الحسابات عند التفعيل",
      preEntryInvalidation: { level: 50.05, conditionAr: "اختبار", reasonAr: "اختبار" },
      postEntryNoteAr: "الخروج يتبع الوقف",
      vetoReasons: [],
    },
    reasons: [],
    relVol: 1.0,
    volPct: null,
    ema20: 60,
    ema50: 70,
    asOf: TODAY,
    todaySession: TODAY,
    bars: ceilingBars(),
  })
  expect(layer).not.toBeNull()
  expect(layer!.setupDropped).toBe(true)
  expect(layer!.setupDroppedNoteAr).not.toBeNull()
  // the stale setup never reaches the classifier: honest observation
  expect(layer!.view.state).toBe("observation")
  // and the ladder anchors on the CURRENT price, not the dead trigger
  for (const t of layer!.ladder?.targets ?? []) {
    expect(t.price).toBeGreaterThan(54.15)
  }
})

it("feeds dataAgeSessions from asOf vs the compute day (EGX Sun–Thu sessions)", () => {
    expect(egxSessionsBetween("2026-11-15", "2026-11-15")).toBe(0)
    expect(egxSessionsBetween("2026-11-12", "2026-11-15")).toBe(1) // Thu → Sun
    expect(egxSessionsBetween("2026-11-13", "2026-11-15")).toBe(1) // Fri skipped
    const layer = buildOpportunityLayer({
      signalState: "confirmed",
      direction: "buy",
      lastClose: 100,
      score: 80,
      tradePlan: row({ ticker: "AGE" }).tradePlan,
      setup: null,
      reasons: [],
      relVol: 1.0,
      volPct: null,
      ema20: 99,
      ema50: 97,
      asOf: "2026-11-12",
      todaySession: TODAY,
      bars: ceilingBars(),
    })
    expect(layer!.dataAgeSessions).toBe(1)
  })
})

// ---- digest fixtures: rows with attached layers (ordering/cap/free pins) ----

function oppView(over: Partial<OpportunityView>): OpportunityView {
  return {
    state: "actionable",
    direction: "buy",
    opportunityVersion: "opportunity@2",
    upsidePctToT1: 8,
    remainingPctToT1: 8,
    qualifies5: true,
    rrOk: true,
    eligible: true,
    rejectionReasonsAr: [],
    missedAr: null,
    watchNextAr: "راقب.",
    stateNoteAr: "مؤهلة.",
    provisional: false,
    ...over,
  }
}

function layer(over: Partial<RowOpportunity> = {}): RowOpportunity {
  return {
    view: oppView({}),
    ladder: null,
    plan: null,
    planRebuilt: false,
    planRebuiltNoteAr: null,
    setupDropped: false,
    setupDroppedNoteAr: null,
    oqs: 80,
    oqsComponents: null,
    oqsNoteAr: "",
    liquidityTier: "normal",
    dataAgeSessions: 0,
    ...over,
  }
}

describe("buildOpportunityDigestV1 — ordering (OQS DESC, eligibility first)", () => {
  it("ranks qualifying rows by OQS DESC; ties → higher upside, then ticker", () => {
    const rows = [
      row({ ticker: "B_LOW_OQS" }),
      row({ ticker: "A_TOP" }),
      row({ ticker: "TIE_B" }),
      row({ ticker: "TIE_A" }),
    ]
    rows[0].opportunity = layer({ oqs: 60 })
    rows[1].opportunity = layer({ oqs: 92 })
    rows[2].opportunity = layer({ oqs: 70, view: oppView({ upsidePctToT1: 6.1 }) })
    rows[3].opportunity = layer({ oqs: 70, view: oppView({ upsidePctToT1: 7.4 }) })
    const d = buildOpportunityDigestV1(rows, "neutral", { free: false })
    expect(d.qualifying).toBe(4)
    expect(d.rows.map((r) => ("ticker" in r ? r.ticker : "")).slice(0, 4)).toEqual(["A_TOP", "TIE_A", "TIE_B", "B_LOW_OQS"])
    const first = d.rows[0] as Extract<(typeof d.rows)[number], { view: unknown }>
    expect(first.section).toBe("qualifying")
    expect(first.oqs).toBe(92)
  })

  it("ineligible rows are NEVER ranked above qualifying rows (sections separate)", () => {
    const rows = [
      row({ ticker: "COND" }),
      row({ ticker: "OBS" }),
      row({ ticker: "ELIG" }),
    ]
    rows[0].opportunity = layer({ oqs: null, view: oppView({ state: "conditional", eligible: false, provisional: true, upsidePctToT1: 9 }) })
    rows[1].opportunity = layer({ oqs: null, view: oppView({ state: "observation", eligible: false, upsidePctToT1: 3, rejectionReasonsAr: ["سبب مرفوض بالأرقام"] }) })
    rows[2].opportunity = layer({ oqs: 55 })
    const d = buildOpportunityDigestV1(rows, "neutral", { free: false })
    const sections = d.rows.map((r) => ("section" in r ? r.section : ""))
    expect(sections).toEqual(["qualifying", "watch", "ineligible"])
    expect(d.qualifying).toBe(1)
  })
})

describe("buildOpportunityDigestV1 — cap + missed list + empty state", () => {
  it("caps total at 5 (qualifying first, informative fills the remainder)", () => {
    const rows: MarketSignalRow[] = []
    for (let i = 0; i < 7; i++) {
      const r = row({ ticker: `Q${i}` })
      r.opportunity = layer({ oqs: 90 - i })
      rows.push(r)
    }
    for (let i = 0; i < 3; i++) {
      const r = watchingRow({ ticker: `W${i}` })
      r.opportunity = layer({ oqs: null, view: oppView({ state: "conditional", eligible: false, provisional: true }) })
      rows.push(r)
    }
    const d = buildOpportunityDigestV1(rows, "neutral", { free: false })
    expect(d.qualifying).toBe(7) // before the cap — a short digest is never a bug
    expect(d.rows.length).toBe(OPPORTUNITY_DIGEST_CAP)
    const tickers = d.rows.map((r) => ("ticker" in r ? r.ticker : ""))
    expect(tickers.slice(0, 5)).toEqual(["Q0", "Q1", "Q2", "Q3", "Q4"])
    expect(tickers).toEqual(["Q0", "Q1", "Q2", "Q3", "Q4"]) // cap consumed by qualifying — no informative rows fit
  })

  it("missed rows travel SEPARATELY, capped at 3, never inside rows", () => {
    const rows: MarketSignalRow[] = []
    for (let i = 0; i < 5; i++) {
      const r = row({ ticker: `M${i}` })
      r.opportunity = layer({
        oqs: null,
        view: oppView({ state: "missed", eligible: false, missedAr: "الفرصة فاتت — العائد المتبقي غير كافٍ", remainingPctToT1: 4 - i * 0.5 }),
      })
      rows.push(r)
    }
    const d = buildOpportunityDigestV1(rows, "neutral", { free: false })
    expect(d.rows.length).toBe(0)
    expect(d.missedRows.length).toBe(OPPORTUNITY_DIGEST_MISSED_CAP)
    expect(d.missedRows.every((r) => "missedAr" in r)).toBe(true)
    // remaining-upside DESC ordering
    expect(d.missedRows.map((r) => ("remainingPctToT1" in r ? r.remainingPctToT1 : null))).toEqual([4, 3.5, 3])
  })

  it("an empty qualifying set carries the EXACT honest empty-state note", () => {
    const d = buildOpportunityDigestV1([], "neutral", { free: false })
    expect(d.qualifying).toBe(0)
    expect(d.rows).toEqual([])
    expect(d.missedRows).toEqual([])
    expect(d.emptyNoteAr).toBe(OPPORTUNITY_DIGEST_EMPTY_AR)
  })
})

describe("buildOpportunityDigestV1 — free gating (allowlist serialization)", () => {
  it("free callers receive locked identity rows — no paid field survives", () => {
    const rows = [row({ ticker: "PAID1" }), watchingRow({ ticker: "PAID2" })]
    rows[0].opportunity = layer({ oqs: 77 })
    rows[1].opportunity = layer({ oqs: null, view: oppView({ state: "conditional", eligible: false, provisional: true }) })
    const d = buildOpportunityDigestV1(rows, "neutral", { free: true })
    expect(d.qualifying).toBe(1)
    for (const r of d.rows) {
      expect("locked" in r && r.locked).toBe(true)
      expect("view" in r || "oqs" in r || "stateNoteAr" in r || "section" in r).toBe(false)
    }
    for (const r of d.missedRows) expect("locked" in r && r.locked).toBe(true)
    const serialized = JSON.stringify(d)
    expect(serialized).not.toContain("stateNoteAr")
    expect(serialized).not.toContain("rejectionReasonsAr")
    expect(serialized).not.toContain("entryLow")
  })
})

describe("companyOpportunityFromRows — the per-company block source", () => {
  it("returns the row's layer for the ticker and null otherwise", () => {
    const rows = [row({ ticker: "COMI" }), row({ ticker: "HOLD", signal: "hold", signalState: "wait" })]
    rows[0].opportunity = layer({ oqs: 70 })
    expect(companyOpportunityFromRows(rows, "COMI")).not.toBeNull()
    expect(companyOpportunityFromRows(rows, "HOLD")).toBeNull() // wait row: no field
    expect(companyOpportunityFromRows(rows, "ABCD")).toBeNull()
  })
})
