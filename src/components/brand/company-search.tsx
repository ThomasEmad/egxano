"use client"

import { useEffect, useId, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import { sectorLabel } from "@/lib/sectors"

interface SearchCompany {
  id: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
}

/**
 * Real company search against /api/v1/companies. Results are session-derived
 * data — no sample list is ever shown as if it were the live universe.
 */
export function CompanySearch({
  size = "default",
  className,
  placeholder,
}: {
  size?: "default" | "lg"
  className?: string
  placeholder?: string
}) {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const router = useRouter()
  const listboxId = useId()
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 220)
    return () => clearTimeout(id)
  }, [query])

  useEffect(() => {
    function onDocDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocDown)
    return () => document.removeEventListener("mousedown", onDocDown)
  }, [])

  const { data, isFetching } = useQuery({
    queryKey: ["company-search", debounced],
    queryFn: async () => {
      const res = await fetch(`/api/v1/companies?search=${encodeURIComponent(debounced)}&pageSize=6`)
      if (!res.ok) return { companies: [] as SearchCompany[] }
      const json = (await res.json()) as { companies?: SearchCompany[] }
      return { companies: json.companies ?? [] }
    },
    enabled: debounced.length >= 2,
    staleTime: 30_000,
    retry: false,
  })

  const results = data?.companies ?? []

  function go(company: SearchCompany) {
    setOpen(false)
    setQuery("")
    router.push(`/company/${company.ticker}`)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) {
      if (event.key === "Enter") {
        router.push(`/companies?search=${encodeURIComponent(query.trim())}`)
      }
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (event.key === "Enter") {
      event.preventDefault()
      const picked = results[active]
      if (picked) go(picked)
      else router.push(`/companies?search=${encodeURIComponent(query.trim())}`)
    } else if (event.key === "Escape") {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className={cn("relative w-full", className)}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border border-border bg-card shadow-sm transition-colors focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-ring/30",
          size === "lg" ? "h-14 px-4" : "h-11 px-3",
        )}
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <label htmlFor={`${listboxId}-input`} className="sr-only">
          {ar ? "ابحث عن شركة بالاسم أو الرمز" : "Search for a company by name or ticker"}
        </label>
        <input
          id={`${listboxId}-input`}
          type="search"
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? (ar ? "ابحث عن شركة… مثال: COMI أو البنك التجاري" : "Search a company… e.g. COMI")}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/70",
            size === "lg" ? "text-base" : "text-sm",
          )}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listboxId}-option-${active}` : undefined}
        />
        {isFetching ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
        <Button
          type="button"
          size="sm"
          className={cn("shrink-0 gap-1", size === "lg" ? "h-9 px-4" : "h-8 px-3")}
          onClick={() => router.push(`/companies?search=${encodeURIComponent(query.trim())}`)}
        >
          {ar ? "بحث" : "Search"}
          <ArrowRight className="h-3.5 w-3.5 rtl-flip" aria-hidden="true" />
        </Button>
      </div>

      {open && debounced.length >= 2 ? (
        <div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
          {isFetching && results.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              {ar ? "جارٍ البحث…" : "Searching…"}
            </p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              {ar
                ? `لا توجد شركة مطابقة لـ «${debounced}». جرّب الرمز أو الاسم الإنجليزي، أو تصفح كل الشركات.`
                : `No company matches “${debounced}”. Try the ticker or English name, or browse all companies.`}
            </p>
          ) : (
            <ul id={listboxId} role="listbox" className="max-h-80 overflow-y-auto py-1">
              {results.map((company, index) => (
                <li
                  key={company.id}
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 px-3 py-2 text-start transition-colors",
                    index === active ? "bg-muted" : "hover:bg-muted/60",
                  )}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => go(company)}
                >
                  <span className="w-14 shrink-0 text-xs font-bold tabular text-primary">
                    {company.ticker}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {ar ? (company.nameAr ?? company.nameEn) : company.nameEn}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {sectorLabel(company.sector, lang)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-border bg-muted/30 px-3 py-2 text-[10px] text-muted-foreground">
            {ar
              ? "اختر شركة لفتح صفحتها البحثية، أو ابحث لعرض النتائج الكاملة."
              : "Pick a company to open its research page, or search to see all results."}
          </div>
        </div>
      ) : null}
    </div>
  )
}
