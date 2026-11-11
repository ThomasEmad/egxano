import type { Metadata } from "next"
import { siteConfig } from "@/lib/seo-config"
import PremiumClient from "./client"

export const metadata: Metadata = {
  title: "Premium — full reports, company events and unlimited analysis",
  description:
<<<<<<< HEAD
    "Meza Premium: all detected company events, unlimited Smart Analyses with instant refresh, full rankings and valuation lists, the full multi-year company report with print/PDF, and a portfolio without the 2-position cap. One plan, 30 days, manual activation after payment verification — no card stored, no auto-renewal.",
=======
    "Unlock the full EGXANO dataset: complete rankings across every sector, print-ready company reports and portfolio tools. Billing is handled manually after a request — no card is stored.",
>>>>>>> b110dc6d46bae06b6754fc83151c5421ad4d72a3
  keywords: ["EGX premium", "اشتراك البورصة المصرية", "تقارير مالية"],
  alternates: {
    canonical: "/premium",
    languages: { en: "/premium", "ar-EG": "/premium" },
  },
  openGraph: {
<<<<<<< HEAD
    title: "Premium — Meza",
    description: "Full reports, company events and unlimited analysis for Egyptian Exchange research. One plan, 30 days, manual activation.",
=======
    title: "Premium — EGXANO",
    description: "Full EGX dataset, complete rankings, print-ready reports and portfolio tools.",
>>>>>>> b110dc6d46bae06b6754fc83151c5421ad4d72a3
    url: "/premium",
    type: "website",
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: "EGXANO Premium" }],
  },
}

export default function PremiumPage() {
  return <PremiumClient />
}
