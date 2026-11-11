import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "إعادة تعيين كلمة المرور — إيجيكسّانو · Reset password — EGXANO",
  description: "اختر كلمة مرور جديدة لحسابك في إيجيكسّانو. Choose a new password for your EGXANO account.",
  alternates: { canonical: "/reset-password" },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
