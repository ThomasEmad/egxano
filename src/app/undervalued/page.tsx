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
  },
  openGraph: {
    title: "Undervalued EGX stocks — EGXANO",
    description: "EGX companies meeting explicit, stated valuation criteria — with the criteria shown per company.",
    url: "/undervalued",
    type: "website",
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: "EGXANO valuation screen" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Undervalued EGX stocks — EGXANO",
    description: "EGX companies meeting explicit valuation criteria, with the criteria shown per company.",
    images: [siteConfig.ogImage],
  },
}

export default function UndervaluedPage() {
  return (
    <>
      <h1 className="sr-only">
        Undervalued EGX stocks — فحص التقييم واكتشاف الأسهم المقومة بأقل من قيمتها في البورصة المصرية
      </h1>
      <UndervaluedClient />
    </>
  )
}