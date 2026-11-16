import type { Metadata } from "next"
import { siteConfig } from "@/lib/seo-config"
import AnalyzeClient from "./client"

export const metadata: Metadata = {
  title: "حلل سهمي — هل أحتفظ أم أنتظر أم أخرج؟ · EGXANO",
  description:
    "اكتب متوسط سعر شراءك وأي سهم مصري، والمحرك يقرر معك: احتفظ أم انتظر أم اخرج — بكل الأسباب، كل الدعوم والمقاومات، والقراءة الفنية الكاملة بنبرة صديق فاهم في البورصة. قرار القص/الاحتفاظ مبني على كسر الدعم وفرق الدعم التالي (قاعدة البطانة)، وليس نصيحة استثمارية.",
  keywords: [
    "حلل سهمي",
    "هل أبيع أسهمي",
    "متوسط الشراء",
    "دعوم ومقاومات",
    "التحليل الفني مصر",
    "البورصة المصرية",
    "EGX stock analyzer",
    "average buy price",
    "support resistance",
  ],
  alternates: {
    canonical: "/analyze",
  },
  openGraph: {
    title: "حلل سهمي — هل أحتفظ أم أبيع؟ · EGXANO",
    description:
      "أدخل متوسط شراءك والمحرك يجاوبك بكل الأسباب: احتفظ، انتظر، أو اخرج — مع كل الدعوم والمقاومات والقراءة الكاملة.",
    url: "/analyze",
    type: "website",
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: "EGXANO — حلل سهمي" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "حلل سهمي — هل أحتفظ أم أبيع؟ · EGXANO",
    description: "أدخل متوسط شراءك والمحرك يجاوبك بكل الأسباب: احتفظ، انتظر، أو اخرج.",
    images: [siteConfig.ogImage],
  },
}

export default function AnalyzePage() {
  return <AnalyzeClient />
}
