"use client"

// /watchlist — the starred companies with a verified-data snapshot each:
// latest recorded price + 1Y change, latest annual revenue/profit/margins.
// The list itself is a client preference (zustand, device-local).

import { useMemo } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Star, Trash2, TrendingDown, TrendingUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { EmptyState } from "@/components/brand/empty-state"
import { MarketDataLine } from "@/components/brand/data-trust"
import { SECTOR_AR } from "@/lib/sectors"
import { TRUST } from "@/lib/brand"
import { useWatchlist } from "@/lib/client/watchlist"
import { useI18n } from "@/lib/i18n"

interface WatchCompany {
  id: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
  price: number | null
  priceAsOf: string | null
  change1y: number | null
  fiscalYear: number | null
  periodLabel: string | null
  metrics: Record<string, number>
}

interface WatchData {
  companies: WatchCompany[]
  metricDefs: { code: string; labelEn: string; labelAr: string; unit: string }[]
}

function fmt(unit: string, v: number | undefined | null): string {
  if (v === undefined || v === null) return "—"
  if (unit === "PERCENT") return `${v.toFixed(1)}%`
  if (unit === "EGP") {
    const abs = Math.abs(v)
    if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`
    if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`
    if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`
    return v.toFixed(0)
  }
  return v.toFixed(2)
}

export default function WatchlistPage() {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const items = useWatchlist((s) => s.items)
  const toggle = useWatchlist((s) => s.toggle)
  const ids = useMemo(() => items.map((i) => i.id), [items])
  const idKey = ids.join(",")

  const { data, isLoading, error } = useQuery({
    queryKey: ["watchlist-summaries", idKey],
    queryFn: () => fetch(`/api/v1/watchlist?ids=${idKey}`).then((r) => (r.ok ? (r.json() as Promise<WatchData>) : null)),
    enabled: ids.length > 0,
    staleTime: 120_000,
  })

  if (error) {
    return (
      <LayoutShell>
        <div className="mx-auto max-w-7xl py-6">
          <Card className="border-destructive/20 bg-destructive/5">
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm font-medium text-destructive">{ar ? "تعذّر تحميل القائمة — تحقق من اتصالك" : "Failed to load watchlist — please check your connection"}</p>
              <p className="text-xs text-muted-foreground">{error instanceof Error ? error.message : ar ? "حدث خطأ غير متوقع" : "An unexpected error occurred"}</p>
              <Button variant="outline" onClick={() => window.location.reload()} className="mt-2 h-8 text-xs">{ar ? "إعادة التحميل" : "Reload"}</Button>
            </CardContent>
          </Card>
        </div>
      </LayoutShell>
    )
  }

  const defs = data?.metricDefs ?? []
  const get = (c: WatchCompany, code: string) => fmt(defs.find((d) => d.code === code)?.unit ?? "RATIO", c.metrics[code])
  const latestAsOf =
    data?.companies?.map((c) => c.priceAsOf).filter((v): v is string => Boolean(v)).sort().at(-1) ?? null

  return (
    <LayoutShell>
      <div className="mx-auto max-w-7xl py-6">
        <div className="mb-5">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
            {ar ? "قائمة المتابعة" : "Watchlist"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {ar
              ? "الشركات اللي بتتابعها مع أحدث أرقام مسجّلة. محفوظة على الجهاز وبتتزامن مع حسابك لما تسجّل الدخول."
              : "Companies you follow, with their latest recorded figures. Saved on this device and synced to your account when you sign in."}
          </p>
          {ids.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">{ar ? TRUST.source.ar : TRUST.source.en}:</span>{" "}
                {ar ? TRUST.sourceFiling.ar : TRUST.sourceFiling.en}
              </span>
              <MarketDataLine asOf={latestAsOf} source={ar ? "أسعار مسجّلة" : "recorded prices"} />
              <span>{ar ? "القيم غير المتاحة تظهر «—» ولا تُقدَّر." : "Unavailable values show “—” and are never estimated."}</span>
            </div>
          ) : null}
        </div>

        {ids.length === 0 ? (
          <EmptyState
            icon={Star}
            title={ar ? "مفيش شركات في القائمة بعد" : "No companies yet"}
            description={
              ar
                ? "دوس النجمة على أي شركة عشان تتابعها هنا. القائمة بتتحفظ على جهازك، وبتتزامن مع حسابك لما تسجّل الدخول."
                : "Tap the star on any company to follow it here. The list is saved on your device and synced to your account when you sign in."
            }
            action={
              <Button size="sm" asChild>
                <Link href="/companies">{ar ? "تصفح الشركات" : "Browse companies"}</Link>
              </Button>
            }
          />
        ) : isLoading ? (
          <div className="space-y-2">
            {ids.slice(0, 6).map((id) => (
              <Skeleton key={id} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : (
          <Card className="border-border/60 p-0">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="p-3 text-start font-medium">{ar ? "الشركة" : "Company"}</th>
                      <th className="p-3 text-start font-medium">{ar ? "الفترة" : "Period"}</th>
                      <th className="p-3 text-end font-medium">{ar ? "آخر سعر" : "Last price"}</th>
                      <th className="p-3 text-end font-medium">{ar ? "سنة" : "1Y"}</th>
                      <th className="p-3 text-end font-medium">{ar ? "الإيرادات" : "Revenue"}</th>
                      <th className="p-3 text-end font-medium">{ar ? "صافي الربح" : "Net profit"}</th>
                      <th className="p-3 text-end font-medium">{ar ? "الهامش" : "Margin"}</th>
                      <th className="p-3 text-end font-medium">ROE</th>
                      <th className="hidden p-3 text-end font-medium md:table-cell">P/E</th>
                      <th className="hidden p-3 text-end font-medium md:table-cell">{ar ? "التوزيعات" : "Div yield"}</th>
                      <th className="p-3 text-end font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.companies ?? []).map((c) => {
                      const up = c.change1y !== null && c.change1y >= 0
                      return (
                        <tr key={c.id} className="border-b border-border/40 last:border-0">
                          <td className="p-3">
                            <a href={`/company/${c.id}`} className="group flex items-center gap-2">
                              <span className="font-bold group-hover:text-primary">{c.ticker}</span>
                              <span className="hidden max-w-40 truncate text-xs text-muted-foreground sm:inline">{ar ? c.nameAr ?? c.nameEn : c.nameEn}</span>
                              <Badge variant="outline" className="hidden text-[9px] lg:inline-flex">{ar ? SECTOR_AR[c.sector] ?? c.sector : c.sector}</Badge>
                            </a>
                          </td>
                          <td className="whitespace-nowrap p-3 text-xs text-muted-foreground">
                            {c.periodLabel ?? "—"}
                            {c.fiscalYear !== null ? <span className="ms-1 text-[10px] opacity-70">FY{c.fiscalYear}</span> : null}
                          </td>
                          <td className="p-3 text-end tabular">
                            {c.price !== null ? (
                              <>
                                {c.price.toFixed(2)}
                                {c.priceAsOf ? <span className="ms-1 text-[10px] text-muted-foreground">{c.priceAsOf.slice(0, 10)}</span> : null}
                              </>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </td>
                          <td className={`p-3 text-end font-semibold tabular ${c.change1y === null ? "text-muted-foreground/60" : up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                            {c.change1y !== null ? (
                              <span className="inline-flex items-center gap-1">
                                {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                {up ? "+" : ""}{c.change1y.toFixed(1)}%
                              </span>
                            ) : "—"}
                          </td>
                          <td className="p-3 text-end tabular">{get(c, "revenue")}</td>
                          <td className="p-3 text-end tabular">{get(c, "net_profit")}</td>
                          <td className="p-3 text-end tabular">{get(c, "net_margin")}</td>
                          <td className="p-3 text-end tabular">{get(c, "roe")}</td>
                          <td className="hidden p-3 text-end tabular md:table-cell">{get(c, "p_e")}</td>
                          <td className="hidden p-3 text-end tabular md:table-cell">{get(c, "dividend_yield")}</td>
                          <td className="p-3 text-end">
                            <Button variant="ghost" size="sm" className="h-7 w-7 px-0 text-muted-foreground hover:text-red-500" onClick={() => toggle({ id: c.id, ticker: c.ticker })} aria-label={ar ? "إزالة" : "Remove"}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {ids.length > 0 && data && data.companies.length < ids.length ? (
          <p className="mt-3 text-xs text-muted-foreground italic">
            {ar
              ? `${ids.length - data.companies.length} شركة في قائمتك لسه مش مغطاة — هتظهر أول ما تتوفر بياناتها المالية.`
              : `${ids.length - data.companies.length} company in your list isn't covered yet — it will appear as soon as financial data is available.`}
          </p>
        ) : null}
      </div>
    </LayoutShell>
  )
}
