// Tests for the briefing script builder — determinism, the 900-char budget,
// null-safety (never prints null/NaN/undefined), and the mandatory intro +
// disclaimer sections.

import { describe, expect, it } from "vitest"
import { buildBriefingScript, estimateDurationSec, BRIEFING_SCRIPT_MAX_CHARS, DISCLAIMER_SENTENCE } from "@/lib/briefing/script"
import type { TechnicalSnapshot } from "@/lib/technical/analyze"
import type { SdZone } from "@/lib/technical/zones"

/** Minimal TechnicalSnapshot fixture (technical@4) — the assembleBundle base shape with everything null. */
function baseSnapshot(): TechnicalSnapshot {
  return {
    version: "technical@4",
    available: false,
    asOf: null,
    sessions: 0,
    firstSession: null,
    lastClose: null,
    currency: "EGP",
    sparse: false,
    adjustedActions: null,
    limitations: [],
    perf: { d1: null, w1: null, m1: null, m3: null, m6: null, y1: null },
    trend: {
      ema20: null, ema50: null, ema200: null,
      priceVsEma20: null, priceVsEma50: null, priceVsEma200: null,
      ema20VsEma50: null, ema50VsEma200: null, alignment: null,
      cross50200: null, cross50200Age: null,
    },
    momentum: { rsi14: null, macd: { macd: null, signal: null, histogram: null }, stochastic: { k: null, d: null } },
    volume: { obv: null, obvSlope20: null, volMa20: null, relVol: null, volumeWindow: null },
    volatility: {
      atr14: null, atrPct: null,
      bollinger: { upper: null, middle: null, lower: null, widthPct: null, percentB: null },
      histVol20: null,
    },
    levels: { supports: [], resistances: [] },
    structure: null,
    vsa: null,
    zones: null,
    context: null,
    quality: null,
    range60: { high: null, low: null, posPct: null, sessions: 0 },
    signals: [],
  }
}

const demandZone: SdZone = {
  kind: "demand",
  low: 28.4,
  high: 29.2,
  formedAt: "2026-01-20",
  origin: "pivot_rejection",
  tests: 3,
  lastTestAt: "2026-02-02",
  reactionPct: 4.2,
  avgVolRatio: 1.3,
  quality: 72,
  distPct: -7.2,
  invalidation: 28.26,
  text: "Demand zone 28.4–29.2",
  textAr: "منطقة طلب 28.4–29.2",
}

const supplyZone: SdZone = {
  kind: "supply",
  low: 32.5,
  high: 33.4,
  formedAt: "2026-01-05",
  origin: "consolidation_break",
  tests: 2,
  lastTestAt: null,
  reactionPct: 3.1,
  avgVolRatio: null,
  quality: 65,
  distPct: 5.8,
  invalidation: 33.57,
  text: "Supply zone 32.5–33.4",
  textAr: "منطقة عرض 32.5–33.4",
}

/** Fictional clean-bullish snapshot: full evidence, every optional section present. */
function bullishSnapshot(): TechnicalSnapshot {
  return {
    ...baseSnapshot(),
    available: true,
    asOf: "2026-02-13",
    sessions: 260,
    firstSession: "2025-02-10",
    lastClose: 31.2,
    perf: { d1: 1.2, w1: 3.4, m1: 8.1, m3: 14.2, m6: 22.5, y1: 31.0 },
    trend: {
      ...baseSnapshot().trend,
      ema20: 30.1, ema50: 28.7, ema200: 26.5,
    },
    momentum: {
      rsi14: 58.4,
      macd: { macd: 0.8, signal: 0.5, histogram: 0.3 },
      stochastic: { k: 62, d: 55 },
    },
    volume: { obv: 1_250_000, obvSlope20: 12.5, volMa20: 900_000, relVol: 1.4, volumeWindow: 260 },
    volatility: { ...baseSnapshot().volatility, atr14: 0.56, atrPct: 1.8 },
    levels: {
      supports: [{ price: 29.5, touches: 3, distPct: -5.4 }],
      resistances: [{ price: 32.8, touches: 4, distPct: 5.1 }],
    },
    zones: { version: "zones@1", available: true, zones: [demandZone, supplyZone], limitations: [] },
    range60: { high: 33.4, low: 26.8, posPct: 66, sessions: 60 },
    signals: [],
  }
}

describe("estimateDurationSec", () => {
  it("maps WAV bytes to seconds at 48KB/sec", () => {
    expect(estimateDurationSec(48_000)).toBe(1)
    expect(estimateDurationSec(96_000)).toBe(2)
    expect(estimateDurationSec(24_000)).toBe(1) // rounds to the nearest second
    expect(estimateDurationSec(0)).toBe(0)
  })
})

describe("buildBriefingScript — bullish fixture", () => {
  const { scriptAr, sectionsUsed } = buildBriefingScript({
    ticker: "EGCH",
    nameAr: "التجمع للصناعات الكيماوية",
    snapshot: bullishSnapshot(),
  })

  it("starts with the greeting", () => {
    expect(scriptAr.startsWith("تحليل فني معلوماتي لسهم التجمع للصناعات الكيماوية — كود EGCH.")).toBe(true)
    expect(sectionsUsed).toContain("greeting")
  })

  it("carries the informational disclaimer verbatim and never drops it", () => {
    expect(scriptAr).toContain(DISCLAIMER_SENTENCE)
    expect(sectionsUsed).toContain("disclaimer")
  })

  it("never prints null / NaN / undefined", () => {
    expect(scriptAr).not.toContain("null")
    expect(scriptAr).not.toContain("NaN")
    expect(scriptAr).not.toContain("undefined")
  })

  it("stays within the single-TTS-call char budget", () => {
    expect(scriptAr.length).toBeLessThanOrEqual(BRIEFING_SCRIPT_MAX_CHARS)
    expect(scriptAr.length).toBeLessThanOrEqual(1024)
  })

  it("narrates the verdict, trend, momentum, levels, zones, volume and invalidation", () => {
    expect(scriptAr).toMatch(/الصورة الفنية (إيجابية|محايدة|سلبية) — درجة \d+ من 100\./)
    expect(scriptAr).toContain("رصيف متوسطات صاعد")
    expect(scriptAr).toContain("مؤشر القوة النسبية عند 58.4 في منطقة الزخم الصح")
    expect(scriptAr).toContain("أقرب دعم عند 29.5")
    expect(scriptAr).toContain("أقرب مقاومة عند 32.8")
    expect(scriptAr).toContain("أقرب منطقة طلب بين 28.4 و29.2")
    expect(scriptAr).toContain("أقرب منطقة عرض بين 32.5 و33.4")
    expect(scriptAr).toContain("بيدعم الحركة")
    expect(scriptAr).toContain("الإغلاق تحت 29.5 بيبطل القراءة دي.")
    expect(scriptAr).toContain("آخر جلسة متاحة: 2026-02-13.")
    expect(sectionsUsed).toEqual(expect.arrayContaining(["verdict", "trend", "momentum", "levels", "zones", "volume", "invalidation", "asOf"]))
  })

  it("is deterministic", () => {
    const again = buildBriefingScript({ ticker: "EGCH", nameAr: "التجمع للصناعات الكيماوية", snapshot: bullishSnapshot() })
    expect(again.scriptAr).toBe(scriptAr)
    expect(again.sectionsUsed).toEqual(sectionsUsed)
  })

  it("falls back to the ticker when the Arabic name is missing", () => {
    const { scriptAr: s } = buildBriefingScript({ ticker: "EGCH", nameAr: null, snapshot: bullishSnapshot() })
    expect(s.startsWith("تحليل فني معلوماتي لسهم EGCH — كود EGCH.")).toBe(true)
  })
})

describe("buildBriefingScript — null safety (empty snapshot)", () => {
  it("still returns intro + disclaimer and skips every data-driven sentence", () => {
    const { scriptAr, sectionsUsed } = buildBriefingScript({ ticker: "XXXX", nameAr: "شركة بلا بيانات", snapshot: baseSnapshot() })
    expect(scriptAr).toContain("تحليل فني معلوماتي لسهم شركة بلا بيانات — كود XXXX.")
    expect(scriptAr).toContain(DISCLAIMER_SENTENCE)
    expect(scriptAr).not.toContain("null")
    expect(scriptAr).not.toContain("NaN")
    expect(scriptAr).not.toContain("undefined")
    expect(sectionsUsed).toEqual(["greeting", "disclaimer"])
  })

  it("survives hostile numeric junk (NaN/Infinity) without printing them", () => {
    const snap = {
      ...baseSnapshot(),
      available: true,
      asOf: "2026-02-13",
      sessions: 40,
      lastClose: Number.NaN,
      trend: { ...baseSnapshot().trend, ema20: Number.POSITIVE_INFINITY, ema50: 28.7 },
      momentum: { rsi14: Number.NaN, macd: { macd: Number.NaN, signal: null, histogram: Number.POSITIVE_INFINITY }, stochastic: { k: null, d: null } },
      volume: { obv: null, obvSlope20: Number.NaN, volMa20: null, relVol: Number.POSITIVE_INFINITY, volumeWindow: 40 },
      levels: { supports: [{ price: Number.NaN, touches: 2, distPct: -3 }], resistances: [] },
    } as TechnicalSnapshot
    const { scriptAr } = buildBriefingScript({ ticker: "XXXX", nameAr: null, snapshot: snap })
    expect(scriptAr).not.toContain("NaN")
    expect(scriptAr).not.toContain("Infinity")
    expect(scriptAr).not.toContain("null")
    expect(scriptAr).toContain(DISCLAIMER_SENTENCE)
  })
})
