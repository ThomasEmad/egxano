import type { Metadata } from "next"

export const metadata: Metadata = {
<<<<<<< HEAD
  title: "Sign in",
  description: "Sign in to sync your watchlist, portfolio and price targets. Browsing and company research stay free without an account.",
=======
  title: "تسجيل الدخول — إيجيكسّانو · Sign in to EGXANO",
  description: "ادخل إلى حسابك لمتابعة قائمة المتابعة والمحفظة والتنبيهات وتحليلات الذكاء الاصطناعي لشركات البورصة المصرية. Sign in to your account to use watchlists, portfolio tracking, alerts and AI company analysis.",
>>>>>>> b110dc6d46bae06b6754fc83151c5421ad4d72a3
  alternates: { canonical: "/login" },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}