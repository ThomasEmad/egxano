"use client"

// /undervalued — "فحص التقييم": companies meeting explicitly stated valuation
// criteria. This is a screen, not a call: fair value is arithmetic from the
// published criteria, the "gap" is not a price target, and each row lists the
// criteria it met plus a data-quality flag when the gap is extreme.

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown, Gauge, Lock, Scale, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { EmptyState } from "@/components/brand/empty-state"
import { SourceLine, UnavailableValue } from "@/components/brand/data-trust"
import { useI18n } from "@/lib/i18n"
import { useSubscriptionGate } from "@/lib/client/subscription-gate"
import { sectorLabel } from "@/lib/sectors"
type Row = {
  companyId: string
  ticker: string
  name: string
  nameEn?: string
  nameAr?: string | null
  sector: string
  currentPrice: number
  priceAsOf?: string | null
  fairValue: number | null
  upside: number | null
  method: string
  criteriaMet: string[]
  extreme?: boolean
  reviewRequired?: boolean
  reviewReason?: string | null
  fiscalYear?: number | null
}

const CRITERIA_AR: Record<string, string> = {
  PE_BELOW_SECTOR_0_85: "مضاعف الربحية أقل من ٨٥٪ من وسيط القطاع",
  PB_BELOW_1_AND_SECTOR_0_9: "تحت القيمة الدفترية وأقل من ٩٠٪ من وسيط القطاع",
  YIELD_ABOVE_SECTOR_75TH: "عائد التوزيعات أعلى من ٧٥٪ من شركات القطاع",
  ROE_ABOVE_PE_BELOW: "عائد على حقوق الملكية أعلى من القطاع بسعر أرخص",
  EV_EBITDA_BELOW_25TH: "EV/EBITDA ضمن أرخص ٢٥٪ من القطاع",
}

const CRITERIA_EN: Record<string, string> = {
  PE_BELOW_SECTOR_0_85: "P/E below 85% of the sector median",
  PB_BELOW_1_AND_SECTOR_0_9: "Below book value and below 90% of the sector median",
  YIELD_ABOVE_SECTOR_75TH: "Dividend yield above the sector's 75th percentile",
  ROE_ABOVE_PE_BELOW: "ROE above the sector's at a lower P/E",
  EV_EBITDA_BELOW_25TH: "EV/EBITDA in the sector's cheapest 25%",
}

function fmtDay(iso: string | null | undefined, lang: "en" | "ar"): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric" })
}

export default function UndervaluedPage() {
  const { lang } = useI18n()
  const router = useRouter()
  const { isPremium } = useSubscriptionGate()
  const ar = lang === "ar"

  const [sector, setSector] = useState("")
  const [minGap, setMinGap] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["undervalued"],
    queryFn: async () => {
      const res = await fetch("/api/v1/undervalued")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as { detected: number; results: Row[]; lastUpdated: string }
    },
    staleTime: 300_000,
  })

  const rows = useMemo(() => {
    let list = data?.results ?? []
    if (sector) list = list.filter((r) => r.sector === sector)
    if (minGap) list = list.filter((r) => (r.upside ?? -Infinity) >= Number(minGap))
    return list
  }, [data, sector, minGap])

  const sectors = useMemo(
    () => [...new Set((data?.results ?? []).map((r) => r.sector))].sort((a, b) => sectorLabel(a, lang).localeCompare(sectorLabel(b, lang))),
    [data, lang]
  )

  const visible = isPremium ? rows : rows.slice(0, 3)
  const locked = rows.length - visible.length

  function toggleSelect(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 4 ? prev : [...prev, id]))
  }

  return (
    <LayoutShell showMobileNav={true}>
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <header>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
            <Gauge className="h-5 w-5 text-primary" aria-hidden="true" />
            {ar ? "فحص التقييم — المعايير المتحققة" : "Valuation screen — criteria met"}
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {ar
              ? "شركات تحققت فيها معايير تقييم معلنة. القيمة العادلة نتيجة حسابية من هذه المعايير، والفجوة المعروضة ليست سعرًا مستهدفًا وليست توصية."
              : "Companies that met explicitly stated valuation criteria. Fair value is arithmetic from those criteria; the gap shown is not a price target and not a recommendation."}
          </p>
        </header>

        {/* Filters with meaning */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            {ar ? "فلترة:" : "Filter:"}
          </span>
          <Select value={sector || "all"} onValueChange={(v) => setSector(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 w-48 text-xs" aria-label={ar ? "القطاع" : "Sector"}>
              <SelectValue placeholder={ar ? "كل القطاعات" : "All sectors"} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all" className="text-xs">{ar ? "كل القطاعات" : "All sectors"}</SelectItem>
              {sectors.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  {sectorLabel(s, lang)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <Input
              value={minGap}
              onChange={(e) => setMinGap(e.target.value.replace(/[^\d.-]/g, ""))}
              placeholder={ar ? "أقل فجوة ٪" : "Min gap %"}
              className="h-8 w-28 text-xs tabular"
              inputMode="decimal"
              aria-label={ar ? "أقل فجوة بالنسبة المئوية" : "Minimum gap percentage"}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setSector("")
              setMinGap("")
            }}
          >
            {ar ? "إعادة ضبط" : "Reset"}
          </Button>
          <span className="text-[11px] tabular text-muted-foreground">
            {data ? (ar ? `${rows.length} من ${data.detected} نتيجة` : `${rows.length} of ${data.detected} results`) : null}
          </span>
        </div>

        {/* Provenance of this screen */}
        <SourceLine
          source={ar ? "معايير التقييم المعلنة + أسعار السوق المسجلة" : "Stated valuation criteria + recorded market prices"}
          asOf={data?.lastUpdated ?? null}
        />
        <p className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
          {ar
            ? "الصفوف الموسومة «مراجعة» تعرض فجوة تقييم متطرفة تحتاج التحقق من وحدة السهم أو فترة البيانات — لا تعتمد عليها قبل التحقق."
            : "Rows marked “review” show an extreme valuation gap that needs a unit or period check — do not rely on the figure before verifying it."}
        </p>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm font-medium text-destructive">{ar ? "تعذّر تحميل فحص التقييم" : "The valuation screen could not be loaded"}</p>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => refetch()}>
                {ar ? "إعادة المحاولة" : "Retry"}
              </Button>
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Gauge}
            title={ar ? "لا نتائج مطابقة للفلاتر" : "No results match these filters"}
            description={
              ar
                ? "الفلاتر تضيّق قائمة الشركات التي حققت المعايير. أعد ضبطها لرؤية كل النتائج الحالية."
                : "The filters narrow the list of companies that met the criteria. Reset them to see every current result."
            }
            action={
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setSector(""); setMinGap("") }}>
                {ar ? "إعادة ضبط الفلاتر" : "Reset filters"}
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            {visible.map((r) => {
              const name = ar ? r.nameAr || r.nameEn || r.name : r.nameEn || r.name
              const gap = r.upside
              const open = expanded === r.companyId
              return (
                <Card key={r.companyId} className="border-border/60">
                  <CardContent className="p-0">
                    <div className="flex items-start gap-2.5 p-3.5">
                      <input
                        type="checkbox"
                        checked={selected.includes(r.companyId)}
                        onChange={() => toggleSelect(r.companyId)}
                        className="mt-1 h-3.5 w-3.5 shrink-0 accent-primary"
                        aria-label={ar ? `اختيار ${r.ticker} للمقارنة` : `Select ${r.ticker} for comparison`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => router.push(`/company/${r.ticker}`)}
                            className="flex min-w-0 items-center gap-2 text-start hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="text-sm font-bold">{r.ticker}</span>
                            <span className="truncate text-xs text-muted-foreground">{name}</span>
                          </button>
                          {r.reviewRequired ? (
                            <Badge variant="outline" className="border-warning/40 bg-warning/10 text-[9px] text-warning">
                              {ar ? "مراجعة" : "review"}
                            </Badge>
                          ) : null}
                          <Badge variant="outline" className="text-[9px] text-muted-foreground">
                            {ar ? `${r.criteriaMet.length} معيار` : `${r.criteriaMet.length} criteria`}
                          </Badge>
                        </div>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                          <span>
                            {ar ? "السعر " : "Price "}
                            <span dir="ltr" className="tabular">
                              {r.currentPrice.toFixed(2)} {ar ? "ج.م" : "EGP"}
                            </span>
                          </span>
                          {r.priceAsOf ? <span>({fmtDay(r.priceAsOf, lang)})</span> : <UnavailableValue />}
                          {r.fiscalYear ? <span>· {ar ? "سنة" : "FY"} {r.fiscalYear}</span> : null}
                          <span>· {sectorLabel(r.sector, lang)}</span>
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {r.criteriaMet.slice(0, 3).map((c) => (
                            <span key={c} className="rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                              {(ar ? CRITERIA_AR : CRITERIA_EN)[c] ?? c}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="shrink-0 text-end">
                        <p className="tabular text-sm font-semibold text-foreground">{gap !== null ? `${gap > 0 ? "+" : ""}${gap.toFixed(1)}%` : "—"}</p>
                        <p className="text-[9px] text-muted-foreground">{ar ? "الفجوة مقابل القيمة المستنتجة" : "gap vs criteria value"}</p>
                        <button
                          type="button"
                          onClick={() => setExpanded(open ? null : r.companyId)}
                          className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-expanded={open}
                        >
                          {ar ? "التفاصيل" : "Details"}
                          <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    {open ? (
                      <div className="space-y-2 border-t border-border/60 p-3.5 text-xs">
                        <p>
                          <span className="font-medium">{ar ? "القيمة المستنتجة من المعايير:" : "Criteria-implied value:"}</span>{" "}
                          <span dir="ltr" className="tabular font-semibold">
                            {r.fairValue !== null ? `${r.fairValue.toFixed(2)} ${ar ? "ج.م" : "EGP"}` : "—"}
                          </span>
                          {r.method ? <span className="ms-2 text-muted-foreground">({r.method})</span> : null}
                        </p>
                        <div>
                          <p className="mb-1 font-medium">{ar ? "المعايير المتحققة:" : "Criteria met:"}</p>
                          <ul className="list-disc space-y-0.5 ps-4 text-muted-foreground">
                            {r.criteriaMet.map((c) => (
                              <li key={c}>{(ar ? CRITERIA_AR : CRITERIA_EN)[c] ?? c}</li>
                            ))}
                          </ul>
                        </div>
                        {r.reviewRequired ? (
                          <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] leading-relaxed text-warning">
                            {ar
                              ? "فجوة التقييم تتجاوز ٢٠٠٪ — تحقق من وحدة السهم أو فترة البيانات قبل الاعتماد على الرقم."
                              : "The valuation gap exceeds 200% — verify the per-share unit or the statement period before relying on this figure."}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-1.5">
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => router.push(`/company/${r.ticker}`)}>
                            {ar ? "افتح صفحة الشركة" : "Open company"}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              )
            })}

            {selected.length > 0 ? (
              <div className="sticky bottom-2 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-card/95 p-2.5 shadow-sm backdrop-blur">
                <span className="text-xs font-medium text-foreground">
                  {ar ? `${selected.length} محددة للمقارنة` : `${selected.length} selected for comparison`}
                </span>
                <Button size="sm" className="ms-auto h-7 gap-1.5 text-xs" disabled={selected.length < 2} onClick={() => router.push(`/compare?ids=${selected.join(",")}`)}>
                  <Scale className="h-3.5 w-3.5" aria-hidden="true" />
                  {ar ? "قارن" : "Compare"}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected([])}>
                  {ar ? "إلغاء" : "Clear"}
                </Button>
              </div>
            ) : null}

            {!isPremium && locked > 0 ? (
              <Card className="border-gold/30 bg-gold/5">
                <CardContent className="flex flex-wrap items-center justify-center gap-3 p-3 text-xs text-warning">
                  <Lock className="h-4 w-4" aria-hidden="true" />
                  {ar ? `${locked} نتيجة إضافية مع بريميوم` : `${locked} more results with Premium`}
                  <Button size="sm" className="h-7 text-xs" onClick={() => router.push("/premium")}>
                    {ar ? "تفاصيل بريميوم" : "Premium details"}
                  </Button>
                </CardContent>
              </Card>
            ) : null}
          </div>
        )}
      </div>
    </LayoutShell>
  )
}
