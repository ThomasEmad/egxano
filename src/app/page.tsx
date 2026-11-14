import { Metadata } from "next"
import LandingClient from "./landing-client"
import { siteConfig } from "@/lib/seo-config"
import { StructuredData } from "@/components/seo/structured-data"

const faq = [
  {
    q: "Is the data real or estimated?",
    a: "Every figure comes from a company's published financial statements and passes period and consistency checks before entering analytics. Derived values are labelled as calculated; unavailable values show “—” — they are never estimated or invented.",
  },
  {
    q: "What is the difference between Free and Pro?",
    a: "Free includes company browsing, financial statements, public rankings and comparisons, CSV export, and the first five technical signal reads with their entry/exit zones and stop-loss. Pro opens the whole signals board — every company, every filter — plus detected company events, saved scanners, unlimited portfolio tracking and higher daily smart-question limits. The complete plan comparison is on the Premium page — no fake trial, no countdown.",
  },
  {
    q: "How do you compare companies?",
    a: "Comparisons use the same period (annual or quarterly) and the same metrics. When periods are not aligned, the platform says the comparison is indicative. Sector comparisons respect the nature of the sector — banks are not compared like industrials.",
  },
  {
    q: "Are prices real-time?",
    a: "No. Prices are delayed by 15 minutes and labelled as delayed. Financial analysis is built on published filings and their period end, not on live price movement.",
  },
  {
    q: "Do you provide buy or sell recommendations?",
    a: "No. EGXANO is a research and information tool: it shows the figures, their interpretation, risks and limitations, and leaves the decision to the user. Every technical read is a labelled, rule-based interpretation of price data — not a recommendation.",
  },
]

export const metadata: Metadata = {
  title: {
    absolute: "EGXANO — Egyptian stock market research",
  },
  description:
    "EGXANO — Egyptian stock market research: published financial statements, calculated ratios, fair company comparisons and technical context for EGX-listed companies — in Arabic and English. Every figure keeps its source and reporting period.",
  keywords: [
    "EGX",
    "Egyptian stock market research",
    "Egyptian Exchange",
    "EGX company analysis",
    "financial statements Egypt",
    "stock screener Egypt",
    "company comparison",
    "البورصة المصرية",
    "أبحاث الأسهم المصرية",
    "القوائم المالية",
    "مقارنة الشركات",
    "التحليل المالي",
    "EGXANO",
    "إيجيكسّانو",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "EGXANO — Egyptian stock market research",
    description:
      "Understand Egyptian companies before you decide: published statements, calculated ratios, fair comparisons and technical context, with the source and period of every figure.",
    type: "website",
    locale: "en_US",
    alternateLocale: "ar_EG",
    siteName: "EGXANO",
    url: "/",
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: "EGXANO — Egyptian stock market research" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "EGXANO — Egyptian stock market research",
    description:
      "Understand Egyptian companies before you decide: statements, ratios, comparisons and technical context — with sources.",
    images: [siteConfig.ogImage],
  },
}

export default function HomePage() {
  return (
    <>
      <StructuredData
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faq.map((item) => ({
            "@type": "Question",
            name: item.q,
            acceptedAnswer: {
              "@type": "Answer",
              text: item.a,
            },
          })),
        }}
      />
      <LandingClient />
    </>
  )
}