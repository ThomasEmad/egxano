import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to sync your watchlist, portfolio and price targets. Browsing and company research stay free without an account.",
  alternates: { canonical: "/login" },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}