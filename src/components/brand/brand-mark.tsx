"use client"

import { cn } from "@/lib/utils"

/**
 * The EGXANO mark: the glowing green brand tile (owner's 2026-11-16 artwork) —
 * white/green "E", rising bars and a growth arrow on a dark tile with a lime
 * glow. Theme-independent on purpose — the brand mark must not change color
 * with the UI theme.
 */
export function EGXANOMark({
  className,
  size = 32,
  decorative = false,
}: {
  className?: string
  size?: number
  decorative?: boolean
}) {
  // Owner mandate 2026-11-16 — the mark is now the glowing green brand icon
  // (white/green "E" over rising bars + growth arrow). Raster file lives in
  // /icon-192.png (regenerated from the owner's artwork by
  // scripts/regen-brand-assets.py); theme-independent by design, so the dark
  // tile reads the same on light and dark UI.
  return (
    // eslint-disable-next-line @next/next/no-img-element -- brand mark must not blur: fixed raster, explicit w/h
    <img
      src="/icon-192.png"
      alt={decorative ? "" : "EGXANO"}
      aria-hidden={decorative || undefined}
      width={size}
      height={size}
      className={cn("shrink-0 rounded-lg object-cover", className)}
      style={{ filter: "drop-shadow(0 0 6px color-mix(in oklab, var(--brand-lime) 35%, transparent))" }}
    />
  )
}

export function EGXANOWordmark({
  lang,
  subtitle = true,
  size = 30,
  className,
}: {
  lang: "en" | "ar"
  subtitle?: boolean
  size?: number
  className?: string
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <EGXANOMark size={size} decorative />
      <span className="flex flex-col leading-none">
        <span className="text-base font-bold tracking-tight text-foreground">EGXANO</span>
        {subtitle ? (
          <span className="mt-1 text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {lang === "ar" ? "أبحاث البورصة المصرية" : "EGX research"}
          </span>
        ) : null}
      </span>
    </span>
  )
}
