"use client"

// Desktop sidebar (sm+): brand + primary navigation, rendered on the inline
// start side so it flips to the right automatically under RTL (the html dir
// is synchronized by the i18n provider).
// Mobile (<sm) keeps its own top bar + bottom navigation.

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Bell,
  Briefcase,
  Building2,
  CalendarDays,
  Crown,
  Gem,
  Info,
  Activity,
  LayoutDashboard,
  Scale,
  ScanSearch,
  ShieldCheck,
  Layers,
  Trophy,
} from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { EGXANOWordmark } from "@/components/brand/brand-mark"

export interface NavItem {
  href: string
  label: string
  labelAr: string
  icon: React.ComponentType<{ className?: string }>
  exact?: boolean
}

export interface NavSection {
  label: string
  labelAr: string
  items: NavItem[]
}

// Single source of truth for navigation — shared with the mobile drawer
// (MobileNavDrawer), which mirrors these sections below the sm breakpoint.
// Grouped by the research loop, not by feature type: research → monitor.
export const SECTIONS: NavSection[] = [
  {
    label: "Research",
    labelAr: "البحث",
    items: [
      { href: "/dashboard", label: "Research home", labelAr: "لوحة البحث", icon: LayoutDashboard },
      { href: "/signals", label: "Technical signals", labelAr: "الإشارات الفنية", icon: Activity },
      { href: "/companies", label: "Companies", labelAr: "الشركات", icon: Building2 },
      { href: "/scanners", label: "Screeners", labelAr: "الماسحات", icon: ScanSearch },
      { href: "/compare", label: "Compare", labelAr: "المقارنة", icon: Scale },
      { href: "/rankings", label: "Rankings", labelAr: "الترتيب", icon: Trophy },
      { href: "/undervalued", label: "Valuation screen", labelAr: "فحص التقييم", icon: Gem },
      { href: "/sectors", label: "Sectors", labelAr: "القطاعات", icon: Layers },
    ],
  },
  {
    label: "Monitor",
    labelAr: "المتابعة",
    items: [
      { href: "/watchlist", label: "Watchlist", labelAr: "قائمة المتابعة", icon: ShieldCheck },
      { href: "/portfolio", label: "Portfolio", labelAr: "المحفظة", icon: Briefcase },
      { href: "/dividends", label: "Dividends", labelAr: "التوزيعات", icon: CalendarDays },
      { href: "/alerts", label: "Alerts", labelAr: "التنبيهات", icon: Bell },
    ],
  },
  {
    label: "Plans & about",
    labelAr: "الباقات وعن EGXANO",
    items: [
      { href: "/premium", label: "Premium", labelAr: "بريميوم", icon: Crown },
      { href: "/about", label: "About EGXANO", labelAr: "عن EGXANO", icon: Info },
    ],
  },
]

export function AppSidebar() {
  const { lang } = useI18n()
  const pathname = usePathname()
  const ar = lang === "ar"

  const isActive = (item: NavItem) => {
    if (item.href === "/dashboard") return pathname === "/" || pathname === "/dashboard"
    if (item.exact) return pathname === item.href
    return pathname === item.href || pathname.startsWith(`${item.href}/`)
  }

  return (
    <aside
      className="fixed inset-y-0 start-0 z-40 hidden w-64 flex-col border-e border-border/60 bg-sidebar sm:flex"
      aria-label={ar ? "التنقل الرئيسي" : "Main navigation"}
    >
      {/* Brand */}
      <Link
        href="/"
        className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border/60 px-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="EGXANO — Home"
      >
        <EGXANOWordmark lang={lang} size={32} />
      </Link>

      {/* Navigation */}
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
    </aside>
  )
}