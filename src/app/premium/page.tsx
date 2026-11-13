import type { Metadata } from "next"
import { siteConfig } from "@/lib/seo-config"
import PremiumClient from "./client"

// The pricing page promises exactly the 3 real plans (المجانية / برو / برو بلس)
// with the first-month 40% offer on the paid tiers — the same numbers the
// backend enforces (see src/lib/plans/entitlements.ts), so the copy can't drift.
export const metadata: Metadata = {
  title: "الباقات — المجانية وبرو وبرو بلس | EGXANO",
  description:
    "ثلاث باقات على EGXANO: المجانية للتجربة، برو 150 جنيه/شهر للتابع اليومي للسوق، وبرو بلس 300 جنيه/شهر مع تقرير PDF القابل للطباعة — وأول شهر بخصم 40% على برو وبرو بلس. لوحة الإشارات الفنية كاملة، تحليلات ذكية بلا حد، بريفينج صوتي، أحداث الشركات والماسحات. الدفع عبر انستاباي وتفعيل يدوي بعد مطابقة الحوالة — بدون اشتراك تلقائي.",
  keywords: ["EGX premium", "اشتراك البورصة المصرية", "باقات EGXANO", "تقارير مالية"],
  alternates: {
    canonical: "/premium",
    languages: { en: "/premium", "ar-EG": "/premium" },
  },
  openGraph: {
    title: "باقات EGXANO — المجانية وبرو وبرو بلس",
    description:
      "ثلاث باقات لبحث البورصة المصرية: لوحة إشارات كاملة، تحليلات ذكية بلا حد، بريفينج صوتي وتقرير PDF. أول شهر بخصم 40% على برو وبرو بلس.",
    url: "/premium",
    type: "website",
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: "باقات EGXANO" }],
  },
}

export default function PremiumPage() {
  return <PremiumClient />
}
