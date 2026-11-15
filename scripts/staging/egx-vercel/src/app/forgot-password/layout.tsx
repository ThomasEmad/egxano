import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "استعادة كلمة المرور — EGXANO · Forgot password — EGXANO",
  description: "استعد الوصول إلى حسابك في EGXANO عبر رابط إعادة تعيين آمن. Regain access to your EGXANO account via a secure reset link.",
  alternates: { canonical: "/forgot-password" },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
