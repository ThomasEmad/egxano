"use client"

/**
 * Professional AI Report Renderer — renders the AI-generated markdown as a
 * structured, trustworthy financial research report. Every section is styled
 * as a proper research note with proper typography, tables, and trust signals.
 */

import ReactMarkdown from "react-markdown"
import { FileText, CalendarDays, Scale, TrendingUp, TrendingDown, Minus, Info, ShieldCheck, Sparkles, AlertTriangle, Eye } from "lucide-react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import { formatMoney, formatDate } from "@/lib/brand"
import { formatPercent, formatRatio } from "@/lib/financial/units"
import { DataStateBadge, SourceLine, FreshnessBadge } from "@/components/brand/data-trust"
import { MetricTip } from "@/components/brand/metric-tip"
import { SectionHeading } from "@/components/brand/section-heading"

/**
 * Custom components for ReactMarkdown that render financial report elements
 * with professional styling matching the brand design system.
 */
const aiMdComponents = {
  h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <SectionHeading
      title={children}
      className="my-6"
      {...props}
    />
  ),

  h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="text-base font-semibold text-foreground mt-5 mb-3 flex items-center gap-2" {...props}>
      <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
      {children}
    </h3>
  ),

  h4: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h4 className="text-sm font-semibold text-foreground mt-4 mb-2 text-muted-foreground/80 uppercase tracking-wider" {...props}>
      {children}
    </h4>
  ),

  p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="text-sm leading-relaxed text-foreground/90 mt-2" {...props}>{children}</p>
  ),

  ul: ({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="list-disc list-inside space-y-1.5 mt-2 ml-4 text-sm leading-relaxed text-foreground/90" {...props}>
      {children}
    </ul>
  ),

  ol: ({ children, ...props }: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="list-decimal list-inside space-y-1.5 mt-2 ml-4 text-sm leading-relaxed text-foreground/90" {...props}>
      {children}
    </ol>
  ),

  li: ({ children, ...props }: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="leading-relaxed" {...props}>{children}</li>
  ),

  strong: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-foreground" {...props}>{children}</strong>
  ),

  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic text-foreground/80">{children}</em>
  ),

  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-primary">{children}</code>
  ),

  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-s-2 border-primary/30 bg-primary/5 ps-4 py-2 my-4 text-sm leading-relaxed text-foreground/90">
      {children}
    </blockquote>
  ),

  hr: () => (
    <hr className="my-6 border-border/50" />
  ),

  table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="overflow-x-auto my-6 rounded-xl border border-border/60" {...props}>
      <table className="w-full text-sm">{children}</table>
    </div>
  ),

  thead: ({ children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <thead className="bg-muted/50 border-b border-border/60" {...props}>
      {children}
    </thead>
  ),

  tbody: ({ children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <tbody className="divide-y divide-border/40" {...props}>{children}</tbody>
  ),

  tr: ({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
    <tr className="hover:bg-muted/30 transition-colors" {...props}>{children}</tr>
  ),

  th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th className="p-3 text-start font-semibold text-[11px] uppercase tracking-wider text-muted-foreground whitespace-nowrap" {...props}>{children}</th>
  ),

  td: ({ children, style, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td className="p-3 text-sm align-top tabular" style={style} {...props}>{children}</td>
  ),

  // Custom component for rendering key numbers as metric cards
  KeyNumbersTable: ({ children }: { children: React.ReactNode }) => (
    <div className="my-6">{children}</div>
  ),

  // Stance badge component
  StanceBadge: ({ children, stance }: { children: React.ReactNode; stance?: string }) => {
    const { lang } = useI18n()
    const s = stance ?? children
    const isBullish = /bullish|صاعد|إيجابي/i.test(String(s))
    const isBearish = /bearish|هابط|سلبي/i.test(String(s))
    const isCautious = /cautious|بحذر|إيجابي بحذر/i.test(String(s))
    
    const tone = isBullish ? "bullish" : isBearish ? "bearish" : isCautious ? "cautious" : "neutral"
    
    const STYLE = {
      bullish: "border-success/40 bg-success/10 text-success",
      cautious: "border-warning/40 bg-warning/10 text-warning", 
      neutral: "border-border bg-muted/60 text-muted-foreground",
      bearish: "border-destructive/40 bg-destructive/10 text-destructive",
    }
    
    const getIcon = () => {
      switch (tone) {
        case "bullish": return <TrendingUp className="h-3 w-3" aria-hidden />
        case "bearish": return <TrendingDown className="h-3 w-3" aria-hidden />
        case "cautious": return <TrendingUp className="h-3 w-3" aria-hidden />
        default: return <Minus className="h-3 w-3" aria-hidden />
      }
    }
    const LABEL = {
      bullish: { en: "Bullish", ar: "صاعد" },
      cautious: { en: "Cautiously Positive", ar: "إيجابي بحذر" },
      neutral: { en: "Neutral", ar: "محايد" },
      bearish: { en: "Bearish", ar: "هابط" },
    }[tone]
    
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STYLE[tone]}`} title={LABEL[lang === "ar" ? "ar" : "en"]}>
        {getIcon()}
        {LABEL[lang === "ar" ? "ar" : "en"]}
      </span>
    )
  },
}

/**
 * Professional AI Report Renderer — renders the full analysis as a structured
 * research report with proper sections, tables, and trust signals.
 */
export function AiReportRenderer({
  analysis,
  lang = "en",
  className,
}: {
  analysis: {
    content: string
    completedAt?: string | null
    model?: string | null
    degraded?: boolean
    stance?: string | null
    dataHash?: string
    technicalHash?: string | null
    priceAsOf?: string | null
    financialAsOf?: string | null
    reportKey?: string
    completeness?: {
      financialCoveragePct: number | null
      technicalCoveragePct: number | null
      limitations: string[]
    } | null
  }
  lang?: "en" | "ar"
  className?: string
}) {
  const { t } = useI18n()
  const ar = lang === "ar"
  const content = analysis.content ?? ""
  
  // Extract stance from content if not provided
  const extractStance = (content: string) => {
    const match = content.match(/^##\s*(?:Overall Assessment|التقييم العام)\s*([\s\S]*)$/im)
    const tail = (match?.[1] ?? content).slice(0, 500).toLowerCase()
    if (/bullish|صاعد|إيجابي(?!\s*بحذر)/.test(tail)) return "bullish"
    if (/cautiously\s*positive|cautious|صعود\s*بحذر|إيجابي\s*بحذر/.test(tail)) return "cautious"
    if (/bearish|هابط|سلبي/.test(tail)) return "bearish"
    if (/neutral|محايد/.test(tail)) return "neutral"
    return "neutral"
  }

  const stance = extractStance(content)

  return (
    <div className={cn("space-y-4", className)} dir={ar ? "rtl" : "ltr"}>
      {/* Header with trust signals */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-4 rounded-xl border border-border/60 bg-card">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden />
          <span className="text-sm font-semibold text-foreground">
            {ar ? "قراءة المحلل" : "Analyst Note"}
          </span>
          {analysis.model && (
            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full border border-border/60 bg-muted/40 text-muted-foreground font-mono">
              {analysis.model}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {analysis.financialAsOf && (
            <SourceLine
              source={ar ? "الإفصاح المالي المنشور" : "Published financial filing"}
              period={analysis.financialAsOf}
              asOf={analysis.financialAsOf}
            />
          )}
          {analysis.priceAsOf && (
            <FreshnessBadge asOf={analysis.priceAsOf} />
          )}
        </div>
      </div>

      {/* Limitations / Coverage */}
      {analysis.completeness?.limitations?.length ? (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <div className="text-xs leading-relaxed text-warning">
              {analysis.completeness.limitations.join(" · ")}
            </div>
          </div>
        </div>
      ) : null}

      {/* Degraded notice */}
      {analysis.degraded ? (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <div className="text-xs leading-relaxed text-warning">
              {ar
                ? "تم إنشاء هذا التقرير باستخدام القواعد المحددة (بدون نموذج لغوي) بسبب عدم توفر الخدمة. المحتوى موثوق لكن قد يفتقر للعمق التحليلي."
                : "This report was generated using rule-based fallback (no language model) due to service unavailability. Content is reliable but may lack analytical depth."}
            </div>
          </div>
        </div>
      ) : null}

      {/* Main Content */}
      <article className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground/90" dir={ar ? "rtl" : "ltr"}>
        <ReactMarkdown components={aiMdComponents}>{content}</ReactMarkdown>
      </article>

      {/* Footer with trust signals */}
      <div className="border-t border-border/50 pt-4 flex flex-wrap items-center gap-2 text-[11px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
        <span>{ar ? "مبني على بيانات موثقة — مصدر وتاريخ كل رقم ظاهر في التقرير" : "Built on verified data — source and date of every figure shown in the report"}</span>
      </div>
    </div>
  )
}

/**
 * Compact summary card for AI analysis — used in dashboards/lists
 */
export function AiReportSummary({
  analysis,
  lang = "en",
  onClick,
}: {
  analysis: {
    content: string
    completedAt?: string
    stance?: string
    model?: string
  }
  lang?: "en" | "ar"
  onClick?: () => void
}) {
  const { t } = useI18n()
  const ar = lang === "ar"
  const extractStance = (content: string) => {
    const tail = content.slice(0, 400).toLowerCase()
    if (/bullish|صاعد|إيجابي(?!\s*بحذر)/.test(content)) return { tone: "bullish", label: ar ? "صاعد" : "Bullish" }
    if (/cautious|بحذر|إيجابي\s*بحذر/.test(tail)) return { tone: "cautious", label: ar ? "إيجابي بحذر" : "Cautiously Positive" }
    if (/bearish|هابط|سلبي/.test(tail)) return { tone: "bearish", label: ar ? "هابط" : "Bearish" }
    return { tone: "neutral", label: ar ? "محايد" : "Neutral" }
  }

  const stance = extractStance(analysis.content ?? "")
  const STYLE = {
    bullish: "border-success/40 bg-success/10 text-success",
    cautious: "border-warning/40 bg-warning/10 text-warning",
    neutral: "border-border bg-muted/60 text-muted-foreground",
    bearish: "border-destructive/40 bg-destructive/10 text-destructive",
  }
  const ICON = { bullish: TrendingUp, cautious: TrendingUp, neutral: Minus, bearish: TrendingDown }[stance.tone] ?? Minus
const IconComponent = ICON

  return (
    <div 
      className={cn(
        "rounded-xl border border-border/60 bg-card p-4 transition-all duration-200 hover:border-primary/30 hover:shadow-md",
        onClick && "cursor-pointer"
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            <span className="text-sm font-semibold text-foreground">{ar ? "قراءة المحلل" : "Analyst Note"}</span>
            {analysis.model && (
              <span className="px-2 py-0.5 text-[10px] font-medium rounded-full border border-border/60 bg-muted/40 text-muted-foreground font-mono">
                {analysis.model}
              </span>
            )}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
            {analysis.content?.slice(0, 200)}…
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STYLE[stance.tone]}`}>
            <IconComponent className="h-2.5 w-2.5" aria-hidden />
            {stance.label}
          </span>
          <span className="text-[10px] text-muted-foreground/70">
            {analysis.completedAt ? new Date(analysis.completedAt).toLocaleDateString(ar ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
          </span>
        </div>
      </div>
    </div>
  )
}

export { aiMdComponents }