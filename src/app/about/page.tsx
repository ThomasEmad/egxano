import type { Metadata } from "next"
import { siteConfig } from "@/lib/seo-config"
import AboutClient from "./client"

export const metadata: Metadata = {
  title: "About — independent Egyptian stock market research",
  description:
<<<<<<< HEAD
    "Meza is an independent Egyptian Exchange research platform: published financial statements, calculated ratios, fair comparisons and technical context. Not affiliated with the EGX, any broker or issuer. Not investment advice.",
  keywords: ["about Meza", "Egyptian Exchange data", "من نحن", "البورصة المصرية"],
  alternates: {
    canonical: "/about",
    languages: { en: "/about", "ar-EG": "/about" },
  },
  openGraph: {
    title: "About Meza",
    description: "Independent Egyptian stock market research, with a source and date for every figure.",
=======
    "EGXANO is an independent platform for Egyptian Exchange financial data: statements, calculated ratios, sector rankings and valuations. Not affiliated with the EGX.",
  keywords: ["about EGXANO", "Egyptian Exchange data", "من نحن", "البورصة المصرية"],
    alternates: {
      canonical: "/about",
      languages: { en: "/about", "ar-EG": "/about" },
    },
  openGraph: {
    title: "About EGXANO",
    description: "Independent, audited financial data for Egyptian Exchange companies.",
>>>>>>> b110dc6d46bae06b6754fc83151c5421ad4d72a3
    url: "/about",
    type: "website",
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: "About EGXANO" }],
  },
}

export default function AboutPage() {
  return <AboutClient />
}
