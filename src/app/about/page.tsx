import type { Metadata } from "next"
import { siteConfig } from "@/lib/seo-config"
import AboutClient from "./client"

export const metadata: Metadata = {
  title: "About — independent Egyptian stock market research",
  description:
    "Meza is an independent Egyptian Exchange research platform: published financial statements, calculated ratios, fair comparisons and technical context. Not affiliated with the EGX, any broker or issuer. Not investment advice.",
  keywords: ["about Meza", "Egyptian Exchange data", "من نحن", "البورصة المصرية"],
  alternates: {
    canonical: "/about",
    languages: { en: "/about", "ar-EG": "/about" },
  },
  openGraph: {
    title: "About Meza",
    description: "Independent Egyptian stock market research, with a source and date for every figure.",
    url: "/about",
    type: "website",
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: "About Meza" }],
  },
}

export default function AboutPage() {
  return <AboutClient />
}
