// Opportunity-state classifier tests (opportunity@1 — 2026-11-15).
//
// THE INVARIANTS UNDER TEST: the classifier is a STRICT eligibility filter,
// never a target generator —
//   • the 5% gate is STRICTLY greater: exactly 5.00 FAILS, 5.01 passes;
//   • the RR gate is >= 1.5: exactly 1.50 passes, 1.49 fails;
//   • T1 comes ONLY from the documented ladder (never invented, never
//     substituted from T2/T3 when a T1 exists, never nudged to pass);
//   • the NO-CHASE rule recomputes remaining upside from the LAST CLOSE and
//     emits missedAr exactly when the entry zone is left behind;
//   • conditional rows are provisional and never executable as-is;
//   • wait rows are never opportunities (no naked reads): none/early only;
//   • rejection reasons cite the ACTUAL computed numbers in Arabic.
//
// All fixtures are hand-shaped numbers, so every expected view is derivable
// by construction, not by re-running any engine.
import { describe, expect, it } from "vitest"
import {
  classifyOpportunity,
  OPPORTUNITY_THRESHOLDS,
  OPPORTUNITY_VERSION,
  type OpportunityInput,
  type OpportunityLadderInput,
  type OpportunityLadderTargetInput,
  type OpportunityPlanInput,
  type OpportunitySetupInput,
  type OpportunityView,
} from "../opportunity"

// ---------------------------------------------------------------------------
// Fixtures — hand-shaped, deterministic
// ---------------------------------------------------------------------------

function planInput(over: Partial<OpportunityPlanInput> = {}): OpportunityPlanInput {
  return {
    bias: "buy",
    entryLow: 9.8,
    entryHigh: 10,
    stop: 9.2,
    targetLow: 10.5,
    targetHigh: 10.8,
    riskReward: 2,
    targetKind: "zone",
    ...over,
  }
}

function rung(label: string, price: number, over: Partial<OpportunityLadderTargetInput> = {}): OpportunityLadderTargetInput {
  return { label, price, kind: "zone", strength: 80, whyAr: "منطقة عرض موثقة بإغلاقات سابقة", ...over }
}

function ladderInput(targets: OpportunityLadderTargetInput[] | null): OpportunityLadderInput {
  return { targets }
}

function setupInput(over: Partial<OpportunitySetupInput> = {}): OpportunitySetupInput {
  return {
    direction: "buy",
    activationLevel: 10.05,
    activationConditionAr: "إغلاق يومي فوق 10.05 بحجم ≥ 1.5× متوسط آخر 20 جلسة",
    provisional: true,
    provisionalRiskReward: 2,
    ...over,
  }
}

function base(over: Partial<OpportunityInput> = {}): OpportunityInput {
  return {
    lastClose: 9.9,
    signalState: "confirmed",
    score: 72,
    direction: "buy",
    tradePlan: planInput(),
    setup: null,
    lifecycleView: null,
    zones: [],
    ladder: ladderInput([rung("T1", 10.501)]),
    intradayContext: null,
    earlyEvidence: null,
    ...over,
  }
}

/** A T1 that pays exactly the 5.00% boundary from entryHigh = 10. */
const T1_EXACT_5 = 10.5
/** A T1 that pays 5.01% — the smallest passing upside at 2dp granularity. */
const T1_JUST_OVER_5 = 10.501

// ---------------------------------------------------------------------------
// The contract checker — every view from ANY path must satisfy it.
// ---------------------------------------------------------------------------

const ALL_STATES = ["early", "observation", "conditional", "actionable", "invalidated", "missed", "none"] as const

function checkContract(v: OpportunityView, label: string): void {
  expect(v.opportunityVersion, `${label}: version stamped`).toBe(OPPORTUNITY_VERSION)
  expect(ALL_STATES, `${label}: state in vocabulary`).toContain(v.state)
  // eligible ⇔ both gates true AND the state allows execution
  expect(v.eligible, `${label}: eligible ⇔ gates ∧ actionable`).toBe(v.qualifies5 && v.rrOk && v.state === "actionable")
  // missedAr exactly on missed rows
  expect(v.missedAr !== null, `${label}: missedAr ⟺ state missed`).toBe(v.state === "missed")
  // provisional exactly on conditional rows
  expect(v.provisional, `${label}: provisional ⟺ state conditional`).toBe(v.state === "conditional")
  // honest emptiness: every non-qualifying state carries rejection reasons
  if (["none", "observation", "missed", "invalidated"].includes(v.state)) {
    expect(v.rejectionReasonsAr.length, `${label}: non-qualifying states cite reasons`).toBeGreaterThan(0)
    expect(v.eligible, `${label}: non-qualifying never eligible`).toBe(false)
  }
  if (v.state === "actionable") {
    expect(v.rejectionReasonsAr, `${label}: actionable carries no rejections`).toEqual([])
    expect(v.upsidePctToT1, `${label}: actionable has a computed upside`).not.toBeNull()
    expect(v.qualifies5, `${label}: actionable passed the 5% gate`).toBe(true)
    expect(v.rrOk, `${label}: actionable passed the RR gate`).toBe(true)
  }
  if (v.state === "conditional") {
    expect(v.upsidePctToT1, `${label}: conditional has a provisional upside`).not.toBeNull()
    expect(v.rejectionReasonsAr, `${label}: conditional carries no rejections`).toEqual([])
    expect(v.eligible, `${label}: conditional never executable as-is`).toBe(false)
  }
  if (v.state === "early") {
    // early NEVER implies a trade: no levels, no gates, no direction claim
    expect(v.upsidePctToT1, `${label}: early carries no levels`).toBeNull()
    expect(v.qualifies5, `${label}: early gate 5 false`).toBe(false)
    expect(v.rrOk, `${label}: early gate RR false`).toBe(false)
    expect(v.eligible, `${label}: early never eligible`).toBe(false)
  }
  if (v.state === "missed") {
    expect(v.missedAr, `${label}: missedAr exact text`).toBe("الفرصة فاتت — العائد المتبقي غير كافٍ")
    expect(v.watchNextAr, `${label}: missed never suggests a late entry`).toContain("لا يُنصح بدخول متأخر")
  }
}

// ---------------------------------------------------------------------------
// 1. Version + thresholds pinning
// ---------------------------------------------------------------------------

describe("opportunity@2 pinning", () => {
  it("stamps the version on every view", () => {
    expect(OPPORTUNITY_VERSION).toBe("opportunity@2")
    for (const inp of [
      base(),
      base({ signalState: "watching", setup: setupInput(), tradePlan: null, direction: null }),
      base({ signalState: "wait", tradePlan: null, direction: null, ladder: null }),
    ]) {
      expect(classifyOpportunity(inp).opportunityVersion).toBe("opportunity@2")
    }
  })

  it("exposes the strict thresholds for UI/tests to cite", () => {
    expect(OPPORTUNITY_THRESHOLDS.minUpsidePct).toBe(5.0)
    expect(OPPORTUNITY_THRESHOLDS.minRiskReward).toBe(1.5)
    expect(OPPORTUNITY_THRESHOLDS.upsideRoundDecimals).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// 2. Boundary pinning — the 5% gate is STRICTLY greater
// ---------------------------------------------------------------------------

describe("strict 5% upside gate (boundary pinning)", () => {
  it("upside exactly 5.00% FAILS (state none, honest rejection)", () => {
    const v = classifyOpportunity(base({ ladder: ladderInput([rung("T1", T1_EXACT_5)]) }))
    checkContract(v, "exactly 5.00")
    expect(v.state).toBe("none")
    expect(v.qualifies5).toBe(false)
    expect(v.eligible).toBe(false)
    expect(v.upsidePctToT1).toBe(5)
    expect(v.rejectionReasonsAr.join(" ")).toContain("5%")
    expect(v.missedAr).toBeNull()
  })

  it("upside 5.01% PASSES (state actionable, eligible)", () => {
    const v = classifyOpportunity(base({ ladder: ladderInput([rung("T1", T1_JUST_OVER_5)]) }))
    checkContract(v, "5.01")
    expect(v.state).toBe("actionable")
    expect(v.qualifies5).toBe(true)
    expect(v.rrOk).toBe(true)
    expect(v.eligible).toBe(true)
    expect(v.upsidePctToT1).toBe(5.01)
  })

  it("the gate never nudges levels: rejection cites the real number (3.4%)", () => {
    const v = classifyOpportunity(base({ ladder: ladderInput([rung("T1", 10.34)]) }))
    expect(v.state).toBe("none")
    expect(v.upsidePctToT1).toBe(3.4)
    expect(v.rejectionReasonsAr.join(" ")).toContain("3.4%")
    expect(v.rejectionReasonsAr.join(" ")).toContain("أقل من الحد الأدنى 5%")
  })

  it("mirrors conservatively for SELL: (entryLow − T1)/entryLow — exactly 5.00 fails", () => {
    const sellPlan = planInput({ bias: "sell", entryLow: 10, entryHigh: 10.2, stop: 10.9, targetLow: 9.4, targetHigh: 9.2 })
    const v = classifyOpportunity(base({ direction: "sell", tradePlan: sellPlan, lastClose: 10.1, ladder: ladderInput([rung("T1", 9.5)]) }))
    checkContract(v, "sell exact 5.00")
    expect(v.state).toBe("none")
    expect(v.direction).toBe("sell")
    expect(v.upsidePctToT1).toBe(5)
    expect(v.qualifies5).toBe(false)
  })

  it("SELL 5.1% passes (worst executable entry is entryLow)", () => {
    const sellPlan = planInput({ bias: "sell", entryLow: 10, entryHigh: 10.2, stop: 10.9, targetLow: 9.4, targetHigh: 9.2 })
    const v = classifyOpportunity(base({ direction: "sell", tradePlan: sellPlan, lastClose: 10.1, ladder: ladderInput([rung("T1", 9.49)]) }))
    checkContract(v, "sell 5.1")
    expect(v.state).toBe("actionable")
    expect(v.eligible).toBe(true)
    expect(v.upsidePctToT1).toBe(5.1)
  })
})

// ---------------------------------------------------------------------------
// 3. Boundary pinning — the RR gate is >= 1.5
// ---------------------------------------------------------------------------

describe("strict RR gate (boundary pinning)", () => {
  it("RR exactly 1.5 PASSES", () => {
    const v = classifyOpportunity(base({ tradePlan: planInput({ riskReward: 1.5 }) }))
    checkContract(v, "RR 1.5")
    expect(v.rrOk).toBe(true)
    expect(v.state).toBe("actionable")
    expect(v.eligible).toBe(true)
  })

  it("RR 1.49 FAILS with the number in the reason", () => {
    const v = classifyOpportunity(base({ tradePlan: planInput({ riskReward: 1.49 }) }))
    checkContract(v, "RR 1.49")
    expect(v.state).toBe("none")
    expect(v.rrOk).toBe(false)
    expect(v.rejectionReasonsAr.join(" ")).toContain("1.49")
    expect(v.rejectionReasonsAr.join(" ")).toContain("أقل من الحد الأدنى 1.5")
  })

  it("a failing RR cannot be rescued by a passing upside (no trade-off)", () => {
    // upside 8% passes, RR 1.2 fails → not eligible, none
    const v = classifyOpportunity(base({ tradePlan: planInput({ riskReward: 1.2 }), ladder: ladderInput([rung("T1", 10.8)]) }))
    expect(v.state).toBe("none")
    expect(v.qualifies5).toBe(true)
    expect(v.rrOk).toBe(false)
    expect(v.eligible).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 4. NO-CHASE (missed) — remaining upside recomputed from the LAST CLOSE
// ---------------------------------------------------------------------------

describe("no-chase (missed) transition", () => {
  it("entry zone left behind + remaining < 5% → missed with the exact missedAr", () => {
    // entry upside 4% (fails), lastClose 10.2 > entryHigh 10, remaining from
    // close to T1 = (10.4 − 10.2)/10.2 = 1.96% < 5% → missed
    const v = classifyOpportunity(base({ lastClose: 10.2, ladder: ladderInput([rung("T1", 10.4)]) }))
    checkContract(v, "missed")
    expect(v.state).toBe("missed")
    expect(v.missedAr).toBe("الفرصة فاتت — العائد المتبقي غير كافٍ")
    expect(v.rejectionReasonsAr.join(" ")).toContain("1.96%")
    expect(v.rejectionReasonsAr.join(" ")).toContain("10.20")
  })

  it("SELL mirror: close below entryLow + remaining < 5% → missed", () => {
    const sellPlan = planInput({ bias: "sell", entryLow: 10, entryHigh: 10.2, stop: 10.9, targetLow: 9.4, targetHigh: 9.2 })
    // remaining = (9.85 − 9.5)/9.85 = 3.55% < 5%
    const v = classifyOpportunity(base({ direction: "sell", tradePlan: sellPlan, lastClose: 9.85, ladder: ladderInput([rung("T1", 9.5)]) }))
    checkContract(v, "sell missed")
    expect(v.state).toBe("missed")
    expect(v.missedAr).toBe("الفرصة فاتت — العائد المتبقي غير كافٍ")
    expect(v.rejectionReasonsAr.join(" ")).toContain("3.55%")
  })

  it("entry left behind but remaining >= 5% → NOT missed (none with reasons)", () => {
    // RR fails (1.2) so not eligible; remaining from 10.25 to 10.8 = 5.37% ≥ 5
    const v = classifyOpportunity(
      base({ lastClose: 10.25, tradePlan: planInput({ riskReward: 1.2 }), ladder: ladderInput([rung("T1", 10.8)]) }),
    )
    checkContract(v, "left behind, room left")
    expect(v.state).toBe("none")
    expect(v.missedAr).toBeNull()
    expect(v.rejectionReasonsAr.join(" ")).toContain("1.2")
    expect(v.rejectionReasonsAr.join(" ")).toContain("تجاوز منطقة الدخول")
  })

  it("entry left behind with NO T1 → remaining unknowable → none (never missed)", () => {
    const v = classifyOpportunity(base({ lastClose: 10.4, ladder: null, zones: [] }))
    checkContract(v, "left behind, no T1")
    expect(v.state).toBe("none")
    expect(v.missedAr).toBeNull()
    expect(v.rejectionReasonsAr.join(" ")).toContain("الهدف الأول غير متاح — لا توجد منطقة مقاومة موثقة فوق الدخول")
  })

  it("entry left behind, zones documented but ladder absent → no target is DERIVED", () => {
    const v = classifyOpportunity(
      base({ lastClose: 10.4, ladder: null, zones: [{ low: 10.6, high: 10.9, kind: "supply", touches: 3 }] }),
    )
    expect(v.state).toBe("none")
    expect(v.missedAr).toBeNull()
    expect(v.rejectionReasonsAr.join(" ")).toContain("لا سلّم أهداف محسوب")
    expect(v.rejectionReasonsAr.join(" ")).toContain("لا يُشتق هدف جديد هنا")
  })
})

// ---------------------------------------------------------------------------
// 5. T1 selection from the ladder — documented rungs only
// ---------------------------------------------------------------------------

describe("T1 selection", () => {
  it("prefers the rung labeled T1 (the ladder's conservative edge)", () => {
    // T2 sits closer, but the labeled T1 is the reference: upside = 6%
    const v = classifyOpportunity(base({ ladder: ladderInput([rung("T1", 10.6), rung("T2", 10.51)]) }))
    expect(v.state).toBe("actionable")
    expect(v.upsidePctToT1).toBe(6)
  })

  it("falls back to the nearest documented rung beyond entry when no T1 label exists", () => {
    const v = classifyOpportunity(base({ ladder: ladderInput([rung("T2", 10.8)]) }))
    expect(v.state).toBe("actionable")
    expect(v.upsidePctToT1).toBe(8)
  })

  it("never substitutes T2/T3 for a T1 that sits on the wrong side", () => {
    // T1 BELOW the buy entry → gate fails honestly; T2 above is NOT swapped in
    const v = classifyOpportunity(base({ ladder: ladderInput([rung("T1", 9.5), rung("T2", 10.8)]) }))
    expect(v.state).toBe("none")
    expect(v.upsidePctToT1).toBe(-5)
    expect(v.rejectionReasonsAr.join(" ")).toContain("لا تُستبدل الأهداف لتمرير البوابة")
  })
})

// ---------------------------------------------------------------------------
// 6. State-mapping matrix — signalState × plan × ladder × lifecycle
// ---------------------------------------------------------------------------

describe("state-mapping matrix", () => {
  const cases: { name: string; input: OpportunityInput; state: OpportunityView["state"]; direction: "buy" | "sell" | null }[] = [
    // confirmed rows
    { name: "confirmed + plan + qualifying ladder → actionable", input: base(), state: "actionable", direction: "buy" },
    {
      name: "confirmed + plan + no ladder → none (no T1 invented)",
      input: base({ ladder: null, zones: [] }),
      state: "none",
      direction: "buy",
    },
    {
      name: "confirmed + plan + failing upside → none",
      input: base({ ladder: ladderInput([rung("T1", 10.34)]) }),
      state: "none",
      direction: "buy",
    },
    { name: "confirmed without plan → none (no plan invented)", input: base({ tradePlan: null, ladder: null }), state: "none", direction: "buy" },
    {
      name: "confirmed + lifecycle awaiting entry (confirmed) → actionable",
      input: base({ lifecycleView: { state: "confirmed", events: [] } }),
      state: "actionable",
      direction: "buy",
    },
    {
      name: "confirmed + lifecycle active (in trade) → none (no new entry)",
      input: base({
        lifecycleView: { state: "active", events: [{ type: "activated", date: "2026-11-10", price: 9.95, noteAr: "بدأ تتبع الصفقة." }] },
      }),
      state: "none",
      direction: "buy",
    },
    {
      name: "confirmed + lifecycle stopped → none",
      input: base({ lifecycleView: { state: "stopped", events: [{ type: "stopped", date: "2026-11-12", price: 9.2, noteAr: "ضرب الوقف." }] } }),
      state: "none",
      direction: "buy",
    },
    {
      name: "confirmed + lifecycle targeted → none",
      input: base({ lifecycleView: { state: "targeted", events: [{ type: "targeted", date: "2026-11-12", price: 10.5, noteAr: "لمس الهدف." }] } }),
      state: "none",
      direction: "buy",
    },
    {
      name: "confirmed + lifecycle time_stopped → none",
      input: base({ lifecycleView: { state: "time_stopped", events: [{ type: "time_stopped", date: "2026-11-20", price: 10, noteAr: "وقف زمني." }] } }),
      state: "none",
      direction: "buy",
    },
    // watching rows
    {
      name: "watching + setup with qualifying trigger geometry → conditional",
      input: base({
        signalState: "watching",
        tradePlan: null,
        setup: setupInput(),
        ladder: ladderInput([rung("T1", 10.6)]),
      }),
      state: "conditional",
      direction: "buy",
    },
    {
      name: "watching + setup with trigger upside < 5% → observation",
      input: base({
        signalState: "watching",
        tradePlan: null,
        setup: setupInput({ activationLevel: 10 }),
        ladder: ladderInput([rung("T1", 10.3)]),
      }),
      state: "observation",
      direction: "buy",
    },
    {
      name: "watching + setup with provisional RR < 1.5 → observation",
      input: base({
        signalState: "watching",
        tradePlan: null,
        setup: setupInput({ provisionalRiskReward: 1.4 }),
        ladder: ladderInput([rung("T1", 10.8)]),
      }),
      state: "observation",
      direction: "buy",
    },
    {
      name: "watching + setup with unknown provisional RR → observation",
      input: base({
        signalState: "watching",
        tradePlan: null,
        setup: setupInput({ provisionalRiskReward: null }),
        ladder: ladderInput([rung("T1", 10.8)]),
      }),
      state: "observation",
      direction: "buy",
    },
    {
      name: "watching without setup → observation",
      input: base({ signalState: "watching", tradePlan: null, setup: null, ladder: ladderInput([rung("T1", 10.8)]) }),
      state: "observation",
      direction: "buy",
    },
    {
      name: "watching + open lifecycle (watching) → conditional when geometry qualifies",
      input: base({
        signalState: "watching",
        tradePlan: null,
        setup: setupInput(),
        ladder: ladderInput([rung("T1", 10.6)]),
        lifecycleView: { state: "watching", events: [] },
      }),
      state: "conditional",
      direction: "buy",
    },
    {
      name: "watching + lifecycle invalidated → invalidated (pass-through)",
      input: base({
        signalState: "watching",
        tradePlan: null,
        setup: setupInput(),
        ladder: ladderInput([rung("T1", 10.6)]),
        lifecycleView: {
          state: "invalidated",
          events: [{ type: "invalidated", date: "2026-11-11", price: 9.4, noteAr: "أُلغيت الفرصة قبل الدخول: إغلاق يومي تحت مستوى الإلغاء." }],
        },
      }),
      state: "invalidated",
      direction: "buy",
    },
    {
      name: "watching + lifecycle expired → invalidated (pass-through)",
      input: base({
        signalState: "watching",
        tradePlan: null,
        setup: setupInput(),
        ladder: ladderInput([rung("T1", 10.6)]),
        lifecycleView: {
          state: "expired",
          events: [{ type: "expired", date: "2026-12-10", price: 9.8, noteAr: "انتهت المهلة بدون تفعيل." }],
        },
      }),
      state: "invalidated",
      direction: "buy",
    },
    {
      name: "watching + lifecycle recompute-CONFIRMED (plan on the view) → actionable, non-provisional",
      input: base({
        signalState: "watching",
        tradePlan: null,
        setup: setupInput(),
        ladder: ladderInput([rung("T1", 10.501)]),
        lifecycleView: {
          state: "confirmed",
          events: [{ type: "activated", date: "2026-11-13", price: 10.06, noteAr: "تفعّلت الفرصة بإغلاق يومي." }],
          tradePlan: planInput(),
        },
      }),
      state: "actionable",
      direction: "buy",
    },
    // wait rows
    { name: "wait row → none (never an opportunity)", input: base({ signalState: "wait", tradePlan: null, direction: null, ladder: null, setup: null }), state: "none", direction: null },
    {
      name: "wait row + early evidence → early",
      input: base({
        signalState: "wait",
        tradePlan: null,
        direction: null,
        ladder: null,
        setup: null,
        earlyEvidence: { improvingRs: true, accumulation: false },
      }),
      state: "early",
      direction: null,
    },
  ]

  it("maps every combination to the documented state", () => {
    for (const c of cases) {
      const v = classifyOpportunity(c.input)
      checkContract(v, c.name)
      expect(v.state, c.name).toBe(c.state)
      expect(v.direction, `${c.name}: direction`).toBe(c.direction)
    }
  })
})

// ---------------------------------------------------------------------------
// 7. Conditional rows — provisional labeling + trigger-time numbers
// ---------------------------------------------------------------------------

describe("conditional (provisional) labeling", () => {
  function conditionalInput(): OpportunityInput {
    return base({
      signalState: "watching",
      tradePlan: null,
      setup: setupInput({ activationLevel: 10.05 }),
      ladder: ladderInput([rung("T1", 10.6)]),
      // (10.6 − 10.05)/10.05 = 5.4726% > 5 → qualifies at the trigger
    })
  }

  it("conditional rows are provisional and never executable as-is", () => {
    const v = classifyOpportunity(conditionalInput())
    checkContract(v, "conditional")
    expect(v.state).toBe("conditional")
    expect(v.provisional).toBe(true)
    expect(v.eligible).toBe(false)
    expect(v.qualifies5).toBe(true)
    expect(v.rrOk).toBe(true)
    expect(v.upsidePctToT1).toBe(5.4726)
  })

  it("stateNoteAr and watchNextAr disclose the recompute-on-activation rule", () => {
    const v = classifyOpportunity(conditionalInput())
    expect(v.stateNoteAr).toContain("تُعاد الحسابات")
    expect(v.stateNoteAr).toContain("تقديري")
    expect(v.watchNextAr).toContain("10.05")
    expect(v.watchNextAr).toContain("بحجم")
  })

  it("trigger-time upside exactly 5.00% fails → observation citing the trigger number", () => {
    const v = classifyOpportunity(
      base({
        signalState: "watching",
        tradePlan: null,
        setup: setupInput({ activationLevel: 10 }),
        ladder: ladderInput([rung("T1", 10.5)]),
      }),
    )
    checkContract(v, "trigger exact 5.00")
    expect(v.state).toBe("observation")
    expect(v.provisional).toBe(false)
    expect(v.qualifies5).toBe(false)
    expect(v.upsidePctToT1).toBe(5)
    expect(v.rejectionReasonsAr.join(" ")).toContain("عند مستوى التفعيل 5%")
  })

  it("trigger-time upside 5.01% passes → conditional", () => {
    const v = classifyOpportunity(
      base({
        signalState: "watching",
        tradePlan: null,
        setup: setupInput({ activationLevel: 10 }),
        ladder: ladderInput([rung("T1", 10.501)]),
      }),
    )
    checkContract(v, "trigger 5.01")
    expect(v.state).toBe("conditional")
    expect(v.provisional).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 8. Wait rows are NEVER opportunities; early requires explicit evidence
// ---------------------------------------------------------------------------

describe("hold/wait never actionable (no naked reads)", () => {
  const waitVariants: OpportunityInput[] = [
    base({ signalState: "wait", tradePlan: null, direction: null, ladder: null, setup: null }),
    base({ signalState: "wait", tradePlan: null, direction: null, ladder: null, setup: null, score: 95 }),
    base({
      signalState: "wait",
      tradePlan: null,
      direction: null,
      ladder: null,
      setup: null,
      earlyEvidence: { improvingRs: false, accumulation: false },
    }),
  ]

  it("wait rows never reach actionable/conditional and never carry a direction", () => {
    for (const inp of waitVariants) {
      const v = classifyOpportunity(inp)
      checkContract(v, "wait variant")
      expect(["none", "early"]).toContain(v.state)
      expect(v.state).not.toBe("actionable")
      expect(v.state).not.toBe("conditional")
      expect(v.eligible).toBe(false)
      expect(v.direction).toBeNull()
    }
  })

  it("early requires at least one explicit evidence flag", () => {
    const noneV = classifyOpportunity(waitVariants[0])
    expect(noneV.state).toBe("none")
    const earlyV = classifyOpportunity(
      base({
        signalState: "wait",
        tradePlan: null,
        direction: null,
        ladder: null,
        setup: null,
        earlyEvidence: { improvingRs: true, accumulation: true, noteAr: "تحسّن نسبي مقابل القطاع" },
      }),
    )
    checkContract(earlyV, "early")
    expect(earlyV.state).toBe("early")
    expect(earlyV.stateNoteAr).toContain("قراءة مبكرة")
    expect(earlyV.stateNoteAr).toContain("تحسّن نسبي مقابل القطاع")
    expect(earlyV.upsidePctToT1).toBeNull()
    expect(earlyV.rejectionReasonsAr).toEqual([])
  })

  it("a plan handed to a wait row does NOT make it actionable (state outranks payload)", () => {
    const v = classifyOpportunity(base({ signalState: "wait", direction: "buy" }))
    checkContract(v, "wait with stray plan")
    expect(["none", "early"]).toContain(v.state)
    expect(v.eligible).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 9. Lifecycle pass-through — notes travel, dead stays dead
// ---------------------------------------------------------------------------

describe("lifecycle pass-through", () => {
  it("invalidated passes the LAST event noteAr through as the primary assessment", () => {
    const note = "أُلغيت الفرصة قبل الدخول: إغلاق يومي عند 9.40 تحت مستوى الإلغاء 9.50."
    const v = classifyOpportunity(
      base({
        signalState: "watching",
        tradePlan: null,
        setup: setupInput(),
        ladder: null,
        lifecycleView: { state: "invalidated", events: [{ type: "activated", date: "2026-11-10", price: 10, noteAr: "تفعّلت." }, { type: "invalidated", date: "2026-11-11", price: 9.4, noteAr: note }] },
      }),
    )
    expect(v.state).toBe("invalidated")
    expect(v.stateNoteAr).toBe(note)
    expect(v.eligible).toBe(false)
    expect(v.upsidePctToT1).toBeNull()
    expect(v.rejectionReasonsAr.join(" ")).toContain("أُلغيت قبل الدخول")
  })

  it("expired passes through to the invalidated bucket with its own note", () => {
    const v = classifyOpportunity(
      base({
        signalState: "watching",
        tradePlan: null,
        setup: setupInput(),
        ladder: null,
        lifecycleView: { state: "expired", events: [{ type: "expired", date: "2026-12-10", price: 9.8, noteAr: "انتهت المهلة بدون تفعيل." }] },
      }),
    )
    expect(v.state).toBe("invalidated")
    expect(v.stateNoteAr).toBe("انتهت المهلة بدون تفعيل.")
    expect(v.rejectionReasonsAr.join(" ")).toContain("انتهت صلاحيتها")
  })

  it("executed/resolved outcomes are honest emptiness with the event note (no re-entry manufacture)", () => {
    for (const [state, note] of [
      ["active", "بدأ تتبع الصفقة."],
      ["stopped", "ضرب وقف الخسارة عند 9.20."],
      ["targeted", "لمس الهدف عند 10.50."],
      ["time_stopped", "وقف زمني بعد 15 جلسة."],
    ] as const) {
      const v = classifyOpportunity(base({ lifecycleView: { state, events: [{ type: state, date: "2026-11-12", price: 10, noteAr: note }] } }))
      expect(v.state, state).toBe("none")
      expect(v.stateNoteAr, state).toBe(note)
      expect(v.eligible, state).toBe(false)
      expect(v.missedAr, state).toBeNull()
    }
  })

  it("a lifecycle verdict with no events falls back to the documented default note", () => {
    const v = classifyOpportunity(base({ lifecycleView: { state: "stopped", events: null } }))
    expect(v.state).toBe("none")
    expect(v.stateNoteAr).toContain("محلولة")
  })
})

// ---------------------------------------------------------------------------
// 10. Arabic rejection reasons cite the computed numbers; ladder form tolerance;
//     evidence-only inputs never gate; determinism
// ---------------------------------------------------------------------------

describe("honesty and input-tolerance properties", () => {
  it("the qualifying actionable note cites the upside and RR numbers", () => {
    const v = classifyOpportunity(base())
    expect(v.state).toBe("actionable")
    expect(v.stateNoteAr).toContain("5.01%")
    expect(v.stateNoteAr).toContain("2")
    expect(v.watchNextAr).toContain("9.80")
    expect(v.watchNextAr).toContain("10.00")
    expect(v.watchNextAr).toContain("10.50")
  })

  it("accepts a bare target-rung array (TargetLadder-tolerance) with identical output", () => {
    const asObject = classifyOpportunity(base())
    const asArray = classifyOpportunity(base({ ladder: [rung("T1", 10.501)] }))
    expect(asArray).toEqual(asObject)
  })

  it("intradayContext is evidence-only: it never changes the classification", () => {
    const without = classifyOpportunity(base({ signalState: "watching", tradePlan: null, setup: setupInput() }))
    const withCtx = classifyOpportunity(
      base({
        signalState: "watching",
        tradePlan: null,
        setup: setupInput(),
        intradayContext: { noteAr: "اختراق داخل الجلسة", sessionHigh: 10.06, sessionLow: 9.85 },
      }),
    )
    expect(withCtx).toEqual(without)
    const actionable = classifyOpportunity(base({ intradayContext: { sessionHigh: 99 } }))
    expect(actionable).toEqual(classifyOpportunity(base()))
  })

  it("score carries no threshold in opportunity@1 (no invented gate)", () => {
    expect(classifyOpportunity(base({ score: 12 })).state).toBe(classifyOpportunity(base({ score: 99 })).state)
    expect(classifyOpportunity(base({ score: 12 })).state).toBe("actionable")
  })

  it("is deterministic: identical inputs → identical views", () => {
    const inp = base({
      signalState: "watching",
      tradePlan: null,
      setup: setupInput(),
      ladder: ladderInput([rung("T1", 10.6)]),
      zones: [{ low: 10.6, high: 10.9, kind: "supply", touches: 2, strength: 70 }],
    })
    expect(classifyOpportunity(inp)).toEqual(classifyOpportunity(inp))
  })
})
