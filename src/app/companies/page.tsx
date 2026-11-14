import type { Metadata } from "next"
import { siteConfig } from "@/lib/seo-config"
import { CompaniesPageShell } from "./client"

export const metadata: Metadata = {
  title: "EGX Companies — All Listed Egyptian Exchange Companies",
  description:
    "Browse every listed Egyptian Exchange company: live price, market cap, sector and verified annual financials (revenue, net profit, ROE). Search and filter in Arabic and English.",
  keywords: [
    "EGX companies",
    "Egyptian Exchange listed companies",
    "شركات البورصة المصرية",
    "قائمة الأسهم المصرية",
    "أسعار الأسهم اليوم",
  ],
  alternates: {
    canonical: "/companies",
  },
  openGraph: {
    title: "EGX Companies — All Listed Egyptian Exchange Companies",
    description: "Browse every listed EGX company with price, market cap and verified financials.",
    url: "/companies",
    type: "website",
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: "EGX companies" }],
  },
}

export default function CompaniesPage() {
  // Server-rendered H1: the client shell swaps in its visual heading only after
  // data loads, so crawlers and LLMs (no JS execution) would otherwise see a
  // headingless page. sr-only keeps the visual design unchanged.
  return (
    <>
      <h1 className="sr-only">
        All listed Egyptian Exchange companies — أسعار وقوائم شركات البورصة المصرية
      </h1>
      <CompaniesPageShell />
    </>
  )
}
