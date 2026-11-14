import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "إنشاء حساب — إيجيكسّانو · Sign up — EGXANO",
  description: "افتح حسابك في إيجيكسّانو للمتابعة والتنبيهات والتحليل الفني. Create your EGXANO account for watchlists, alerts and technical analysis.",
  alternates: { canonical: "/register" },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}