import { PLANS, type PlanDef, type PlanId } from "@/lib/plans/entitlements"
import { db } from "@/lib/db"
import { publicCacheControl } from "@/lib/public-cache"

// GET /api/v1/plans — public, cacheable pricing catalog.
//
// PRICING TRUTH (2026-11-16): the /admin/plans editor writes the DB Plan rows
// and the owner expects the site to reflect them — so the catalog reads the
// DB FIRST (canonical names only: FREE / PRO / PRO_3M) and merges over the
// PLANS constant, which stays the fallback (fresh DB, transient DB error) and
// the single source of LIMITS (limits are code-enforced, not admin-editable).
// Cache window shortened to 60s so an admin edit reaches the site quickly.
const TTL_SECONDS = 60

/** Only exact canonical plan names may override the catalog — an arbitrary
 *  priced row must never silently replace PRO. */
function canonicalPlanKey(name: string): PlanId | null {
  const norm = name.trim().toUpperCase().replace(/[\s-]+/g, "_")
  return norm === "FREE" || norm === "PRO" || norm === "PRO_3M" ? (norm as PlanId) : null
}

function parseFeatures(json: string | null): string[] | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed) && parsed.every((f) => typeof f === "string") && parsed.length > 0) {
      return parsed.map((f) => String(f))
    }
  } catch {
    // malformed JSON → keep the shipped features
  }
  return null
}

async function buildCatalog(): Promise<PlanDef[]> {
  const plans: PlanDef[] = (Object.keys(PLANS) as PlanId[])
    .filter((id) => id !== "TRIAL") // TRIAL is granted automatically, never sold
    .map((id) => ({ ...PLANS[id] }))
  try {
    const rows = await db.plan.findMany({
      where: { isActive: true },
      select: { name: true, price: true, currency: true, durationDays: true, offerActive: true, offerPrice: true, offerLabel: true, features: true },
    })
    for (const row of rows) {
      const key = canonicalPlanKey(row.name)
      if (!key) continue
      const def = plans.find((p) => p.id === key)
      if (!def) continue
      if (typeof row.price === "number" && row.price > 0) def.price = row.price
      if (typeof row.durationDays === "number" && row.durationDays > 0) def.durationDays = row.durationDays
      def.offerActive = row.offerActive === true
      def.offerPrice = typeof row.offerPrice === "number" && row.offerPrice > 0 ? row.offerPrice : null
      def.offerLabelAr = row.offerLabel ?? null
      const feats = parseFeatures(row.features)
      if (feats) def.featuresAr = feats
    }
  } catch {
    // DB hiccup → the shipped catalog stands (never a blank pricing page)
  }
  return plans
}

export async function GET() {
  const plans = await buildCatalog()

  return Response.json(
    {
      ok: true,
      offerNoteAr:
        "الأسعار والعروض المعروضة هي الأسعار الرسمية الحالية من إدارة المنصة. كل حساب يحصل تلقائيًا على تجربة مجانية كاملة لمدة شهر بكل المميزات.",
      plans,
    },
    { headers: { "Cache-Control": publicCacheControl(TTL_SECONDS) } },
  )
}
