"use client"

// Global search (⌘K / Ctrl K). This is a real ARIA combobox: arrow keys move the
// active option, Enter opens it, Escape closes the list, and every result is a
// focusable option with aria-selected. The old markup advertised keyboard
// selection it did not implement.

import { useState, useRef, useEffect, useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useI18n } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import {
  Search,
  User,
  X,
  Sun,
  Moon,
  Crown,
  ShieldCheck,
  Building2,
  Shield,
  Scale,
  Briefcase,
  CalendarDays,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  ScanSearch,
  ListOrdered,
  Gauge,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"
import { api, authHeaders, clearUserToken, getUserToken } from "@/lib/client/api"
import { SECTORS, sectorLabel } from "@/lib/sectors"
import { MarketTicker } from "@/components/egx/market-ticker"

const NAV_TABS = [
  { href: "/dashboard", label: "Dashboard", labelAr: "لوحة القيادة", icon: LayoutDashboard, exact: true },
  { href: "/companies", label: "Companies", labelAr: "الشركات", icon: Building2 },
  { href: "/sectors", label: "Sectors", labelAr: "القطاعات", icon: Shield },
  { href: "/compare", label: "Compare", labelAr: "المقارنة", icon: Scale },
  { href: "/dashboard#/scanners", label: "Screener", labelAr: "الماسح", icon: ScanSearch },
  { href: "/rankings", label: "Rankings", labelAr: "الترتيب", icon: ListOrdered },
  { href: "/undervalued", label: "Valuation screen", labelAr: "فحص التقييم", icon: Gauge },
  { href: "/portfolio", label: "Portfolio", labelAr: "المحفظة", icon: Briefcase },
  { href: "/dividends", label: "Dividends", labelAr: "التوزيعات", icon: CalendarDays },
  { href: "/watchlist", label: "Watchlist", labelAr: "قائمة المتابعة", icon: ShieldCheck },
] as const

type NavTab = (typeof NAV_TABS)[number]

interface SearchCompany {
  id: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
}

interface SearchOption {
  key: string
  href: string
  kind: "company" | "sector" | "page"
  ticker?: string
  name: string
  meta: string
  icon: React.ComponentType<{ className?: string }>
}

interface TopHeaderProps {
  className?: string
}

export function TopHeader({ className }: TopHeaderProps = {}) {
  const { lang, setLang } = useI18n()
  const { setTheme, theme } = useTheme()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [profileOpen, setProfileOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [shortcut, setShortcut] = useState("Ctrl K")
  const searchInputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Hydration-safe theme/session gating (same pattern as the sidebar).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
    // Platform-aware shortcut hint (the handler accepts both).
    if (typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)) setShortcut("⌘K")
  }, [])

  const ar = lang === "ar"
  const isDark = mounted && theme === "dark"

  const token = mounted ? getUserToken() : null
  const { data: me } = useQuery({
    queryKey: ["auth-me", token],
    queryFn: () =>
      token
        ? fetch("/api/v1/auth/me", { headers: { "x-session-token": token } }).then((r) => {
            if (r.status === 401) {
              clearUserToken()
              return null
            }
            return r.ok ? r.json() : null
          })
        : Promise.resolve(null),
    enabled: mounted,
    staleTime: 300_000,
    retry: false,
  })
  const { data: subscription } = useQuery({
    queryKey: ["subscription-me", token],
    queryFn: () =>
      fetch("/api/v1/subscription/me", { headers: { "x-session-token": token ?? "" } }).then((r) => (r.ok ? r.json() : null)),
    enabled: mounted && !!token,
    staleTime: 300_000,
    retry: false,
  })

  const loggedIn = !!me?.user
  const meName: string | null = me?.user?.name ?? me?.user?.email ?? null
  const isPremium = !!subscription?.isPremium

  const normalizedQuery = debouncedQuery.trim().toLowerCase()
  const { data: companySearch, isFetching: companySearching } = useQuery({
    queryKey: ["header-company-search", debouncedQuery],
    queryFn: async () => {
      const res = await fetch(`/api/v1/companies?search=${encodeURIComponent(debouncedQuery)}&pageSize=6`)
      if (!res.ok) return { companies: [] as SearchCompany[] }
      const json = (await res.json()) as { companies?: SearchCompany[] }
      return { companies: json.companies ?? [] }
    },
    enabled: debouncedQuery.length >= 2,
    staleTime: 120_000,
    retry: false,
  })

  const matchedSectors = useMemo(() => {
    if (normalizedQuery.length < 2) return []
    return SECTORS.filter(
      (sector) => sector.toLowerCase().includes(normalizedQuery) || sectorLabel(sector, lang).toLowerCase().includes(normalizedQuery)
    ).slice(0, 4)
  }, [normalizedQuery, lang])

  const matchedTabs = useMemo(() => {
    if (normalizedQuery.length < 2) return []
    return NAV_TABS.filter(
      (tab) =>
        tab.href !== "/dashboard" &&
        ((ar ? tab.labelAr : tab.label).toLowerCase().includes(normalizedQuery) || tab.label.toLowerCase().includes(normalizedQuery))
    ).slice(0, 5)
  }, [normalizedQuery, ar])

  const options = useMemo<SearchOption[]>(() => {
    if (normalizedQuery.length < 2) return []
    const list: SearchOption[] = []
    for (const c of companySearch?.companies ?? []) {
      list.push({
        key: `company:${c.id}`,
        href: `/company/${c.ticker}`,
        kind: "company",
        ticker: c.ticker,
        name: ar ? c.nameAr ?? c.nameEn : c.nameEn,
        meta: sectorLabel(c.sector, lang),
        icon: Building2,
      })
    }
    for (const s of matchedSectors) {
      list.push({ key: `sector:${s}`, href: `/sectors/${encodeURIComponent(s)}`, kind: "sector", name: sectorLabel(s, lang), meta: ar ? "قطاع" : "Sector", icon: Shield })
    }
    for (const tab of matchedTabs) {
      list.push({ key: `page:${tab.href}`, href: tab.href, kind: "page", name: ar ? tab.labelAr : tab.label, meta: ar ? "صفحة" : "Page", icon: tab.icon })
    }
    return list
  }, [companySearch, matchedSectors, matchedTabs, ar, lang, normalizedQuery.length])

  useEffect(() => {
    if (activeIndex < 0) return
    document.getElementById(`search-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"))

  const handleLogout = async () => {
    try {
      await fetch("/api/v1/auth/logout", { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() } })
    } finally {
      clearUserToken()
      queryClient.clear()
      router.push("/login")
    }
  }

  const handleProfileClick = () => {
    if (loggedIn) setProfileOpen((open) => !open)
    else router.push("/login")
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault()
      searchInputRef.current?.focus()
      setShowSearchResults(true)
    }
  }

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 200)
    return () => clearTimeout(id)
  }, [searchQuery])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (resultsRef.current && !resultsRef.current.contains(e.target as Node)) setShowSearchResults(false)
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  const go = (href: string) => {
    setShowSearchResults(false)
    setSearchQuery("")
    setDebouncedQuery("")
    setActiveIndex(-1)
    const [path, hash] = href.split("#")
    // Same-page hash routes (/dashboard#/scanners) are driven by a hashchange
    // listener, so set the hash instead of relying on a soft navigation.
    if (hash && window.location.pathname === path) {
      window.location.hash = hash
    } else {
      router.push(href)
    }
  }

  const listboxOpen = showSearchResults && debouncedQuery.length >= 2

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setShowSearchResults(false)
      searchInputRef.current?.blur()
      return
    }
    if (!listboxOpen) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex((i) => (options.length === 0 ? -1 : Math.min(i + 1, options.length - 1)))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((i) => (options.length === 0 ? -1 : Math.max(i - 1, 0)))
    } else if (e.key === "Enter") {
      const target = options[activeIndex] ?? options[0]
      if (target) {
        e.preventDefault()
        go(target.href)
      }
    }
  }

  return (
    <header
      dir={ar ? "rtl" : "ltr"}
      className={cn(
        "sticky top-0 z-40 h-16 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/90 shadow-sm transition-colors",
        className
      )}
    >
      <div className="flex h-full items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        {/* Market ticker strip — hidden below lg so it cannot squeeze search */}
        <div className="hidden lg:block w-[300px] xl:w-[440px] shrink-0 overflow-hidden">
          <MarketTicker />
        </div>

        {/* Center: global search combobox */}
        <div className="flex min-w-0 flex-1 justify-center">
          <div className="relative w-full max-w-2xl" ref={resultsRef}>
            <label htmlFor="global-search" className="sr-only">
              {ar ? "البحث في الشركات والقطاعات والأدوات" : "Search companies, sectors and tools"}
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 start-3 flex items-center">
                <Search className="h-4 w-4 text-muted-foreground/60" aria-hidden="true" />
              </div>
              <input
                ref={searchInputRef}
                id="global-search"
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setShowSearchResults(true)
                  setActiveIndex(-1)
                }}
                onFocus={() => setShowSearchResults(true)}
                onBlur={() => setTimeout(() => setShowSearchResults(false), 150)}
                onKeyDown={onSearchKeyDown}
                placeholder={ar ? `ابحث عن شركة، قطاع، أو أداة… (${shortcut})` : `Search companies, sectors, tools… (${shortcut})`}
                className="h-9 w-full rounded-xl border border-border/60 bg-background ps-10 pe-10 text-sm text-foreground placeholder:text-muted-foreground/50 transition-all focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                autoComplete="off"
                role="combobox"
                aria-expanded={listboxOpen}
                aria-controls="search-results"
                aria-autocomplete="list"
                aria-activedescendant={activeIndex >= 0 ? `search-option-${activeIndex}` : undefined}
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("")
                    setShowSearchResults(false)
                    searchInputRef.current?.focus()
                  }}
                  className="absolute end-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={ar ? "مسح البحث" : "Clear search"}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>

            <AnimatePresence>
              {listboxOpen && (
                <motion.div
                  id="search-results"
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.98 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border/60 bg-background shadow-xl shadow-black/10"
                  role="listbox"
                  aria-label={ar ? "نتائج البحث" : "Search results"}
                >
                  <div className="max-h-80 overflow-y-auto">
                    <div className="flex items-center justify-between border-b border-border/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <span>{ar ? "نتائج البحث" : "Results"}</span>
                      <span className="text-[10px] font-normal text-muted-foreground/70">
                        {ar ? "↑ ↓ للتحرك · Enter للفتح" : "↑ ↓ to move · Enter to open"}
                      </span>
                    </div>

                    {companySearching && options.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-muted-foreground">{ar ? "جارٍ البحث…" : "Searching…"}</div>
                    ) : null}

                    {options.map((option, index) => {
                      const Icon = option.icon
                      const active = index === activeIndex
                      return (
                        <button
                          key={option.key}
                          id={`search-option-${index}`}
                          type="button"
                          role="option"
                          aria-selected={active}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => go(option.href)}
                          className={cn(
                            "flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors",
                            active ? "bg-accent/60" : "hover:bg-muted/40"
                          )}
                        >
                          {option.kind === "company" ? (
                            <span className="flex h-8 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[10px] font-bold text-primary">
                              {option.ticker}
                            </span>
                          ) : (
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <Icon className="h-4 w-4" aria-hidden="true" />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground">{option.name}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">{option.meta}</span>
                          </span>
                          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            {option.kind === "company" ? (ar ? "شركة" : "Company") : option.kind === "sector" ? (ar ? "قطاع" : "Sector") : ar ? "صفحة" : "Page"}
                          </span>
                        </button>
                      )
                    })}

                    {!companySearching && options.length === 0 ? (
                      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                        {ar ? "لا توجد نتائج مطابقة" : "No matching results"}
                      </div>
                    ) : null}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-xl"
            onClick={toggleTheme}
            aria-label={ar ? "تبديل المظهر" : "Toggle theme"}
            title={ar ? "تبديل المظهر" : "Toggle theme"}
          >
            <AnimatePresence mode="wait">
              {isDark ? (
                <motion.div key="sun" initial={{ rotate: -90, scale: 0 }} animate={{ rotate: 0, scale: 1 }} exit={{ rotate: 90, scale: 0 }} transition={{ duration: 0.2 }}>
                  <Sun className="h-5 w-5 text-warning" aria-hidden="true" />
                </motion.div>
              ) : (
                <motion.div key="moon" initial={{ rotate: 90, scale: 0 }} animate={{ rotate: 0, scale: 1 }} exit={{ rotate: -90, scale: 0 }} transition={{ duration: 0.2 }}>
                  <Moon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                </motion.div>
              )}
            </AnimatePresence>
          </Button>

          <div className="relative" ref={profileRef}>
            <button
              onClick={handleProfileClick}
              className="flex items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-1.5 transition-all hover:border-primary/30 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              aria-label={loggedIn ? (ar ? "حسابي" : "My account") : ar ? "تسجيل الدخول" : "Sign in"}
              aria-expanded={loggedIn ? profileOpen : undefined}
              aria-haspopup={loggedIn ? "true" : undefined}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <User className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="hidden flex-col items-end leading-tight text-right sm:flex">
                <span className="max-w-[140px] truncate text-sm font-semibold text-foreground">
                  {loggedIn ? meName ?? (ar ? "حسابي" : "My account") : ar ? "تسجيل الدخول" : "Sign in"}
                </span>
                <span className="max-w-[140px] truncate text-[11px] text-muted-foreground">
                  {loggedIn ? (isPremium ? (ar ? "بريميوم" : "Premium") : ar ? "مجاني" : "Free") : ar ? "للوصول الكامل" : "For full access"}
                </span>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground/70 transition-transform" style={{ transform: profileOpen ? "rotate(180deg)" : "rotate(0deg)" }} aria-hidden="true" />
            </button>

            {loggedIn && profileOpen && (
              <AnimatePresence>
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  className="absolute end-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-border/60 bg-background shadow-xl shadow-black/10"
                  role="menu"
                >
                  <div className="space-y-1 p-2">
                    <div className="px-3 py-2">
                      <p className="truncate text-sm font-semibold text-foreground">{meName}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{me?.user?.email}</p>
                    </div>
                    <hr className="my-1 border-border/40" />
                    <button
                      onClick={() => {
                        setProfileOpen(false)
                        router.push("/premium")
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-right text-sm transition-colors hover:bg-muted/50"
                      role="menuitem"
                    >
                      <Crown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <span className="font-medium">{ar ? "الاشتراك" : "Subscription"}</span>
                    </button>
                    <hr className="my-1 border-border/40" />
                    <button
                      onClick={handleLogout}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-right text-sm transition-colors hover:bg-destructive/10 hover:text-destructive"
                      role="menuitem"
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                      <span className="font-medium">{ar ? "تسجيل الخروج" : "Sign out"}</span>
                    </button>
                  </div>
                </motion.div>
              </AnimatePresence>
            )}
          </div>

          {isPremium ? (
            <div className="hidden items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 lg:flex">
              <Crown className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              <span className="text-xs font-bold tracking-tight text-primary">{ar ? "بريميوم" : "Premium"}</span>
            </div>
          ) : (
            <Link
              href="/premium"
              className="hidden items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 text-xs font-bold text-foreground transition-colors hover:border-primary/40 hover:text-primary lg:flex"
            >
              <Crown className="h-3.5 w-3.5" aria-hidden="true" />
              {ar ? "ترقية" : "Upgrade"}
            </Link>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-9 rounded-xl border border-border/60 bg-card px-3 transition-colors hover:bg-accent/50"
            onClick={() => setLang(lang === "en" ? "ar" : "en")}
            aria-label={ar ? "تغيير اللغة" : "Change language"}
          >
            <ShieldCheck className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wider">{lang === "en" ? "AR" : "EN"}</span>
          </Button>
        </div>
      </div>
    </header>
  )
}
