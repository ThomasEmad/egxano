// =============================================================================
// حلل سهمي (Position Review) — DB wiring. Reuses the signals series builder
// (same merge/override/corporate-action pass) and the cached v2 row so the
// review reads the EXACT anatomy the signals board reads. No writes anywhere.
// =============================================================================

import { buildZoneMap } from "@/lib/signals/levels"
import { getCompanySeriesCached, getCompanySignalV2Cached } from "@/lib/signals/board-service"
import { MIN_BARS } from "@/lib/signals/types"
import { reviewPosition } from "./review"
import type { PositionReviewResult } from "./types"

/**
 * Build the full position review for one company + the user's average buy
 * price. Returns null only when the company itself is gone — otherwise a
 * result carries either the review or an honest "not reviewable" reason.
 */
export async function buildPositionReview(companyId: string, avgBuyPrice: number): Promise<PositionReviewResult | null> {
  const series = await getCompanySeriesCached(companyId)
  if (!series) return null

  const head = { companyId: series.companyId, ticker: series.ticker, nameAr: series.nameAr, sector: series.sector }

  if (series.bars.length < MIN_BARS || series.bars.length < 2) {
    return {
      ...head,
      review: null,
      notReviewableAr: `التاريخ المتاح ${series.bars.length} جلسة فقط — أقل من الحد الأدنى ${MIN_BARS} جلسة لبناء المستويات وقراءة موثوقة`,
    }
  }

  const row = await getCompanySignalV2Cached(companyId)
  if (!row || row.metrics === null || row.lastClose === null) {
    return {
      ...head,
      review: null,
      notReviewableAr: "تعذر حساب المؤشرات الفنية من البيانات المتاحة — جرّب لاحقًا أو راجع صفحة حالة البيانات",
    }
  }

  const map = buildZoneMap(series.bars)
  return {
    ...head,
    review: reviewPosition({ row, bars: series.bars, map, avgBuyPrice }),
    notReviewableAr: null,
  }
}
