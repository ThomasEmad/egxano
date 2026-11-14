// Divergence module tests — confirmed-swing divergence with a DOCUMENTED
// K = 3-session confirmation delay (zero lookahead beyond it) and prefix
// purity. Fixture pins computed by hand in node first (rsiSeries on the same
// closes): bullish RSI@19 = 19.9120, RSI@42 = 24.3793, gap 4.4673 > 2 floor;
// bearish RSI@19 = 84.6744, RSI@42 = 76.8465.
import { describe, expect, it } from "vitest"
import { detectDivergence, CONFIRMATION_SESSIONS, ACTIVE_SESSIONS, PIVOT_WING, type DivergenceRow } from "../divergence"
import { rsiSeries } from "../indicators"

function mkRows(closes: number[]): DivergenceRow[] {
  const start = Date.UTC(2025, 5, 2)
  return closes.map((c, i) => ({ ts: new Date(start + i * 86_400_000).toISOString().slice(0, 10), close: c }))
}

// price: rise → crash to a low @19 → recover → slow grind to a LOWER low @42 → recover
const bullCloses: number[] = []
{
  let p = 100
  for (let i = 0; i < 10; i++) { p *= 1.012; bullCloses.push(Math.round(p * 100) / 100) }
  for (let i = 10; i < 20; i++) { p *= 0.955; bullCloses.push(Math.round(p * 100) / 100) }
  for (let i = 20; i < 28; i++) { p *= 1.02; bullCloses.push(Math.round(p * 100) / 100) }
  for (let i = 28; i < 43; i++) { p *= 0.988; bullCloses.push(Math.round(p * 100) / 100) }
  for (let i = 43; i < 51; i++) { p *= 1.01; bullCloses.push(Math.round(p * 100) / 100) }
}
// mirror: decline → spike high @19 → dip → slow climb to a HIGHER high @42 → decline
const bearCloses: number[] = []
{
  let p = 100
  for (let i = 0; i < 10; i++) { p *= 0.988; bearCloses.push(Math.round(p * 100) / 100) }
  for (let i = 10; i < 20; i++) { p *= 1.045; bearCloses.push(Math.round(p * 100) / 100) }
  for (let i = 20; i < 28; i++) { p *= 0.98; bearCloses.push(Math.round(p * 100) / 100) }
  for (let i = 28; i < 43; i++) { p *= 1.012; bearCloses.push(Math.round(p * 100) / 100) }
  for (let i = 43; i < 51; i++) { p *= 0.99; bearCloses.push(Math.round(p * 100) / 100) }
}

/** Independent hand-computed strength (documented formula, close pivots). */
function handStrength(closes: number[], i1: number, i2: number, bullish: boolean): number {
  const rsi = rsiSeries(closes, 14)
  const r1 = rsi[i1] as number
  const r2 = rsi[i2] as number
  const pg = (Math.abs(closes[i2] - closes[i1]) / closes[i1]) * 100
  const ig = bullish ? r2 - r1 : r1 - r2
  expect(ig).toBeGreaterThan(2) // above the documented RSI noise floor
  return Math.min(1, 0.4 * Math.min(1, pg / 3) + 0.6 * Math.min(1, ig / 10))
}

describe("divergence — confirmation, no-lookahead, abstention", () => {
  const bullRows = mkRows(bullCloses)
  const bearRows = mkRows(bearCloses)

  it("bullish: lower price low + higher RSI low, declared exactly K sessions after the pivot", () => {
    const r = detectDivergence(bullRows)
    expect(r.available).toBe(true)
    expect(r.bullish).not.toBeNull()
    const d = r.bullish!
    expect(d.kind).toBe("bullish")
    expect(d.basis).toBe("rsi")
    expect(d.pivotIndex).toBe(42)
    expect(d.confirmedAtIndex).toBe(42 + CONFIRMATION_SESSIONS)
    expect(d.confirmedAtSession).toBe(bullRows[d.confirmedAtIndex].ts)
    const expectStrength = Math.round(handStrength(bullCloses, 19, 42, true) * 1000) / 1000
    expect(Math.abs(d.strength - expectStrength)).toBeLessThan(0.02)
    expect(r.bearish).toBeNull()
  })

  it("bearish: higher price high + lower RSI high (mirror fixture)", () => {
    const r = detectDivergence(bearRows)
    expect(r.available).toBe(true)
    expect(r.bearish).not.toBeNull()
    const d = r.bearish!
    expect(d.kind).toBe("bearish")
    expect(d.basis).toBe("rsi")
    expect(d.pivotIndex).toBe(42)
    const expectStrength = Math.round(handStrength(bearCloses, 19, 42, false) * 1000) / 1000
    expect(Math.abs(d.strength - expectStrength)).toBeLessThan(0.02)
    expect(r.bullish).toBeNull()
  })

  it("zero lookahead: nothing is reported before pivotIndex + K, even though the pivot bar is already visible", () => {
    for (let t = 0; t <= 42 + CONFIRMATION_SESSIONS - 1; t++) {
      const r = detectDivergence(bullRows.slice(0, t + 1))
      expect(r.bullish ?? null).toBeNull()
    }
  })

  it("prefix purity: the declared divergence is IDENTICAL on every later prefix until it expires", () => {
    const declared = detectDivergence(bullRows).bullish!
    const first = detectDivergence(bullRows.slice(0, declared.confirmedAtIndex + 1)).bullish!
    expect(first).toEqual(declared)
    for (let t = declared.confirmedAtIndex + 1; t < bullRows.length; t++) {
      const r = detectDivergence(bullRows.slice(0, t + 1)).bullish!
      expect(r.kind).toBe(declared.kind)
      expect(r.basis).toBe(declared.basis)
      expect(r.pivotIndex).toBe(declared.pivotIndex)
      expect(r.strength).toBe(declared.strength)
    }
  })

  it("evidence expires after ACTIVE_SESSIONS: a stale divergence is dropped", () => {
    // prefix ending exactly at confirmation + ACTIVE_SESSIONS (expired on the strict bound)
    const declared = detectDivergence(bullRows).bullish!
    const lastActive = declared.confirmedAtIndex + ACTIVE_SESSIONS - 1
    expect(detectDivergence(bullRows.slice(0, lastActive + 1)).bullish).not.toBeNull()
    // append enough fresh post-declaration bars so the window slides past expiry:
    // the newest passing pair is still (19,42) — once expiry passes, null.
    const longTail = [...bullCloses]
    let p = bullCloses[bullCloses.length - 1]
    for (let i = 0; i < 12; i++) { p *= 1.012; longTail.push(Math.round(p * 100) / 100) }
    const r = detectDivergence(mkRows(longTail))
    expect(r.bullish).toBeNull()
  })

  it("abstains on thin data (< 30 sessions)", () => {
    const r = detectDivergence(bullRows.slice(0, 29))
    expect(r.available).toBe(false)
    expect(r.bullish).toBeNull()
    expect(r.bearish).toBeNull()
    expect(r.reason).toBeTruthy()
  })
})

describe("divergence — constant sanity", () => {
  it("K = 3 equals the fractal wing (declaration = window close, documented)", () => {
    expect(CONFIRMATION_SESSIONS).toBe(PIVOT_WING)
    expect(ACTIVE_SESSIONS).toBe(10)
  })
})
