import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Password recovery",
  description: "Request a password reset for your Meza account. Resets are completed by the Meza team with a single-use code — no automatic email is sent in this environment.",
  alternates: { canonical: "/forgot-password" },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}