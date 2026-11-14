import type { Metadata } from "next"
import { siteConfig } from "@/lib/seo-config"
import AboutClient from "./client"

export const metadata: Metadata = {
  title: "About EGXANO — independent Egyptian stock market research",
  description:
    "EGXANO is an independent platform for Egyptian Exchange financial data: statements, calculated ratios, sector rankings and valuations. Not affiliated with the EGX.",
  keywords: ["about EGXANO", "Egyptian Exchange data", "من نحن", "البورصة المصرية"],
  alternates: {
    canonical: "/about",
  },
  openGraph: {
    title: "About EGXANO",
    description: "Independent, audited financial data for Egyptian Exchange companies.",
    url: "/about",
    type: "website",
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: "About EGXANO" }],
  },
}

export default function AboutPage() {
  return <AboutClient />
}