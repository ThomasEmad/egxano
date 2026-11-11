import { cn } from "@/lib/utils"

/**
 * Editorial section heading: a small uppercase eyebrow, a tight headline and
 * one supporting sentence. Used instead of repetitive feature-card grids.
 */
export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "start",
  className,
  titleClassName,
}: {
  eyebrow?: string
  title: React.ReactNode
  description?: React.ReactNode
  align?: "start" | "center"
  className?: string
  titleClassName?: string
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      {eyebrow ? (
        <p
          className={cn(
            "eyebrow mb-3 flex items-center gap-2",
            align === "center" && "justify-center",
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
          {eyebrow}
        </p>
      ) : null}
      <h2
        className={cn(
          "text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-3xl",
          titleClassName,
        )}
      >
        {title}
      </h2>
      {description ? (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {description}
        </p>
      ) : null}
    </div>
  )
}

/** A single figure with a label — the smallest unit of the data language. */
export function Stat({
  value,
  label,
  hint,
  tone = "default",
  className,
}: {
  value: React.ReactNode
  label: string
  hint?: string
  tone?: "default" | "accent"
  className?: string
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div
        className={cn(
          "num text-xl font-semibold tracking-tight sm:text-2xl",
          tone === "accent" ? "text-primary" : "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{label}</div>
      {hint ? <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground/70">{hint}</div> : null}
    </div>
  )
}
