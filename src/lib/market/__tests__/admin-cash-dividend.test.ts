// =============================================================================
// Admin cash-dividend mandate (owner bug 2026-11-17 — «القاهرة للدواجن»):
// the owner recorded a 1.9 EGP cash dividend via the admin console
// (POST /api/v1/admin/corporate-actions → CorporateAction row,
// actionType "cash_dividend"), ex-date = the latest session. The technical
// view still showed the raw mechanical drop (−19.2%) and the position engine
// read a fake "broken support".
//
// ROOT CAUSE: every loader in corporate-actions.ts excluded cash_dividend
// from the CorporateAction query (the Dividend table was assumed to be the
// single cash source) — the admin write path records cash dividends ONLY in
// CorporateAction, so the dividend was invisible to the technical series, the
// board, the position review and the refresh ex-date path.
//
// FIX CONTRACT (pinned here):
//   • CorporateAction cash rows (cashPerShare > 0) are included everywhere.
//   • mergeSeriesActionRows collapses the two cash ledgers to ONE event per
//     company-day (MANUAL_ADMIN wins) — never subtracted twice.
//   • The series pass applies the cash subtraction with the EXISTING
//     adjustPrevClose semantics: adjPrev = prev − d, change = (close − adjPrev)/adjPrev.
//     Scenario [prev 9.9, last 8.0] + dividend 1.9 → adjPrev = 8.0 → d1 = 0%
//     (the drop was ENTIRELY mechanical — the exact value per adjustPrevClose,
//     not the ≈−1.1% first estimate). A genuine residual drop survives:
//     [prev 9.9, last 7.9] → d1 = −1.25%.
//   • Double-adjustment vs Yahoo is impossible by construction: the engine
//     feeds on Yahoo's chart `close` (split/bonus-adjusted, cash NEVER
//     adjusted — see candles.ts), so our cash overlay is the only cash
//     adjustment that series ever receives.
// =============================================================================

import { describe, expect, it, vi, beforeEach } from "vitest"

// The engine modules import the Prisma client statically; the mandate tests
// are pure/engine-level, so the DB layer is replaced wholesale (same shape as
// the rows the loaders select). The hoisted state lets each e2e scenario seed
// its own PriceBar / CorporateAction / Dividend rows.
const h = vi.hoisted(() => ({
  priceBars: [] as { ts: Date; open: number; high: number; low: number; close: number; volume: number | null }[],
  actions: [] as Record<string, unknown>[],
  dividends: [] as Record<string, unknown>[],
}))

vi.mock("@/lib/db", () => ({
  db: {
    priceBar: { findMany: async () => h.priceBars },
    marketPrice: { findMany: async () => [] },
    company: { findUnique: async () => ({ ticker: "PTRY" }) },
    corporateAction: { findMany: async () => h.actions },
    dividend: { findMany: async () => h.dividends },
    stanceSnapshot: { deleteMany: async () => ({ count: 0 }) },
  },
}))
vi.mock("@/lib/technical/live-bars", () => ({
  fetchRecentBarsForCompany: vi.fn(async () => null),
  fetchRecentBarsYahoo: vi.fn(async () => null),
}))
vi.mock("@/lib/market/price-override", () => ({
  getAdminPriceOverride: vi.fn(async () => null),
  applyAdminPriceOverrideToLastBar: vi.fn(),
}))

import {
  adjustPrevClose,
  adjustedChangePct,
  applyCorporateActionAdjustments,
  invalidateCorporateActionCaches,
  mergeSeriesActionRows,
  type CorporateActionRowLike,
  type CorporateActionTerms,
  type DividendRowLike,
  type SeriesBar,
} from "@/lib/market/corporate-actions"
import { assembleBundle } from "@/lib/technical/analyze"

const cashDividend = (amount: number, sourceName: string | null = "MANUAL_ADMIN"): CorporateActionTerms => ({
  actionType: "cash_dividend",
  ratioNumerator: null,
  ratioDenominator: null,
  cashPerShare: amount,
  subscriptionPrice: null,
})

const adminCashRow = (amount: number, dayISO: string): CorporateActionRowLike => ({
  actionType: "cash_dividend",
  sourceName: "MANUAL_ADMIN",
  exDate: new Date(`${dayISO}T00:00:00.000Z`),
  ratioNumerator: null,
  ratioDenominator: null,
  cashPerShare: amount,
  subscriptionPrice: null,
})

const dividendRow = (amount: number, dayISO: string): DividendRowLike => ({
  dividendPerShare: amount,
  exDividendDate: new Date(`${dayISO}T00:00:00.000Z`),
})

// ── the owner scenario, at the pure-math layer ───────────────────────────────
describe("owner scenario (1.9 EGP dividend, ex-date today) — adjustPrevClose semantics", () => {
  it("adjPrev = prev − dividend: 9.9 − 1.9 = 8.0, so the adjusted change is exactly 0%", () => {
    const adjPrev = adjustPrevClose(9.9, [cashDividend(1.9)])
    expect(adjPrev).toBeCloseTo(8.0, 9)
    // (8.0 − 8.0) / 8.0 — the drop was entirely mechanical
    const d1 = ((8.0 - adjPrev) / adjPrev) * 100
    expect(d1).toBeCloseTo(0, 9)
  })

  it("adjustedChangePct on the scanner row: raw −19.19% becomes ≈0%, no actions → untouched", () => {
    // price 8.0 with raw change −19.19% implies rawPrev = 9.9 → adj 8.0 → 0%
    expect(adjustedChangePct(8.0, -19.19191919191919, [cashDividend(1.9)])).toBeCloseTo(0, 6)
    expect(adjustedChangePct(8.0, -19.19191919191919, undefined)).toBeCloseTo(-19.19191919191919, 9)
  })

  it("a genuine residual market drop survives the adjustment (last 7.9 → −1.25%)", () => {
    const adjPrev = adjustPrevClose(9.9, [cashDividend(1.9)])
    const d1 = ((7.9 - adjPrev) / adjPrev) * 100
    expect(d1).toBeCloseTo(-1.25, 6)
    expect(adjustedChangePct(7.9, -20.2020202020202, [cashDividend(1.9)])).toBeCloseTo(-1.25, 6)
  })

  it("series continuity: [9.9 → 8.0] with the ex-date ON the last bar rescales only the pre-ex-date bar", () => {
    const bars: SeriesBar[] = [
      { ts: "2026-11-16", open: 9.9, high: 9.95, low: 9.85, close: 9.9, volume: 1000, source: "scanner" },
      { ts: "2026-11-17", open: 8.0, high: 8.05, low: 7.95, close: 8.0, volume: 2000, source: "scanner" },
    ]
    const { bars: adj, eventsApplied, eventsSkipped } = applyCorporateActionAdjustments(bars, [
      { exDateISO: "2026-11-17", terms: cashDividend(1.9) },
    ])
    expect(eventsSkipped).toHaveLength(0)
    expect(eventsApplied).toHaveLength(1)
    expect(eventsApplied[0].actionType).toBe("cash_dividend")
    expect(eventsApplied[0].factor).toBeCloseTo(8.0 / 9.9, 9)
    expect(adj[0].close).toBeCloseTo(8.0, 6)
    expect(adj[1].close).toBeCloseTo(8.0, 6)
    // the mechanical −19.19% cliff is gone from the series
    const d1 = (adj[1].close / adj[0].close - 1) * 100
    expect(d1).toBeCloseTo(0, 9)
  })

  it("no-action control: the same bars keep their raw −19.19% shape", () => {
    const bars: SeriesBar[] = [
      { ts: "2026-11-16", open: 9.9, high: 9.95, low: 9.85, close: 9.9, volume: 1000, source: "scanner" },
      { ts: "2026-11-17", open: 8.0, high: 8.05, low: 7.95, close: 8.0, volume: 2000, source: "scanner" },
    ]
    const { bars: adj, eventsApplied } = applyCorporateActionAdjustments(bars, [])
    expect(eventsApplied).toHaveLength(0)
    expect(adj[0].close).toBe(9.9)
    expect(adj[1].close).toBe(8.0)
    expect((adj[1].close / adj[0].close - 1) * 100).toBeCloseTo(-19.19191919191919, 9)
  })

  it("Yahoo-sourced bars are NOT double-adjusted for cash (Yahoo close is never cash-adjusted)", () => {
    const bars: SeriesBar[] = [
      { ts: "2026-11-16", open: 9.9, high: 9.95, low: 9.85, close: 9.9, volume: 1000, source: "yahoo" },
      { ts: "2026-11-17", open: 8.0, high: 8.05, low: 7.95, close: 8.0, volume: 2000, source: "yahoo" },
    ]
    const { bars: adj, eventsApplied } = applyCorporateActionAdjustments(bars, [
      { exDateISO: "2026-11-17", terms: cashDividend(1.9) },
    ])
    expect(eventsApplied).toHaveLength(1)
    // exactly ONE subtraction: 9.9 → 8.0. A double subtraction would read ≈6.1.
    expect(adj[0].close).toBeCloseTo(8.0, 6)
    expect(adj[0].close).toBeGreaterThan(7.9)
  })
})

// ── the displayed change on the technical tab comes from the adjusted bundle ──
describe("owner scenario — assembleBundle day change (perf.d1) on the adjusted series", () => {
  const baseBars = (lastClose: number): Parameters<typeof assembleBundle>[0] => {
    const bars: Parameters<typeof assembleBundle>[0] = []
    for (let i = 39; i >= 1; i--) {
      const ts = new Date(Date.UTC(2026, 10, 8) - i * 86_400_000).toISOString().slice(0, 10)
      bars.push({ ts, open: 9.9, high: 9.9, low: 9.9, close: 9.9, volume: null })
    }
    // the two owner-scenario sessions: prev close 9.9, last session 2026-11-17
    bars.push({ ts: "2026-11-16", open: 9.9, high: 9.9, low: 9.9, close: 9.9, volume: null })
    bars.push({ ts: "2026-11-17", open: lastClose, high: lastClose, low: lastClose, close: lastClose, volume: null })
    return bars
  }

  it("with the admin dividend applied, perf.d1 reads 0% (not −19.19%) and adjustedActions ≥ 1", () => {
    const { bars: adjusted, eventsApplied } = applyCorporateActionAdjustments(baseBars(8.0).map((b) => ({ ...b, source: "scanner" as const })), [
      { exDateISO: "2026-11-17", terms: cashDividend(1.9) },
    ])
    const bundle = assembleBundle(adjusted.map(({ source: _s, ...rest }) => rest))
    expect(eventsApplied.length).toBeGreaterThanOrEqual(1)
    bundle.snapshot.adjustedActions = eventsApplied.length
    expect(bundle.snapshot.adjustedActions).toBeGreaterThanOrEqual(1)
    expect(bundle.snapshot.perf.d1).not.toBeNull()
    expect(bundle.snapshot.perf.d1).toBeCloseTo(0, 6)
    expect(bundle.snapshot.lastClose).toBeCloseTo(8.0, 6)
  })

  it("no-action control: the same bundle keeps the raw −19.19% day change", () => {
    const bundle = assembleBundle(baseBars(8.0))
    expect(bundle.snapshot.perf.d1).not.toBeNull()
    expect(bundle.snapshot.perf.d1).toBeCloseTo(-19.19, 6)
  })
})

// ── the two cash ledgers, merged — the double-count contract ─────────────────
describe("mergeSeriesActionRows — one cash event per company-day", () => {
  it("an admin-only CorporateAction cash row is included (the previously invisible path)", () => {
    const out = mergeSeriesActionRows([adminCashRow(1.9, "2026-11-17")], [])
    expect(out).toHaveLength(1)
    expect(out[0].exDateISO).toBe("2026-11-17")
    expect(out[0].terms.actionType).toBe("cash_dividend")
    expect(out[0].terms.cashPerShare).toBeCloseTo(1.9, 9)
  })

  it("a Dividend-ledger-only row still applies (legacy behavior preserved)", () => {
    const out = mergeSeriesActionRows([], [dividendRow(1.9, "2026-11-17")])
    expect(out).toHaveLength(1)
    expect(out[0].terms.cashPerShare).toBeCloseTo(1.9, 9)
  })

  it("the same event in BOTH ledgers on one day collapses to ONE subtraction", () => {
    const out = mergeSeriesActionRows([adminCashRow(1.9, "2026-11-17")], [dividendRow(1.9, "2026-11-17")])
    expect(out).toHaveLength(1)
    expect(out[0].terms.cashPerShare).toBeCloseTo(1.9, 9)
    // and the merged result adjusts exactly like the single-ledger case
    const adj = adjustPrevClose(9.9, [out[0].terms])
    expect(adj).toBeCloseTo(8.0, 9)
  })

  it("a double subtraction would read +31.15% — the contract must never produce it", () => {
    // pinned so a regression of the dedupe contract is loud and quantified
    const doubleSubtracted = 9.9 - 1.9 - 1.9
    expect(((8.0 - doubleSubtracted) / doubleSubtracted) * 100).toBeCloseTo(31.147540983606564, 6)
    const merged = mergeSeriesActionRows([adminCashRow(1.9, "2026-11-17")], [dividendRow(1.9, "2026-11-17")])
    expect(adjustPrevClose(9.9, merged.map((s) => s.terms))).toBeCloseTo(8.0, 9)
  })

  it("cash events on DIFFERENT days both apply (compounding, not dedupe)", () => {
    const out = mergeSeriesActionRows([adminCashRow(1.9, "2026-11-17")], [dividendRow(0.5, "2026-11-10")])
    expect(out).toHaveLength(2)
    const adj = adjustPrevClose(9.9, out.map((s) => s.terms))
    expect(adj).toBeCloseTo(7.5, 9)
  })

  it("MANUAL_ADMIN wins a same-day CorporateAction duplicate (deliberate correction)", () => {
    const foudalens: CorporateActionRowLike = { ...adminCashRow(1.9, "2026-11-17"), sourceName: "FOUDALENS_CORPORATE_ACTIONS", cashPerShare: 2.5 }
    const out = mergeSeriesActionRows([foudalens, adminCashRow(1.9, "2026-11-17")], [])
    expect(out).toHaveLength(1)
    expect(out[0].terms.cashPerShare).toBeCloseTo(1.9, 9)
  })

  it("a cash row without a usable amount is ignored and cannot claim the day", () => {
    const zeroAmount: CorporateActionRowLike = { ...adminCashRow(0, "2026-11-17"), cashPerShare: 0 }
    const out = mergeSeriesActionRows([zeroAmount], [dividendRow(1.9, "2026-11-17")])
    expect(out).toHaveLength(1)
    expect(out[0].terms.cashPerShare).toBeCloseTo(1.9, 9)
  })

  it("share events never claim the cash-dedupe day: bonus + Dividend cash compose", () => {
    const bonus: CorporateActionRowLike = {
      actionType: "stock_dividend",
      sourceName: "MANUAL_ADMIN",
      exDate: new Date("2026-11-17T00:00:00.000Z"),
      ratioNumerator: BigInt(1),
      ratioDenominator: BigInt(2),
      cashPerShare: null,
      subscriptionPrice: null,
    }
    const out = mergeSeriesActionRows([bonus], [dividendRow(1.5, "2026-11-17")])
    expect(out).toHaveLength(2)
    // 9.9 → bonus ÷1.5 → 6.6 → cash −1.5 → 5.1 (adjustPrevClose composition order)
    const adj = adjustPrevClose(9.9, out.map((s) => s.terms))
    expect(adj).toBeCloseTo(5.1, 9)
  })

  it("rows without an ex-date are skipped, not fabricated", () => {
    const noDate: CorporateActionRowLike = { ...adminCashRow(1.9, "2026-11-17"), exDate: null }
    const out = mergeSeriesActionRows([noDate], [{ dividendPerShare: 1.9, exDividendDate: null }])
    expect(out).toHaveLength(0)
  })
})

// ── the admin write path must be able to drop the engine's ledger cache ──────
describe("invalidateCorporateActionCaches — admin save hook", () => {
  it("is callable from any request context and never throws", () => {
    expect(() => invalidateCorporateActionCaches()).not.toThrow()
  })
})

// ── end-to-end: buildTechnicalBundle — the exact engine the technical route ───
// (/api/v1/companies/[id]/technical) and the AI builder call. Seeded with the
// owner's stored series (41 sessions ending [9.9 → 8.0]) plus the admin's
// cash-dividend row — the full path DB rows → loaders → series pass → snapshot.
describe("buildTechnicalBundle — admin dividend reaches the technical view (e2e)", () => {
  const COMPANY = "co-poultry-1"

  /** 41 daily stored sessions, all closes 9.9 except the last = lastClose. */
  function seedBars(lastClose: number): void {
    h.priceBars = []
    const days = 41
    for (let i = days - 1; i >= 0; i--) {
      const ts = new Date(Date.UTC(2026, 10, 17) - i * 86_400_000)
      const close = i === 0 ? lastClose : 9.9
      h.priceBars.push({ ts, open: close, high: close, low: close, close, volume: null })
    }
  }

  beforeEach(() => {
    h.priceBars = []
    h.actions = []
    h.dividends = []
  })

  it("owner scenario: admin cash row (1.9 EGP, ex = last session) → perf.d1 ≈ 0%, adjustedActions ≥ 1, chart continuous", async () => {
    seedBars(8.0)
    h.actions = [
      {
        companyId: COMPANY,
        actionType: "cash_dividend",
        sourceName: "MANUAL_ADMIN",
        exDate: new Date("2026-11-17T00:00:00.000Z"),
        ratioNumerator: null,
        ratioDenominator: null,
        cashPerShare: 1.9,
        subscriptionPrice: null,
      },
    ]
    const { buildTechnicalBundle } = await import("@/lib/technical/analyze")
    const bundle = await buildTechnicalBundle(COMPANY)
    expect(bundle.snapshot.perf.d1).not.toBeNull()
    // exact expected value per adjustPrevClose: (8.0 − (9.9 − 1.9)) / (9.9 − 1.9) = 0
    expect(bundle.snapshot.perf.d1).toBeCloseTo(0, 6)
    expect(bundle.snapshot.adjustedActions).not.toBeNull()
    expect(bundle.snapshot.adjustedActions).toBeGreaterThanOrEqual(1)
    expect(bundle.snapshot.limitations.some((l) => l.toLowerCase().includes("corporate-action"))).toBe(true)
    // the client chart (adjusted candles) shows the rebuilt prev close — no cliff
    expect(bundle.candles.length).toBeGreaterThanOrEqual(2)
    expect(bundle.candles[bundle.candles.length - 1].c).toBeCloseTo(8.0, 6)
    expect(bundle.candles[bundle.candles.length - 2].c).toBeCloseTo(8.0, 6)
  })

  it("no-action control: the identical series keeps the raw −19.19% day change", async () => {
    seedBars(8.0)
    const { buildTechnicalBundle } = await import("@/lib/technical/analyze")
    const bundle = await buildTechnicalBundle(COMPANY)
    expect(bundle.snapshot.perf.d1).toBeCloseTo(-19.19, 6)
    expect(bundle.snapshot.adjustedActions).toBeNull()
    expect(bundle.candles[bundle.candles.length - 2].c).toBeCloseTo(9.9, 6)
  })

  it("the dividend in BOTH ledgers adjusts exactly once (dedupe), never the +31.15% double-subtraction", async () => {
    seedBars(8.0)
    h.actions = [
      {
        companyId: COMPANY,
        actionType: "cash_dividend",
        sourceName: "MANUAL_ADMIN",
        exDate: new Date("2026-11-17T00:00:00.000Z"),
        ratioNumerator: null,
        ratioDenominator: null,
        cashPerShare: 1.9,
        subscriptionPrice: null,
      },
    ]
    h.dividends = [{ companyId: COMPANY, dividendPerShare: 1.9, exDividendDate: new Date("2026-11-17T00:00:00.000Z") }]
    const { buildTechnicalBundle } = await import("@/lib/technical/analyze")
    const bundle = await buildTechnicalBundle(COMPANY)
    expect(bundle.snapshot.perf.d1).toBeCloseTo(0, 6)
  })

  it("a genuine residual drop survives: last close 7.9 → −1.25% after the dividend adjustment", async () => {
    seedBars(7.9)
    h.actions = [
      {
        companyId: COMPANY,
        actionType: "cash_dividend",
        sourceName: "MANUAL_ADMIN",
        exDate: new Date("2026-11-17T00:00:00.000Z"),
        ratioNumerator: null,
        ratioDenominator: null,
        cashPerShare: 1.9,
        subscriptionPrice: null,
      },
    ]
    const { buildTechnicalBundle } = await import("@/lib/technical/analyze")
    const bundle = await buildTechnicalBundle(COMPANY)
    expect(bundle.snapshot.perf.d1).toBeCloseTo(-1.25, 6)
  })
})

// ── share-type events dedupe like cash (audit 2026-11-19): a split/bonus
//    mirrored by FOUDALENS_CORPORATE_ACTIONS + MANUAL_ADMIN used to pass
//    through twice and apply its ratio TWICE ──────────────────────────────────
describe("mergeSeriesActionRows — one share event per company-day-type", () => {
  const splitRow = (sourceName: string | null): CorporateActionRowLike => ({
    actionType: "split",
    sourceName,
    exDate: new Date("2026-11-17T00:00:00.000Z"),
    ratioNumerator: BigInt(2),
    ratioDenominator: BigInt(1),
    cashPerShare: null,
    subscriptionPrice: null,
  })

  it("the same split recorded by BOTH sources collapses to ONE ratio application", () => {
    const out = mergeSeriesActionRows([splitRow("FOUDALENS_CORPORATE_ACTIONS"), splitRow("MANUAL_ADMIN")], [])
    expect(out).toHaveLength(1)
    expect(out[0].terms.actionType).toBe("split")
    // 9.9 → ÷2 = 4.95 exactly once; a double application would read 2.475
    expect(adjustPrevClose(9.9, [out[0].terms])).toBeCloseTo(4.95, 9)
  })

  it("MANUAL_ADMIN wins the same-day share duplicate (deliberate correction)", () => {
    const fouda = { ...splitRow("FOUDALENS_CORPORATE_ACTIONS"), ratioNumerator: BigInt(3), ratioDenominator: BigInt(1) }
    const out = mergeSeriesActionRows([fouda, splitRow("MANUAL_ADMIN")], [])
    expect(out).toHaveLength(1)
    // the admin's 2:1 split (÷2 → 4.95) wins over FoudaLens's 3:1 (÷3 → 3.3)
    expect(adjustPrevClose(9.9, out.map((s) => s.terms))).toBeCloseTo(4.95, 9)
  })

  it("different share types on one day still compose (split + bonus are NOT duplicates)", () => {
    const bonus: CorporateActionRowLike = { ...splitRow("MANUAL_ADMIN"), actionType: "stock_dividend", ratioNumerator: BigInt(1), ratioDenominator: BigInt(2) }
    const out = mergeSeriesActionRows([splitRow("MANUAL_ADMIN"), bonus], [])
    expect(out).toHaveLength(2)
    // split ÷2 then bonus ÷1.5: 9.9 → 4.95 → 3.3
    expect(adjustPrevClose(9.9, out.map((s) => s.terms))).toBeCloseTo(3.3, 9)
  })

  it("a doubled share adjustment would read 2.475 — the contract must never produce it", () => {
    // pinned so a regression of the share-dedupe contract is loud and quantified
    const doubleApplied = 9.9 / 2 / 2
    expect(doubleApplied).toBeCloseTo(2.475, 9)
    const merged = mergeSeriesActionRows([splitRow("FOUDALENS_CORPORATE_ACTIONS"), splitRow("MANUAL_ADMIN")], [])
    expect(adjustPrevClose(9.9, merged.map((s) => s.terms))).toBeCloseTo(4.95, 9)
  })
})
