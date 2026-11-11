import type { Metadata } from "next"
import { siteConfig } from "@/lib/seo-config"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { StatusView, type StatusPayload } from "./client"

// /status — public trust page: what the platform serves, how fresh the data
// is, and whether the status feed could be read. The badge is derived from
// the payload below; the page never hardcodes "Operational".

export const metadata: Metadata = {
  title: "Platform status — data freshness and coverage",
  description:
    "Coverage, latest recorded market price and its 15-minute delay, last imported financial statement, and what the status check covers. Missing data shows as unavailable — never as zero.",
  alternates: { canonical: "/status" },
}

export const revalidate = 60

async function loadStatus(): Promise<StatusPayload | null> {
  // Prefer the configured public URL. Without it, the self-fetch would be a
  // relative URL (unsupported on the server) — fall back to the canonical
  // site URL so the page degrades to the honest "unavailable" state instead
  // of silently showing zeros.
  const configured = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "")
  const base = configured || siteConfig.url.replace(/\/+$/, "")
  try {
    const res = await fetch(`${base}/api/v1/status`, { next: { revalidate: 60 } })
    if (!res.ok) throw new Error(String(res.status))
    return (await res.json()) as StatusPayload
  } catch {
    return null
  }
}

export default async function StatusPage() {
  const status = await loadStatus()
  return (
    <LayoutShell chrome="marketing">
      <StatusView data={status} />
    </LayoutShell>
  )
}
