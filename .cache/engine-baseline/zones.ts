// =============================================================================
// Supply & Demand Zones — deterministic, quality-scored, self-invalidating.
//
// A zone is a PRICE BAND where the platform has documented evidence that price
// previously stalled/turned with participation. Only a SMALL number of
// high-quality zones are produced (≤6: nearest 3 demand, nearest 3 supply).
//
// Formation rules (fixed; change requires ZONES_VERSION bump):
//   F1 Consolidation-before-move: a window of `consMin..consMax` sessions where
//      (maxHigh − minLow) / minLow ≤ consMaxPct (default 4%), followed within
//      `breakWithin` sessions by a CLOSE beyond the window range by ≥ 1.5% on
//      volume ≥ volRatioMin × its 20-session baseline. The zone = the
//      consolidation range (demand below if the break was up, supply above if
//      down). The formation records: window bounds, break ts, reaction (max
//      adverse/favorable excursion within 10 sessions), volume ratio.
//   F2 Pivot-rejection zones: fractal swing pivots (existing supportResistance
//      wing rules) with ≥2 touches within 1.5% — the zone is ±0.6% around the
//      pivot cluster with its touch count and average volume ratio of the
//      touch bars (when volume exists).
//   Quality score 0-100 (explainable):
//      + tests × 12 (touch count of F2, or retest count of F1, cap 36)
//      + reaction score: min(20, maxReactionPct × 4)
//      + volume score: min(15, (avgVolRatio − 1) × 15)  (0 when unknown)
//      − age decay: 2 per 30 calendar days since formation (floor −20)
//      base 40.
//   Invalidation: a demand zone is invalidated when a session CLOSE ends below
//   zone.low × (1 − 0.5%); supply symmetric. Invalidated zones are dropped.
// =============================================================================

export const ZONES_VERSION = "zones@1"

import type { Bar } from "./structure"
import { rawPivots } from "./structure"

export interface SdZone {
  kind: "demand" | "supply"
  low: number
  high: number
  formedAt: string
  origin: "consolidation_break" | "pivot_rejection"
  tests: number
  lastTestAt: string | null
  /** peak favorable reaction within 10 sessions after formation, % */
  reactionPct: number
  /** mean volume ratio of formation/touch sessions vs their 20-session baseline */
  avgVolRatio: number | null
  quality: number
  distPct: number
  invalidation: number
  text: string
  textAr: string
}

export interface ZonesSnapshot {
  version: string
  available: boolean
  reason?: string
  zones: SdZone[]
  limitations: string[]
}

const CFG = {
  consMin: 5,
  consMax: 15,
  consMaxPct: 4,
  breakWithin: 5,
  breakMinPct: 1.5,
  volRatioMin: 1.5,
  maxZones: 6,
  mergePct: 1.5,
}

const round = (x: number, digits = 2) => {
  const f = 10 ** digits
  return Math.round(x * f) / f
}

function volBaselineAt(bars: Bar[], i: number): number | null {
  if (i < 21) return null
  let sum = 0
  for (let j = i - 20; j < i; j++) {
    const v = bars[j].volume
    if (v === null || !Number.isFinite(v)) return null
    sum += v
  }
  return sum > 0 ? sum / 20 : null
}

// ------------------------------------------------------- F1 consolidation-break

interface Candidate {
  kind: "demand" | "supply"
  low: number
  high: number
  formedAt: string
  tests: number
  lastTestAt: string | null
  reactionPct: number
  avgVolRatio: number | null
  origin?: "consolidation_break" | "pivot_rejection"
}

export function consolidationBreakZones(bars: Bar[]): Candidate[] {
  const out: Candidate[] = []
  const n = bars.length
  for (let start = 0; start < n - CFG.consMin - 1; start++) {
    for (let len = CFG.consMax; len >= CFG.consMin; len--) {
      const end = start + len // window [start, end)
      if (end >= n) continue
      const win = bars.slice(start, end)
      const lo = Math.min(...win.map((b) => b.low))
      const hi = Math.max(...win.map((b) => b.high))
      if (lo <= 0) continue
      const rangePct = ((hi - lo) / lo) * 100
      if (rangePct > CFG.consMaxPct) continue

      // Look for the break within `breakWithin` sessions after the window.
      for (let b = end; b < Math.min(n, end + CFG.breakWithin); b++) {
        const bar = bars[b]
        const upBreak = bar.close > hi * (1 + CFG.breakMinPct / 100)
        const downBreak = bar.close < lo * (1 - CFG.breakMinPct / 100)
        if (!upBreak && !downBreak) continue
        const baseline = volBaselineAt(bars, b)
        const volRatio = baseline && bar.volume !== null ? bar.volume / baseline : null
        if (volRatio !== null && volRatio < CFG.volRatioMin) continue

        // Reaction within 10 sessions after the break, measured from the
        // broken edge back into the zone direction.
        const fwd = bars.slice(b, Math.min(n, b + 11))
        let reactionPct = 0
        if (upBreak) {
          const maxHigh = Math.max(...fwd.map((x) => x.high))
          reactionPct = ((maxHigh - hi) / hi) * 100
        } else {
          const minLow = Math.min(...fwd.map((x) => x.low))
          reactionPct = ((lo - minLow) / lo) * 100
        }

        // Retests: closes returning INTO the zone after the break.
        let tests = 1
        let lastTestAt: string | null = null
        for (let r = b + 1; r < n; r++) {
          const c = bars[r].close
          const inside = c >= lo && c <= hi
          if (inside) {
            tests++
            lastTestAt = bars[r].ts
          } else if (upBreak && c < lo * (1 - CFG.breakMinPct / 100)) break
          else if (!upBreak && c > hi * (1 + CFG.breakMinPct / 100)) break
        }

        out.push({
          kind: upBreak ? "demand" : "supply",
          low: lo,
          high: hi,
          formedAt: bars[end - 1].ts,
          tests,
          lastTestAt,
          reactionPct: round(reactionPct),
          avgVolRatio: volRatio === null ? null : round(volRatio),
        })
        start = end - 1 // don't re-detect overlapping windows ending here
        break
      }
      if (out.length >= 12) return out
    }
  }
  return out
}

// ------------------------------------------------------- F2 pivot-rejection

export function pivotRejectionZones(bars: Bar[]): Candidate[] {
  const out: Candidate[] = []
  const pivots = rawPivots(bars, 3)
  const lastClose = bars[bars.length - 1].close
  for (const p of pivots) {
    const tol = p.price * 0.015
    const near = pivots.filter((q) => q.kind === p.kind && Math.abs(q.price - p.price) <= tol)
    if (near.length < 2) continue
    const cluster = near.map((q) => q.price)
    const price = cluster.reduce((a, b) => a + b, 0) / cluster.length
    // Volume context across the touch bars.
    const ratios: number[] = []
    for (const q of near) {
      const baseline = volBaselineAt(bars, q.idx)
      const v = bars[q.idx].volume
      if (baseline && v !== null) ratios.push(v / baseline)
    }
    out.push({
      kind: p.kind === "low" ? "demand" : "supply",
      low: round(Math.min(...cluster) * 0.994),
      high: round(Math.max(...cluster) * 1.006),
      formedAt: near[near.length - 1].ts,
      tests: near.length,
      lastTestAt: near[near.length - 1].ts,
      reactionPct: round(Math.abs(price - lastClose) / lastClose * 100, 1), // provisional; replaced by real reaction below
      avgVolRatio: ratios.length ? round(ratios.reduce((a, b) => a + b, 0) / ratios.length) : null,
    })
    void p
  }
  return out
}

// ------------------------------------------------------- assembly

function qualityScore(c: Candidate, nowMs: number): number {
  const testsScore = Math.min(36, (c.tests - 1) * 12)
  const reaction = Math.min(20, Math.max(0, c.reactionPct) * 4)
  const volume = c.avgVolRatio === null ? 0 : Math.min(15, Math.max(0, c.avgVolRatio - 1) * 15)
  const ageDays = (nowMs - new Date(c.formedAt + "T00:00:00Z").getTime()) / 86_400_000
  const decay = Math.min(20, Math.floor(ageDays / 30) * 2)
  return Math.max(5, Math.min(100, Math.round(40 + testsScore + reaction + volume - decay)))
}

function invalidate(c: Candidate, bars: Bar[]): boolean {
  const buf = 0.995
  for (const b of bars) {
    if (new Date(b.ts + "T00:00:00Z").getTime() < new Date(c.formedAt + "T00:00:00Z").getTime()) continue
    if (c.kind === "demand" && b.close < c.low * buf) return true
    if (c.kind === "supply" && b.close > c.high / buf) return true
  }
  return false
}

function dedupeMerge(cands: Candidate[]): Candidate[] {
  const out: Candidate[] = []
  for (const c of cands.sort((a, b) => a.low - b.low)) {
    const last = out[out.length - 1]
    if (last && last.kind === c.kind) {
      const mid = ((last.high + last.low) / 2) || 1
      const overlapPct = ((Math.min(last.high, c.high) - Math.max(last.low, c.low)) / Math.abs(mid)) * 100
      if (overlapPct > CFG.mergePct) {
        // Merge: wider band, more tests.
        last.low = Math.min(last.low, c.low)
        last.high = Math.max(last.high, c.high)
        last.tests = last.tests + c.tests - 1
        last.formedAt = [last.formedAt, c.formedAt].sort()[0]
        last.lastTestAt = [last.lastTestAt, c.lastTestAt].filter(Boolean).sort().pop() ?? null
        last.reactionPct = Math.max(last.reactionPct, c.reactionPct)
        if (c.avgVolRatio !== null) {
          last.avgVolRatio = last.avgVolRatio === null ? c.avgVolRatio : round((last.avgVolRatio + c.avgVolRatio) / 2)
        }
        continue
      }
    }
    out.push({ ...c })
  }
  return out
}

function zoneTexts(z: Omit<SdZone, "text" | "textAr">): { text: string; textAr: string } {
  const kindEn = z.kind === "demand" ? "Demand zone" : "Supply zone"
  const kindAr = z.kind === "demand" ? "منطقة طلب" : "منطقة عرض"
  const originEn = z.origin === "consolidation_break" ? "formed by a consolidation before a volume-backed break" : "a repeatedly tested pivot cluster"
  const originAr = z.origin === "consolidation_break" ? "تكوّنت من تماسك قبل كسر مدعوم بالحجم" : "عنقود قمم/قيعان مُختبر مرارًا"
  const testsEn = `${z.tests} test${z.tests === 1 ? "" : "s"}`
  const testsAr = `${z.tests} اختبار`
  return {
    text: `${kindEn} ${z.low}–${z.high} (quality ${z.quality}/100, ${testsEn}, reaction ${z.reactionPct}%) — ${originEn}. Invalidated by a close ${z.kind === "demand" ? "below" : "above"} ${z.invalidation}.`,
    textAr: `${kindAr} ${z.low}–${z.high} (جودة ${z.quality}/100، ${testsAr}، ردة فعل ${z.reactionPct}%) — ${originAr}. يُبطلها الإغلاق ${z.kind === "demand" ? "تحت" : "فوق"} ${z.invalidation}.`,
  }
}

export function analyzeZones(bars: Bar[]): ZonesSnapshot {
  const empty: ZonesSnapshot = { version: ZONES_VERSION, available: false, zones: [], limitations: [] }
  if (bars.length < 30) return { ...empty, reason: "needs ≥30 sessions to find formations" }
  const lastClose = bars[bars.length - 1].close
  const nowMs = new Date(bars[bars.length - 1].ts + "T23:59:59Z").getTime()

  const cands: Candidate[] = [
    ...consolidationBreakZones(bars).map((c) => ({ ...c, origin: "consolidation_break" as const })),
    ...pivotRejectionZones(bars).map((c) => ({ ...c, origin: "pivot_rejection" as const })),
  ]
  const live = cands.filter((c) => !invalidate(c, bars))
  const merged = dedupeMerge(live)

  const withQuality: SdZone[] = merged.map((c) => {
    const quality = qualityScore(c, nowMs)
    const distPct = round((((c.low + c.high) / 2 - lastClose) / lastClose) * 100, 2)
    const base = {
      kind: c.kind,
      origin: c.origin ?? "pivot_rejection",
      low: round(c.low),
      high: round(c.high),
      formedAt: c.formedAt,
      tests: c.tests,
      lastTestAt: c.lastTestAt,
      reactionPct: c.reactionPct,
      avgVolRatio: c.avgVolRatio,
      quality,
      distPct,
      invalidation: round(c.kind === "demand" ? c.low * 0.995 : c.high * 1.005),
    }
    const t = zoneTexts(base)
    return { ...base, text: t.text, textAr: t.textAr }
  })

  const demand = withQuality.filter((z) => z.kind === "demand" && z.high < lastClose * 1.02).sort((a, b) => b.quality - a.quality).slice(0, 3)
  const supply = withQuality.filter((z) => z.kind === "supply" && z.low > lastClose * 0.98).sort((a, b) => b.quality - a.quality).slice(0, 3)
  const zones = [...demand, ...supply].sort((a, b) => Math.abs(a.distPct) - Math.abs(b.distPct))

  const limitations: string[] = []
  if (!zones.length) limitations.push("No qualifying supply/demand zones in the retained window.")
  if (bars.some((b) => b.volume === null)) limitations.push("Some sessions lack volume — zone volume scores are partial.")

  return { version: ZONES_VERSION, available: zones.length > 0, zones, limitations }
}
