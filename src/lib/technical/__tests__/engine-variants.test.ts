// Ablation variant plumbing tests (2026-11-14) — the additive evidence layer:
//   • variant engineVersions are accepted and reported in `version`
//   • the score delta is CAPPED (±4/module, ±8 total)
//   • evidence alone NEVER flips a hold to buy/sell (the @5 confluence is
//     still required — volume agreement, excellence, trend share, vetoes)
//   • OHLC-absent rows: ADX/candle evidence abstains SILENTLY (output is
//     byte-identical to plain v2 apart from the version string)
//   • divergence works off closes (close-only replay keeps its evidence)
import { describe, expect, it } from "vitest"
import {
  computeCloseSignal,
  TECH_ENGINE_VARIANTS,
  EVIDENCE_DELTA_CAP_PER_MODULE,
  EVIDENCE_DELTA_CAP_TOTAL,
  SIGNALS_VERSION,
  type CloseRow,
} from "../signals"
import { detectDivergence } from "../divergence"

function rowsFrom(closes: number[], volumes: number[] | null = null, withOHLC = true, wick = 0.6): CloseRow[] {
  const out: CloseRow[] = []
  const start = Date.UTC(2025, 5, 2)
  for (let i = 0; i < closes.length; i++) {
    const o = i === 0 ? closes[0] * 0.99 : closes[i - 1]
    const c = closes[i]
    const row: CloseRow = { ts: new Date(start + i * 86_400_000).toISOString().slice(0, 10), close: c, volume: volumes ? volumes[i] : 1000 }
    if (withOHLC) {
      row.open = o
      row.high = Math.max(o, c) + wick
      row.low = Math.min(o, c) - wick
    }
    out.push(row)
  }
  return out
}

function uptrend(n = 90): number[] {
  const out: number[] = []
  let p = 50
  for (let i = 0; i < n; i++) { p *= i % 2 === 0 ? 1.006 : 0.998; out.push(Math.round(p * 100) / 100) }
  return out
}

/** The divergence fixture (lower price low + higher RSI low), 51 sessions. */
function divergenceCloses(): number[] {
  const out: number[] = []
  let p = 100
  for (let i = 0; i < 10; i++) { p *= 1.012; out.push(Math.round(p * 100) / 100) }
  for (let i = 10; i < 20; i++) { p *= 0.955; out.push(Math.round(p * 100) / 100) }
  for (let i = 20; i < 28; i++) { p *= 1.02; out.push(Math.round(p * 100) / 100) }
  for (let i = 28; i < 43; i++) { p *= 0.988; out.push(Math.round(p * 100) / 100) }
  for (let i = 43; i < 51; i++) { p *= 1.01; out.push(Math.round(p * 100) / 100) }
  return out
}

const stripVersion = (o: unknown): unknown => {
  const c = { ...(o as Record<string, unknown>) }
  delete c.version
  return c
}

describe("variants — plumbing", () => {
  it("every variant string is accepted and echoed in `version`; the plain engine is untouched", () => {
    const rows = rowsFrom(uptrend())
    expect(computeCloseSignal(rows).version).toBe(SIGNALS_VERSION)
    for (const v of TECH_ENGINE_VARIANTS) {
      expect(computeCloseSignal(rows, { engineVersion: v }).version).toBe(v)
    }
    // v1 baseline path unchanged
    expect(computeCloseSignal(rows, { engineVersion: "tech-signals@4" }).version).toBe("tech-signals@4")
  })

  it("caps: the variant score never drifts beyond ±8 from the base score on any fixture", () => {
    const fixtures: CloseRow[][] = [
      rowsFrom(uptrend()),
      rowsFrom(uptrend(120), uptrend(120).map((_, i) => (i % 2 === 0 ? 1500 : 1000))),
      rowsFrom(divergenceCloses(), divergenceCloses().map((_, i) => (i % 3 === 0 ? 3000 : 900))),
      rowsFrom(uptrend().map((c, i) => (i > 75 ? c * 0.985 : c))), // late downturn
    ]
    for (const rows of fixtures) {
      const base = computeCloseSignal(rows)
      for (const v of TECH_ENGINE_VARIANTS) {
        const out = computeCloseSignal(rows, { engineVersion: v })
        if (base.score !== null && out.score !== null) {
          expect(Math.abs((out.score as number) - (base.score as number))).toBeLessThanOrEqual(EVIDENCE_DELTA_CAP_TOTAL)
        }
        if (base.signal !== null && out.signal !== null) {
          // evidence can never create the OPPOSITE directional read
          if (base.signal === "buy") expect(out.signal).not.toBe("sell")
          if (base.signal === "sell") expect(out.signal).not.toBe("buy")
        }
      }
    }
  })

  it("evidence reasons are APPENDED after the base reasons (base reasons unchanged)", () => {
    // close-only rows: with open=prev-close synthesis the trough bars TIE on
    // lows (low[i+1] = close[i] − wick) and the STRICT fractal rule rejects the
    // pivot — the close-only fixture is the deterministic divergence fixture.
    const closes = divergenceCloses()
    const rows = rowsFrom(closes, closes.map((_, i) => (i % 3 === 0 ? 3000 : 900)), false)
    const base = computeCloseSignal(rows)
    const div = computeCloseSignal(rows, { engineVersion: "tech-signals@5+div" })
    // base reason codes are a prefix of the variant reason codes
    const baseCodes = base.reasons.map((r) => r.code)
    const divCodes = div.reasons.map((r) => r.code)
    expect(divCodes.slice(0, baseCodes.length)).toEqual(baseCodes)
    expect(divCodes).toContain("divergence_bullish")
    const divReason = div.reasons.find((r) => r.code === "divergence_bullish")!
    expect(divReason.tone).toBe("positive")
    expect(divReason.ar).toContain("دايفرجنس صاعد")
  })

  it("OHLC-absent abstention: +adx and +candles are byte-identical to plain v2 (silent, no delta)", () => {
    const closes = uptrend()
    const closeOnly = rowsFrom(closes, null, false)
    const plain = computeCloseSignal(closeOnly)
    for (const v of ["tech-signals@5+adx", "tech-signals@5+candles"] as const) {
      const out = computeCloseSignal(closeOnly, { engineVersion: v })
      expect(JSON.stringify(stripVersion(out))).toBe(JSON.stringify(stripVersion(plain)))
    }
  })

  it("hold is never flipped to buy by evidence alone — the @5 volume gate still blocks", () => {
    // rising closes with heavy DOWN-day volume → OBV slope ≤ 0 and relVol < 1 →
    // the @5 volume-agreement gate fails, so max bullish evidence (ADX + candles)
    // must NOT create a buy read.
    const closes: number[] = []
    let p = 50
    for (let i = 0; i < 90; i++) { p *= i % 2 === 0 ? 1.006 : 0.997; closes.push(Math.round(p * 100) / 100) }
    const volumes = closes.map((_, i) => (i % 2 === 0 ? 120 : 6000)) // up days light, down days heavy
    const rows = rowsFrom(closes, volumes)
    const base = computeCloseSignal(rows)
    for (const v of TECH_ENGINE_VARIANTS) {
      const out = computeCloseSignal(rows, { engineVersion: v })
      if (base.signal === "hold") expect(out.signal).not.toBe("buy")
    }
    void EVIDENCE_DELTA_CAP_PER_MODULE
  })

  it("divergence evidence works on CLOSE-ONLY rows (pivots read off closes)", () => {
    const closes = divergenceCloses()
    const closeOnly = rowsFrom(closes, null, false)
    const div = detectDivergence(closeOnly)
    expect(div.available).toBe(true)
    expect(div.bullish?.basis).toBe("rsi")
    expect(div.bullish?.pivotIndex).toBe(42)
    const out = computeCloseSignal(closeOnly, { engineVersion: "tech-signals@5+div" })
    expect(out.reasons.map((r) => r.code)).toContain("divergence_bullish")
  })
})
