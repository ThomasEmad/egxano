import { buildPrismaClient } from "../src/lib/db"
import { PLANS } from "../src/lib/plans/entitlements"

const db = buildPrismaClient()

// The 3 production plans are seeded straight from the single source of truth
// (src/lib/plans/entitlements.ts) so the DB rows can never drift from the
// pricing/enforcement the product code uses. Idempotent: each plan is resolved
// by name first (rows may exist from older seeds with a different cuid) and
// only created when no row with that name exists.
const PLAN_IDS: Record<string, string> = {
  FREE: "free",
  PRO: "pro",
  PRO_PLUS: "pro-plus",
}

async function main() {
  // Seed the 3 plans from PLANS (FREE/PRO/PRO_PLUS)
  for (const plan of Object.values(PLANS)) {
    const existing = await db.plan.findFirst({ where: { name: plan.id } })
    const data = {
      name: plan.id,
      price: plan.price,
      offerPrice: plan.offerPrice,
      offerActive: plan.offerActive,
      offerLabel: plan.offerLabelAr,
      currency: plan.currency,
      durationDays: plan.durationDays,
      features: JSON.stringify(plan.featuresAr),
      isActive: true,
      isDefault: plan.id === "FREE",
      sortOrder: plan.id === "FREE" ? 1 : plan.id === "PRO" ? 2 : 3,
    }
    const row = existing
      ? await db.plan.update({ where: { id: existing.id }, data })
      : await db.plan.upsert({
          where: { id: PLAN_IDS[plan.id] ?? plan.id },
          update: data,
          create: { id: PLAN_IDS[plan.id] ?? plan.id, ...data },
        })
    console.log(`Seeded plan: ${row.name} (${row.price} ${row.currency})`)
  }

  // Exactly 3 plans are sellable — any legacy row (e.g. the old "PREMIUM"
  // 99 EGP plan) keeps its FK references but is no longer offered/active.
  const legacy = await db.plan.updateMany({
    where: { name: { notIn: Object.keys(PLANS) } },
    data: { isActive: false },
  })
  if (legacy.count > 0) console.log(`Deactivated ${legacy.count} legacy plan row(s)`)

  // Seed default settings
  // NOTE: payment support is InstaPay ONLY — the user writes their REGISTERED
  // EMAIL in the InstaPay note and the admin matches the transfer. There is no
  // WhatsApp channel and no WhatsApp setting anywhere in the product.
  const settings = [
    { key: "PREMIUM_ENABLED", value: "true", type: "boolean", description: "Enable premium subscriptions" },
    { key: "ADS_ENABLED", value: "true", type: "boolean", description: "Enable ads for free users" },
    { key: "PREMIUM_PRICE", value: "150", type: "number", description: "Legacy premium price (kept for old clients — plans come from the Plan table)" },
    { key: "PREMIUM_CURRENCY", value: "EGP", type: "string", description: "Premium subscription currency" },
    { key: "PREMIUM_DURATION_DAYS", value: "30", type: "number", description: "Premium subscription duration in days" },
    { key: "PAYMENT_PHONE", value: "", type: "string", description: "Payment phone number" },
    {
      key: "PAYMENT_INSTRUCTIONS",
      value:
        "الدفع عبر انستاباي (InstaPay): حوّل المبلغ واكتب بريدك الإلكتروني المسجّل عندنا في خانة الملاحظة (Note) فوق التحويل — التفعيل بيتم بعد مطابقة الحوالة، عادة خلال ساعات قليلة. (EN: Pay via InstaPay and write your registered email in the transfer note. Activation after the transfer is matched — usually within hours.)",
      type: "string",
      description: "Payment instructions shown to users",
    },
  ]

  for (const s of settings) {
    await db.setting.upsert({
      where: { key: s.key },
      update: { value: s.value, type: s.type, description: s.description },
      create: { key: s.key, value: s.value, type: s.type, description: s.description },
    })
  }
  // Scrub the retired WhatsApp contact setting if an old seed left it behind.
  await db.setting.deleteMany({ where: { key: "WHATSAPP_NUMBER" } })

  console.log(`Seeded ${settings.length} settings`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
