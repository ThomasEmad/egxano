import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "إعادة تعيين كلمة المرور — إيجيكسّانو · Reset password — EGXANO",
  description: "أعد تعيين كلمة مرور حسابك في إيجيكسّانو. Reset your EGXANO account password.",
  alternates: { canonical: "/reset-password" },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}