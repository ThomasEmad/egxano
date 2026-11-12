"use client"

// /scanners — standalone screeners page (user request: "لا يوجد صفحة للماسحات").
//
// The scanners used to live ONLY inside the dashboard hash-router
// (/dashboard#/scanners) — impossible to link from the sidebar or share.
// This page wraps the same ScannersView (identical data, identical presets)
// with real URLs:
//   /scanners            → preset screens
//   /scanners?mode=custom→ the custom rule builder
//   /scanners?preset=KEY → a preset card linked from the landing page
//
// Keeping one source of truth (ScannersView) means the dashboard and this page
// can never drift apart.

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ScannersView } from "@/components/egx/scanners-view"
import { LayoutShell } from "@/components/layout/LayoutShell"

function readMode(): "presets" | "custom" {
  if (typeof window === "undefined") return "presets"
  return new URLSearchParams(window.location.search).get("mode") === "custom" ? "custom" : "presets"
}

function readPreset(): string | null {
  if (typeof window === "undefined") return null
  return new URLSearchParams(window.location.search).get("preset")
}

export default function ScannersPageClient() {
  const router = useRouter()
  const [mode, setMode] = useState<"presets" | "custom">(readMode)
  const [pendingRuleId, setPendingRuleId] = useState<string | null>(readPreset)

  // Keep the address bar shareable when the view switches inside the page.
  useEffect(() => {
    const u = new URL(window.location.href)
    const wantCustom = mode === "custom"
    if (wantCustom) u.searchParams.set("mode", "custom")
    else u.searchParams.delete("mode")
    if (!wantCustom && pendingRuleId) u.searchParams.set("preset", pendingRuleId)
    else u.searchParams.delete("preset")
    if (u.toString() !== window.location.href) window.history.replaceState(null, "", u.toString())
  }, [mode, pendingRuleId])

  const openCompany = useCallback((id: string) => router.push(`/company/${id}`), [router])
  const openCustom = useCallback(() => {
    setMode("custom")
    setPendingRuleId(null)
    window.scrollTo({ top: 0 })
  }, [])

  return (
    <LayoutShell showMobileNav={true}>
      <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6">
        <ScannersView
          key={mode === "custom" ? "custom" : pendingRuleId ?? "none"}
          mode={mode}
          pendingRuleId={pendingRuleId}
          onOpenCompany={openCompany}
          onOpenCustom={openCustom}
        />
      </div>
    </LayoutShell>
  )
}
