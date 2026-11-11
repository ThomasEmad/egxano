"use client"

import Link from "next/link"
import { Crown, Lock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useI18n } from "@/lib/i18n"

interface PremiumGateProps {
  /** What is gated, e.g. "Company events" — passed by the call-site when known. */
  title?: string
  description?: string
  compact?: boolean
}

/**
 * Premium gate. Copy rules (docs/brand/audit-trust.md P14):
 *  • name the gated section,
 *  • state what Premium adds and what the free account keeps,
 *  • say activation is manual — never imply an instant upgrade,
 *  • reuse the same "Premium" name everywhere (no "Pro").
 */
export function PremiumGate({ title, description, compact = false }: PremiumGateProps) {
  const { lang } = useI18n()
  const ar = lang === "ar"

  const defaultTitle = ar ? "هذا القسم جزء من Premium" : "This section is part of Premium"
  const defaultDescription = ar
    ? "Premium بيضيف أحداث الشركات، تحليلات ذكية بلا حد، الترتيب الكامل والتقييم الكامل، والتقرير الكامل متعدد السنوات. الحساب المجاني بيفضل فيه التصفح والقوائم والنسب و3 تحليلات شهرياً. التفعيل يدوي بعد مراجعة الدفع."
    : "Premium adds company events, unlimited Smart Analyses, full rankings and valuation lists, and the full multi-year report. Free accounts keep browsing, statements, ratios and 3 Smart Analyses a month. Activation is manual after payment review."

  if (compact) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
        <span>{title ?? (ar ? "متاح في Premium" : "Part of Premium")}</span>
        <Button asChild size="sm" variant="link" className="h-auto gap-1 px-0 text-xs">
          <Link href="/premium">
            <Crown className="h-3 w-3" aria-hidden />
            {ar ? "اعرف اللي في Premium" : "See what Premium includes"}
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <Card className="border-dashed border-border bg-muted/10">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-warning/10 text-warning">
            <Lock className="h-4 w-4" aria-hidden />
          </span>
          {title ?? defaultTitle}
          <Badge variant="outline" className="ms-auto gap-1 border-warning/40 text-warning">
            <Crown className="h-3 w-3" aria-hidden />
            {ar ? "بريميوم" : "Premium"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs text-muted-foreground">
        <p className="leading-relaxed">{description ?? defaultDescription}</p>
        <Button asChild size="sm" className="w-full gap-2">
          <Link href="/premium">
            <Crown className="h-4 w-4" aria-hidden />
            {ar ? "اعرف اللي في Premium" : "See what Premium includes"}
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
