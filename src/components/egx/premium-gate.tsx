"use client"

import Link from "next/link"
import { Crown, Lock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardTitle } from "@/components/ui/card"
import { useI18n } from "@/lib/i18n"

interface PremiumGateProps {
  /** What is gated, e.g. "Company events" — passed by the call-site when known. */
  title?: string
  description?: string
  compact?: boolean
}

/**
 * Premium gate. Copy rules (docs/brand/audit-trust.md P14 — updated to the
 * برو package naming):
 *  • name the gated section,
 *  • state what the برو packages add and what the free account keeps,
 *  • mention activation: تفعيل فوري بعد تأكيد التحويل — never imply a hidden catch,
 *  • use the same "برو / برو بلس" naming everywhere — never "بريميوم".
 */
export function PremiumGate({ title, description, compact = false }: PremiumGateProps) {
  const { lang } = useI18n()
  const ar = lang === "ar"

  const defaultTitle = ar ? "القسم ده من باقات برو وبرو بلس" : "This section is part of Pro and Pro Plus"
  const defaultDescription = ar
    ? "القسم ده متاح لباقات برو وبرو بلس — التفعيل بيتم بعد تأكيد الحوالة."
    : "This section is available on Pro and Pro Plus — activation happens after the transfer is confirmed."

  const upgradeCta = ar ? "ترقية الآن" : "Upgrade now"

  if (compact) {
    return (
      <div className="relative rounded-lg bg-gradient-to-r from-amber-500/40 via-[var(--brand-accent)]/30 to-emerald-500/40 p-px">
        <div className="flex items-center gap-2 rounded-[11px] bg-card/90 px-3 py-2 text-xs text-muted-foreground backdrop-blur-sm">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full shadow-sm bg-gradient-to-br from-amber-500 via-[var(--brand-accent)] to-emerald-500"
            aria-hidden
          >
            <Lock className="h-3 w-3 text-white" />
          </span>
          <span className="font-medium text-foreground">
            {title ?? (ar ? "القسم ده من باقات برو وبرو بلس" : "Part of Pro and Pro Plus")}
          </span>
          <Button asChild size="sm" variant="link" className="ms-auto h-auto gap-1 px-0 text-xs font-semibold">
            <Link href="/premium">
              <Crown className="h-3 w-3" aria-hidden />
              {upgradeCta}
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative rounded-xl bg-gradient-to-br from-amber-500/45 via-[var(--brand-accent)]/35 to-emerald-500/45 p-px">
      <Card className="rounded-[15px] border-none bg-card/90 backdrop-blur-sm">
        <CardContent className="flex flex-col gap-3 px-5 py-5">
          <div className="flex items-center gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-md bg-gradient-to-br from-amber-500 via-[var(--brand-accent)] to-emerald-500"
              aria-hidden
            >
              <Lock className="h-5 w-5 text-white" />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold leading-snug text-foreground">
                {title ?? defaultTitle}
              </CardTitle>
              <Badge variant="outline" className="mt-1 border-primary/40 text-primary">
                {ar ? "باقة برو وبرو بلس" : "Pro / Pro Plus"}
              </Badge>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {description ?? defaultDescription}
          </p>
          <Button asChild size="sm" className="w-full gap-2 font-semibold">
            <Link href="/premium">
              <Crown className="h-4 w-4" aria-hidden />
              {upgradeCta}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
