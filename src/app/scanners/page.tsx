import type { Metadata } from "next"
import { siteConfig } from "@/lib/seo-config"
import ScannersPageClient from "./client"

export const metadata: Metadata = {
  title: "EGX Financial Screeners — Ready-made & Custom Scans",
  description:
    "Ready-made Egyptian Exchange screeners (turnarounds, debt reduction, strong cash flow, high ROE) plus a custom scanner with explicit, validated rules. Every matched condition is explained.",
  keywords: ["EGX screener", "Egyptian stock scanner", "ماسحات البورصة المصرية", "فلتر أسهم مصر"],
  alternates: {
    canonical: "/scanners",
    languages: { en: "/scanners", "ar-EG": "/scanners" },
  },
  openGraph: {
    title: "EGX Financial Screeners — EGXANO",
    description: "Ready-made and custom screeners for Egyptian Exchange companies — explicit rules, explained matches.",
    url: "/scanners",
    type: "website",
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: "EGXANO screeners" }],
  },
}

export default function ScannersPage() {
  return <ScannersPageClient />
}
