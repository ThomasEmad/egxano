"use client"

// /signals — the market-wide technical signals board (real route so it is
// linkable from the sidebar, the header and the landing page).

import { SignalsView } from "@/components/egx/signals-view"
import { LayoutShell } from "@/components/layout/LayoutShell"

export default function SignalsPageClient() {
  return (
    <LayoutShell showMobileNav={true}>
      <div className="mx-auto w-full max-w-6xl">
        <SignalsView />
      </div>
    </LayoutShell>
  )
}
