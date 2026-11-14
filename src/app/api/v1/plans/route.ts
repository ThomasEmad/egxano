import { PLANS, type PlanId } from "@/lib/plans/entitlements"
import { publicCacheControl } from "@/lib/public-cache"

// GET /api/v1/plans — public, cacheable pricing catalog.
//
// Sourced from the PLANS constant (the single source of truth the whole app
// enforces), NOT from the DB — the marketing page and the enforced gates read
// the same values, so they can never drift. Pure data, no auth, 5-minute
// edge/browser cache.
const TTL_SECONDS = 300

export async function GET() {
  const plans = (Object.keys(PLANS) as PlanId[]).map((id) => {
    const p = PLANS[id]
    return {
      id: p.id,
      nameAr: p.nameAr,
      nameEn: p.nameEn,
      taglineAr: p.taglineAr,
      price: p.price,
      offerPrice: p.offerPrice,
      offerActive: p.offerActive,
      offerLabelAr: p.offerLabelAr,
      currency: p.currency,
      durationDays: p.durationDays,
      featuresAr: p.featuresAr,
      limits: p.limits,
    }
  })

  return Response.json(
    {
      ok: true,
      offerNoteAr: "خصم 50% على أول شهر لخطة الـ 3 شهور (أول دورة 375 بدل 450) — وأول شهر بخصم 40% على برو",
      plans,
    },
    { headers: { "Cache-Control": publicCacheControl(TTL_SECONDS) } },
  )
}
