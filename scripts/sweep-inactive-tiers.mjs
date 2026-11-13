// كشف شركات "خارج المقصورة" (OTC) بالسلوك الفعلي مش بالتصنيف اليدوي.
//
// الفكرة: شركة MAIN نشطة لازم يكون ليها نبض حي — سعر من TradingView scanner
// أو شمعة من بايپلاين الشمعات. لو آخر MarketPrice.asOf وآخر PriceBar.ts
// الاتنين أقدم من 45 يوم (أو مش موجودين خالص) يبقى المرشح OTC
// ("خارج المقصورة"). الفحص على marketTier="MAIN" فقط — EGX30/EGX70
// لا يُلمس نهائياً حسب البناء هنا.
//
// الكفاءة: استعلامَي GROUP BY بس (MAX لكل شركة على MarketPrice وPriceBar)
// بيتحمّلوا في Maps بدل استعلام لكل شركة.
//
// الوضع الافتراضي DRY-RUN: بيعرض المرشحين مجمّعين حسب القطاع مع nameAr
// وتاريخ آخر نبض لكل من السعر والشمعات، بدون أي كتابة. --apply يحدّث
// marketTier="OTC" عبر updateMany واحدة (idempotent — إعادة التشغيل آمنة:
// المرشّحين بعد التطبيق هيبقوا OTC فمش هيظهرولي تاني في السويب الجاي).
//
// الاستخدام:
//   node scripts/sweep-inactive-tiers.mjs           # dry-run
//   node scripts/sweep-inactive-tiers.mjs --apply   # تطبيق OTC فعلياً
//
// يتطلب DATABASE_URL في البيئة.

import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

const STALE_DAYS = 45
const apply = process.argv.slice(2).includes("--apply")
const cutoff = new Date(Date.now() - STALE_DAYS * 86_400_000)

// استعلامَي GROUP BY واحدات — من غير استعلام لكل شركة.
const [priceMax, barMax, mainCompanies] = await Promise.all([
  db.$queryRaw`SELECT "companyId", MAX("asOf") AS "lastAsof" FROM "MarketPrice" GROUP BY "companyId"`,
  db.$queryRaw`SELECT "companyId", MAX("ts") AS "lastBar" FROM "PriceBar" GROUP BY "companyId"`,
  db.company.findMany({
    where: { isActive: true, marketTier: "MAIN" },
    select: { id: true, ticker: true, nameAr: true, sector: true },
    orderBy: { ticker: "asc" },
  }),
])

const priceMap = new Map(priceMax.map((r) => [r.companyId, r.lastAsof]))
const barMap = new Map(barMax.map((r) => [r.companyId, r.lastBar]))

// المرشّح: الاتنين stale (أقدم من الحد — والقيمة الناقصة تُحسب stale).
const isStale = (d) => !(d instanceof Date) || d.getTime() < cutoff.getTime()
const candidates = mainCompanies.filter(
  (co) => isStale(priceMap.get(co.id)) && isStale(barMap.get(co.id))
)

const fmt = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : "مفيش")

console.log(
  `الحد الفاصل: ${cutoff.toISOString().slice(0, 10)} (آخر ${STALE_DAYS} يوم)`
)
console.log(
  `شركات MAIN النشطة المفحوصة: ${mainCompanies.length} | المرشحون OTC: ${candidates.length}`
)
console.log(
  `المعايير: آخر سعر أقدم من الحد ${cutoff.toISOString().slice(0, 10)} وأخر شمعة أقدم منه (أو ناقصين).`
)
console.log(
  `وضع التشغيل: ${apply ? "APPLY — تحديث marketTier=OTC فعلياً" : "DRY-RUN — عرض فقط"}\n`
)

// عرض مجمّع حسب القطاع مع الاسم العربي.
const bySector = new Map()
for (const co of candidates) {
  const list = bySector.get(co.sector) ?? []
  list.push(co)
  bySector.set(co.sector, list)
}
for (const [sector, list] of [...bySector.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`[${sector}] (${list.length}):`)
  for (const co of list) {
    console.log(
      `  ${co.ticker.padEnd(7)} ${co.nameAr ?? "-"} — آخر سعر: ${fmt(priceMap.get(co.id))} | آخر شمعة: ${fmt(barMap.get(co.id))}`
    )
  }
}
console.log("")

if (!apply) {
  console.log(
    `DONE (dry-run): ${candidates.length} مرشح OTC — شغّل بـ --apply للتطبيق الفعلي.`
  )
} else if (candidates.length === 0) {
  console.log("DONE (apply): مفيش مرشحين — لم يُنفّذ أي تحديث.")
} else {
  const otcBefore = await db.company.count({ where: { marketTier: "OTC" } })
  const r = await db.company.updateMany({
    where: { id: { in: candidates.map((c) => c.id) } },
    data: { marketTier: "OTC" },
  })
  const otcAfter = await db.company.count({ where: { marketTier: "OTC" } })
  console.log(
    `DONE (apply): updateMany طابق ${r.count} شركة → OTC. عدّاد OTC: قبل=${otcBefore} بعد=${otcAfter}. EGX30/EGX70 لم تُلمس.`
  )
}

await db.$disconnect()
