import type { Metadata } from "next"
import { siteConfig } from "@/lib/seo-config"
import PremiumClient from "./client"

// The pricing page promises exactly the 3 real plans (المجانية / برو / برو 3 شهور)
// with the first-month offers — the same numbers the backend enforces
// (see src/lib/plans/entitlements.ts), so the copy can't drift.
export const metadata: Metadata = {
  title: "الباقات — المجانية وبرو وخطة الـ 3 شهور | EGXANO",
  description:
    "ثلاث باقات على EGXANO: المجانية للتجربة بكل الشركات والخريطة الحرارية، وبرو 150 جنيه/شهر للتابع اليومي للسوق، وخطة الـ 3 شهور بـ 450 جنيه مع خصم 50% على أول شهر. لوحة الإشارات الفنية كاملة، المقارنة والترتيبات، الماسحات المخصصة، التحليل الفني الشامل، التوزيعات والتنبيهات. الدفع عبر انستاباي وتفعيل يدوي بعد مطابقة الحوالة — بدون اشتراك تلقائي.",
  keywords: ["EGX premium", "اشتراك البورصة المصرية", "باقات EGXANO", "تقارير مالية"],
  alternates: {
    canonical: "/premium",
    languages: { en: "/premium", "ar-EG": "/premium" },
  },
  openGraph: {
    title: "باقات EGXANO — المجانية وبرو وخطة الـ 3 شهور",
    description:
      "لوحة إشارات كاملة وأحداث الشركات والماسحات والتنبيهات. خطة 3 شهور بـ 450 ج — أول شهر بخصم 50%.",
    url: "/premium",
    type: "website",
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: "باقات EGXANO" }],
  },
}

export default function PremiumPage() {
  return <PremiumClient />
}
