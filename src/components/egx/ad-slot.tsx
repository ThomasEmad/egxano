"use client"

// AdSlot — the single AdSense surface for the whole site.
//
// Design contract:
//   • No layout shift: every slot reserves its height BEFORE an ad fills it
//     (min-height + flex centering), so CLS stays at zero with or without ads.
//   • Configurable by env only: NEXT_PUBLIC_ADSENSE_CLIENT ("ca-pub-…").
//     When unset (AdSense not approved yet) the slot renders a calm,
//     brand-consistent placeholder — same geometry, no third-party request.
//   • One push per slot per mount; multiple slots coexist on one page.
//   • display:block + responsive shape per Google's guidance; the container
//     caps max-width so ads never blow out the reading column.
//
// Placement map (approved formats, kept away from buttons/content seams):
//   slot="leaderboard"  — 728×90 / 320×100 strip under the header on listing pages
//   slot="in-article"   — fluid rectangle between content sections
//   slot="sidebar"      — 300×250 rectangle on wide viewports

import { useEffect, useRef } from "react"
import Script from "next/script"

type AdFormat = "leaderboard" | "in-article" | "sidebar" | "in-feed"

const GEOMETRY: Record<AdFormat, { minHeight: number; maxWidth: number; label: string }> = {
  leaderboard: { minHeight: 90, maxWidth: 728, label: "مساحة إعلانية — 728×90" },
  "in-article": { minHeight: 250, maxWidth: 336, label: "مساحة إعلانية — 336×280" },
  sidebar: { minHeight: 250, maxWidth: 300, label: "مساحة إعلانية — 300×250" },
  "in-feed": { minHeight: 120, maxWidth: 728, label: "مساحة إعلانية" },
}

declare global {
  interface Window {
    adsbygoogle?: unknown[]
  }
}

export function AdSenseScript(): React.ReactElement | null {
  const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT
  if (!client) return null
  return (
    <Script
      async
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`}
      crossOrigin="anonymous"
      strategy="afterInteractive"
    />
  )
}

export function AdSlot({
  slot,
  adUnit, // the AdSense ad-unit id (data-ad-slot) when approved
  format = "in-article",
  className = "",
}: {
  slot: string
  /** AdSense data-ad-slot — empty until the unit exists in the AdSense console. */
  adUnit?: string
  format?: AdFormat
  className?: string
}) {
  const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT
  const pushed = useRef(false)
  const geo = GEOMETRY[format]

  useEffect(() => {
    if (!client || !adUnit || pushed.current) return
    pushed.current = true
    try {
      ;(window.adsbygoogle = window.adsbygoogle || []).push({})
    } catch {
      // AdSense script blocked/slow — the reserved box keeps the layout intact
    }
  }, [client, adUnit])

  return (
    <div
      role="complementary"
      aria-label="إعلان"
      data-adslot={slot}
      className={`mx-auto w-full ${className}`}
      style={{ maxWidth: geo.maxWidth, minHeight: geo.minHeight }}
    >
      {client && adUnit ? (
        <ins
          className="adsbygoogle block"
          style={{ display: "block", width: "100%", minHeight: geo.minHeight }}
          data-ad-client={client}
          data-ad-slot={adUnit}
          data-ad-format={format === "in-article" ? "rectangle" : "auto"}
          data-full-width-responsive="true"
        />
      ) : (
        <div
          className="flex items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/30 text-[11px] text-muted-foreground/70"
          style={{ minHeight: geo.minHeight }}
        >
          {geo.label}
        </div>
      )}
    </div>
  )
}
