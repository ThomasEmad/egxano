import { Metadata } from "next"
import { siteConfig } from "@/lib/seo-config"
import DisclaimerClient from "./disclaimer-client"

export const metadata: Metadata = {
<<<<<<< HEAD
  title: "Risk notice and disclaimer",
  description:
    "Meza's risk notice: sources are published filings and a delayed public price source (15 minutes), calculated vs reported values, unavailable values shown as “—” (never estimated), AI-assisted interpretation is not advice, and no buy/sell recommendations.",
  alternates: {
    canonical: "/disclaimer",
    languages: { en: "/disclaimer", "ar-EG": "/disclaimer" },
  },
  openGraph: {
    title: "Risk notice — Meza",
    description: "Data sources, price delay, AI interpretation and the limits of what Meza's figures mean.",
    url: "/disclaimer",
    type: "website",
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: "Meza risk notice" }],
  },
=======
  title: "Disclaimer",
  description: "Important disclaimers about data accuracy, investment risk, and service limitations for EGXANO.",
    alternates: {
      canonical: "/disclaimer",
      languages: { en: "/disclaimer", "ar-EG": "/disclaimer" },
    },
>>>>>>> b110dc6d46bae06b6754fc83151c5421ad4d72a3
}

export default function DisclaimerPage() {
  return <DisclaimerClient />
}
