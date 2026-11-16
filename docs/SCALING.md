# جاهزية Vercel لـ 10,000 مستخدم متزامن — EGXANO

> تقييم جاهزية (2026-11-17) بعد إصلاح فقدان الاتصال ونقل قاعدة البيانات إلى Neon.

## الخلاصة

المعمارية الحالية (Next.js على Vercel serverless + Neon Postgres المجمَّع) تصلح
أساسًا لحمل 10 آلاف مستخدم متزامن، بشرطين مُنفَّذين بالفعل وشرطين إجرائيين على
صاحب الحساب. لا يمكن إثبات الرقم من بيئة التطوير — الأمر يتبع اختبار حمل حقيقي
(الأمر الجاهز بالأسفل) مع خطة مدفوعة على النطاقين.

## ما هو منفَّذ بالفعل (في الكود)

1. **تجميع الاتصالات على مستوى كل دالة**: `DATABASE_URL` يجب أن يكون رابط Neon
   المُجمَّع (`-pooler` host) — وضع `prisma/schema.prisma` موثّق على ذلك، و
   `src/lib/db.ts` يعيد استخدام نسخة Prisma واحدة لكل عملية Lambda
   (`globalThis` cache) بدل فتح اتصال جديد لكل طلب.
2. **لا حالة داخل الذاكرة**: كل بيانات السوق تُقرأ من Postgres ولا تعتمد الصفحات
   على ذاكرة العملية (العملية على Vercel مؤقتة بطبيعتها).
3. **sitemap لا يُسقط النشر** إذا انقطعت قاعدة البيانات لحظة البناء
   (fallback ثابت) — انظر `src/app/sitemap.ts`.
4. **حماية مسارات cron** بمفتاح `CRON_SECRET` timing-safe.

## الإجراءات المطلوبة على صاحب الحساب

1. **خطة Vercel Pro** (~$20/شهر): عند 10 آلاف متزامن، حدود خطة Hobby (حجم
   bandwidth وعدد دوالّ الأداء) ستُخنق الموقع قبل أن تصل قاعدة البيانات.
2. **خطة Neon Scale أو Launch**: كي يتحرك `compute` تلقائيًا للأعلى؛ خطة Free
   تنام بعد اللاستخدام وتواجه جدار connection points.
3. **ضبط حد الاتصال لكل دالة**: أضف إلى رابط `DATABASE_URL` المُجمَّع على Vercel:
   `?sslmode=require&connection_limit=10`
   الحسبة: 10k مستخدم ≈ ذروة ~200-400 طلب/ثانية، كل دالة تحمل حتى 10 اتصالات،
   و Neon pooled يستوعبها (pooled endpoint يدير آلاف الاتصالات الواردة عبر
   PgBouncer الداخلي).

## اختبار الحمل (شغّله قبل ذروة الاستخدام)

```bash
# k6 — يجرّب 10 آلاف مستخدم افتراضي يتزايدون خلال 5 دقائق على الصفحات الثقيلة
k6 run - <<'EOF'
import http from 'k6/http'
import { sleep } from 'k6'
export const options = { stages: [
  { duration: '2m', target: 2000 },
  { duration: '3m', target: 10000 },
  { duration: '2m', target: 0 } ] }
export default function () {
  http.get('https://egxano.vercel.app/')
  http.get('https://egxano.vercel.app/companies')
  http.get('https://egxano.vercel.app/api/v1/status')
  sleep(1)
}
EOF
```

معايير النجاح: p95 < 1.5s و `0` أخطاء 503/502 من Vercel، ولاتصالات Neon
رفض (`too many connections`) في لوحة Neon.

## المخاطر المتبقية المعروفة

- **شموع EOD اليومية** تعتمد على GitHub Action (`candles-refresh.yml`) لأن Yahoo
  يحجب خروج Vercel — تأكد أن سر `CANDLE_DB_URL` يحمل رابط Neon المباشر
  (غير المُجمَّع) بعد النقل، وإلا فالشموع التاريخية ستتوقف عن التحديث.
- صفحات التقارير الثقيلة (`/company/[id]/report`) تُستدعى على الطلب — إن صارت
  ذروة عليها، فعّل ISR بـ `revalidate` بدل `force-dynamic` (حالياً الصفحات
  الرئيسية تعمل بالجلب المباشر لأن البيانات حساسة للتوقيت).
