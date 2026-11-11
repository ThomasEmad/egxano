"use client"

// Mobile (<sm) navigation drawer. The desktop AppSidebar is `hidden sm:flex`,
// so on phones the drawer exposes the same sections as the desktop sidebar
// (single source of truth: SECTIONS lives in AppSidebar).
//
// IMPORTANT: this drawer is rendered through a portal into <body>. The mobile
// top bar that hosts the hamburger uses `backdrop-blur`, and a non-none
// backdrop-filter makes an ancestor the containing block for fixed-position
// descendants — rendering the drawer inside that bar clipped it to ~55px and
// made the nav unreachable on phones.

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu, X } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { EGXANOWordmark } from "@/components/brand/brand-mark"
import { SECTIONS, type NavItem } from "./AppSidebar"

export function MobileNavDrawer() {
  const { lang } = useI18n()
  const pathname = usePathname()
  const ar = lang === "ar"
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Hydration-safe portal gate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  // lock body scroll + Escape closes while the drawer is open
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  // any route change closes the drawer (Link clicks don't unmount the layout)
  // — handled on each link instead of an effect to avoid a cascading render.

  const isActive = (item: NavItem) => {
    if (item.href === "/dashboard") return pathname === "/" || pathname === "/dashboard"
    if (item.exact) return pathname === item.href
    return pathname === item.href || pathname.startsWith(`${item.href}/`)
  }

  return (
    <>
      {/* Hamburger — lives in the mobile top bar */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={ar ? "فتح القائمة" : "Open menu"}
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      {open && mounted
        ? createPortal(
            <div
              id="mobile-nav-drawer"
              role="dialog"
              aria-modal="true"
              aria-label={ar ? "التنقل الرئيسي" : "Main navigation"}
              className="fixed inset-0 z-[60] sm:hidden"
            >
              {/* backdrop */}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={ar ? "إغلاق القائمة" : "Close menu"}
                className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
              />

              {/* panel — same side as the desktop sidebar */}
              <div className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col border-e border-border/60 bg-sidebar shadow-xl">
                {/* Brand + close */}
                <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border/60 px-4">
                  <div className="flex-1">
                    <EGXANOWordmark lang={lang} size={32} />
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label={ar ? "إغلاق القائمة" : "Close menu"}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={ar ? "إغلاق القائمة" : "Close menu"}
                    autoFocus
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>

                {/* Navigation — same sections/markup as AppSidebar */}
                <nav className="flex-1 overflow-y-auto px-3 py-4">
                  <div className="space-y-5">
                    {SECTIONS.map((section) => (
                      <div key={section.label}>
                        <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                          {ar ? section.labelAr : section.label}
                        </p>
                        <div className="space-y-0.5">
                          {section.items.map((item) => {
                            const active = isActive(item)
                            const Icon = item.icon
                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setOpen(false)}
                                aria-current={active ? "page" : undefined}
                                className={cn(
                                  "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-150",
                                  active
                                    ? "bg-primary/10 font-semibold text-primary"
                                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                                )}
                              >
                                {active && (
                                  <span
                                    className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-primary"
                                    aria-hidden="true"
                                  />
                                )}
                                <Icon
                                  className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")}
                                  aria-hidden="true"
                                />
                                <span className="truncate">{ar ? item.labelAr : item.label}</span>
                              </Link>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </nav>

                {/* Footer */}
                <div className="shrink-0 border-t border-border/40 px-4 py-3">
                  <p className="text-[10px] leading-tight text-muted-foreground">
                    {ar
                      ? "أسعار متأخرة 15 دقيقة — ليست نصيحة استثمارية."
                      : "Prices delayed 15 min — not investment advice."}
                  </p>
                  <Link
                    href="/status"
                    className="mt-1.5 inline-block text-[10px] font-medium text-muted-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {ar ? "حالة البيانات والحداثة" : "Data status & freshness"}
                  </Link>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}