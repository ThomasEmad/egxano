import type { Metadata } from "next"

export const metadata: Metadata = {
<<<<<<< HEAD
  title: "Set a new password",
  description: "Set a new password for your Meza account using the single-use reset code issued by the Meza team.",
=======
  title: "إعادة تعيين كلمة المرور — إيجيكسّانو · Reset password — EGXANO",
  description: "اختر كلمة مرور جديدة لحسابك في إيجيكسّانو. Choose a new password for your EGXANO account.",
>>>>>>> b110dc6d46bae06b6754fc83151c5421ad4d72a3
  alternates: { canonical: "/reset-password" },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}