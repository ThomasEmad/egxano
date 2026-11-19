// =============================================================================
// حلل سهمي (Position Review) — DB wiring. Reuses the signals series builder
// (same merge/override/corporate-action pass) and the cached v2 row so the
// review reads the EXACT anatomy the signals board reads. No writes anywhere.
// =============================================================================

import { buildMarketContext } from "@/lib/market/intelligence/context"
import { buildZoneMap } from "@/lib/signals/levels"
import { getCompanySeriesCached, getCompanySignalV2Cached } from "@/lib/signals/board-service"
import { MIN_BARS } from "@/lib/signals/types"
import type { MarketContextSection } from "@/lib/technical/analyze"
import { isLastBarFinal, reviewPosition } from "./review"
import type { PositionReviewResult } from "./types"

/**
 * Build the full position review for one company + the user's average buy
 * price. Returns null only when the company itself is gone — otherwise a
 * result carries either the review or an honest "not reviewable" reason.
 */
export async function buildPositionReview(companyId: string, avgBuyPrice: number, downsideAnswer?: "yes" | "no" | null): Promise<PositionReviewResult | null> {
  const series = await getCompanySeriesCached(companyId)
  if (!series) return null

  const head = { companyId: series.companyId, ticker: series.ticker, nameAr: series.nameAr, sector: series.sector }

  if (series.bars.length < MIN_BARS || series.bars.length < 2) {
    return {
      ...head,
      review: null,
      quota: null, // the route fills the caller's quota after a successful build
      notReviewableAr: `التاريخ المتاح ${series.bars.length} جلسة فقط — أقل من الحد الأدنى ${MIN_BARS} جلسة لبناء المستويات وقراءة موثوقة`,
    }
  }

  const row = await getCompanySignalV2Cached(companyId)
  if (!row || row.metrics === null || row.lastClose === null) {
    return {
      ...head,
      review: null,
      quota: null,
      notReviewableAr: "تعذر حساب المؤشرات الفنية من البيانات المتاحة — جرّب لاحقًا أو راجع صفحة حالة البيانات",
    }
  }

  const map = buildZoneMap(series.bars)
  // 2026-11-19 doctrine gate (الحكم بالإغلاق): the last bar counts as FINAL
  // only when its session is over — a bar dated today (Africa/Cairo) is the
  // live session until 15:00 Cairo. The rule lives in review.ts (pure,
  // testable); the service owns the clock.
  const lastBar = series.bars[series.bars.length - 1]
  const lastBarFinal = isLastBarFinal(lastBar?.ts ?? null)
  // OWNER MANDATE (2026-11-18, «خبرة 100 سنة… عارف سياق السوق»): the veteran
  // review reads the whole-market intelligence section (regime, breadth,
  // sector rotation, liquidity rank). buildMarketContext returns null when
  // intelligence hasn't run — and any unexpected rejection (DB read inside)
  // is swallowed to null so the review still builds WITHOUT market context,
  // just with fewer lines. Fetched only on this successful path, AFTER the
  // row/map checks, so failing series never pay the intelligence cost.
  let marketCtx: MarketContextSection | null = null
  try {
    marketCtx = await buildMarketContext(companyId)
  } catch {
    marketCtx = null
  }
  return {
    ...head,
    review: reviewPosition({ row, bars: series.bars, map, avgBuyPrice, downsideAnswer: downsideAnswer ?? null, marketCtx, lastBarFinal }),
    quota: null, // the route fills the caller's quota after consuming
    notReviewableAr: null,
  }
}
