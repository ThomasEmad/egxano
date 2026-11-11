import type { Metadata } from "next"

export const metadata: Metadata = {
<<<<<<< HEAD
  title: "Password recovery",
  description: "Request a password reset for your Meza account. Resets are completed by the Meza team with a single-use code — no automatic email is sent in this environment.",
=======
  title: "استعادة كلمة المرور — إيجيكسّانو · Forgot password — EGXANO",
  description: "استعد الوصول إلى حسابك في إيجيكسّانو عبر رابط إعادة تعيين آمن. Regain access to your EGXANO account via a secure reset link.",
>>>>>>> b110dc6d46bae06b6754fc83151c5421ad4d72a3
  alternates: { canonical: "/forgot-password" },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}