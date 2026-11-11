import type { Metadata } from "next"
import { siteConfig } from "@/lib/seo-config"
import UndervaluedClient from "./client"

export const metadata: Metadata = {
  title: "Valuation screen — EGX companies meeting stated criteria · فحص التقييم",
  description:
    "Egyptian Exchange companies that meet explicit valuation criteria — P/E below the sector median, price below book value, dividend yield in the sector's top quartile, and more. Each candidate lists the criteria it met; the criteria-implied value is arithmetic, not a price target or a recommendation.",
  keywords: [
    "EGX valuation screen",
    "Egyptian stocks valuation",
    "P/E below sector",
    "فحص التقييم",
    "تقييم أسهم البورصة المصرية",
  ],
  alternates: {
    canonical: "/undervalued",
    languages: { en: "/undervalued", "ar-EG": "/undervalued" },
  },
  openGraph: {
    title: "Valuation screen — Meza",
    description: "EGX companies meeting explicit, stated valuation criteria — with the criteria shown per company.",
    url: "/undervalued",
    type: "website",
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: "Meza valuation screen" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Valuation screen — Meza",
    description: "EGX companies meeting explicit valuation criteria, with the criteria shown per company.",
    images: [siteConfig.ogImage],
  },
}

export default function UndervaluedPage() {
  return <UndervaluedClient />
}
