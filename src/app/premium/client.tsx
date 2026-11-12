"use client"

// Premium page — full redesign (2026-11-13).
//
// The old page was a flat stack of small cards with weak hierarchy — user
// feedback: "صفحة البريميوم مش جذابة كـ UI". This version is built like a
// real pricing page: a hero that states the price once, a benefits grid with
// real icons, an honest free-vs-premium comparison, and a payment block whose
// WhatsApp CTA is the primary action. All the entitlement copy stays exactly
// what the product actually ships — no invented promises.
//
// Hydration-safety gate preserved: React Query reports isLoading=false on the
// server but true on the client's first fetch — both server and first client
// render must agree (nothing), and the spinner appears only after mount.

import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  BellRing,
  Check,
  Crown,
  FileCheck2,
  Gauge,
  Gem,
  Layers,
  Loader2,
  MessageCircle,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { useI18n } from "@/lib/i18n"
import { getUserToken } from "@/lib/client/api"

export default function PremiumPage() {
  const { lang } = useI18n()
  const ar = lang === "ar"
  // Hydration-safety gate (see header comment).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { data: settingsData } = useQuery({
    queryKey: ["public-settings"],
    queryFn: () => fetch("/api/v1/settings/public").then((r) => (r.ok ? r.json() : Promise.resolve({}))),
  })

  const { data: subStatus, isLoading: subLoading } = useQuery({
    queryKey: ["my-subscription"],
    queryFn: () => {
      const token = getUserToken()
      if (!token) {
        return Promise.resolve({ isPremium: false, subscription: null, smartAnalysisUsage: null })
      }
      return fetch("/api/v1/subscription/me", { headers: { "x-session-token": token } }).then((r) =>
        r.ok ? r.json() : Promise.resolve({ isPremium: false, subscription: null, smartAnalysisUsage: null }),
      )
    },
    enabled: typeof window !== "undefined",
  })

  const qc = useQueryClient()
  const requestSub = useMutation({
    mutationFn: async (notes?: string) => {
      const res = await fetch("/api/v1/subscription/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session-token": getUserToken() ?? "" },
        body: JSON.stringify({ notes }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({ error: "Failed to request subscription" }))).error)
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-subscription"] })
    },
  })

  const settings = (settingsData ?? {}) as Record<string, unknown>

  const price = typeof settings.PREMIUM_PRICE === "number" ? settings.PREMIUM_PRICE : 99
  const currency = typeof settings.PREMIUM_CURRENCY === "string" ? settings.PREMIUM_CURRENCY : "EGP"
  const durationDays = typeof settings.PREMIUM_DURATION_DAYS === "number" ? settings.PREMIUM_DURATION_DAYS : 30
  const phone = typeof settings.PAYMENT_PHONE === "string" ? settings.PAYMENT_PHONE : ""
  const whatsapp = typeof settings.WHATSAPP_NUMBER === "string" ? settings.WHATSAPP_NUMBER : "01211566147"
  const instructions = typeof settings.PAYMENT_INSTRUCTIONS === "string" ? settings.PAYMENT_INSTRUCTIONS : ""

  const subscription = subStatus?.subscription
  const isPremium = !!subStatus?.isPremium
  const status = subscription?.status

  const openWhatsApp = () => {
    const number = whatsapp.replace(/\D/g, "")
    const message = ar
      ? `مرحباً، أريد الاشتراك في Premium لمدة ${durationDays} يوماً.`
      : `Hello, I would like to subscribe to Premium for ${durationDays} days.`
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer")
  }

  const benefits = [
    { icon: Gauge, t: ar ? "مؤشر الصحة المالية" : "Financial Health Score", d: ar ? "درجة 0-100 من 5 محاور موثقة مع تفصيل بكل محور" : "0-100 score across 5 verified axes, each one explained" },
    { icon: Sparkles, t: ar ? "أطروحة استثمار بالـ AI" : "AI Investment Thesis", d: ar ? "قوة/ضعف/فرص/مخاطر من البيانات الموثقة فقط — بلا تأليف" : "Strengths, weaknesses, opportunities and risks — from verified data only" },
    { icon: Gem, t: ar ? "فرص التقييم القطاعي" : "Sector Valuation Screen", d: ar ? "الشركات الأقل من وسيط قطاعها في P/E و P/B" : "Companies below their sector median P/E & P/B" },
    { icon: FileCheck2, t: ar ? "أحدث النتائج المعلنة" : "Latest Announced Results", d: ar ? "آخر صافي ربح معلن لكل شركة — الأحدث أولاً" : "Most recent announced net profit per company — newest first" },
    { icon: BellRing, t: ar ? "أحداث استثمارية" : "Investment Events", d: ar ? "انقلاب أرباح، خفض دين، تحسن تدفق نقدي — مع الشرح" : "Profit turns, debt cuts, cash-flow improvements — with explanations" },
    { icon: Layers, t: ar ? "أرباع 2026 موثقة" : "Verified 2026 quarters", d: ar ? "قوائم ربعية بسلاسل زمنية كاملة لكل شركة" : "Quarterly statements with full time series per company" },
  ]

  const freeRows = [
    ar ? "معلومات أساسية عن الشركات" : "Basic company information",
    ar ? "بيانات مالية أساسية" : "Basic financial data",
    ar ? "3 تحليلات ذكية شهرياً" : "3 Smart Analyses per month",
    ar ? "فحوصات مالية" : "Financial scanning",
  ]
  const premiumRows = [
    ar ? "كل مميزات المجاني" : "All Free features",
    ar ? "تحليلات ذكية غير محدودة" : "Unlimited Smart Analyses",
    ar ? "أحداث الشركات الاستثمارية" : "Company investment events",
    ar ? "أطروحة استثمار بالـ AI لكل شركة" : "AI investment thesis per company",
    ar ? "مؤشر الصحة المالية الكامل" : "Full financial health score",
    ar ? "الترتيب الكامل بكل المؤشرات" : "Full rankings across every metric",
    ar ? "تقرير الشركة الكامل مع الطباعة/PDF" : "Full company report with print/PDF",
    ar ? "محفظة بدون حد السهمين" : "Portfolio without the 2-position cap",
    ar ? "بدون إعلانات" : "No ads",
  ]

  let statusBlock: React.ReactNode = null
  if (!mounted) {
    statusBlock = null
  } else if (subLoading) {
    statusBlock = (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  } else if (isPremium && status === "ACTIVE") {
    statusBlock = (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-success/40 bg-success/10 p-5">
        <div>
          <p className="flex items-center gap-2 font-bold text-success">
            <ShieldCheck className="h-5 w-5" aria-hidden />
            {ar ? "أنت مشترك في Premium" : "You are a Premium member"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {ar ? "ينتهي في" : "Expires"}:{" "}
            {subscription?.endDate ? new Date(subscription.endDate).toLocaleDateString(ar ? "ar-EG" : "en-GB") : "—"}
          </p>
        </div>
        <Check className="h-8 w-8 text-success" aria-hidden />
      </div>
    )
  } else if (status === "PENDING") {
    statusBlock = (
      <div className="rounded-2xl border border-warning/40 bg-warning/10 p-5">
        <p className="font-bold text-warning-foreground">{ar ? "طلبك قيد المراجعة" : "Your request is pending approval"}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {ar ? "سيتم تفعيل اشتراكك بعد موافقة المشرف — عادة خلال ساعات." : "Your subscription will be activated once an admin approves it."}
        </p>
      </div>
    )
  } else if (status === "REJECTED") {
    statusBlock = (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5">
        <p className="font-bold text-destructive">{ar ? "تم رفض الطلب" : "Your request was rejected"}</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => requestSub.mutate(undefined)} disabled={requestSub.isPending}>
          {requestSub.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : ar ? "إعادة المحاولة" : "Try again"}
        </Button>
      </div>
    )
  }

  const canRequest = !isPremium && status !== "PENDING"

  return (
    <LayoutShell showMobileNav={true}>
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        {/* ================= HERO ================= */}
        <section className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-6 sm:p-10">
          <div className="pointer-events-none absolute -top-16 -end-16 h-48 w-48 rounded-full bg-primary/20 blur-[70px]" aria-hidden />
          <div className="relative">
            <Badge variant="outline" className="border-gold/50 bg-gold/10 text-gold">
              <Crown className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {ar ? "بريميوم" : "Premium"}
            </Badge>
            <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              {ar ? "بحث أعمق. قرارات أدق." : "Deeper research. Sharper decisions."}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              {ar
                ? "افتح كل أدوات EGXANO: أطروحات AI مبنية على إفصاحات رسمية، مؤشر صحة مالية كامل، فرص تقييم قطاعي، وأحداث الشركات قبل ما تتحرك."
                : "Unlock every EGXANO tool: AI theses built on official disclosures, the full health score, sector valuation screens, and company events."}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <div className="rounded-2xl border border-primary/30 bg-card px-5 py-3 shadow-sm">
                <span className="text-3xl font-extrabold tabular text-foreground" dir="ltr">
                  {price}
                  <span className="ms-1 text-sm font-semibold text-muted-foreground">{currency}</span>
                </span>
                <span className="ms-2 text-xs text-muted-foreground">/ {ar ? `${durationDays} يوم` : `${durationDays} days`}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
                {ar ? "تفعيل يدوي بعد تأكيد الدفع — بدون اشتراك تلقائي" : "Manually activated after payment check — no auto-renewal"}
              </div>
            </div>
          </div>
        </section>

        {/* ================= STATUS ================= */}
        {statusBlock ? <div className="mt-6">{statusBlock}</div> : null}

        {/* ================= BENEFITS ================= */}
        <section className="mt-8">
          <h2 className="text-lg font-bold text-foreground">{ar ? "ماذا يفتح بريميوم؟" : "What Premium unlocks"}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {benefits.map((f) => (
              <div key={f.t} className="rounded-2xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/40">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <f.icon className="h-4.5 w-4.5" aria-hidden />
                </div>
                <p className="mt-3 text-sm font-bold text-foreground">{f.t}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ================= COMPARISON ================= */}
        <section className="mt-8">
          <h2 className="text-lg font-bold text-foreground">{ar ? "مجاني مقابل بريميوم" : "Free vs Premium"}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Card className="border-border/60">
              <CardContent className="p-5">
                <p className="text-sm font-bold text-muted-foreground">{ar ? "مجاني" : "Free"}</p>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {freeRows.map((row) => (
                    <li key={row} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />
                      {row}
                    </li>
                  ))}
                  <li className="flex items-start gap-2 font-medium text-warning">
                    + {ar ? "إعلانات" : "Ads"}
                  </li>
                </ul>
              </CardContent>
            </Card>
            <Card className="relative border-primary/40 bg-gradient-to-br from-primary/5 to-transparent">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-primary">{ar ? "بريميوم" : "Premium"}</p>
                  <Badge variant="outline" className="border-primary/40 text-[10px] text-primary">
                    <Crown className="me-1 h-3 w-3" aria-hidden />
                    {ar ? "موصى به" : "Recommended"}
                  </Badge>
                </div>
                <ul className="mt-3 space-y-2 text-sm text-foreground">
                  {premiumRows.map((row) => (
                    <li key={row} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                      {row}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ================= HOW TO SUBSCRIBE ================= */}
        {canRequest ? (
          <section className="mt-8">
            <h2 className="text-lg font-bold text-foreground">{ar ? "إزاي تشترك؟" : "How to subscribe"}</h2>
            <div className="mt-4 grid gap-4 lg:grid-cols-5">
              {/* Steps */}
              <div className="space-y-2 lg:col-span-2">
                {[
                  { n: 1, t: ar ? "ابعت طلب الاشتراك" : "Submit your request" },
                  { n: 2, t: ar ? `حوّل ${price} ${currency} على الرقم الظاهر` : `Transfer ${price} ${currency} to the number shown` },
                  { n: 3, t: ar ? "ابعت إيصال التحويل على واتساب" : "Send the receipt on WhatsApp" },
                  { n: 4, t: ar ? "المشرف يفعّل حسابك بعد التحقق" : "An admin activates your account after verification" },
                ].map((step) => (
                  <div key={step.n} className="flex items-center gap-3 rounded-xl border border-border/50 bg-card px-3.5 py-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {step.n}
                    </span>
                    <p className="text-sm font-medium text-foreground">{step.t}</p>
                  </div>
                ))}
              </div>

              {/* Payment card */}
              <Card className="border-border/60 lg:col-span-3">
                <CardContent className="space-y-4 p-5">
                  <div>
                    <p className="text-sm font-bold">{ar ? "طرق الدفع" : "Payment methods"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ar ? "تحويل بنكي / محفظة إلكترونية" : "Bank transfer / mobile wallet"}
                    </p>
                    {phone ? (
                      <p className="mt-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 font-mono text-sm tabular" dir="ltr">
                        {phone}
                      </p>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-success/30 bg-success/10 p-4">
                    <p className="flex items-center gap-2 text-sm font-bold text-success">
                      <MessageCircle className="h-4 w-4" aria-hidden />
                      {ar ? "واتساب — للدفع والاستفسارات" : "WhatsApp — payment & inquiries"}
                    </p>
                    <p className="mt-1 font-mono text-sm font-semibold tabular text-success" dir="ltr">{whatsapp}</p>
                    <Button size="sm" className="mt-3 w-full gap-2" onClick={openWhatsApp}>
                      <MessageCircle className="h-4 w-4" aria-hidden />
                      {ar ? "ابعت على واتساب برسالة جاهزة" : "Message on WhatsApp (pre-filled)"}
                    </Button>
                  </div>

                  {instructions ? (
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
                      <p className="whitespace-pre-wrap">{instructions}</p>
                    </div>
                  ) : null}

                  <Button size="lg" className="w-full gap-2" onClick={() => requestSub.mutate(undefined)} disabled={requestSub.isPending}>
                    {requestSub.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeft className="h-4 w-4 rtl-flip" aria-hidden />}
                    {ar ? "ابعت طلب اشتراك بريميوم" : "Submit Premium request"}
                  </Button>
                  <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                    {ar
                      ? "بعد إتمام التحويل، ابعت طلب الاشتراك والإيصال — والمشرف هيفعّل اشتراكك بعد التحقق من الدفع."
                      : "After the transfer, submit the request with your receipt — an admin verifies payment and activates your subscription."}
                  </p>
                </CardContent>
              </Card>
            </div>
          </section>
        ) : null}
      </div>
    </LayoutShell>
  )
}
