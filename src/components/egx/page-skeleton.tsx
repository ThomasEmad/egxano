import { Skeleton } from "@/components/ui/skeleton"

// Shared route-level loading skeleton: keeps navigation feeling instant with a
// realistic page shell (header + card grid) instead of a blank frame.
export function PageSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <div className="space-y-3">
        <Skeleton className="h-8 w-64 rounded-lg" />
        <Skeleton className="h-4 w-96 max-w-full rounded-md" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}
