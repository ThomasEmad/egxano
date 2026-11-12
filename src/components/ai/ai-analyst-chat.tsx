"use client"

/**
 * Professional AI Analyst Chat — grounded follow-up conversation with the
 * AI analyst. Maintains context from the main report, shows usage limits,
 * and displays grounded answers with figure citations.
 */

import { useEffect, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Loader2, Send, Sparkles, ShieldCheck, Info, Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { authHeaders } from "@/lib/client/api"
import { useI18n } from "@/lib/i18n"
import { formatMoney } from "@/lib/brand"
import { cn } from "@/lib/utils"
import { DataStateBadge, SourceLine } from "@/components/brand/data-trust"
import { MetricTip } from "@/components/brand/metric-tip"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"
import React from "react"

interface AiChatMessage {
  role: "user" | "assistant"
  content: string
  figures?: Array<{
    label: string
    value: string
    unit?: string
    detail?: string
    status?: "ok" | "unavailable" | "estimated"
    source?: string
    period?: string
  }>
  sources?: string[]
}

interface AiChatData {
  reply: string
  usage?: { used: number; limit: number }
  figures?: AiChatMessage["figures"]
  sources?: string[]
}

export function AiAnalystChat({ companyId }: { companyId: string }) {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [input, setInput] = useState("")
  const [chatUsed, setChatUsed] = useState<{ used: number; limit: number } | null>(null)
  const [showWelcome, setShowWelcome] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const send = useMutation({
    mutationFn: (history: AiChatMessage[]) => {
      const body = { messages: history, lang: ar ? "ar" : "en" }
      // The chat route is nested under the company path param: /api/v1/companies/[id]/ai-analysis/chat
      return fetch(`/api/v1/companies/${encodeURIComponent(companyId)}/ai-analysis/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      }).then((r) => r.json())
    },
    onSuccess: (data) => {
      const reply = data.reply ?? (ar ? "عذراً، لم أتمكن من توليد رد." : "Sorry, I couldn't generate a response.")
      setMessages((prev) => [...prev, { role: "assistant", content: reply, figures: data.figures, sources: data.sources }])
      if (data.usage) setChatUsed(data.usage)
      setShowWelcome(false)
    },
    onError: () => {
      const errMsg = ar ? "تعذر الاتصال بالمحلل — حاول تاني." : "Could not reach the analyst — please try again."
      setMessages((prev) => [...prev, { role: "assistant", content: errMsg }])
    },
  })

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || send.isPending) return
    setShowWelcome(false)
    setMessages((prev) => [...prev, { role: "user", content: text }])
    setInput("")
    send.mutate([...messages, { role: "user", content: text }])
  }

  // Render welcome screen
  const renderWelcome = () => (
    <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
        <Sparkles className="h-7 w-7 text-primary" aria-hidden />
      </div>
      <h3 className="text-base font-semibold text-foreground">
        {ar ? "مرحباً! أنا محللك المالي" : "Hello! I'm your financial analyst"}
      </h3>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
        {ar
          ? "اسألني أي حاجة عن الشركة — الأرباح، التقييم، الأحداث، المخاطر. كل إجابة هتكون بالأرقام من الإفصاحات الرسمية."
          : "Ask me anything about this company — earnings, valuation, events, risks. Every answer comes with figures from official filings."}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {[
          ar ? "هل الشركة مربحة؟" : "Is the company profitable?",
          ar ? "إيه تقييم الشركة؟" : "How is it valued?",
          ar ? "أحدث الأحداث؟" : "Latest events?",
          ar ? "إيه درجة صحتها المالية؟" : "Financial health score?",
        ].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setShowWelcome(false)
              setMessages((prev) => [...prev, { role: "user", content: s }])
            }}
            className="rounded-full border border-border/60 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary hover:border-primary/30"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )

  // Render a single message
  const renderMessage = (msg: AiChatMessage, idx: number) => {
    if (msg.role === "user") {
      return (
        <div key={idx} className={cn("animate-in fade-in slide-in-from-bottom-2 duration-200", idx === messages.length - 1 && "last-message")}>
          <div className="flex items-end justify-end gap-2">
            <div className="max-w-[80%] rounded-2xl border border-primary/20 bg-primary/5 p-3">
              <p className="text-sm text-foreground">{msg.content}</p>
            </div>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <span className="text-[10px] font-bold">{ar ? "أ" : "U"}</span>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div key={idx} className={cn("animate-in fade-in slide-in-from-bottom-2 duration-200", idx === messages.length - 1 && "last-message")}>
        <div className="flex items-start gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1 rounded-2xl border border-border/60 bg-card p-4">
            <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground/90">
              {msg.content.split("\n").map((line, i) => (
                <p key={i} className="mt-1">
                  {line.split(/\*\*(.+?)\*\*/g).map((part, j) => (
                    j % 2 === 1 ? <strong key={j} className="font-semibold text-foreground">{part}</strong> : <span key={j}>{part}</span>
                  ))}
                </p>
              ))}
            </div>
            {msg.figures?.length && (
              <div className="mt-3 pt-3 border-t border-border/50">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {ar ? "الأرقام المستخدمة" : "Figures used"}
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {msg.figures.map((fig, fIdx) => (
                    <Card key={fIdx} className="p-3 border-border/60 hover:border-primary/30 transition-colors">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <MetricTip code={fig.label.toLowerCase().replace(/\s+/g, "_")} label={fig.label} className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground" />
                        <DataStateBadge state={fig.status === "unavailable" ? "unavailable" : fig.status === "estimated" ? "ai" : "reported"} className="text-[9px]" />
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-base font-bold tabular text-foreground shrink-0">
                          {fig.value === "—" ? "—" : (fig.unit === "PERCENT" ? `${fig.value}%` : fig.unit === "RATIO" ? `${fig.value}x` : fig.unit === "EGP" ? formatMoney(parseFloat(fig.value), "en") : fig.value)}
                        </span>
                        {fig.period && (
                          <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">{fig.period}</span>
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
                          <TooltipContent side="top" className="max-w-xs text-[11px]">{fig.detail}</TooltipContent>
                        </Tooltip>
                      ) : null}
                      {fig.source && <SourceLine source={fig.source} period={fig.period} className="mt-1.5" />}
                    </Card>
                  ))}
                </div>
              </div>
            )}
            {msg.sources?.length && (
              <div className="mt-2 pt-2 border-t border-border/50">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  {ar ? "المصادر" : "Sources"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {msg.sources.map((src, sIdx) => (
                    <Badge key={sIdx} variant="outline" className="text-[10px] font-mono text-muted-foreground/80">{src}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Compute chat content based on state
  const chatContent = showWelcome && messages.length === 0 ? renderWelcome() : (
    <React.Fragment>
      <ScrollArea className="h-[500px] pr-2" style={{ scrollbarWidth: "thin" }}>
        <div className="p-4 space-y-4" ref={scrollRef}>
          {messages.map((msg, idx) => renderMessage(msg, idx))}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>
    </React.Fragment>
  )

  return (
    <Card className="rounded-2xl border border-border/60 bg-card overflow-hidden">
      <CardHeader className="pb-3 flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden />
          {ar ? "متابعة مع المحلل" : "Continue with Analyst"}
        </CardTitle>
        <div className="flex items-center gap-2">
          {chatUsed && (
            <Badge variant="outline" className="gap-1 text-[10px]">
              <Info className="h-3 w-3" aria-hidden />
              {ar ? `محادثة: ${chatUsed.used}/${chatUsed.limit}` : `Chat: ${chatUsed.used}/${chatUsed.limit}`}
            </Badge>
          )}
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
            <span className="hidden sm:inline">{ar ? "إجابات من البيانات الموثقة — ليست توصية" : "Answers from verified data — not advice"}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {chatContent}

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="border-t border-border/60 p-4" data-chat-form>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Input
                dir="auto"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={ar ? "اكمل المحادثة… اسأل عن أي تفصيل" : "Continue the conversation… ask any follow-up"}
                className="h-10 text-sm pr-10"
                maxLength={500}
                disabled={send.isPending}
              />
              {input && !send.isPending && (
                <button
                  type="button"
                  onClick={() => setInput("")}
                  className="absolute inset-y-0 end-3 flex items-center text-muted-foreground/50 hover:text-muted-foreground"
                  aria-label={ar ? "مسح" : "Clear"}
                >
                  <span className="h-4 w-4">×</span>
                </button>
              )}
            </div>
            <Button
              type="submit"
              size="sm"
              className="h-10 px-4 gap-1.5"
              disabled={send.isPending || !input.trim()}
              aria-label={ar ? "أرسل" : "Send"}
            >
              {send.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  <span>{ar ? "جاري الرد…" : "Replying…"}</span>
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 rtl-flip" aria-hidden />
                  <span>{ar ? "إرسال" : "Send"}</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function formatFigureValue(fig: { value: string; unit?: string }) {
  if (fig.value === "—" || !fig.value) return "—"
  const v = fig.value
  if (fig.unit === "PERCENT") return `${v}%`
  if (fig.unit === "RATIO") return `${v}x`
  if (fig.unit === "EGP") {
    const n = parseFloat(v)
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
    return v
  }
  return v
}