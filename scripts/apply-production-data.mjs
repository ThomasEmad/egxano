// ترحيل داتا الإنتاج — idempotent: يشتغل أكتر من مرة بأمان وبيطّلع نفس النتيجة.
//
// الخطوات:
//   (a) Company: marketTier "NILEX" → "MAIN" (بورصة النيل دُمجت في السوق
//       الرئيسي بعد هذه الإصدارة — القيم المتاحة: EGX30 | EGX70 | MAIN | OTC)
//   (b) Setting upsert للمفتاح PAYMENT_INSTRUCTIONS — تعليمات الدفع:
//       انستاباي + كتابة الإيميل المسجّل في خانة الملاحظة فوق التحويل،
//       بدون واتساب.
//   (c) حذف صف Setting بالمفتاح WHATSAPP_NUMBER لو موجود (استُبدل بـ (b)).
//   (d) ملخص "DONE" في الآخر.
//
// القراءة من env: DATABASE_URL (PrismaClient بيقرأه مباشرة) — لا يُطبع
// ولا يُخزّن أي قيمة سرية في أي مكان.
//
// الاستخدام: node scripts/apply-production-data.mjs

import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL مش متظبط في البيئة — السكريبت بيقرأه من env وقت التشغيل.")
  await db.$disconnect()
  process.exit(1)
}

const summary = []

// (a) NILEX → MAIN -----------------------------------------------------------
const nilexBefore = await db.company.count({ where: { marketTier: "NILEX" } })
let nilexMigrated = 0
if (nilexBefore > 0) {
  const r = await db.company.updateMany({
    where: { marketTier: "NILEX" },
    data: { marketTier: "MAIN" },
  })
  nilexMigrated = r.count
}
const nilexAfter = await db.company.count({ where: { marketTier: "NILEX" } })
summary.push(
  `(a) NILEX→MAIN: قبل=${nilexBefore} تم تحديثه=${nilexMigrated} بعد=${nilexAfter}${
    nilexAfter === 0 ? " (تمام)" : " (لسه فيه NILEX!)"
  }`
)

// (b) Setting PAYMENT_INSTRUCTIONS -------------------------------------------
const PAYMENT_KEY = "PAYMENT_INSTRUCTIONS"
const PAYMENT_VALUE =
  "الدفع عبر انستاباي (InstaPay): حوّل المبلغ واكتب بريدك الإلكتروني المسجّل عندنا في خانة الملاحظة (Note) فوق التحويل — التفعيل بيتم بعد مطابقة الحوالة، عادة خلال ساعات قليلة. | EN: Pay via InstaPay and write your registered email in the transfer note. Activation happens after the transfer is matched — usually within hours."
const PAYMENT_DESC = "Premium payment instructions — InstaPay + email-in-note, no WhatsApp"
const payment = await db.setting.upsert({
  where: { key: PAYMENT_KEY },
  update: { value: PAYMENT_VALUE, type: "string", description: PAYMENT_DESC },
  create: { key: PAYMENT_KEY, value: PAYMENT_VALUE, type: "string", description: PAYMENT_DESC },
})
summary.push(`(b) Setting ${PAYMENT_KEY}: upsert تم (key=${payment.key}, type=${payment.type}) — idempotent`)

// (c) حذف WHATSAPP_NUMBER لو موجود --------------------------------------------
const deleted = await db.setting.deleteMany({ where: { key: "WHATSAPP_NUMBER" } })
summary.push(`(c) Setting WHATSAPP_NUMBER: ات حذفت ${deleted.count} صف${deleted.count === 0 ? " (مكانش موجود أصلاً)" : ""}`)

// (d) DONE --------------------------------------------------------------------
console.log("ملخص ترحيل داتا الإنتاج:")
for (const line of summary) console.log("  " + line)
console.log("DONE")
await db.$disconnect()
