import type { Metadata } from "next"

export const metadata: Metadata = {
<<<<<<< HEAD
  title: "Create a free account",
  description: "Create a free Meza account to save a watchlist, portfolio and price targets. No card required. Premium is optional and activated manually.",
=======
  title: "إنشاء حساب — إيجيكسّانو · Create an account — EGXANO",
  description: "أنشئ حساباً مجانياً لمتابعة شركات البورصة المصرية وتلقي التحليلات والتقييمات. Create a free account to track EGX companies, valuations and AI analysis.",
>>>>>>> b110dc6d46bae06b6754fc83151c5421ad4d72a3
  alternates: { canonical: "/register" },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}