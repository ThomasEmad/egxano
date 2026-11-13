// =============================================================================
// Whole-market intelligence — types + pure computation.
//
// PRINCIPLES (enforced by construction):
//  - Every figure is computed from real inputs (scanner snapshot, PriceBar
//    volume history, stored daily intelligence rows, daily enrichment job).
//  - Coverage is disclosed (volumeCoveragePct, tradedValueCoverage, enrichment
//    asOf). Missing inputs produce `null` fields + limitation strings — never
//    fabricated numbers.
//  - Turnover language is "share of traded value" / "activity rotation" —
//    NEVER net inflow/outflow (every trade has both a buyer and a seller).
//  - The regime classification always carries its evidence (actual numbers).
// =============================================================================

import { z } from "zod"

export const MI_VERSION = "mi@1"
export const MI_SETTING_KEY = "market_intelligence_snapshot_v1"
export const ENRICHMENT_SETTING_KEY = "market_enrichment_v1"

// ---------------------------------------------------------------- input types

export interface MoverInput {
  ticker: string
  name: string
  nameAr: string | null
  sector: string
  price: number
  changePct: number
  volume: number | null
  cap: number | null
}

export interface VolumeBaseline {
  avg20: number | null
  avg60: number | null
  sessions: number
}

export interface HistoryDay {
  day: string
  advancing: number
  declining: number
  unchanged: number
  regime: string | null
  pulse: number | null
  tradedValueEgp: number | null
  /** sector → traded value share % (null when volume coverage was insufficient) */
  turnoverShares: Record<string, number> | null
}

export interface EnrichmentBlock {
  asOf: string
  pctAboveSma20: number | null
  pctAboveSma50: number | null
  pctAboveSma200: number | null
  /** EMA-breadth twins of the SMA aggregates — optional because stored blocks
   *  written before this field existed simply lack the keys (read as null). */
  pctAboveEma20?: number | null
  pctAboveEma50?: number | null
  pctAboveEma200?: number | null
  new52wHighs: number | null
  new52wLows: number | null
  universe: number
}

export interface IntelInput {
  now: string
  day: string
  delayMinutes: number
  movers: MoverInput[]
  /** ticker → 20/60-session volume baseline from PriceBar (excludes today) */
  baselines: Record<string, VolumeBaseline>
  /** stored MarketIntelligenceDay rows, ascending by day, last ≤60 */
  history: HistoryDay[]
  /** daily enrichment job output (true 52w / SMA200 flags); null until it runs */
  enrichment: EnrichmentBlock | null
}

// ---------------------------------------------------------------- output types

export interface AnomalyItem {
  ticker: string
  name: string
  nameAr: string | null
  sector: string
  kind: "volume_spike" | "price_without_volume" | "volume_without_price" | "activity_after_quiet"
  relVol: number | null
  dayChangePct: number
  detail: string
  detailAr: string
}

export interface RadarItem {
  ticker: string
  name: string
  nameAr: string | null
  sector: string
  dayChangePct: number
  relVol: number | null
  code: string
  detail: string
  detailAr: string
}

export interface SectorRotationRow {
  sector: string
  companies: number
  advancing: number
  declining: number
  dayChangePct: number | null
  capWeightedChangePct: number | null
  turnoverSharePct: number | null
  turnoverShareDelta5d: number | null
  medianRelVol: number | null
  tradedValueEgp: number | null
}

export interface RegimeOutput {
  code:
    | "strong_uptrend"
    | "weak_uptrend"
    | "sideways"
    | "weak_downtrend"
    | "strong_downtrend"
    | "narrow_leadership"
    | "broad_participation"
    | null
  label: string
  labelAr: string
  evidence: string[]
  changedFrom: string | null
}

export interface PulseDimension {
  key: string
  label: string
  labelAr: string
  earned: number
  max: number
  reason: string
}

export interface MarketIntelligence {
  version: string
  asOf: string
  day: string
  delayMinutes: number
  universe: { tracked: number; priced: number; volumeCovered: number; volumeCoveragePct: number }
  breadth: {
    advancing: number
    declining: number
    unchanged: number
    ratio: number | null
    tradedValueEgp: number | null
    tradedValueCoverage: number
    pctAboveSma20: number | null
    pctAboveSma50: number | null
    pctAboveSma200: number | null
    pctAboveEma20: number | null
    pctAboveEma50: number | null
    pctAboveEma200: number | null
    new52wHighs: number | null
    new52wLows: number | null
    new52wWindowDays: number | null
    adLine: { day: string; value: number }[]
    adLineNote: string
  }
  regime: RegimeOutput
  pulse: { score: number; labelAr: string; dimensions: PulseDimension[] }
  concentration: {
    top5TurnoverSharePct: number | null
    top10TurnoverSharePct: number | null
    herfindahl: number | null
    note: string
  }
  rotation: {
    sectors: SectorRotationRow[]
    gaining: string[]
    losing: string[]
    note: string
  }
  anomalies: AnomalyItem[]
  /** ticker → relative volume vs 20-session baseline (rounded) — enables
   * per-company context injection and market-relative liquidity rank. */
  relVolByTicker: Record<string, number>
  radars: {
    opportunities: RadarItem[]
    risks: RadarItem[]
    note: string
  }
  enrichment: EnrichmentBlock | null
  limitations: string[]
}

// ---------------------------------------------------------------- validation

export const marketIntelligenceSchema = z.object({
  version: z.string(),
  asOf: z.string(),
  day: z.string(),
  delayMinutes: z.number(),
  universe: z.object({ tracked: z.number(), priced: z.number(), volumeCovered: z.number(), volumeCoveragePct: z.number() }),
  breadth: z.object({
    advancing: z.number(),
    declining: z.number(),
    unchanged: z.number(),
    ratio: z.number().nullable(),
    tradedValueEgp: z.number().nullable(),
    tradedValueCoverage: z.number(),
    pctAboveSma20: z.number().nullable(),
    pctAboveSma50: z.number().nullable(),
    pctAboveSma200: z.number().nullable(),
    // EMA breadth twins — optional so intelligence snapshots persisted before
    // these fields existed still validate (they read back as undefined and are
    // normalized to null in getIntelligence).
    pctAboveEma20: z.number().nullable().optional(),
    pctAboveEma50: z.number().nullable().optional(),
    pctAboveEma200: z.number().nullable().optional(),
    new52wHighs: z.number().nullable(),
    new52wLows: z.number().nullable(),
    new52wWindowDays: z.number().nullable(),
    adLine: z.array(z.object({ day: z.string(), value: z.number() })),
    adLineNote: z.string(),
  }),
  regime: z.object({ code: z.string().nullable(), label: z.string(), labelAr: z.string(), evidence: z.array(z.string()), changedFrom: z.string().nullable() }),
  pulse: z.object({ score: z.number(), labelAr: z.string(), dimensions: z.array(z.object({ key: z.string(), label: z.string(), labelAr: z.string(), earned: z.number(), max: z.number(), reason: z.string() })) }),
  concentration: z.object({ top5TurnoverSharePct: z.number().nullable(), top10TurnoverSharePct: z.number().nullable(), herfindahl: z.number().nullable(), note: z.string() }),
  rotation: z.object({
    sectors: z.array(
      z.object({
        sector: z.string(),
        companies: z.number(),
        advancing: z.number(),
        declining: z.number(),
        dayChangePct: z.number().nullable(),
        capWeightedChangePct: z.number().nullable(),
        turnoverSharePct: z.number().nullable(),
        turnoverShareDelta5d: z.number().nullable(),
        medianRelVol: z.number().nullable(),
        tradedValueEgp: z.number().nullable(),
      }),
    ),
    gaining: z.array(z.string()),
    losing: z.array(z.string()),
    note: z.string(),
  }),
  anomalies: z.array(
    z.object({
      ticker: z.string(),
      name: z.string(),
      nameAr: z.string().nullable(),
      sector: z.string(),
      kind: z.string(),
      relVol: z.number().nullable(),
      dayChangePct: z.number(),
      detail: z.string(),
      detailAr: z.string(),
    }),
  ),
  relVolByTicker: z.record(z.string(), z.number()),
  radars: z.object({
    opportunities: z.array(
      z.object({
        ticker: z.string(),
        name: z.string(),
        nameAr: z.string().nullable(),
        sector: z.string(),
        dayChangePct: z.number(),
        relVol: z.number().nullable(),
        code: z.string(),
        detail: z.string(),
        detailAr: z.string(),
      }),
    ),
    risks: z.array(
      z.object({
        ticker: z.string(),
        name: z.string(),
        nameAr: z.string().nullable(),
        sector: z.string(),
        dayChangePct: z.number(),
        relVol: z.number().nullable(),
        code: z.string(),
        detail: z.string(),
        detailAr: z.string(),
      }),
    ),
    note: z.string(),
  }),
  enrichment: z
    .object({
      asOf: z.string(),
      pctAboveSma20: z.number().nullable(),
      pctAboveSma50: z.number().nullable(),
      pctAboveSma200: z.number().nullable(),
      pctAboveEma20: z.number().nullable().optional(),
      pctAboveEma50: z.number().nullable().optional(),
      pctAboveEma200: z.number().nullable().optional(),
      new52wHighs: z.number().nullable(),
      new52wLows: z.number().nullable(),
      universe: z.number(),
    })
    .nullable(),
  limitations: z.array(z.string()),
})

// ---------------------------------------------------------------- helpers

const r2 = (x: number, d = 2) => {
  const f = 10 ** d
  return Math.round(x * f) / f
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

const REGIME_AR: Record<string, string> = {
  strong_uptrend: "اتجاه صاعد قوي",
  weak_uptrend: "اتجاه صاعد ضعيف",
  sideways: "سوق عرضي / تجميع",
  weak_downtrend: "اتجاه هابط ضعيف",
  strong_downtrend: "اتجاه هابط قوي",
  narrow_leadership: "قيادة ضيقة — الصعود محصور في عدد قليل من الأسهم",
  broad_participation: "مشاركة واسعة",
}

// ---------------------------------------------------------------- compute

export function computeIntelligence(input: IntelInput): MarketIntelligence {
  const limitations: string[] = []
  const { movers } = input
  const priced = movers.length

  // ---------- universe + breadth counters ----------
  const advancing = movers.filter((m) => m.changePct > 0.01).length
  const declining = movers.filter((m) => m.changePct < -0.01).length
  const unchanged = priced - advancing - declining
  const ratio = declining > 0 ? r2(advancing / declining) : null

  // ---------- traded value (coverage-gated) ----------
  let tradedValue = 0
  let volumeCovered = 0
  for (const m of movers) {
    if (m.volume !== null && m.volume > 0) {
      volumeCovered++
      tradedValue += m.volume * m.price
    }
  }
  const volumeCoveragePct = priced ? r2((volumeCovered / priced) * 100, 1) : 0
  const tradedValueEgp = volumeCovered >= priced * 0.5 ? Math.round(tradedValue) : null
  if (volumeCovered < priced * 0.5) {
    limitations.push(`Only ${volumeCovered}/${priced} priced companies carry session volume — aggregate traded value withheld (would be misleading).`)
  }

  // ---------- relative volume per mover ----------
  const relVolOf = (t: string): number | null => {
    const b = input.baselines[t]
    const m = movers.find((x) => x.ticker === t)
    if (!b?.avg20 || !m?.volume) return null
    return r2(m.volume / b.avg20)
  }

  // ---------- concentration (turnover shares) ----------
  let top5: number | null = null
  let top10: number | null = null
  let hhi: number | null = null
  if (tradedValueEgp !== null && tradedValue > 0) {
    const sorted = [...movers].filter((m) => m.volume).map((m) => m.volume! * m.price).sort((a, b) => b - a)
    const sum = sorted.reduce((a, b) => a + b, 0)
    top5 = r2((sorted.slice(0, 5).reduce((a, b) => a + b, 0) / sum) * 100, 1)
    top10 = r2((sorted.slice(0, 10).reduce((a, b) => a + b, 0) / sum) * 100, 1)
    hhi = r2(sorted.reduce((s, v) => s + (v / sum) ** 2, 0) * 10000, 1)
  }

  // ---------- sector rotation ----------
  const bySector = new Map<string, MoverInput[]>()
  for (const m of movers) {
    const arr = bySector.get(m.sector) ?? []
    arr.push(m)
    bySector.set(m.sector, arr)
  }
  const todayShares: Record<string, number> = {}
  if (tradedValueEgp !== null && tradedValue > 0) {
    for (const [sector, list] of bySector) {
      const v = list.filter((m) => m.volume).reduce((s, m) => s + m.volume! * m.price, 0)
      if (v > 0) todayShares[sector] = r2((v / tradedValue) * 100, 2)
    }
  }
  const fiveBack = input.history.length >= 6 ? input.history[input.history.length - 6] : null

  const sectors: SectorRotationRow[] = [...bySector.entries()]
    .map(([sector, list]) => {
      const capSum = list.filter((m) => m.cap).reduce((s, m) => s + (m.cap ?? 0), 0)
      const capWeightedChangePct =
        capSum > 0 ? r2(list.filter((m) => m.cap).reduce((s, m) => s + m.changePct * (m.cap ?? 0), 0) / capSum) : null
      const rvs = list.map((m) => relVolOf(m.ticker)).filter((v): v is number => v !== null).sort((a, b) => a - b)
      return {
        sector,
        companies: list.length,
        advancing: list.filter((m) => m.changePct > 0.01).length,
        declining: list.filter((m) => m.changePct < -0.01).length,
        dayChangePct: list.length ? r2(list.reduce((s, m) => s + m.changePct, 0) / list.length) : null,
        capWeightedChangePct,
        turnoverSharePct: todayShares[sector] ?? null,
        turnoverShareDelta5d:
          todayShares[sector] !== undefined && fiveBack?.turnoverShares?.[sector] !== undefined
            ? r2(todayShares[sector] - fiveBack.turnoverShares[sector])
            : null,
        medianRelVol: median(rvs),
        tradedValueEgp: tradedValueEgp !== null ? Math.round(list.filter((m) => m.volume).reduce((s, m) => s + m.volume! * m.price, 0)) : null,
      }
    })
    .sort((a, b) => (b.turnoverSharePct ?? -1) - (a.turnoverSharePct ?? -1))

  const gaining = sectors.filter((s) => (s.turnoverShareDelta5d ?? 0) > 1.5).map((s) => s.sector)
  const losing = sectors.filter((s) => (s.turnoverShareDelta5d ?? 0) < -1.5).map((s) => s.sector)
  const rotationNote =
    input.history.length >= 6
      ? "Sector turnover-share deltas compare today's share of traded value with the stored day 5 sessions back."
      : `Rotation deltas need ≥6 stored daily snapshots (${input.history.length} stored so far) — they appear as history accrues.`

  // ---------- anomalies ----------
  const anomalies: AnomalyItem[] = []
  for (const m of movers) {
    const rv = relVolOf(m.ticker)
    if (rv === null) continue
    const quiet = (input.baselines[m.ticker]?.avg20 ?? 0) < 5000
    if (quiet && rv >= 3) {
      // Most specific first: a structurally quiet name suddenly trading heavy.
      anomalies.push({
        ticker: m.ticker, name: m.name, nameAr: m.nameAr, sector: m.sector, kind: "activity_after_quiet",
        relVol: rv, dayChangePct: r2(m.changePct),
        detail: `Sudden activity after prolonged quiet: ${rv}× its thin 20-session baseline (<5,000 shares/day).`,
        detailAr: `نشاط مفاجئ بعد هدوء طويل: ${rv} ضعف متوسطه الضعيف (أقل من 5,000 سهم/يوم).`,
      })
    } else if (rv >= 2) {
      if (Math.abs(m.changePct) <= 0.5) {
        anomalies.push({
          ticker: m.ticker, name: m.name, nameAr: m.nameAr, sector: m.sector, kind: "volume_without_price",
          relVol: rv, dayChangePct: r2(m.changePct),
          detail: `Volume ran at ${rv}× its 20-session baseline while the price moved only ${r2(m.changePct)}% — heavy two-sided activity near a level (effort without direction).`,
          detailAr: `حجم التداول ${rv} ضعف متوسط 20 جلسة بينما تحرك السعر ${r2(m.changePct)}% فقط — نشاط ثنائي الاتجاه كثيف عند مستوى معين (جهد بلا اتجاه).`,
        })
      } else {
        anomalies.push({
          ticker: m.ticker, name: m.name, nameAr: m.nameAr, sector: m.sector, kind: "volume_spike",
          relVol: rv, dayChangePct: r2(m.changePct),
          detail: `Volume spike: ${rv}× the 20-session baseline with a ${r2(m.changePct)}% move — participation confirmed the move.`,
          detailAr: `اندفاع حجم: ${rv} ضعف متوسط 20 جلسة مع حركة ${r2(m.changePct)}% — المشاركة أكدت الحركة.`,
        })
      }
    } else if (Math.abs(m.changePct) >= 3 && rv <= 0.6) {
      anomalies.push({
        ticker: m.ticker, name: m.name, nameAr: m.nameAr, sector: m.sector, kind: "price_without_volume",
        relVol: rv, dayChangePct: r2(m.changePct),
        detail: `A ${r2(m.changePct)}% move on only ${rv}× baseline volume — the price moved without participation; treat with caution.`,
        detailAr: `حركة ${r2(m.changePct)}% بحجم ${rv} ضعف المتوسط فقط — السعر تحرك بلا مشاركة؛ يُعامل بحذر.`,
      })
    }
  }
  anomalies.sort((a, b) => (b.relVol ?? 0) - (a.relVol ?? 0))

  // Per-ticker relative volume map (for per-company context injection).
  const relVolByTicker: Record<string, number> = {}
  for (const m of movers) {
    const rv = relVolOf(m.ticker)
    if (rv !== null) relVolByTicker[m.ticker] = rv
  }

  // ---------- A/D line from stored history ----------
  const adLine: { day: string; value: number }[] = []
  let cum = 0
  for (const h of input.history) {
    cum += h.advancing - h.declining
    adLine.push({ day: h.day, value: cum })
  }
  if (input.history.length === 0) {
    limitations.push("The A/D line starts accumulating from today's stored snapshot — no retroactive history exists.")
  }
  cum += advancing - declining
  adLine.push({ day: input.day, value: cum })
  const adLineNote = `Cumulative (advancers − decliners) across ${adLine.length} stored session(s).`

  // ---------- regime (evidence-based) ----------
  const capWeightedMarket = (() => {
    const withCap = movers.filter((m) => m.cap)
    const cap = withCap.reduce((s, m) => s + (m.cap ?? 0), 0)
    return cap > 0 ? r2(withCap.reduce((s, m) => s + m.changePct * (m.cap ?? 0), 0) / cap) : null
  })()
  const pctAbove20 = input.enrichment?.pctAboveSma20 ?? null
  const pctAbove50 = input.enrichment?.pctAboveSma50 ?? null
  const nh = input.enrichment?.new52wHighs ?? null
  const nl = input.enrichment?.new52wLows ?? null
  const narrowLeadership = top5 !== null && top5 >= 55 && ratio !== null && ratio < 1
  const regime = classifyRegime({ capWeightedMarket, ratio, pctAbove20, pctAbove50, nh, nl, narrowLeadership })
  const prevDay = input.history[input.history.length - 1] ?? null
  regime.changedFrom = prevDay?.regime && prevDay.regime !== regime.code ? prevDay.regime : null

  // ---------- pulse (explainable 0-100) ----------
  const pulse = computePulse({
    capWeightedMarket, ratio, pctAbove20, pctAbove50, nh, nl, top5,
    tradedValueEgp, tradedValuePrev: prevDay?.tradedValueEgp ?? null,
  })

  // ---------- radars (deterministic, explanation-carrying) ----------
  const opportunities: RadarItem[] = []
  const risks: RadarItem[] = []
  for (const m of movers) {
    const rv = relVolOf(m.ticker)
    if (rv !== null && rv >= 1.5 && m.changePct >= 3) {
      opportunities.push({
        ticker: m.ticker, name: m.name, nameAr: m.nameAr, sector: m.sector, dayChangePct: r2(m.changePct), relVol: rv,
        code: "volume_backed_advance",
        detail: `+${r2(m.changePct)}% on ${rv}× baseline volume — price and participation agree. Investigate structure before acting.`,
        detailAr: `+${r2(m.changePct)}% بحجم ${rv} ضعف المتوسط — السعر والمشاركة متفقان. افحص الهيكل قبل أي قرار.`,
      })
    }
    if (rv !== null && rv >= 1.5 && m.changePct <= -3) {
      risks.push({
        ticker: m.ticker, name: m.name, nameAr: m.nameAr, sector: m.sector, dayChangePct: r2(m.changePct), relVol: rv,
        code: "volume_backed_decline",
        detail: `${r2(m.changePct)}% on ${rv}× baseline volume — real selling participation, not a thin drift.`,
        detailAr: `${r2(m.changePct)}% بحجم ${rv} ضعف المتوسط — بيع بمشاركة فعلية وليس انزلاقًا ضعيفًا.`,
      })
    }
  }
  opportunities.sort((a, b) => (b.relVol ?? 0) - (a.relVol ?? 0))
  risks.sort((a, b) => a.dayChangePct - b.dayChangePct)

  return {
    version: MI_VERSION,
    asOf: input.now,
    day: input.day,
    delayMinutes: input.delayMinutes,
    universe: { tracked: movers.length, priced, volumeCovered, volumeCoveragePct },
    breadth: {
      advancing, declining, unchanged, ratio,
      tradedValueEgp, tradedValueCoverage: volumeCoveragePct,
      pctAboveSma20: pctAbove20, pctAboveSma50: pctAbove50, pctAboveSma200: input.enrichment?.pctAboveSma200 ?? null,
      pctAboveEma20: input.enrichment?.pctAboveEma20 ?? null,
      pctAboveEma50: input.enrichment?.pctAboveEma50 ?? null,
      pctAboveEma200: input.enrichment?.pctAboveEma200 ?? null,
      new52wHighs: nh, new52wLows: nl,
      new52wWindowDays: input.enrichment ? 252 : null,
      adLine, adLineNote,
    },
    regime,
    pulse,
    concentration: {
      top5TurnoverSharePct: top5, top10TurnoverSharePct: top10, herfindahl: hhi,
      note: top5 === null ? "Concentration metrics need session volume on ≥50% of priced companies." : `Top-5 companies carry ${top5}% of today's traded value (HHI ${hhi}).`,
    },
    rotation: { sectors, gaining, losing, note: rotationNote },
    anomalies: anomalies.slice(0, 12),
    relVolByTicker,
    radars: { opportunities: opportunities.slice(0, 10), risks: risks.slice(0, 10), note: "Radar entries are deterministic screens (price + participation). They are investigation leads, not signals." },
    enrichment: input.enrichment,
    limitations,
  }
}

// ---------------------------------------------------------------- regime

export interface RegimeFacts {
  capWeightedMarket: number | null
  ratio: number | null
  pctAbove20: number | null
  pctAbove50: number | null
  nh: number | null
  nl: number | null
  narrowLeadership: boolean
}

/** Evidence-based classification — thresholds documented in the methodology doc. */
export function classifyRegime(f: RegimeFacts): RegimeOutput {
  const evidence: string[] = []
  const m = f.capWeightedMarket
  if (m !== null) evidence.push(`cap-weighted market change ${r2(m)}%`)
  if (f.ratio !== null) evidence.push(`A/D ratio ${f.ratio}`)
  if (f.pctAbove20 !== null) evidence.push(`${r2(f.pctAbove20, 0)}% of universe above SMA20`)
  if (f.pctAbove50 !== null) evidence.push(`${r2(f.pctAbove50, 0)}% above SMA50`)
  if (f.nh !== null && f.nl !== null) evidence.push(`new 52w highs ${f.nh} vs lows ${f.nl}`)

  let code: RegimeOutput["code"] = null
  if (f.narrowLeadership) {
    code = "narrow_leadership"
  } else if (m !== null && f.ratio !== null) {
    if (m >= 1 && f.ratio >= 2) code = "strong_uptrend"
    else if (m >= 0.2 && f.ratio >= 1.2) code = f.pctAbove50 !== null && f.pctAbove50 >= 55 ? "strong_uptrend" : "weak_uptrend"
    else if (m <= -1 && f.ratio <= 0.5) code = "strong_downtrend"
    else if (m <= -0.2 && f.ratio <= 0.85) code = "weak_downtrend"
    else code = "sideways"
  } else if (m !== null) {
    code = m >= 0.5 ? "weak_uptrend" : m <= -0.5 ? "weak_downtrend" : "sideways"
    evidence.push("A/D ratio unavailable — classified from market change alone (weaker evidence)")
  }
  if (code === "strong_uptrend" && f.pctAbove20 !== null && f.pctAbove20 < 60) {
    code = "weak_uptrend"
    evidence.push("index strength not matched by SMA20 breadth → downgraded to weak uptrend")
  }
  if (code === "strong_downtrend" && f.pctAbove20 !== null && f.pctAbove20 > 40) {
    code = "weak_downtrend"
    evidence.push("SMA20 breadth holds better than the index implies → downgraded to weak downtrend")
  }

  return {
    code,
    label: code ? code.replace(/_/g, " ") : "insufficient evidence",
    labelAr: code ? (REGIME_AR[code] ?? code) : "أدلة غير كافية للتصنيف",
    evidence,
    changedFrom: null,
  }
}

// ---------------------------------------------------------------- pulse

function computePulse(f: {
  capWeightedMarket: number | null
  ratio: number | null
  pctAbove20: number | null
  pctAbove50: number | null
  nh: number | null
  nl: number | null
  top5: number | null
  tradedValueEgp: number | null
  tradedValuePrev: number | null
}): MarketIntelligence["pulse"] {
  const dims: PulseDimension[] = []
  const trendEarned = f.capWeightedMarket === null ? 15 : Math.max(0, Math.min(30, 15 + f.capWeightedMarket * 7.5))
  dims.push({
    key: "trend", label: "Market trend (cap-weighted)", labelAr: "اتجاه السوق (مرجح بالقيمة)",
    earned: r2(trendEarned, 1), max: 30,
    reason: f.capWeightedMarket === null ? "no market-cap data — neutral midpoint assigned" : `cap-weighted change ${r2(f.capWeightedMarket)}%`,
  })
  const ratioScore = f.ratio === null ? 8 : Math.max(0, Math.min(18, 9 * Math.log2(Math.max(0.25, f.ratio) / 0.5) + 9))
  const smaScore = f.pctAbove20 === null ? 6 : Math.max(0, Math.min(12, (f.pctAbove20 / 100) * 12))
  dims.push({
    key: "breadth", label: "Breadth", labelAr: "اتساع المشاركة",
    earned: r2(ratioScore + smaScore, 1), max: 30,
    reason: f.ratio === null ? "A/D ratio unavailable" : `A/D ratio ${f.ratio}` + (f.pctAbove20 !== null ? `; ${r2(f.pctAbove20, 0)}% above SMA20` : ""),
  })
  let nhEarned = 7.5
  let nhReason = "new 52w high/low counts unavailable — neutral"
  if (f.nh !== null && f.nl !== null) {
    const total = f.nh + f.nl
    nhEarned = total === 0 ? 7.5 : 15 * (f.nh / total)
    nhReason = `${f.nh} new highs vs ${f.nl} new lows`
  }
  dims.push({ key: "new_highs_lows", label: "New highs vs lows", labelAr: "قمم جديدة مقابل قيعان", earned: r2(nhEarned, 1), max: 15, reason: nhReason })
  const concEarned = f.top5 === null ? 5 : Math.max(0, Math.min(10, 10 - (f.top5 - 30) / 4))
  dims.push({ key: "concentration", label: "Turnover concentration (lower is healthier)", labelAr: "تركز القيمة المتداولة (الأقل أكثر صحة)", earned: r2(concEarned, 1), max: 10, reason: f.top5 === null ? "concentration unavailable — neutral" : `top-5 share ${f.top5}%` })
  let partEarned = 7.5
  let partReason = "participation history accumulating — neutral"
  if (f.tradedValueEgp !== null && f.tradedValuePrev !== null && f.tradedValuePrev > 0) {
    const delta = (f.tradedValueEgp - f.tradedValuePrev) / f.tradedValuePrev
    partEarned = Math.max(0, Math.min(15, 7.5 + delta * 15))
    partReason = `traded value ${delta >= 0 ? "+" : ""}${r2(delta * 100, 0)}% vs previous stored session`
  }
  dims.push({ key: "participation", label: "Participation (traded value momentum)", labelAr: "المشاركة (زخم القيمة المتداولة)", earned: r2(partEarned, 1), max: 15, reason: partReason })

  const score = Math.round(dims.reduce((s, d) => s + d.earned, 0))
  const labelAr = score >= 70 ? "نبض السوق قوي" : score >= 50 ? "نبض السوق متوازن" : score >= 35 ? "نبض السوق متوتر" : "نبض السوق ضعيف"
  return { score: Math.max(0, Math.min(100, score)), labelAr, dimensions: dims }
}
