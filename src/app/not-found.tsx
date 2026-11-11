"use client"

import Link from "next/link"
import { Compass, Home } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { EGXANOWordmark } from "@/components/brand/brand-mark"
import { useI18n } from "@/lib/i18n"

// App-level 404 — bilingual, on-brand, with a real way back to research.
export default function NotFound() {
  const { lang } = useI18n()
  const ar = lang === "ar"

  return (
    <LayoutShell chrome="marketing">
      <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 py-14 text-center">
        <EGXANOWordmark lang={lang} size={38} subtitle={false} />
        <p className="mt-6 text-5xl font-semibold tracking-tight text-muted-foreground/30">404</p>
        <h1 className="mt-2 text-xl font-semibold text-foreground">
          {ar ? "الصفحة غير موجودة" : "This page doesn't exist"}
        </h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          {ar
            ? "يمكن الرابط قديم أو الصفحة اتغيّر مكانها أو الرابط فيه خطأ إملائي. ابدأ من البحث أو من دليل الشركات."
            : "The link may be outdated, the page may have moved, or there's a typo in the address. Start from search or the company directory."}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button asChild>
            <Link href="/companies">
              <Compass className="me-1.5 h-4 w-4" aria-hidden />
              {ar ? "تصفح الشركات" : "Browse companies"}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">
              <Home className="me-1.5 h-4 w-4" aria-hidden />
              {ar ? "العودة للرئيسية" : "Back to home"}
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/premium">{ar ? "الاشتراك" : "Premium"}</Link>
          </Button>
        </div>
      </div>
    </LayoutShell>
  )
}

