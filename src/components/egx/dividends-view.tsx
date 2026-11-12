"use client"
/**
 * DividendsView v2 — full redesign (2026-11-12).
 *
 * The old layout was a 12-month calendar grid plus heavy month-grouped cards —
 * visually noisy and hard to scan (user feedback: "عرض الجدول سيء"). This
 * version is built around what a user actually asks:
 *   1) «إيه التوزيعات اللي جاية؟» — upcoming distributions with a countdown and
 *      an implied yield against the freshest price, colored semantically.
 *   2) «التوزيعات السابقة؟» — a clean searchable history table (desktop) that
 *      becomes stacked cards on mobile.
 *
 * Data: a single fetch of all dividends (API caches 6h) + one companies call
 * for the price map (implied yield only). Semantic color contract:
 *   info = announced · positive = near (≤14d) / cash · success = paid ·
 *   warning = unverified yield · destructive = cancelled.
 */
import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CalendarDays, History, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/client/api"
import { useI18n } from "@/lib/i18n"

const UP_STATES = new Set(["ANNOUNCED", "UPCOMING", "ELIGIBLE"])

const STATUS_LABEL: Record<string, { en: string; ar: string }> = {
  ANNOUNCED: { en: "Announced", ar: "معلنة" },
  UPCOMING: { en: "Upcoming", ar: "قادمة" },
  ELIGIBLE: { en: "Eligible", ar: "مستحقة" },
  PAID: { en: "Paid", ar: "مصروفة" },
  EXPIRED: { en: "Expired", ar: "منتهية" },
  CANCELLED: { en: "Cancelled", ar: "ملغاة" },
}

const STATUS_CLASS: Record<string, string> = {
  ANNOUNCED: "bg-info/15 text-info border-info/30",
  UPCOMING: "bg-info/15 text-info border-info/30",
  ELIGIBLE: "bg-info/15 text-info border-info/30",
  PAID: "bg-success/15 text-success border-success/30",
  EXPIRED: "bg-muted text-muted-foreground border-border",
  CANCELLED: "bg-destructive/15 text-destructive border-destructive/30",
}

type DividendItem = Awaited<ReturnType<typeof api.dividends>>["dividends"][number]

function effDate(d: DividendItem): string | null {
  return d.exDividendDate ?? d.distributionDate ?? d.eligibilityDate ?? d.announcementDate
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (Number.isNaN(ms)) return null
  return Math.ceil(ms / 86_400_000)
}

function fmtDate(iso: string | null | undefined, ar: boolean): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function fmtDps(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—"
  if (n >= 100) return n.toFixed(0)
  if (n >= 10) return n.toFixed(1)
  return n.toFixed(2)
}

function StatusBadge({ status }: { status: string }) {
  const { lang } = useI18n()
  const entry = STATUS_LABEL[status]
  return (
    <Badge variant="outline" className={`gap-1.5 border ${STATUS_CLASS[status] ?? "border-border"}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {entry ? (lang === "ar" ? entry.ar : entry.en) : status.replaceAll("_", " ")}
    </Badge>
  )
}

function TickerBox({ ticker, className = "" }: { ticker: string; className?: string }) {
  return (
    <div className={`grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-xs font-bold text-primary ${className}`} aria-hidden>
      {ticker.slice(0, 4)}
    </div>
  )
}

export function DividendsView({ onOpenCompany }: { onOpenCompany: (id: string) => void }) {
  const { t, pick, lang } = useI18n()
  const ar = lang === "ar"
  const [histFilter, setHistFilter] = useState<"all" | "paid" | "upcoming" | "gone">("all")
  const [search, setSearch] = useState("")
  const [limit, setLimit] = useState(40)

  const { data, isLoading } = useQuery({
    queryKey: ["dividends", "v2"],
    queryFn: () => api.dividends(),
  })
  const { data: cos } = useQuery({
    queryKey: ["dividends-prices"],
    queryFn: () => api.companies({ page: 1, pageSize: 300, sort: "marketCap" }),
    staleTime: 120_000,
  })

  const priceByTicker = useMemo(
    () => new Map((cos?.companies ?? []).map((c) => [c.ticker.toUpperCase(), c.marketPrice?.price ?? null])),
    [cos],
  )

  const all = data?.dividends ?? []

  const upcoming = useMemo(() => {
    return all
      .filter((d) => UP_STATES.has(d.status))
      .sort((a, b) => {
        const da = effDate(a), dbb = effDate(b)
        if (!da && !dbb) return 0
        if (!da) return 1
        if (!dbb) return -1
        return da.localeCompare(dbb)
      })
      .slice(0, 12)
  }, [all])

  const history = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all
      .filter((d) => {
        if (histFilter === "paid" && d.status !== "PAID") return false
        if (histFilter === "upcoming" && !UP_STATES.has(d.status)) return false
        if (histFilter === "gone" && d.status !== "CANCELLED" && d.status !== "EXPIRED") return false
        if (!q) return true
        const name = pick(d.company?.nameEn, d.company?.nameAr) ?? ""
        return d.company?.ticker.toLowerCase().includes(q) || name.toLowerCase().includes(q)
      })
      .sort((a, b) => (b.announcementDate ?? "").localeCompare(a.announcementDate ?? ""))
  }, [all, histFilter, search, pick])

  const counts = useMemo(() => {
    let paid = 0, up = 0, gone = 0
    const payers = new Set<string>()
    for (const d of all) {
      if (d.status === "PAID") { paid++; if (d.company?.ticker) payers.add(d.company.ticker) }
      else if (UP_STATES.has(d.status)) up++
      else if (d.status === "CANCELLED" || d.status === "EXPIRED") gone++
    }
    return { paid, up, gone, payers: payers.size }
  }, [all])

  const chips: { key: typeof histFilter; label: string; count: number }[] = [
    { key: "all", label: t("dv.filterAll"), count: all.length },
    { key: "paid", label: t("dv.paidChip"), count: counts.paid },
    { key: "upcoming", label: t("dash.upcomingDividends"), count: counts.up },
    { key: "gone", label: t("dv.cancelledChip"), count: counts.gone },
  ]

  const daysLabel = (n: number) =>
    n <= 0 ? t("dv.paidSoon") : n === 1 ? t("dv.tomorrow") : t("dv.inDays").replace("{n}", String(n))

  return (
    <div className="space-y-10">
      {/* ============ 1) Upcoming distributions ============ */}
      <section aria-labelledby="dv-upcoming">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="dv-upcoming" className="flex items-center gap-2 text-lg font-bold">
            <CalendarDays className="size-5 text-info" aria-hidden />
            {t("dv.upcoming")}
          </h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-success/30 bg-success/10 px-2.5 py-1 font-semibold text-success">
              {counts.payers} {ar ? "شركة موزعة" : "paying companies"}
            </span>
            <span className="rounded-full border border-info/30 bg-info/10 px-2.5 py-1 font-semibold text-info">
              {counts.up} {ar ? "قادمة" : "upcoming"}
            </span>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("dv.upcomingSub")}</p>

        {isLoading ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
          </div>
        ) : upcoming.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t("dv.noUpcoming")}
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {upcoming.map((d) => {
              const price = d.company ? priceByTicker.get(d.company.ticker.toUpperCase()) ?? null : null
              const dy = d.dividendPerShare != null && price != null && price > 0 ? (d.dividendPerShare / price) * 100 : null
              const days = daysUntil(effDate(d))
              return (
                <button
                  key={d.id}
                  onClick={() => d.company && onOpenCompany(d.company.id)}
                  className="group w-full rounded-xl border bg-card p-4 text-start transition-colors hover:border-primary/60 hover:bg-accent/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <TickerBox ticker={d.company?.ticker ?? "—"} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold">{pick(d.company?.nameEn, d.company?.nameAr)}</div>
                        <div dir="ltr" className="text-xs font-semibold text-muted-foreground">{d.company?.ticker}</div>
                      </div>
                    </div>
                    <StatusBadge status={d.status} />
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <div className="text-xs text-muted-foreground">{t("dv.dps")} · {d.currency}</div>
                      <div dir="ltr" className="text-2xl font-extrabold tabular-nums text-positive">
                        {fmtDps(d.dividendPerShare)}
                        <span className="ms-1 text-xs font-medium text-muted-foreground">EGP</span>
                      </div>
                    </div>
                    <div className="text-end">
                      {days !== null ? (
                        <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold ${days > 0 && days <= 14 ? "bg-positive/15 text-positive" : "bg-muted text-muted-foreground"}`}>
                          {daysLabel(days)}
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">{t("dv.paidSoon")}</span>
                      )}
                      <div className="mt-1 text-xs text-muted-foreground">{fmtDate(effDate(d), ar)}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    {d.eligibilityDate && (
                      <span className="text-muted-foreground">{t("dv.eligibility")}: <b className="font-semibold text-foreground">{fmtDate(d.eligibilityDate, ar)}</b></span>
                    )}
                    {d.distributionDate && (
                      <span className="text-muted-foreground">{t("dv.distribution")}: <b className="font-semibold text-foreground">{fmtDate(d.distributionDate, ar)}</b></span>
                    )}
                    {dy !== null && (
                      <span className={dy > 30 ? "text-warning" : "text-positive"}>
                        {t("dv.estYield")}: <b className="font-bold tabular-nums">{dy.toFixed(1)}%</b>
                        {dy > 30 && <span className="ms-1 font-medium">({t("dv.yieldUnverified")})</span>}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* ============ 2) History ============ */}
      <section aria-labelledby="dv-history">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="dv-history" className="flex items-center gap-2 text-lg font-bold">
            <History className="size-5 text-muted-foreground" aria-hidden />
            {t("dv.history")}
          </h2>
          <div className="relative w-full max-w-xs">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setLimit(40) }}
              placeholder={t("dv.searchPh")}
              className="h-10 w-full rounded-lg border bg-background ps-9 pe-3 text-sm outline-none transition-colors focus:border-primary/60"
              aria-label={t("dv.searchPh")}
            />
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("dv.historySub")}</p>

        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label={t("dv.history")}>
          {chips.map((c) => (
            <button
              key={c.key}
              role="tab"
              aria-selected={histFilter === c.key}
              onClick={() => { setHistFilter(c.key); setLimit(40) }}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                histFilter === c.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {c.label}
              <span className={`ms-1.5 text-xs ${histFilter === c.key ? "opacity-80" : "opacity-60"}`}>{c.count}</span>
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="mt-4 space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
        ) : history.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("dv.noResults")}</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="mt-4 hidden overflow-x-auto rounded-xl border md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-start text-xs text-muted-foreground">
                    <th className="px-4 py-3 text-start font-semibold">{ar ? "الشركة" : "Company"}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t("dv.dps")}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t("dv.announcement")}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t("dv.exDate")}</th>
                    <th className="px-4 py-3 text-start font-semibold">{t("dv.distribution")}</th>
                    <th className="px-4 py-3 text-start font-semibold">{ar ? "الحالة" : "Status"}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.slice(0, limit).map((d) => (
                    <tr
                      key={d.id}
                      onClick={() => d.company && onOpenCompany(d.company.id)}
                      className="cursor-pointer border-b transition-colors last:border-0 hover:bg-accent/40"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <TickerBox ticker={d.company?.ticker ?? "—"} className="size-8 text-[10px]" />
                          <div className="min-w-0">
                            <div className="max-w-[220px] truncate font-semibold">{pick(d.company?.nameEn, d.company?.nameAr)}</div>
                            <div dir="ltr" className="text-xs text-muted-foreground">{d.company?.ticker}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span dir="ltr" className="font-bold tabular-nums text-positive">{fmtDps(d.dividendPerShare)}</span>
                        <span className="ms-1 text-xs text-muted-foreground">EGP</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(d.announcementDate, ar)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(d.exDividendDate, ar)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(d.distributionDate, ar)}</td>
                      <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="mt-4 space-y-2 md:hidden">
              {history.slice(0, limit).map((d) => (
                <button
                  key={d.id}
                  onClick={() => d.company && onOpenCompany(d.company.id)}
                  className="w-full rounded-xl border bg-card p-3.5 text-start transition-colors hover:border-primary/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <TickerBox ticker={d.company?.ticker ?? "—"} className="size-8 text-[10px]" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold">{pick(d.company?.nameEn, d.company?.nameAr)}</div>
                        <div dir="ltr" className="text-xs text-muted-foreground">{d.company?.ticker}</div>
                      </div>
                    </div>
                    <div dir="ltr" className="text-end">
                      <div className="text-base font-extrabold tabular-nums text-positive">{fmtDps(d.dividendPerShare)}</div>
                      <div className="text-[10px] text-muted-foreground">EGP</div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{t("dv.distribution")}: {fmtDate(d.distributionDate ?? d.exDividendDate, ar)}</span>
                    <StatusBadge status={d.status} />
                  </div>
                </button>
              ))}
            </div>

            {history.length > limit && (
              <div className="mt-4 text-center">
                <button
                  onClick={() => setLimit((l) => l + 40)}
                  className="rounded-full border px-5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  {t("dv.showMore")} ({history.length - limit})
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
