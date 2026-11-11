import { Skeleton } from "@/components/ui/skeleton"

// Route-level loading skeleton — keeps layout stable while server data loads.
// Generic by design: route-specific loading.tsx files can be added where a
// page's shape differs materially.
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">جارٍ التحميل — Loading</span>
      <div className="h-2 w-16 rounded bg-muted" />
      <Skeleton className="mt-3 h-8 w-64 rounded-lg" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl rounded" />
      <Skeleton className="mt-2 h-4 w-2/3 max-w-md rounded" />
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="mt-4 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}
