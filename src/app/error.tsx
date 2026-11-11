"use client"

// Route-level error boundary. Bilingual, non-technical, never leaks stack
// traces. The message reassures that no data was modified, then offers a
// retry and a way back.

import { useEffect } from "react"
import Link from "next/link"
import { AlertTriangle, Home, RotateCcw } from "lucide-react"
import { EGXANOWordmark } from "@/components/brand/brand-mark"
import { useI18n } from "@/lib/i18n"

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { lang } = useI18n()
  const ar = lang === "ar"

  useEffect(() => {
    // Server-side logging is handled by the platform; this keeps a client breadcrumb.
    console.error("Route error", error.digest ?? error.message)
  }, [error])

  return (
    <main id="main-content" className="flex min-h-[70vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <EGXANOWordmark lang={lang} size={34} subtitle={false} />
      <span className="mt-2 flex h-12 w-12 items-center justify-center rounded-xl bg-warning/10 text-warning">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="text-xl font-semibold">{ar ? "تعذّر تحميل هذه الصفحة" : "Couldn't load this page"}</h1>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground" role="status">
        {ar
          ? "حدث خطأ غير متوقع أثناء تحميل البيانات. لم يتم تعديل أي بيانات. أعد المحاولة، وإذا استمر الخطأ ارجع للرئيسية."
          : "An unexpected error occurred while loading this page. No data was modified. Try again, or return home if it persists."}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          {ar ? "إعادة المحاولة" : "Try again"}
        </button>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Home className="h-4 w-4" aria-hidden />
          {ar ? "الرئيسية" : "Home"}
        </Link>
      </div>
      {error.digest ? (
        <p className="text-[11px] text-muted-foreground/70">
          {ar ? "مرجع:" : "Reference:"} <code>{error.digest}</code>
        </p>
      ) : null}
    </main>
  )
}

