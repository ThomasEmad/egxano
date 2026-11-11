import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "إنشاء حساب — إيجيكسّانو · Sign up — EGXANO",
  description: "افتح حسابك في إيجيكسّانو للمتابعة والتنبيهات والتحليلات. Create your EGXANO account for watchlists, alerts and AI analysis.",
  alternates: { canonical: "/register" },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}