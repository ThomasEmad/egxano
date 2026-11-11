"use client"

import { cn } from "@/lib/utils"

/**
 * The EGXANO mark: a graphite tile with an acid-lime "E" that reads as both the
 * initial and a market line breaking upward. It is theme-independent on
 * purpose — the brand mark must not change color with the UI theme.
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
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "EGXANO"}
      aria-hidden={decorative || undefined}
      className={cn("shrink-0", className)}
    >
      <rect
        x="0.75"
        y="0.75"
        width="30.5"
        height="30.5"
        rx="7.25"
        fill="var(--brand-ink)"
        stroke="color-mix(in oklab, var(--brand-lime) 38%, transparent)"
        strokeWidth="0.75"
      />
      <path
        d="M7.5 23.5V10.5L16 19.2L24.5 10.5V23.5"
        fill="none"
        stroke="var(--brand-lime)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="25.5" cy="6.75" r="1.9" fill="var(--brand-lime)" />
    </svg>
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
