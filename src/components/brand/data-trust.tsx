"use client"

import { CalendarDays, Calculator, Clock, FileText, Info } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import { TRUST } from "@/lib/brand"

/** The provenance vocabulary used across product surfaces. */
export type DataState =
  | "reported"
  | "calculated"
  | "unavailable"
  | "ai"
  | "delayed"
  | "needs-review"
  | "comparable"

const STATE: Record<DataState, { className: string; label: { en: string; ar: string } }> = {
  reported: {
    className: "border-success/35 bg-success/10 text-success",
    label: TRUST.reported,
  },
  calculated: {
    className: "border-border bg-muted/60 text-muted-foreground",
    label: TRUST.calculated,
  },
  unavailable: {
    className: "border-dashed border-border bg-transparent text-muted-foreground",
    label: TRUST.unavailable,
  },
  ai: {
    className: "border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    label: TRUST.aiInterpretation,
  },
  delayed: {
    className: "border-warning/40 bg-warning/10 text-warning",
    label: TRUST.delayed,
  },
  "needs-review": {
    className: "border-warning/40 bg-warning/10 text-warning",
    label: TRUST.needsReview,
  },
  comparable: {
    className: "border-border bg-transparent text-muted-foreground",
    label: TRUST.comparablePeriod,
  },
}

export function DataStateBadge({
  state,
  label,
  className,
}: {
  state: DataState
  label?: string
  className?: string
}) {
  const { lang } = useI18n()
  const config = STATE[state]
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 text-[10px] font-medium", config.className, className)}
    >
      {label ?? (lang === "ar" ? config.label.ar : config.label.en)}
    </Badge>
  )
}

function formatAsOf(value: string | null | undefined, lang: "en" | "ar"): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date)
}

/**
 * Source + period + last-updated, in the product's fixed order. If a value is
 * missing, the line says so instead of hiding it.
 */
export function SourceLine({
  source,
  period,
  asOf,
  className,
}: {
  source?: string | null
  period?: string | null
  asOf?: string | null
  className?: string
}) {
  const { lang } = useI18n()
  const date = formatAsOf(asOf, lang)
  const items: { key: string; icon: React.ReactNode; label: string; value: string }[] = []

  items.push({
    key: "source",
    icon: <FileText className="h-3 w-3" aria-hidden="true" />,
    label: lang === "ar" ? TRUST.source.ar : TRUST.source.en,
    value: source || (lang === "ar" ? TRUST.sourceFiling.ar : TRUST.sourceFiling.en),
  })
  if (period) {
    items.push({
      key: "period",
      icon: <CalendarDays className="h-3 w-3" aria-hidden="true" />,
      label: lang === "ar" ? TRUST.reportingPeriod.ar : TRUST.reportingPeriod.en,
      value: period,
    })
  }
  items.push({
    key: "asof",
    icon: <Clock className="h-3 w-3" aria-hidden="true" />,
    label: lang === "ar" ? TRUST.lastUpdated.ar : TRUST.lastUpdated.en,
    value: date || (lang === "ar" ? "غير متاح" : "Unavailable"),
  })

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] leading-relaxed text-muted-foreground",
        className,
      )}
    >
      {items.map((item) => (
        <span key={item.key} className="inline-flex min-w-0 items-center gap-1">
          {item.icon}
          <span className="font-medium">{item.label}:</span>
          <span className="truncate">{item.value}</span>
        </span>
      ))}
    </div>
  )
}

function relativeDays(days: number, lang: "en" | "ar"): string {
  if (days <= 0) return lang === "ar" ? "محدّث اليوم" : "Updated today"
  if (days === 1) return lang === "ar" ? "آخر تحديث أمس" : "Updated yesterday"
  if (days < 30) return lang === "ar" ? `آخر تحديث قبل ${days} يوم` : `Updated ${days} days ago`
  const months = Math.floor(days / 30.4)
  if (months < 12) return lang === "ar" ? `آخر تحديث قبل ${months} شهر` : `Updated ${months} months ago`
  const years = Math.floor(months / 12)
  return lang === "ar" ? `آخر تحديث قبل ${years} سنة` : `Updated ${years} year${years > 1 ? "s" : ""} ago`
}

/**
 * Honest freshness indicator: says when data was last updated and turns amber
 * when a figure is old enough that the user must know.
 */
export function FreshnessBadge({
  asOf,
  className,
}: {
  asOf?: string | null
  className?: string
}) {
  const { lang } = useI18n()
  if (!asOf) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-[10px] text-muted-foreground", className)}>
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" aria-hidden="true" />
        {lang === "ar" ? "آخر تحديث غير متاح" : "Last update unavailable"}
      </span>
    )
  }
  const date = new Date(asOf)
  if (Number.isNaN(date.getTime())) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-[10px] text-muted-foreground", className)}>
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" aria-hidden="true" />
        {lang === "ar" ? "آخر تحديث غير متاح" : "Last update unavailable"}
      </span>
    )
  }
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000))
  const tone =
    days <= 45
      ? "bg-success"
      : days <= 450
        ? "bg-warning"
        : "bg-destructive"
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[10px] text-muted-foreground", className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", tone)} aria-hidden="true" />
      {relativeDays(days, lang)}
    </span>
  )
}

/** "—" is a statement, not a placeholder: the value was not published. */
export function UnavailableValue({ className }: { className?: string }) {
  const { lang } = useI18n()
  return (
    <span className={cn("text-muted-foreground/60", className)} title={lang === "ar" ? TRUST.unavailable.ar : TRUST.unavailable.en}>
      —
    </span>
  )
}

export function UnavailableNote({
  children,
  className,
}: {
  children?: React.ReactNode
  className?: string
}) {
  const { lang } = useI18n()
  return (
    <p className={cn("flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground", className)}>
      <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      <span>
        {children ??
          (lang === "ar"
            ? "غير متاح — لم يُنشر في الإفصاح. لا نعرضه كصفر ولا نقدّره."
            : "Not reported in the filing. It is not shown as zero and is never estimated.")}
      </span>
    </p>
  )
}

export function CalculationNote({
  formula,
  className,
}: {
  formula?: string
  className?: string
}) {
  const { lang } = useI18n()
  return (
    <p className={cn("flex items-center gap-1.5 text-[10px] text-muted-foreground", className)}>
      <Calculator className="h-3 w-3" aria-hidden="true" />
      {lang === "ar" ? TRUST.calculated.ar : TRUST.calculated.en}
      {formula ? <span className="text-muted-foreground/70">· {formula}</span> : null}
    </p>
  )
}

/**
 * Market-price provenance: when the snapshot was taken and how delayed it is.
 * Use the server-provided `delayMinutes` (fall back to the documented 15) —
 * never hardcode a freshness claim.
 */
export function MarketDataLine({
  asOf,
  delayMinutes,
  source,
  className,
}: {
  asOf?: string | null
  delayMinutes?: number | null
  source?: string | null
  className?: string
}) {
  const { lang } = useI18n()
  const date = formatAsOf(asOf, lang)
  const delay = delayMinutes ?? 15
  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground", className)}>
      <span className="inline-flex items-center gap-1">
        <Clock className="h-3 w-3" aria-hidden="true" />
        <span className="font-medium">{lang === "ar" ? TRUST.lastUpdated.ar : TRUST.lastUpdated.en}:</span>
        <span>{date ?? (lang === "ar" ? "غير متاح" : "Unavailable")}</span>
      </span>
      <span aria-hidden="true">·</span>
      <span className="inline-flex items-center gap-1">
        {lang === "ar" ? `متأخر ${delay} دقيقة` : `Delayed ${delay} min`}
      </span>
      {source ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{source}</span>
        </>
      ) : null}
    </p>
  )
}
