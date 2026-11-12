import { NextRequest } from "next/server"
import { computePiotroski } from "@/lib/financial/piotroski"
import { findCompanyByKey } from "@/lib/company-lookup"
import { publicCacheControl } from "@/lib/public-cache"

// GET /api/v1/companies/[id]/f-score — criterion-level Piotroski F-Score
// (piotroski@1) computed deterministically from the two most recent annual
// reports of a matching statement basis. Every criterion carries its input
// figures and period, so the UI can show evidence next to each pass/fail.
// `[id]` accepts company id, ticker or ISIN (see findCompanyByKey).
// Cached at the CDN for 5 minutes — the underlying statements change rarely.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const company = await findCompanyByKey(id)
  if (!company) return Response.json({ error: "NOT_FOUND" }, { status: 404 })
  const result = await computePiotroski(company.id)
  if (!result) {
    return Response.json(
      { error: "INSUFFICIENT_PERIODS", message: "Two annual reports are required for the F-Score." },
      { status: 404 },
    )
  }
  return Response.json(result, { headers: { "Cache-Control": publicCacheControl(300) } })
}
