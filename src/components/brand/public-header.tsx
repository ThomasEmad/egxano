"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import { ArrowRight, Languages, Menu, Moon, Sun, User, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EGXANOWordmark } from "@/components/brand/brand-mark"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import { getUserToken } from "@/lib/client/api"

const PUBLIC_NAV = [
  { href: "/companies", en: "Companies", ar: "الشركات" },
  { href: "/compare", en: "Compare", ar: "المقارنة" },
  { href: "/dashboard", en: "Screener", ar: "الماسح" },
  { href: "/sectors", en: "Sectors", ar: "القطاعات" },
  { href: "/premium", en: "Premium", ar: "بريميوم" },
] as const

/**
 * Public marketing chrome for the homepage. The product app keeps its own
 * sidebar shell; the brand's front door should feel like one institution, not
 * a logged-in dashboard.
 */
export function PublicHeader() {
  const { lang, setLang } = useI18n()
  const { theme, setTheme } = useTheme()
  const pathname = usePathname()
  const ar = lang === "ar"
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)

  useEffect(() => {
    // Hydration-safe: theme/session are client-only sources.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
    setLoggedIn(!!getUserToken())
  }, [])

  const isDark = mounted && theme === "dark"

  const toggleTheme = () => setTheme(isDark ? "light" : "dark")
  const toggleLang = () => setLang(ar ? "en" : "ar")

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center rounded-lg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={ar ? "EGXANO — الرئيسية" : "EGXANO — Home"}
        >
          <EGXANOWordmark lang={lang} size={30} />
        </Link>

        <nav
          aria-label={ar ? "روابط الموقع" : "Site navigation"}
          className="mx-auto hidden items-center gap-1 lg:flex"
        >
          {PUBLIC_NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {ar ? item.ar : item.en}
              </Link>
            )
          })}
        </nav>

        <div className="ms-auto flex items-center gap-1.5 lg:ms-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleLang}
            aria-label={ar ? "Switch to English" : "التبديل إلى العربية"}
            title={ar ? "English" : "العربية"}
            className="h-9 w-9 text-muted-foreground hover:text-foreground"
          >
            <Languages className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{ar ? "EN" : "AR"}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={ar ? "تبديل المظهر" : "Toggle theme"}
            className="h-9 w-9 text-muted-foreground hover:text-foreground"
          >
            {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden gap-1.5 text-muted-foreground hover:text-foreground sm:inline-flex">
            <Link href={loggedIn ? "/dashboard" : "/login"}>
              <User className="h-4 w-4" aria-hidden="true" />
              {loggedIn ? (ar ? "حسابي" : "Account") : ar ? "دخول" : "Sign in"}
            </Link>
          </Button>
          <Button asChild size="sm" className="hidden h-9 gap-1.5 px-4 sm:inline-flex">
            <Link href="/companies">
              {ar ? "ابدأ البحث" : "Start researching"}
              <ArrowRight className="h-3.5 w-3.5 rtl-flip" aria-hidden="true" />
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 lg:hidden"
            aria-label={open ? (ar ? "إغلاق القائمة" : "Close menu") : ar ? "فتح القائمة" : "Open menu"}
            aria-expanded={open}
            aria-controls="public-nav-mobile"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </Button>
        </div>
      </div>

      {open ? (
        <div id="public-nav-mobile" className="border-t border-border bg-background px-4 py-3 lg:hidden">
          <nav aria-label={ar ? "روابط الموقع" : "Site navigation"} className="flex flex-col">
            {PUBLIC_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                {ar ? item.ar : item.en}
              </Link>
            ))}
          </nav>
          <div className="mt-2 flex items-center gap-2 border-t border-border pt-3">
            <Button asChild size="sm" className="h-9 flex-1">
              <Link href="/companies" onClick={() => setOpen(false)}>
                {ar ? "ابدأ البحث" : "Start researching"}
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-9 flex-1">
              <Link href={loggedIn ? "/dashboard" : "/login"} onClick={() => setOpen(false)}>
                {loggedIn ? (ar ? "حسابي" : "Account") : ar ? "دخول" : "Sign in"}
              </Link>
            </Button>
          </div>
        </div>
      ) : null}
    </header>
  )
}
