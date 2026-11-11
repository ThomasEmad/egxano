import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Create a free account",
  description: "Create a free Meza account to save a watchlist, portfolio and price targets. No card required. Premium is optional and activated manually.",
  alternates: { canonical: "/register" },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}