import type { Metadata } from "next"
import { siteConfig } from "@/lib/seo-config"
import SignalsPageClient from "./client"

export const metadata: Metadata = {
  title: "EGX Technical Signals — Rule-Based Market Reads",
  description:
    "Deterministic technical readings for Egyptian Exchange companies: five documented opportunity types (breakout, retest, support bounce, trend continuation, confirmed reversal) scored 0-100 with cited evidence, executable entry/stop/target levels, and a buy / near-activation / wait / exit board. Rule-based, verifiable — not a recommendation, and never a short-selling call (exits close existing longs).",
  keywords: ["EGX technical signals", "تحليل فني البورصة المصرية", "إشارات شراء", "technical scanner Egypt", "RSI MACD فلترة"],
  alternates: {
    canonical: "/signals",
  },
  openGraph: {
    title: "EGX Technical Signals — EGXANO",
    description: "Rule-based technical readings across the Egyptian market — cited evidence, executable levels, full transparency.",
    url: "/signals",
    type: "website",
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: "EGXANO technical signals" }],
  },
}

export default function SignalsPage() {
  // Server-rendered H1 for crawlers/LLMs (see companies/page.tsx note).
  return (
    <>
      <h1 className="sr-only">
        EGX technical signals — الإشارات الفنية والتحليل الفني لأسهم البورصة المصرية
      </h1>
      <SignalsPageClient />
    </>
  )
}
