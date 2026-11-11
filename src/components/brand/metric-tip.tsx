"use client"

import { Info } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import { metricGloss, TRUST } from "@/lib/brand"

/**
 * A metric label with a plain-language explanation. Terms like ROE or P/E stay
 * visible (professionals expect them) but are never left unexplained.
 */
export function MetricTip({
  code,
  label,
  className,
  side = "top",
}: {
  code: string
  label?: string
  className?: string
  side?: "top" | "bottom" | "left" | "right"
}) {
  const { lang } = useI18n()
  const gloss = metricGloss(code)
  const text = label ?? code

  if (!gloss) return <span className={className}>{text}</span>

  const description = lang === "ar" ? gloss.ar : gloss.en
  const formula = lang === "ar" ? gloss.formulaAr : gloss.formulaEn

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {text}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={lang === "ar" ? `ما معنى ${text}؟` : `What does ${text} mean?`}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info className="h-3 w-3" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          className="max-w-[280px] border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <span className="block text-[11px] leading-relaxed">{description}</span>
          {formula ? (
            <span className="mt-1 block text-[10px] text-muted-foreground">{formula}</span>
          ) : null}
          <span className="mt-1 block text-[9px] text-muted-foreground">
            {lang === "ar" ? TRUST.calculated.ar : TRUST.calculated.en}
          </span>
        </TooltipContent>
      </Tooltip>
    </span>
  )
}
