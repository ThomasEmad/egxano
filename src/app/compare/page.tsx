import type { Metadata } from "next"
import CompareClient from "./client"

// Comparison stays an application surface (decision: app-only, shareable URLs
// preserved); the page is crawlable so shared links resolve, but not indexed.
export const metadata: Metadata = {
  title: "Compare EGX companies · مقارنة الشركات",
  description:
    "Compare up to four Egyptian Exchange companies on the same reporting period: margins, ROE, ROA, P/E, P/B and leverage, with each column's period stated and absolute figures shown as levels rather than ranks.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/compare", languages: { en: "/compare", "ar-EG": "/compare" } },
}

export default function ComparePage() {
  return <CompareClient />
}
