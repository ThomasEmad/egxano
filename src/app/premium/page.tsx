import type { Metadata } from "next"
import { siteConfig } from "@/lib/seo-config"
import PremiumClient from "./client"

export const metadata: Metadata = {
  title: "Premium — full reports, company events and unlimited analysis",
  description:
    "Meza Premium: all detected company events, unlimited Smart Analyses with instant refresh, full rankings and valuation lists, the full multi-year company report with print/PDF, and a portfolio without the 2-position cap. One plan, 30 days, manual activation after payment verification — no card stored, no auto-renewal.",
  keywords: ["EGX premium", "اشتراك البورصة المصرية", "تقارير مالية"],
  alternates: {
    canonical: "/premium",
    languages: { en: "/premium", "ar-EG": "/premium" },
  },
  openGraph: {
    title: "Premium — Meza",
    description: "Full reports, company events and unlimited analysis for Egyptian Exchange research. One plan, 30 days, manual activation.",
    url: "/premium",
    type: "website",
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: "Meza Premium" }],
  },
}

export default function PremiumPage() {
  return <PremiumClient />
}
