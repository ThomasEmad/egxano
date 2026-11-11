import { Skeleton } from "@/components/ui/skeleton"

// Company page skeleton: header card + tabs strip + metrics grid mirrors the
// real layout so the swap after load does not jump.
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48 rounded-lg" />
          <Skeleton className="h-4 w-72 max-w-full rounded-md" />
        </div>
        <Skeleton className="h-24 w-28 rounded-xl" />
      </div>
      <Skeleton className="h-10 w-full max-w-2xl rounded-xl" />
      <Skeleton className="h-72 w-full rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
