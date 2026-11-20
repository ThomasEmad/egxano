"use client"

// MarketIntelligencePanel — whole-market intelligence strip mounted at the top
// of the dashboard: regime (with evidence) + market pulse, breadth + A/D line
// sparkline, sector rotation matrix, anomalies and the opportunity / risk
// radars.
//
// Data: passed in as a prop by DashboardView — the page fetches
// GET /api/v1/market/intelligence ONCE and feeds every breadth surface (hero
// cells, market summary, this strip) from that single object. This panel used
// to fetch its own copy while the hero row read /api/v1/market/breadth, and
// the two rows rendered different snapshots of the same market (different
// adv/dec, traded value, SMA status and timestamps). Every figure comes from
// the deterministic compute layer (src/lib/market/intelligence/compute.ts);
// this file only renders what that snapshot carries. When the endpoint 503s
// with INTELLIGENCE_UNAVAILABLE (before the first market refresh) the parent
// passes undefined and this renders a graceful muted state, never an error
// surface.

import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowLeftRight, Info, Radar, Sparkles, TrendingDown, TrendingUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { sectorLabel } from "@/lib/sectors"
import type { MarketIntelligence } from "@/lib/market/intelligence/compute"

// ---------------------------------------------------------------- helpers

const LAST_VISIT_KEY = "egx_last_visit_v1"

interface LastVisit {
  ts: number
  regime: string | null
  pulse: number | null
}

/** AR labels for regime codes (mirrors the compute layer's REGIME_AR map so
 * the "changed from X" line can name the PREVIOUS regime after a code change). */
const REGIME_AR: Record<string, string> = {
  strong_uptrend: "اتجاه صاعد قوي",
  weak_uptrend: "اتجاه صاعد ضعيف",
  sideways: "سوق عرضي / تجميع",
  weak_downtrend: "اتجاه هابط ضعيف",
  strong_downtrend: "اتجاه هابط قوي",
  narrow_leadership: "قيادة ضيقة — الصعود محصور في عدد قليل من الأسهم",
  broad_participation: "مشاركة واسعة",
}

function pctColor(v: number | null): string {
  if (v === null) return "text-muted-foreground"
  return v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-muted-foreground"
}

function pctStr(v: number | null, digits = 1): string {
  if (v === null) return "—"
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`
}

/** Compact EGP value, e.g. "12.4 مليون ج" (AR) / "12.4M EGP" (EN). */
function fmtEgpAr(v: number | null, ar: boolean): string {
  if (v === null || !Number.isFinite(v)) return "—"
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)} ${ar ? "مليار ج" : "B EGP"}`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)} ${ar ? "مليون ج" : "M EGP"}`
  if (abs >= 1e3) return `${(v / 1e3).toFixed(0)} ${ar ? "ألف ج" : "K EGP"}`
  return `${v.toFixed(0)} ${ar ? "ج" : "EGP"}`
}

/** Wall-clock time of an ISO timestamp in Cairo — matches the market's own clock. */
function cairoTime(iso: string, ar: boolean): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(ar ? "ar-EG" : "en-GB", {
    timeZone: "Africa/Cairo",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// ---------------------------------------------------------------- pieces

function PulseRing({ score }: { score: number }) {
  const r = 15.5
  const c = 2 * Math.PI * r
  const clamped = Math.min(100, Math.max(0, score))
  return (
    <span className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center" role="img" aria-label={`pulse ${Math.round(clamped)}/100`}>
      <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--muted)" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${((clamped / 100) * c).toFixed(2)} ${c.toFixed(2)}`}
        />
      </svg>
      <span className="tnum absolute text-[11px] font-bold" dir="ltr">{Math.round(clamped)}</span>
    </span>
  )
}

function StatCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/50 bg-background/60 px-3 py-2">
      <p className="truncate text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}

// (AdLineSparkline REMOVED 2026-11-17 — owner: «احذف خط الصعود/الهبوط التراكمي
// من الداشبورد». The /api/v1/market/intelligence payload still carries adLine
// for any future surface; the dashboard simply no longer renders it.)

const ANOMALY_KIND: Record<string, { ar: string; en: string; cls: string }> = {
  volume_spike: { ar: "اندفاع حجم", en: "volume spike", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  volume_without_price: { ar: "جهد بلا اتجاه", en: "effort w/o result", cls: "border-border/60 bg-muted/30 text-muted-foreground" },
  price_without_volume: { ar: "حركة بلا حجم", en: "price w/o volume", cls: "border-border/60 bg-muted/30 text-muted-foreground" },
  activity_after_quiet: { ar: "نشاط بعد هدوء", en: "activity after quiet", cls: "border-primary/40 bg-primary/10 text-primary" },
}

function RadarColumn({
  title,
  tone,
  icon,
  rows,
  ar,
}: {
  title: string
  tone: string
  icon: React.ReactNode
  rows: MarketIntelligence["radars"]["opportunities"]
  ar: boolean
}) {
  return (
    <div className="min-w-0">
      <p className={`mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide ${tone}`}>
        {icon}
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-border/50 px-2.5 py-3 text-center text-[11px] text-muted-foreground">
          {ar ? "لا إدخالات الآن." : "No entries right now."}
        </p>
      ) : (
        <div className="max-h-64 space-y-1 overflow-y-auto pe-0.5">
          {rows.map((r) => (
            <Link
              key={`${title}-${r.ticker}`}
              href={`/company/${encodeURIComponent(r.ticker)}`}
              className="block rounded-lg border border-border/50 bg-card px-2.5 py-2 transition-colors hover:border-primary/40 hover:bg-accent/30"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold">{r.ticker}</span>
                <span className="min-w-0 truncate text-[10px] text-muted-foreground">{ar ? (r.nameAr ?? r.name) : r.name}</span>
                <span className={`tnum ms-auto shrink-0 text-[11px] font-bold ${r.dayChangePct >= 0 ? "text-positive" : "text-negative"}`} dir="ltr">
                  {r.dayChangePct >= 0 ? "+" : ""}{r.dayChangePct.toFixed(2)}%
                </span>
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{ar ? r.detailAr : r.detail}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- panel

export function MarketIntelligencePanel({
  intel,
  isLoading = false,
}: {
  /** The page's shared intelligence snapshot — one fetch feeds every section. */
  intel: MarketIntelligence | null | undefined
  isLoading?: boolean
}) {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const [visitLines, setVisitLines] = useState<string[]>([])

  // "ماذا تغيّر منذ آخر زيارة؟" — localStorage-based diff. On every data load:
  // compare against the stored last snapshot, highlight regime changes and
  // pulse moves ≥8, then store the fresh snapshot. SSR-safe (typeof window);
  // setState deferred via rAF (same pattern as the I18nProvider) to avoid
  // cascading renders.
  useEffect(() => {
    if (!intel || typeof window === "undefined") return
    const raf = requestAnimationFrame(() => {
      try {
        const raw = window.localStorage.getItem(LAST_VISIT_KEY)
        const lines: string[] = []
        if (raw) {
          const prev = JSON.parse(raw) as Partial<LastVisit>
          if (prev.regime && intel.regime.code && prev.regime !== intel.regime.code) {
            lines.push(
              ar
                ? `نظام السوق تغيّر من ${REGIME_AR[prev.regime] ?? prev.regime} إلى ${intel.regime.labelAr}`
                : `Market regime changed from ${prev.regime.replace(/_/g, " ")} to ${intel.regime.label}`,
            )
          }
          if (typeof prev.pulse === "number" && Math.abs(intel.pulse.score - prev.pulse) >= 8) {
            lines.push(
              ar
                ? `نبض السوق تحرك من ${Math.round(prev.pulse)} إلى ${Math.round(intel.pulse.score)}`
                : `Market pulse moved from ${Math.round(prev.pulse)} to ${Math.round(intel.pulse.score)}`,
            )
          }
        }
        if (lines.length > 0) setVisitLines((old) => (old.length > 0 ? old : lines))
        window.localStorage.setItem(
          LAST_VISIT_KEY,
          JSON.stringify({ ts: Date.now(), regime: intel.regime.code ?? null, pulse: intel.pulse.score } satisfies LastVisit),
        )
      } catch {
        // storage unavailable (private mode / quota) — skip silently
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [intel, ar])

  if (isLoading) {
    return (
      <Card className="border-border/60 p-0">
        <CardContent className="p-5">
          <Skeleton className="h-40 w-full rounded-xl" />
        </CardContent>
      </Card>
    )
  }

  if (!intel) {
    return (
      <Card className="border-border/60 p-0">
        <CardContent className="px-5 py-6 text-center">
          <p className="text-xs text-muted-foreground">
            {ar
              ? "لم تُبنَ لقطة الذكاء بعد — انتظر تحديث السوق الأول."
              : "The market intelligence snapshot is not built yet — wait for the first market refresh."}
          </p>
        </CardContent>
      </Card>
    )
  }

  const b = intel.breadth
  const conc = intel.concentration
  const delay = Math.round(intel.delayMinutes)

  return (
    <Card className="border-border/60 p-0">
      <CardHeader className="pb-3 px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Radar className="h-3.5 w-3.5 text-primary" aria-hidden />
            {ar ? "ذكاء السوق" : "Market intelligence"}
          </CardTitle>
          <span className="rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {ar ? `متأخر ${delay} دقيقة` : `${delay}m delayed`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-5 pb-5">
        {/* What changed since the last visit */}
        {visitLines.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3.5 py-2.5">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="text-xs font-bold text-primary">{ar ? "ماذا تغيّر منذ آخر زيارة؟" : "What changed since your last visit?"}</span>
            <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {visitLines.map((l, i) => (
                <span key={i}>{l}</span>
              ))}
            </span>
          </div>
        ) : null}

        {/* Regime + pulse + asOf */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="inline-flex cursor-help items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-2.5 py-0.5 text-[11px] font-semibold text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {ar ? intel.regime.labelAr : intel.regime.label}
                  <Info className="h-3 w-3" aria-hidden />
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-72 text-[11px]">
                <p className="mb-1 font-semibold">{ar ? "أدلة التصنيف" : "Classification evidence"}</p>
                {intel.regime.evidence.length > 0 ? (
                  <ul className="space-y-0.5">
                    {intel.regime.evidence.map((ev, i) => (
                      <li key={i}>· {ev}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{ar ? "لا أدلة محفوظة بعد." : "No stored evidence yet."}</p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <PulseRing score={intel.pulse.score} />
          <span className="text-xs font-medium">{ar ? intel.pulse.labelAr : "Market pulse"}</span>
          {intel.asOf ? (
            <span className="tnum ms-auto text-[11px] text-muted-foreground" dir="ltr">
              {cairoTime(intel.asOf, ar)}
            </span>
          ) : null}
        </div>

        {/* Breadth strip */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <StatCell label={ar ? "صاعد / هابط" : "Adv / Dec"}>
            <span className="tnum text-sm font-bold" dir="ltr">
              <span className="text-positive">{b.advancing}</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-negative">{b.declining}</span>
              <span className="text-[10px] font-medium text-muted-foreground"> ({b.unchanged})</span>
            </span>
          </StatCell>
          <StatCell label={ar ? "نسبة الصعود/الهبوط" : "A/D ratio"}>
            <span className="tnum text-sm font-bold" dir="ltr">{b.ratio !== null ? b.ratio.toFixed(2) : "—"}</span>
          </StatCell>
          <StatCell label={ar ? "القيمة المتداولة" : "Traded value"}>
            <span className="tnum text-sm font-bold">{fmtEgpAr(b.tradedValueEgp, ar)}</span>
          </StatCell>
          <StatCell label={ar ? "شركات فوق متوسط 20 يوم" : "Above 20-day avg"}>
            <span className="tnum text-sm font-bold" dir="ltr">{b.pctAboveSma20 !== null ? `${b.pctAboveSma20.toFixed(0)}%` : "—"}</span>
          </StatCell>
          <StatCell label={ar ? "شركات فوق متوسط 50 يوم" : "Above 50-day avg"}>
            <span className="tnum text-sm font-bold" dir="ltr">{b.pctAboveSma50 !== null ? `${b.pctAboveSma50.toFixed(0)}%` : "—"}</span>
          </StatCell>
          <StatCell label={ar ? "قمم/قيعان 52 أسبوعاً" : "52w highs/lows"}>
            {b.new52wHighs !== null || b.new52wLows !== null ? (
              <span className="tnum text-sm font-bold" dir="ltr">
                <span className="text-positive">{b.new52wHighs ?? "—"}</span>
                <span className="text-muted-foreground">/</span>
                <span className="text-negative">{b.new52wLows ?? "—"}</span>
              </span>
            ) : (
              <span className="text-sm font-bold text-muted-foreground">—</span>
            )}
          </StatCell>
          <StatCell label={ar ? "تركيز أعلى 5" : "Top-5 share"}>
            <span className="tnum text-sm font-bold" dir="ltr">
              {conc.top5TurnoverSharePct !== null ? `${conc.top5TurnoverSharePct.toFixed(1)}%` : "—"}
            </span>
          </StatCell>
        </div>
        {conc.top5TurnoverSharePct !== null || conc.herfindahl !== null ? (
          <p className="text-[10px] text-muted-foreground">{conc.note}</p>
        ) : null}

        {/* Sector-liquidity rotation matrix (renamed 2026-11-17: دوران السيولة) */}
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              <ArrowLeftRight className="h-3 w-3" aria-hidden />
              {ar ? "دوران السيولة" : "Liquidity rotation"}
            </p>
            {intel.rotation.gaining.length > 0 && (
              <span className="flex flex-wrap items-center gap-1 text-[10px]">
                <span className="font-semibold text-positive">▲ {ar ? "سيولة داخلة:" : "in:"}</span>
                {intel.rotation.gaining.slice(0, 3).map((s) => (
                  <span key={s} className="rounded-full border border-positive/30 bg-positive/10 px-1.5 py-0.5 font-medium text-positive">
                    {sectorLabel(s, lang)}
                  </span>
                ))}
              </span>
            )}
            {intel.rotation.losing.length > 0 && (
              <span className="flex flex-wrap items-center gap-1 text-[10px]">
                <span className="font-semibold text-negative">▼ {ar ? "سيولة خارجة:" : "out:"}</span>
                {intel.rotation.losing.slice(0, 3).map((s) => (
                  <span key={s} className="rounded-full border border-negative/30 bg-negative/10 px-1.5 py-0.5 font-medium text-negative">
                    {sectorLabel(s, lang)}
                  </span>
                ))}
              </span>
            )}
          </div>
          {intel.rotation.sectors.length > 0 ? (
            <div className="max-h-72 overflow-auto rounded-xl border border-border/50">
              <table className="w-full min-w-[420px] text-[11px]">
                <thead className="sticky top-0 z-10 border-b border-border/60 bg-card/95 backdrop-blur">
                  <tr className="text-muted-foreground">
                    <th className="px-2.5 py-2 text-start font-semibold">{ar ? "القطاع" : "Sector"}</th>
                    <th className="px-2.5 py-2 text-start font-semibold">{ar ? "التغير المرجّح" : "Cap-wtd Δ"}</th>
                    <th className="px-2.5 py-2 text-start font-semibold">{ar ? "حصة السيولة" : "Liquidity share"}</th>
                    <th className="px-2.5 py-2 text-start font-semibold">{ar ? "Δ 5ج" : "Δ 5d"}</th>
                    <th className="px-2.5 py-2 text-start font-semibold">{ar ? "حجم نسبي" : "Rel vol"}</th>
                  </tr>
                </thead>
                <tbody>
                  {intel.rotation.sectors.map((s, i) => {
                    const gaining = intel.rotation.gaining.includes(s.sector)
                    const losing = intel.rotation.losing.includes(s.sector)
                    const share = s.turnoverSharePct
                    return (
                      <tr
                        key={s.sector}
                        className={`border-t border-border/40 transition-colors hover:bg-muted/40 ${i % 2 === 1 ? "bg-muted/20" : ""} ${
                          gaining ? "border-s-2 border-s-positive/60 bg-positive/[0.04]" : losing ? "border-s-2 border-s-negative/60 bg-negative/[0.04]" : ""
                        }`}
                      >
                        <td className="px-2.5 py-2">
                          <span className="block max-w-[160px] truncate font-semibold" title={sectorLabel(s.sector, lang)}>
                            {sectorLabel(s.sector, lang)}
                          </span>
                          <span className="tnum text-[9px] text-muted-foreground" dir="ltr">
                            <span className="text-positive">{s.advancing}</span>/<span className="text-negative">{s.declining}</span> · {s.companies}
                          </span>
                        </td>
                        <td className="px-2.5 py-2">
                          <span className={`tnum inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 font-bold ${pctColor(s.capWeightedChangePct) === "text-positive" ? "border-positive/30 bg-positive/10" : pctColor(s.capWeightedChangePct) === "text-negative" ? "border-negative/30 bg-negative/10" : "border-border/50 bg-muted/30"}`} dir="ltr">
                            {s.capWeightedChangePct !== null ? (s.capWeightedChangePct > 0 ? "▲" : s.capWeightedChangePct < 0 ? "▼" : "") : ""} {pctStr(s.capWeightedChangePct)}
                          </span>
                        </td>
                        <td className="px-2.5 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className={`relative inline-block h-1.5 w-14 shrink-0 overflow-hidden rounded-full ${gaining ? "bg-positive/20" : losing ? "bg-negative/20" : "bg-muted"}`}>
                              <span
                                className={`absolute inset-y-0 start-0 rounded-full ${gaining ? "bg-positive" : losing ? "bg-negative" : "bg-primary/70"}`}
                                style={{ width: `${Math.min(100, Math.max(0, share ?? 0))}%` }}
                              />
                            </span>
                            <span className={`tnum font-semibold ${gaining ? "text-positive" : losing ? "text-negative" : "text-muted-foreground"}`} dir="ltr">
                              {share !== null ? `${share.toFixed(1)}%` : "—"}
                            </span>
                          </div>
                        </td>
                        <td className="px-2.5 py-2">
                          {s.turnoverShareDelta5d !== null ? (
                            <span className={`tnum inline-flex items-center gap-0.5 font-semibold ${s.turnoverShareDelta5d > 0 ? "text-positive" : s.turnoverShareDelta5d < 0 ? "text-negative" : "text-muted-foreground"}`} dir="ltr">
                              {s.turnoverShareDelta5d > 0 ? "▲" : s.turnoverShareDelta5d < 0 ? "▼" : ""} {Math.abs(s.turnoverShareDelta5d).toFixed(1)}
                            </span>
                          ) : (
                            <span className="tnum text-muted-foreground" dir="ltr">—</span>
                          )}
                        </td>
                        <td className="tnum px-2.5 py-2 text-muted-foreground" dir="ltr">
                          {s.medianRelVol !== null ? `${s.medianRelVol.toFixed(2)}×` : "—"}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-lg border border-border/50 px-2.5 py-3 text-center text-[11px] text-muted-foreground">
              {ar ? "لا بيانات قطاعات بعد." : "No sector data yet."}
            </p>
          )}
          <p className="mt-1 text-[10px] text-muted-foreground">{intel.rotation.note}</p>
        </div>

        {/* Anomalies + radars */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" aria-hidden />
              {ar ? "حركات شاذة اليوم" : "Today's anomalies"}
            </p>
            {intel.anomalies.length === 0 ? (
              <p className="rounded-lg border border-border/50 px-2.5 py-3 text-center text-[11px] text-muted-foreground">
                {ar ? "لا شواذ مرصودة اليوم." : "No anomalies flagged today."}
              </p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto pe-0.5">
                {intel.anomalies.slice(0, 6).map((a) => {
                  const kind = ANOMALY_KIND[a.kind] ?? { ar: a.kind, en: a.kind, cls: "border-border/60 bg-muted/30 text-muted-foreground" }
                  return (
                    <Link
                      key={`${a.kind}-${a.ticker}`}
                      href={`/company/${encodeURIComponent(a.ticker)}`}
                      className="block rounded-lg border border-border/50 bg-card px-2.5 py-2 transition-colors hover:border-primary/40 hover:bg-accent/30"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold">{a.ticker}</span>
                        <span className="min-w-0 truncate text-[10px] text-muted-foreground">{ar ? (a.nameAr ?? a.name) : a.name}</span>
                        <Badge variant="outline" className={`shrink-0 text-[9px] ${kind.cls}`}>
                          {ar ? kind.ar : kind.en}
                        </Badge>
                        {a.relVol !== null ? (
                          <span className="tnum ms-auto shrink-0 text-[10px] font-semibold text-muted-foreground" dir="ltr">
                            {a.relVol.toFixed(1)}×
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{ar ? a.detailAr : a.detail}</p>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <RadarColumn
                title={ar ? "فرص" : "Opportunities"}
                tone="text-positive"
                icon={<TrendingUp className="h-3.5 w-3.5" aria-hidden />}
                rows={intel.radars.opportunities}
                ar={ar}
              />
              <RadarColumn
                title={ar ? "مخاطر" : "Risks"}
                tone="text-negative"
                icon={<TrendingDown className="h-3.5 w-3.5" aria-hidden />}
                rows={intel.radars.risks}
                ar={ar}
              />
            </div>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">{intel.radars.note}</p>

        {/* Limitations — accessible disclosure for every muted "—" above */}
        {intel.limitations.length > 0 ? (
          <details className="text-[10px] text-muted-foreground">
            <summary className="cursor-pointer select-none font-medium">
              {ar ? "حدود البيانات" : "Data limitations"}
            </summary>
            <ul className="mt-1 list-inside space-y-0.5">
              {intel.limitations.map((l, i) => (
                <li key={i}>· {l}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  )
}
