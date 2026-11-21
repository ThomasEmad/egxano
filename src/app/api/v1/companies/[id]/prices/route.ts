import { db } from "@/lib/db"
import { findCompanyByKey } from "@/lib/company-lookup"

// GET /api/v1/companies/[id]/prices — full price history for the chart.
// `[id]` accepts company id, ticker or ISIN (see findCompanyByKey).
//
// SAME-SOURCE MANDATE (2026-11-21): the chart reads the unified candle store
// (MarketCandle, verified rows — real daily OHLCV). Companies the store does
// not cover fall back to the legacy harvested quote snapshots (the old
// sparse shape — `price` only — so existing consumers keep working).

const MAX_SESSIONS = 520

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const company = await findCompanyByKey(id)
  if (!company) return Response.json({ error: "NOT_FOUND" }, { status: 404 })

  const candles = await db.marketCandle.findMany({
    where: { companyId: company.id, verified: true },
    orderBy: { tradeDate: "desc" },
    take: MAX_SESSIONS,
    select: { tradeDate: true, open: true, high: true, low: true, close: true, volume: true },
  })
  if (candles.length > 0) {
    return Response.json({
      prices: candles
        .reverse()
        .map((c) => ({
          asOf: c.tradeDate,
          price: c.close,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          currency: "EGP",
        })),
    })
  }

  const prices = await db.marketPrice.findMany({
    where: { companyId: company.id },
    orderBy: { asOf: "asc" },
    select: { asOf: true, price: true, currency: true },
  })

  return Response.json({ prices })
}
