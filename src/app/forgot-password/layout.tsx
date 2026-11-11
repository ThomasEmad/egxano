import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "استعادة كلمة المرور — إيجيكسّانو · Forgot password — EGXANO",
  description: "استعد الوصول إلى حسابك في إيجيكسّانو عبر رابط إعادة تعيين آمن. Regain access to your EGXANO account via a secure reset link.",
  alternates: { canonical: "/forgot-password" },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
