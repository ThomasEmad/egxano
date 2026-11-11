"use client"

/**
 * Professional AI Q&A Box — grounded follow-up questions with verified
 * figures displayed as professional metric cards. Every answer shows its
 * evidence, source, and confidence level.
 */

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, MessageCircleQuestion, Send, ShieldCheck, Copy, Check, Info, Sparkles, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { authHeaders } from "@/lib/client/api"
import { useI18n } from "@/lib/i18n"
import { formatMoney } from "@/lib/brand"
import { cn } from "@/lib/utils"
import { SectionHeading } from "@/components/brand/section-heading"
import { MetricTip } from "@/components/brand/metric-tip"
import { DataStateBadge, SourceLine, FreshnessBadge } from "@/components/brand/data-trust"

const SUGGESTIONS_COMPANY_AR = ["هل الشركة مربحة؟", "إيه تقييم الشركة؟", "أحدث الأحداث؟", "إيه درجة صحتها المالية؟"]
const SUGGESTIONS_GLOBAL_AR = ["أفضل شركات البنوك حسب ROE؟", "أفضل شركات الأغذية حسب هامش الربح؟", "أفضل شركات حسب العائد على الأصول؟", "تحليل ABUK"]
const SUGGESTIONS_COMPANY_EN = ["Is the company profitable?", "How is it valued?", "Latest events?", "Health score?"]
const SUGGESTIONS_GLOBAL_EN = ["Best banks by ROE?", "Top food companies by margin?", "Best companies by ROA?", "Analyze ABUK"]

interface QaFigure {
  label: string
  value: string
  unit?: string
  detail?: string
  status?: "ok" | "unavailable" | "estimated"
  source?: string
  period?: string
}

interface QaTurn {
  q: string
  a: string
  figures: QaFigure[]
  error?: string
  sources?: string[]
  confidence?: number
}

function renderAnswer(a: string) {
  return a.split("\n").map((line, i) => {
    const parts = line.split(/\*\*(.+?)\*\*/g)
    return (
      <p key={i} className={cn(i === 0 ? "" : "mt-1", "leading-relaxed text-sm text-foreground/90")}>
        {parts.map((p, j) => (j % 2 === 1 ? <strong key={j} className="font-semibold text-foreground">{p}</strong> : <span key={j}>{p}</span>))}
      </p>
    )
  })
}

function formatFigureValue(fig: QaFigure) {
  if (fig.status === "unavailable") return "—"
  if (fig.unit === "PERCENT") return `${fig.value}%`
  if (fig.unit === "RATIO") return `${fig.value}x`
  if (fig.unit === "EGP") {
    const n = parseFloat(fig.value)
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
    return fig.value
  }
  return fig.value
}

export function AiQaBox({
  companyId,
  companyName,
  compact = false,
}: {
  companyId?: string
  companyName?: string
  compact?: boolean
}) {
  const { lang } = useI18n()
  const qc = useQueryClient()
  const [question, setQuestion] = useState("")
  const [turns, setTurns] = useState<QaTurn[]>([])
  const [busy, setBusy] = useState(false)
  const ar = lang === "ar"

  const suggestions = companyId
    ? (ar ? SUGGESTIONS_COMPANY_AR : SUGGESTIONS_COMPANY_EN)
    : (ar ? SUGGESTIONS_GLOBAL_AR : SUGGESTIONS_GLOBAL_EN)
  const scopeName = companyName ?? (ar ? "الشركة" : "this company")
  const title = companyId
    ? ar ? `اسأل عن ${scopeName} — إجابات من الأرقام الموثقة` : `Ask about ${scopeName} — answers from verified figures`
    : ar ? "اسأل عن السوق — إجابات من الأرقام الموثقة" : "Ask the market — answers from verified figures"

  async function ask(q: string) {
    const text = q.trim()
    if (text.length < 3 || busy) return
    setBusy(true)
    setQuestion("")
    setTurns((t) => [...t, { q: text, a: "", figures: [] }])
    try {
      const res = await fetch("/api/v1/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ question: text, companyId: companyId ?? null }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.answer) {
        const msg = body?.message ?? (ar ? "حصل خطأ — حاول تاني." : "Something went wrong — try again.")
        setTurns((t) => [...t.slice(0, -1), { q: text, a: "", figures: [], error: msg }])
      } else {
        const figures: QaFigure[] = (body.figures ?? []).map((f: unknown) => {
          const fig = f as Record<string, unknown>
          return {
            label: (fig.label as string) ?? "",
            value: String(fig.value ?? ""),
            unit: fig.unit as string,
            detail: fig.detail as string,
            status: fig.status as "ok" | "unavailable" | "estimated",
            source: fig.source as string,
            period: fig.period as string,
          }
        })
        setTurns((t) => [...t.slice(0, -1), { q: text, a: body.answer as string, figures, sources: body.sources, confidence: body.confidence }])
        if (body.usage) qc.setQueryData(["qa-usage"], body.usage as { used: number; limit: number })
      }
    } catch {
      setTurns((t) => [...t.slice(0, -1), { q: text, a: "", figures: [], error: ar ? "الاتصال فشل — حاول تاني." : "Connection failed — try again." }])
    } finally {
      setBusy(false)
    }
  }

  const scopeTitle = companyId
    ? ar ? `حول ${scopeName}` : `About ${scopeName}`
    : ar ? "حول السوق" : "About the market"

  return (
    <Card className={cn("rounded-2xl border border-border/60 bg-card", compact ? "p-4" : "p-5")}>
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="h-4.5 w-4.5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold leading-tight">{title}</h2>
          <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3 shrink-0 text-success" aria-hidden />
            <span>{ar ? "إجابات من الإفصاحات المنشورة — الأرقام المستخدمة تظهر تحت كل إجابة. ليست توصية." : "Answers from published filings — figures used appear under each answer. Not advice."}</span>
          </p>
        </div>
      </div>

      {/* Input Area */}
      <form onSubmit={(e) => { e.preventDefault(); ask(question) }} className="flex gap-2">
        <div className="flex-1 relative">
          <Input
            dir="auto"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={
              companyId
                ? ar ? "اكتب سؤالك عن الشركة… مثال: هل الشركة مربحة؟" : "Ask about this company… e.g. Is it profitable?"
                : ar ? "اكتب سؤالك… مثال: هل الشركة مربحة؟" : "Ask… e.g. Is it profitable?"
            }
            className="h-10 text-sm pr-10"
            maxLength={300}
            disabled={busy}
          />
          {question && !busy && (
            <button
              type="button"
              onClick={() => setQuestion("")}
              className="absolute inset-y-0 end-3 flex items-center text-muted-foreground/50 hover:text-muted-foreground"
              aria-label={ar ? "مسح السؤال" : "Clear question"}
            >
              <span className="h-4 w-4">×</span>
            </button>
          )}
        </div>
        <Button
          type="submit"
          size="sm"
          className="h-10 px-4 gap-1.5"
          disabled={busy || question.trim().length < 3}
          aria-label={ar ? "أرسل السؤال" : "Send question"}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              <span>{ar ? "جارٍ التحليل…" : "Analyzing…"}</span>
            </>
          ) : (
            <>
              <Send className="h-4 w-4 rtl-flip" aria-hidden />
              <span>{ar ? "اسأل" : "Ask"}</span>
            </>
          )}
        </Button>
      </form>

      {/* Suggestions */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => ask(s)}
            disabled={busy}
            className={cn(
              "rounded-full border border-border/60 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors duration-150",
              "hover:bg-primary/10 hover:text-primary hover:border-primary/30 disabled:opacity-50"
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Conversation History */}
      {turns.length > 0 && (
        <div className="mt-5 space-y-5" role="log" aria-label={ar ? "محادثة التحليل" : "Analysis conversation"}>
          {turns.map((t, i) => (
            <div key={i} className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
              {/* Question */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{ar ? "سؤالك" : "Your question"}</p>
                    <p className="mt-1 text-sm text-foreground/90 dir-auto">{t.q}</p>
                  </div>
                </div>
              </div>

              {/* Answer */}
              {t.error ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                  <div className="flex items-start gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <p className="text-sm text-destructive">{t.error}</p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-border/60 bg-card p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
                      <Sparkles className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {ar ? "الرد" : "Answer"}
                        </p>
                        {t.confidence !== undefined && (
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            <Info className="h-3 w-3" aria-hidden />
                            {Math.round(t.confidence * 100)}% {ar ? "ثقة" : "Confidence"}
                          </Badge>
                        )}
                      </div>
                      <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground/90 dir-auto">
                        {t.a.split("\n").map((line, idx) => (
                          <p key={idx} className="mt-1">
                            {line.split(/\*\*(.+?)\*\*/g).map((part, j) => (
                              j % 2 === 1 ? <strong key={j} className="font-semibold text-foreground">{part}</strong> : <span key={j}>{part}</span>
                            ))}
                          </p>
                        ))}
                      </div>

                      {/* Figures/Evidence */}
                      {t.figures && t.figures.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-border/50">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                            {ar ? "الأرقام المستخدمة" : "Figures used"}
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {t.figures.map((fig, idx) => (
                              <Card key={idx} className="p-3 border-border/60 hover:border-primary/30 transition-colors">
                                <div className="flex items-center justify-between gap-2 mb-1.5">
                                  <MetricTip code={fig.label.toLowerCase().replace(/\s+/g, "_")} label={fig.label} className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground" />
                                  <DataStateBadge state={fig.status === "unavailable" ? "unavailable" : fig.status === "estimated" ? "ai" : "reported"} className="text-[9px]" />
                                </div>
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="text-base font-bold tabular text-foreground shrink-0">
                                    {fig.value === "—" ? "—" : formatFigureValue(fig)}
                                  </span>
                                  {fig.period && (
                                    <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">
                                      {fig.period}
                                    </span>
                                  )}
                                </div>
                                {fig.detail ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button type="button" className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
                                        <Info className="h-3 w-3" aria-hidden />
                                        {ar ? "التفاصيل" : "Details"}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-xs text-[11px]">
                                      {fig.detail}
                                    </TooltipContent>
                                  </Tooltip>
                                ) : null}
                                {fig.source && (
                                  <SourceLine source={fig.source} period={fig.period} asOf={fig.period} className="mt-1.5" />
                                )}
                              </Card>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Sources */}
                      {t.sources?.length && (
                        <div className="mt-3 pt-3 border-t border-border/50">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                            {ar ? "المصادر" : "Sources"}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {t.sources.map((src, idx) => (
                              <Badge key={idx} variant="outline" className="text-[10px] font-mono text-muted-foreground/80">
                                {src}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}