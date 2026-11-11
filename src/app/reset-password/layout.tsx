import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Set a new password",
  description: "Set a new password for your Meza account using the single-use reset code issued by the Meza team.",
  alternates: { canonical: "/reset-password" },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}