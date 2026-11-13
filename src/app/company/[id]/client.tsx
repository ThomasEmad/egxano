"use client"

import { Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { CompanyDetail } from "@/components/egx/company-detail"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Deep link support: /company/{id}?tab=technical opens the company profile
 * straight on the technical sub-tab (the signals board links here). Any other
 * (or missing) value keeps the default "overview" landing tab.
 */
function CompanyPageInner({ companyId }: { companyId: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialSubTab = searchParams.get("tab") === "technical" ? ("technical" as const) : undefined

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-4">
      <CompanyDetail
        key={`${companyId}:${initialSubTab ?? "overview"}`}
        companyId={companyId}
        initialSubTab={initialSubTab}
        onBack={() => {
          if (window.history.length > 1) {
            router.back()
          } else {
            router.push("/dashboard")
          }
        }}
        onOpenScanner={() => {
          router.push(`/dashboard#/scanners`)
        }}
      />
    </div>
  )
}

export default function CompanyPageClient({ companyId }: { companyId: string }) {
  return (
    <LayoutShell showMobileNav={true}>
      {/* useSearchParams requires a Suspense boundary for clean prerendering;
          the shell stays mounted so the chrome never flashes. */}
      <Suspense
        fallback={
          <div className="mx-auto w-full max-w-7xl space-y-4 px-4 sm:px-6 py-4">
            <Skeleton className="h-10 w-32 rounded-md" />
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        }
      >
        <CompanyPageInner companyId={companyId} />
      </Suspense>
    </LayoutShell>
  )
}
