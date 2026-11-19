// =============================================================================
// حلل سهمي (Position Review) — service plumbing tests. The DB wiring in
// service.ts is exercised with module mocks (no DB): board-service series/row
// reads, the whole-market intelligence fetch, and the pure reviewPosition are
// all mocked so the tests assert the PLUMBING CONTRACT only — that the market
// context reaches the review engine's input, that an intelligence failure
// degrades to null instead of breaking the review, and that the
// not-reviewable early returns never pay the intelligence cost.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildZoneMap } from "@/lib/signals/levels"
import { computeMetrics, toSignalMetrics } from "@/lib/signals/metrics"
import { getCompanySeriesCached, getCompanySignalV2Cached } from "@/lib/signals/board-service"
import type { CompanySeries } from "@/lib/signals/board-service"
import { buildMarketContext } from "@/lib/market/intelligence/context"
import type { MarketContextSection } from "@/lib/technical/analyze"
import type { Bar, SignalRowV2, SignalMetrics, SignalState } from "@/lib/signals/types"
import type { PositionReview } from "../types"
import { reviewPosition } from "../review"
import { buildPositionReview } from "../service"
import { cushionSeries } from "./bars-fixture"

vi.mock("@/lib/signals/board-service", () => ({
  getCompanySeriesCached: vi.fn(),
  getCompanySignalV2Cached: vi.fn(),
}))

vi.mock("@/lib/market/intelligence/context", () => ({
  buildMarketContext: vi.fn(),
}))

// The service imports reviewPosition directly — mocked so each test asserts
// the EXACT input object handed to the review engine.
vi.mock("../review", () => ({
  reviewPosition: vi.fn(),
}))

const CID = "company-1"

function rowOver(bars: Bar[], over: Partial<SignalRowV2> = {}): SignalRowV2 {
  const m = computeMetrics(bars)!
  const metrics: SignalMetrics = toSignalMetrics(m)
  return {
    companyId: CID,
    ticker: "TEST",
    nameEn: "Test Co",
    nameAr: "شركة الاختبار",
    sector: "Tests",
    marketTier: "EGX30",
    state: "wait",
    type: null,
    asOf: "2026-03-12",
    lastClose: bars[bars.length - 1].close,
    changePct: null,
    score: 50,
    scoreGroups: null,
    evidence: [],
    plan: null,
    setup: null,
    invalidationAr: null,
    metrics,
    quality: { bars: bars.length, ohlc: true, liquidity: "normal", avgTradedValueEgp: null, dataAgeSessions: 0, notesAr: [] },
    warnings: [],
    engine: "test",
    ...over,
  }
}

function seriesOver(bars: Bar[], over: Partial<CompanySeries> = {}): CompanySeries {
  return {
    companyId: CID,
    ticker: "TEST",
    nameEn: "Test Co",
    nameAr: "شركة الاختبار",
    sector: "Tests",
    marketTier: "EGX30",
    bars,
    ...over,
  }
}

const marketCtxFixture: MarketContextSection = {
  available: true,
  asOf: "2026-11-18T10:00:00Z",
  marketRegime: "risk_on",
  marketRegimeAr: "شهية مخاطرة",
  marketPulse: 62,
  breadth: { advancing: 30, declining: 12, unchanged: 8, ratio: 2.5 },
  aboveEma20: 55,
  aboveEma50: 48,
  aboveEma200: 41,
  sector: null,
  relVolRankPct: 70,
  limitations: ["test limitation"],
}

/** A recognizable sentinel so the test can assert result.review IS the mock's
 *  return value (reference identity) rather than re-running the ladder. */
function sentinel(): PositionReview {
  return { decision: "wait", __sentinel: true } as unknown as PositionReview
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("buildPositionReview — market-context plumbing", () => {
  it("fetches buildMarketContext(companyId) and passes its value into reviewPosition's input", async () => {
    const bars = cushionSeries(97)
    const row = rowOver(bars, { state: "wait" as SignalState })
    const ctx = marketCtxFixture
    const out = sentinel()
    vi.mocked(getCompanySeriesCached).mockResolvedValueOnce(seriesOver(bars))
    vi.mocked(getCompanySignalV2Cached).mockResolvedValueOnce(row)
    vi.mocked(buildMarketContext).mockResolvedValueOnce(ctx)
    vi.mocked(reviewPosition).mockReturnValueOnce(out)

    const result = await buildPositionReview(CID, 105, "no")

    // the intelligence fetch gets the exact companyId, nothing else
    expect(buildMarketContext).toHaveBeenCalledTimes(1)
    expect(buildMarketContext).toHaveBeenCalledWith(CID)
    // the review engine received the full input, marketCtx included
    expect(reviewPosition).toHaveBeenCalledTimes(1)
    const input = vi.mocked(reviewPosition).mock.calls[0][0]
    expect(input.marketCtx).toBe(ctx)
    expect(input.row).toBe(row)
    expect(input.bars).toBe(bars)
    expect(input.map).toEqual(buildZoneMap(bars))
    expect(input.avgBuyPrice).toBe(105)
    expect(input.downsideAnswer).toBe("no")
    // the mocked review value flows straight through
    expect(result).not.toBeNull()
    expect(result!.review).toBe(out)
    expect(result!.notReviewableAr).toBeNull()
  })

  it("buildMarketContext rejecting → review STILL built with marketCtx null (no throw)", async () => {
    const bars = cushionSeries(100)
    const row = rowOver(bars, { state: "wait" as SignalState })
    const out = sentinel()
    vi.mocked(getCompanySeriesCached).mockResolvedValueOnce(seriesOver(bars))
    vi.mocked(getCompanySignalV2Cached).mockResolvedValueOnce(row)
    vi.mocked(buildMarketContext).mockRejectedValueOnce(new Error("intelligence db down"))
    vi.mocked(reviewPosition).mockReturnValueOnce(out)

    const result = await buildPositionReview(CID, 110, null) // must not throw

    expect(result).not.toBeNull()
    expect(buildMarketContext).toHaveBeenCalledTimes(1) // attempted, not abandoned
    expect(reviewPosition).toHaveBeenCalledTimes(1)
    const input = vi.mocked(reviewPosition).mock.calls[0][0]
    expect(input.marketCtx).toBeNull() // the defensive catch degraded to null
    expect(result!.review).toBe(out) // the veteran review still built
    expect(result!.notReviewableAr).toBeNull()
  })

  it("not-reviewable early returns never pay the intelligence cost", async () => {
    // company gone → null result, no intelligence fetch
    vi.mocked(getCompanySeriesCached).mockResolvedValueOnce(null)
    expect(await buildPositionReview(CID, 105)).toBeNull()
    expect(buildMarketContext).not.toHaveBeenCalled()
    expect(reviewPosition).not.toHaveBeenCalled()

    // too few bars → honest notReviewableAr, no intelligence fetch, no row read
    vi.mocked(getCompanySeriesCached).mockResolvedValueOnce(seriesOver(cushionSeries(97).slice(0, 10)))
    const short = await buildPositionReview(CID, 105)
    expect(short!.review).toBeNull()
    expect(short!.notReviewableAr).toContain("60")
    expect(buildMarketContext).not.toHaveBeenCalled()
    expect(getCompanySignalV2Cached).not.toHaveBeenCalled()

    // engine row unusable → honest notReviewableAr, still no intelligence fetch
    vi.mocked(getCompanySeriesCached).mockResolvedValueOnce(seriesOver(cushionSeries(97)))
    vi.mocked(getCompanySignalV2Cached).mockResolvedValueOnce(null)
    const noRow = await buildPositionReview(CID, 105)
    expect(noRow!.review).toBeNull()
    expect(noRow!.notReviewableAr).not.toBeNull()
    expect(buildMarketContext).not.toHaveBeenCalled()
  })

  it("two-cache skew: the service hands the review a skewed row/bars pair and the engine resolves the SERIES close", async () => {
    // the two caches are mocked with DIFFERENT closes: the v2-row cache is
    // stale (110) while the series cache is fresh (103). The one build is
    // delegated to the REAL engine on the assembled input — the review must
    // read the series close, not the stale row value.
    const { reviewPosition: realReviewPosition } = await vi.importActual<typeof import("../review")>("../review")
    const bars = cushionSeries(97) // series-derived close 103
    const staleRow = rowOver(bars, { state: "exit" as SignalState, lastClose: 110 })
    vi.mocked(getCompanySeriesCached).mockResolvedValueOnce(seriesOver(bars))
    vi.mocked(getCompanySignalV2Cached).mockResolvedValueOnce(staleRow)
    vi.mocked(buildMarketContext).mockResolvedValueOnce(marketCtxFixture)
    vi.mocked(reviewPosition).mockImplementationOnce((input) => realReviewPosition(input))

    const result = await buildPositionReview(CID, 100, null)

    expect(result).not.toBeNull()
    expect(result!.review).not.toBeNull()
    expect(result!.review!.lastClose).toBe(103) // NOT the stale 110
    expect(result!.review!.decision).toBe("exit") // the stale 110 (+10٪) would flip this to take_profit
    expect(result!.review!.reasonsAr.some((x) => x.includes("103.00"))).toBe(true)
    expect(JSON.stringify(result!.review)).not.toContain("110.00")
  })
})
