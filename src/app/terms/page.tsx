import { Metadata } from "next"
import { siteConfig } from "@/lib/seo-config"
import TermsClient from "./terms-client"

export const metadata: Metadata = {
  title: "Terms of Service",
<<<<<<< HEAD
  description:
    "Meza terms: research tool (not a broker), published-filing data with delayed prices, accounts, privacy, one-off 30-day Premium manual activation with no auto-renewal, acceptable use, and governing law.",
  alternates: {
    canonical: "/terms",
    languages: { en: "/terms", "ar-EG": "/terms" },
  },
  openGraph: {
    title: "Terms of Service — Meza",
    description: "How Meza's research service, accounts and one-off Premium activation work.",
    url: "/terms",
    type: "website",
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: "Meza terms of service" }],
  },
=======
  description: "Terms of service for EGXANO.",
    alternates: {
      canonical: "/terms",
      languages: { en: "/terms", "ar-EG": "/terms" },
    },
>>>>>>> b110dc6d46bae06b6754fc83151c5421ad4d72a3
}

export default function TermsPage() {
  return <TermsClient />
}
