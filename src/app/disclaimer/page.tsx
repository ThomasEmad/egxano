import { Metadata } from "next"
import { siteConfig } from "@/lib/seo-config"
import DisclaimerClient from "./disclaimer-client"

export const metadata: Metadata = {
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
}

export default function DisclaimerPage() {
  return <DisclaimerClient />
}
