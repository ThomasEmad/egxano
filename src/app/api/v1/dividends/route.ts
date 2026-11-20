import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { cachedResponse, queryKey, tableFingerprint } from "@/lib/public-cache"

const STATUSES = ["ANNOUNCED", "UPCOMING", "ELIGIBLE", "PAID", "EXPIRED", "CANCELLED"]

// GET /api/v1/dividends — dividend records with optional status filter.
// Dates that are not officially available are returned as null (never inferred).
//
// The cache key carries the Dividend table's write fingerprint: import jobs
// run from GitHub Actions (admin ops) and self-hosted scripts write rows
// without any channel to invalidate this cache — the fingerprint rolls the
// key so new rows are live within ~60s instead of the full 6h TTL (see
// tableFingerprint).
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const status = url.searchParams.get("status")?.trim() || ""

  const where: Record<string, unknown> = {}
  if (status && STATUSES.includes(status)) where.status = status

  const fp = await tableFingerprint("dividend", async () => {
    const agg = await db.dividend.aggregate({ _max: { id: true, updatedAt: true }, _count: true })
    return `${agg._count}:${agg._max.id ?? "-"}:${agg._max.updatedAt?.getTime() ?? "-"}`
  })

  return cachedResponse(`dividends:v${fp}:${queryKey(req, ["status"])}`, 6 * 60 * 60 * 1000, async () => {
    const dividends = await db.dividend.findMany({
      where,
      include: {
        company: { select: { id: true, ticker: true, nameEn: true, nameAr: true, sector: true, isDemoData: true } },
      },
      orderBy: [{ announcementDate: "desc" }],
    })
    return { dividends }
  })
}
