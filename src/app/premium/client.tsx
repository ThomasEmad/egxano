"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Clock,
  Crown,
  Hourglass,
  Loader2,
  MessageCircle,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { SectionHeading } from "@/components/brand/section-heading"
import { BRAND, TRUST } from "@/lib/brand"
import { useI18n } from "@/lib/i18n"
import { getUserToken } from "@/lib/client/api"

// Truth rules for this page (see docs/brand/audit-trust.md):
//  • Only benefits verified in code are listed; nothing else is claimed.
//  • Price/period come from public settings; there is no hardcoded fallback.
//  • Activation is manual: a request, a manual transfer, then verification.
//    No card is stored and nothing renews automatically.
//  • Payment details render only when a channel is actually configured.

interface PlanSettings {
  enabled: boolean
  price: number | null
  currency: string
  durationDays: number | null
  phone: string | null
  whatsapp: string | null
  instructions: string | null
}

function readSettings(raw: unknown): PlanSettings {
  const s = (raw ?? {}) as Record<string, unknown>
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null)
  return {
    enabled: s.PREMIUM_ENABLED === true,
    price: num(s.PREMIUM_PRICE),
    currency: typeof s.PREMIUM_CURRENCY === "string" && s.PREMIUM_CURRENCY.trim() ? s.PREMIUM_CURRENCY.trim() : "EGP",
    durationDays: num(s.PREMIUM_DURATION_DAYS),
    phone: str(s.PAYMENT_PHONE),
    whatsapp: str(s.WHATSAPP_NUMBER),
    instructions: str(s.PAYMENT_INSTRUCTIONS),
  }
}

function formatPrice(price: number, currency: string, ar: boolean): string {
  const n = price.toLocaleString("en-EG")
  if (currency === "EGP") return ar ? `${n} ج.م` : `${n} EGP`
  return `${n} ${currency}`
}

function formatDate(value: string | null | undefined, ar: boolean): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(ar ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric" })
}

/** Map API error codes to plain, bilingual messages — never render a raw code. */
function requestError(code: string, ar: boolean): string {
  switch (code) {
    case "UNAUTHENTICATED":
      return ar ? "انتهت الجلسة — سجّل الدخول تاني وأعد المحاولة." : "Your session expired — sign in again and retry."
    case "REQUEST_PENDING":
      return ar ? "عندك طلب قيد المراجعة بالفعل." : "You already have a request pending review."
    case "ALREADY_PREMIUM":
      return ar ? "اشتراكك نشط بالفعل." : "Your subscription is already active."
    case "NO_PREMIUM_PLAN":
      return ar ? "باقة Premium مش متاحة حالياً." : "Premium isn't available right now."
    case "RATE_LIMITED":
      return ar ? "طلبات كتير — جرّب تاني بعد شوية." : "Too many requests — please try again shortly."
    default:
      return ar ? "تعذّر إرسال الطلب. جرّب تاني." : "Couldn't submit the request. Please try again."
  }
}

export default function PremiumPage() {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const qc = useQueryClient()

  // Hydration-safety gate: React Query reports isLoading=false on the server
  // (fetchStatus "idle") but true on the client's first fetch — rendering the
  // spinner on the client while the server rendered a card caused React #418.
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), [])

  const signedIn = mounted && !!getUserToken()

  const {
    data: settingsData,
    isLoading: settingsLoading,
    isError: settingsError,
    refetch: refetchSettings,
  } = useQuery({
    queryKey: ["public-settings"],
    queryFn: async () => {
      const res = await fetch("/api/v1/settings/public")
      if (!res.ok) throw new Error("SETTINGS_UNAVAILABLE")
      return (await res.json()) as unknown
    },
    retry: 1,
    staleTime: 60_000,
  })

  const { data: subStatus, isLoading: subLoading } = useQuery({
    queryKey: ["my-subscription"],
    queryFn: async () => {
      const token = getUserToken()
      if (!token) return { isPremium: false, subscription: null }
      const res = await fetch("/api/v1/subscription/me", { headers: { "x-session-token": token } })
      if (!res.ok) return { isPremium: false, subscription: null }
      return (await res.json()) as {
        isPremium: boolean
        subscription: { status: string; planName: string; startDate: string | null; endDate: string | null } | null
      }
    },
    enabled: mounted,
    staleTime: 30_000,
  })

  const [requestErrorCode, setRequestErrorCode] = useState<string | null>(null)

  const requestSub = useMutation({
    mutationFn: async () => {
      const token = getUserToken()
      if (!token) throw new Error("UNAUTHENTICATED")
      const res = await fetch("/api/v1/subscription/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session-token": token },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "FAILED")
      return data
    },
    onMutate: () => setRequestErrorCode(null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-subscription"] })
      qc.invalidateQueries({ queryKey: ["subscription-me"] })
    },
    onError: (err: Error) => setRequestErrorCode(err.message),
  })

  const settings = readSettings(settingsData)
  const settingsReady = !settingsLoading && !settingsError
  const priceKnown = settings.price !== null
  const durationKnown = settings.durationDays !== null

  const subscription = subStatus?.subscription ?? null
  const isPremium = !!subStatus?.isPremium
  const status = subscription?.status

  const activation: "signed-out" | "loading" | "active" | "pending" | "rejected" | "none" = !mounted || subLoading
    ? "loading"
    : !signedIn
      ? "signed-out"
      : isPremium && status === "ACTIVE"
        ? "active"
        : status === "PENDING"
          ? "pending"
          : status === "REJECTED"
            ? "rejected"
            : "none"

  const hasPaymentChannel = Boolean(settings.phone || settings.whatsapp)

  const openWhatsApp = () => {
    if (!settings.whatsapp) return
    const number = settings.whatsapp.replace(/\D/g, "")
    const message =
      ar && durationKnown
        ? `مرحباً، أريد الاشتراك في Premium لمدة ${settings.durationDays} يوماً.`
        : durationKnown
          ? `Hello, I would like to request Premium for ${settings.durationDays} days.`
          : ar
            ? "مرحباً، أريد الاشتراك في Premium."
            : "Hello, I would like to request Premium."
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer")
  }

  const priceLine =
    settingsReady && priceKnown && durationKnown
      ? ar
        ? `${formatPrice(settings.price as number, settings.currency, ar)} · ${settings.durationDays} يوماً · تفعيل لمرة واحدة، بدون تجديد تلقائي`
        : `${formatPrice(settings.price as number, settings.currency, ar)} · ${settings.durationDays} days · one-time activation, no auto-renewal`
      : null

  const benefits = [
    {
      title: ar ? "كل أحداث الشركات والتغيرات المكتشفة" : "All company events and detected changes",
      body: ar ? "أحداث مكتشفة من القوائم الموثقة، مع تفسير لكل حدث." : "Events detected from verified statements, each with an explanation.",
    },
    {
      title: ar ? "تحليلات ذكية بلا حد شهري" : "Unlimited Smart Analyses",
      body: ar ? "3 تحليلات شهرياً على الحساب المجاني — Premium يرفع الحد ويضيف تحديثاً فورياً." : "3 a month on the free account — Premium removes the cap and adds instant refresh.",
    },
    {
      title: ar ? "الترتيب الكامل وقوائم التقييم" : "Full rankings and valuation lists",
      body: ar ? "المجاني بيعرض أول 10 في الترتيب وأول 3 في التقييم — Premium بيعرض القائمة الكاملة." : "Free shows the top 10 of a ranking and the top 3 valuation rows — Premium shows the full lists.",
    },
    {
      title: ar ? "تقرير الشركة الكامل + طباعة/PDF" : "Full company report + print/PDF",
      body: ar ? "المجاني: ملخص صفحة واحدة. Premium: تقرير متعدد السنوات قابل للطباعة." : "Free: a one-page overview. Premium: the multi-year report, printable to PDF.",
    },
    {
      title: ar ? "محفظة بدون حد المركزين" : "Portfolio without the 2-position cap",
      body: ar ? "الخطة المجانية بتسمح بمركزين — Premium بدون حد." : "The free plan allows two positions — Premium removes the limit.",
    },
  ]

  const freeRows = [
    ar ? "تصفح الشركات والقوائم المالية والنسب" : "Browse companies, statements and ratios",
    ar ? "صفحات القطاعات والمقارنة بين الشركات" : "Sector pages and company comparison",
    ar ? "الترتيب العام (أول 10) وقوائم التقييم (أول 3)" : "Public rankings (top 10) and valuation lists (top 3)",
    ar ? "3 تحليلات ذكية شهرياً" : "3 Smart Analyses per month",
    ar ? "محفظة حتى مركزين" : "Portfolio up to 2 positions",
    ar ? "تنبيهات أسعار داخل المنصة" : "In-app price alerts",
  ]

  const premiumRows = [
    ar ? "كل أحداث الشركات المكتشفة" : "All detected company events",
    ar ? "تحليلات ذكية بلا حد + تحديث فوري" : "Unlimited Smart Analyses + instant refresh",
    ar ? "الترتيب الكامل وقوائم التقييم الكاملة" : "Full rankings and full valuation lists",
    ar ? "تقرير كامل متعدد السنوات + طباعة/PDF" : "Full multi-year report + print/PDF",
    ar ? "محفظة بلا حد للمراكز" : "Portfolio without a position cap",
  ]

  const faqs = [
    {
      q: ar ? "هل الوصول بيتم فوراً؟" : "Do I get access immediately?",
      a: ar
        ? "لأ — التفعيل يدوي: بنتحقق من التحويل وبنسجّل 30 يوماً من Premium. الصفحة دي هتعرض حالة الطلب."
        : "No — activation is manual: we verify the transfer and record 30 days of Premium. This page shows the request status.",
    },
    {
      q: ar ? "هل الاشتراك بيتجدد تلقائياً؟" : "Does the subscription renew automatically?",
      a: ar
        ? "لأ. مفيش تجديد تلقائي ومفيش بطاقة بتتخزن. لما المدة تخلص بيرجع حسابك للخطة المجانية، وتقدر تبعت طلب جديد."
        : "No. There is no automatic renewal and no card is stored. When the period ends your account returns to the free plan, and you can submit a new request.",
    },
    {
      q: ar ? "إيه طرق الدفع المتاحة؟" : "Which payment methods are available?",
      a: hasPaymentChannel
        ? ar
          ? "التحويل البنكي أو المحفظة، حسب البيانات المنشورة في الصفحة. مفيش دفع بالبطاقة."
          : "Bank transfer or wallet, using the details published on this page. Card payment is not available."
        : ar
          ? "بيانات الدفع لسه مش منشورة. تقدر تبعت الطلب — مفيش أي مبلغ بيتحصّل قبل ما تظهر بيانات التحويل هنا."
          : "Payment details aren't published yet. You can submit a request — no money changes hands until transfer details appear here.",
    },
    {
      q: ar ? "إيه اللي بيحصل لبياناتي لو الاشتراك خلص؟" : "What happens to my data when Premium ends?",
      a: ar
        ? "حسابك وقوائمك ومحفظتك بتفضل محفوظة. الميزات المدفوعة بس هي اللي بتتقفل."
        : "Your account, lists and portfolio stay saved. Only the paid features lock.",
    },
    {
      q: ar ? "هل تحليل الذكاء الاصطناعي نصيحة استثمارية؟" : "Is the AI analysis investment advice?",
      a: ar
        ? "لأ — تفسير مساعد لأرقام منشورة. مش توصية ولا تنبؤ، ومفيش توصيات شراء أو بيع."
        : "No — it is assisted interpretation of published figures. Not a recommendation or a prediction, and we issue no buy or sell advice.",
    },
  ]

  return (
    <LayoutShell chrome="marketing">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        {/* Hero — promise first, no price yet. */}
        <div className="text-center">
          <Badge variant="outline" className="gap-1 border-border bg-card text-[11px] font-medium text-muted-foreground">
            <Crown className="h-3.5 w-3.5 text-primary" aria-hidden />
            {ar ? "بريميوم" : "Premium"}
          </Badge>
          <h1 className="mt-4 text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {ar ? "التقارير الكاملة، كل الأحداث، وتحليلات بلا حد شهري." : "Full reports, all company events, unlimited analysis."}
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {ar
              ? "باقة واحدة لمدة 30 يوماً. التفعيل يدوي بعد مراجعة الدفع — بدون بطاقة، وبدون تجديد تلقائي."
              : "One plan, 30 days. Activation is manual after payment verification — no card, no auto-renewal."}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground/80">{ar ? BRAND.trustLineAr : BRAND.trustLineEn}</p>
        </div>

        {/* Status card for members / requests / rejections. */}
        {activation === "active" ? (
          <Card className="mt-8 border-positive/30 bg-positive/5">
            <CardContent className="flex flex-col gap-2 p-5 text-sm sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-2">
                <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-positive" aria-hidden />
                <div>
                  <p className="font-semibold text-foreground">{ar ? "اشتراكك في Premium نشط" : "Your Premium plan is active"}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {formatDate(subscription?.startDate, ar) ? (
                      <>
                        {ar ? "بدأ في" : "Started"} {formatDate(subscription?.startDate, ar)}
                        {" · "}
                      </>
                    ) : null}
                    {ar ? "ينتهي في" : "Ends"} {formatDate(subscription?.endDate, ar) ?? "—"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/dashboard">{ar ? "ابدأ من لوحة التحكم" : "Go to the dashboard"}</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : activation === "pending" ? (
          <Card className="mt-8 border-warning/40 bg-warning/5">
            <CardContent className="flex items-start gap-2 p-5">
              <Hourglass className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
              <div>
                <p className="font-semibold text-foreground">{ar ? "تم استلام طلبك — في انتظار مراجعة الدفع" : "Request received — awaiting payment verification"}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {ar
                    ? "بنراجع التحويلات يدوياً. الـ 30 يوماً بتبدأ من تسجيل التفعيل، والصفحة دي هتعرض تاريخ الانتهاء. مفيش أي مبلغ بيتحصّل تلقائياً."
                    : "We verify transfers manually. Your 30 days start when the activation is recorded, and this card will show the end date. Nothing is charged automatically."}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : activation === "rejected" ? (
          <Card className="mt-8 border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-start gap-2 p-5">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
              <div>
                <p className="font-semibold text-foreground">{ar ? "تعذّر التحقق من الدفع" : "We could not verify a payment"}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {ar
                    ? "مفيش مبلغ اتأكد. لو حوّلت بالفعل، ابعت الطلب تاني وفريقنا هيراجعه من جديد."
                    : "No charge was recorded as confirmed. If you did transfer, submit the request again and the team will re-check it."}
                </p>
                <Button className="mt-3" size="sm" onClick={() => requestSub.mutate()} disabled={requestSub.isPending}>
                  {requestSub.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                  {ar ? "إعادة إرسال الطلب" : "Resubmit request"}
                </Button>
                {requestErrorCode ? (
                  <p role="alert" className="mt-2 text-xs text-destructive">
                    {requestError(requestErrorCode, ar)}
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* What Premium adds — verified benefits only. */}
        <section className="mt-10" aria-label={ar ? "ما يضيفه Premium" : "What Premium adds"}>
          <SectionHeading
            eyebrow={ar ? "مقارنة صريحة" : "An honest comparison"}
            title={ar ? "اللي بيضيفه Premium — فوق الخطة المجانية" : "What Premium adds — on top of Free"}
            description={
              ar
                ? "كل بند هنا مبني على ميزة موجودة فعلاً في المنصة، وبحدود واضحة للخطة المجانية."
                : "Every item below is a feature that actually exists, with the free-plan limit stated."
            }
          />
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {benefits.map((b) => (
              <li key={b.title} className="rounded-xl border border-border/70 bg-card p-4">
                <p className="flex items-start gap-2 text-sm font-medium text-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden />
                  {b.title}
                </p>
                <p className="mt-1.5 ps-6 text-xs leading-relaxed text-muted-foreground">{b.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* How activation works — the manual reality, stated before the CTA.
            Hidden while subscriptions are paused (there is no flow to explain). */}
        {!(settingsReady && !settings.enabled) && activation !== "active" ? (
        <section id="how-activation-works" className="mt-10 scroll-mt-24" aria-label={ar ? "كيف يتم التفعيل" : "How activation works"}>
          <SectionHeading
            eyebrow={ar ? "الخطوات" : "The steps"}
            title={ar ? "إزاي بيتم التفعيل" : "How activation works"}
            titleClassName="text-xl sm:text-2xl"
          />
          <ol className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              {
                n: "1",
                t: ar ? "تحويل المبلغ" : "Transfer the amount",
                d: hasPaymentChannel
                  ? ar
                    ? "استخدم بيانات الدفع المنشورة في الصفحة (تحويل بنكي أو محفظة)."
                    : "Use the payment details published on this page (bank transfer or wallet)."
                  : ar
                    ? "بيانات الدفع لسه مش منشورة — تقدر تبعت الطلب، ومفيش أي مبلغ بيتحصّل قبل ما تظهر."
                    : "Payment details aren't published yet — you can still submit a request, and nothing is charged before they appear.",
              },
              {
                n: "2",
                t: ar ? "ابعت الطلب" : "Submit the request",
                d: ar ? "من الصفحة دي أو من صفحة المحفظة — الطلب بيتسجّل باسم حسابك." : "From this page or the portfolio screen — the request is recorded on your account.",
              },
              {
                n: "3",
                t: ar ? "المراجعة والتفعيل" : "Review and activation",
                d: ar
                  ? "فريق Meza بيتحقق من التحويل وبيسجّل 30 يوماً. مفيش بطاقة بتتخزن، ومفيش تجديد تلقائي."
                  : "The Meza team verifies the transfer and records 30 days. No card is stored and nothing renews automatically.",
              },
            ].map((step) => (
              <li key={step.n} className="rounded-xl border border-border/70 bg-card p-4">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {step.n}
                </span>
                <p className="mt-2.5 text-sm font-medium text-foreground">{step.t}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.d}</p>
              </li>
            ))}
          </ol>
        </section>
        ) : null}

        {/* Price + CTA — price only after the settings resolve; no hardcoded fallback. */}
        {(settings.enabled || !settingsReady) && activation !== "active" && activation !== "pending" ? (
          <Card className="mt-10 border-border/70">
            <CardContent className="grid gap-5 p-6 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <p className="eyebrow">{ar ? "السعر والمدة" : "Price and period"}</p>
                {settingsLoading || !mounted ? (
                  <div className="mt-2 space-y-2" aria-busy="true" aria-live="polite">
                    <span className="sr-only">{ar ? "جارٍ تحميل السعر الحالي" : "Loading the current price"}</span>
                    <div className="h-7 w-56 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-72 animate-pulse rounded bg-muted" />
                  </div>
                ) : settingsError ? (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-foreground">{ar ? "تعذّر تحميل السعر الحالي" : "Couldn't load the current price"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ar
                        ? "بنعرض السعر من إعدادات الخطة الحالية — مش بنخمّن رقم. جرّب تاني أو راجع صفحة الحالة."
                        : "The price comes from the live plan settings — we don't guess a number. Retry, or check the status page."}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Button size="sm" variant="outline" onClick={() => refetchSettings()}>
                        {ar ? "إعادة المحاولة" : "Try again"}
                      </Button>
                      <Link href="/status" className="text-xs font-medium text-primary underline-offset-2 hover:underline">
                        {ar ? "حالة المنصة" : "Platform status"}
                      </Link>
                    </div>
                  </div>
                ) : !priceKnown || !durationKnown ? (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-foreground">{ar ? "السعر غير متاح حالياً" : "Price unavailable right now"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ar ? "إعدادات الخطة ناقصة — مش بنعرض سعر تقديري." : "The plan settings are incomplete — we don't show an estimated price."}
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="mt-1 num text-2xl font-semibold tracking-tight text-foreground">{priceLine}</p>
                    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" aria-hidden /> {ar ? "مفيش بطاقة بتتخزن" : "No card stored"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" aria-hidden /> {ar ? "مفيش تجديد تلقائي" : "No auto-renewal"}
                      </span>
                    </p>
                  </>
                )}
              </div>

              <div className="flex flex-col items-stretch gap-2 sm:items-end">
                {activation === "signed-out" ? (
                  <>
                    <Button asChild className="w-full sm:w-auto">
                      <Link href="/login?next=%2Fpremium">
                        {ar ? "سجّل الدخول لطلب Premium" : "Sign in to request Premium"}
                        <ArrowRight className="ms-1.5 h-4 w-4 rtl-flip" aria-hidden />
                      </Link>
                    </Button>
                    <Link href="/register?next=%2Fpremium" className="text-center text-[11px] text-muted-foreground underline-offset-2 hover:underline">
                      {ar ? "مفيش حساب؟ أنشئ حساب مجاني" : "No account? Create a free one"}
                    </Link>
                  </>
                ) : activation === "loading" ? (
                  <Button disabled className="w-full sm:w-auto">
                    <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
                    {ar ? "جارٍ التحقق…" : "Checking…"}
                  </Button>
                ) : activation === "none" ? (
                  <>
                    <Button className="w-full sm:w-auto" onClick={() => requestSub.mutate()} disabled={requestSub.isPending || !settingsReady || !priceKnown}>
                      {requestSub.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden /> : <Crown className="me-2 h-4 w-4" aria-hidden />}
                      {ar ? "اطلب Premium — 30 يوماً" : "Request Premium — 30 days"}
                    </Button>
                    {requestErrorCode ? (
                      <p role="alert" className="max-w-xs text-xs leading-relaxed text-destructive">
                        {requestError(requestErrorCode, ar)}
                        {requestErrorCode === "UNAUTHENTICATED" ? (
                          <>
                            {" "}
                            <Link href="/login?next=%2Fpremium" className="font-semibold underline underline-offset-2">
                              {ar ? "تسجيل الدخول" : "Sign in"}
                            </Link>
                          </>
                        ) : null}
                      </p>
                    ) : (
                      <p className="max-w-xs text-center text-[11px] leading-relaxed text-muted-foreground sm:text-end">
                        {ar
                          ? "الطلب بيتسجّل باسم حسابك، والتفعيل يدوي بعد التحقق من الدفع."
                          : "The request is recorded on your account; activation is manual after payment verification."}
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : activation === "active" || activation === "pending" ? null : (
          <Card className="mt-10 border-border/70 bg-muted/30">
            <CardContent className="flex items-start gap-2 p-5">
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-foreground">{ar ? "الاشتراكات متوقفة مؤقتاً" : "Subscriptions are paused right now"}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {ar
                    ? "طلبات Premium مش بتُقبل حالياً. تقدر تكمل استخدام الخطة المجانية بحرية، وشوف صفحة الحالة لأي تحديث."
                    : "We aren't accepting Premium requests right now. You can keep using the free plan, and the status page will show any update."}
                </p>
                <Link href="/status" className="mt-2 inline-block text-xs font-medium text-primary underline-offset-2 hover:underline">
                  {ar ? "حالة المنصة" : "Platform status"}
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Payment details — only when a channel is actually configured. */}
        {activation !== "active" && settingsReady && settings.enabled ? (
          <Card className="mt-6 border-border/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{ar ? "بيانات الدفع" : "Payment details"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              {hasPaymentChannel ? (
                <>
                  {settings.instructions ? (
                    <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">{settings.instructions}</p>
                  ) : null}
                  {settings.phone ? (
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">{ar ? "رقم التحويل:" : "Transfer number:"}</span>{" "}
                      <span className="tabular" dir="ltr">{settings.phone}</span>
                    </p>
                  ) : null}
                  {settings.whatsapp ? (
                    <Button size="sm" variant="outline" className="w-full gap-2 sm:w-auto" onClick={openWhatsApp}>
                      <MessageCircle className="h-4 w-4" aria-hidden />
                      {ar ? "فتح واتساب" : "Open WhatsApp"}
                    </Button>
                  ) : null}
                  <p className="leading-relaxed text-muted-foreground">
                    {ar
                      ? "بعد التحويل، ابعت طلب الاشتراك — الفريق بيتحقق من الدفع يدوياً وبعدها بيتم تسجيل 30 يوماً."
                      : "After transferring, submit the subscription request — the team verifies payment manually, then the 30 days are recorded."}
                  </p>
                </>
              ) : (
                <div className="space-y-2">
                  <p className="leading-relaxed text-muted-foreground">
                    {ar
                      ? "بيانات الدفع لسه مش منشورة. تقدر تبعت الطلب — مفيش أي مبلغ بيتحصّل قبل ما تظهر بيانات التحويل هنا وتأكد الدفع بنفسك."
                      : "Payment details aren't published yet. You can still submit a request — no money changes hands until transfer details appear here and you confirm a payment."}
                  </p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground/80">
                    {ar
                      ? "مش بننشر أرقام دفع تقديرية. لما تتوفر البيانات هتظهر في نفس المكان ده."
                      : "We don't publish placeholder payment numbers. When the details are available they'll appear here."}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* Capability matrix with the real limits. */}
        <section className="mt-10" aria-label={ar ? "خريطة الميزات" : "Capability map"}>
          <SectionHeading
            eyebrow={ar ? "خطة مقابل خطة" : "Plan vs plan"}
            title={ar ? "خريطة الميزات بحدودها الحقيقية" : "The capability map, with real limits"}
            titleClassName="text-xl sm:text-2xl"
          />
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border/70 bg-card p-5">
              <p className="text-sm font-semibold text-foreground">{ar ? "الحساب المجاني" : "Free account"}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{ar ? "بدون بطاقة — التصفح متاح حتى بدون حساب." : "No card — browsing works even without an account."}</p>
              <ul className="mt-3 space-y-2">
                {freeRows.map((row) => (
                  <li key={row} className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    {row}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/[0.04] p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Crown className="h-4 w-4 text-primary" aria-hidden />
                {ar ? "بريميوم — 30 يوماً" : "Premium — 30 days"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">{ar ? "كل اللي في المجاني، بالإضافة إلى:" : "Everything in Free, plus:"}</p>
              <ul className="mt-3 space-y-2">
                {premiumRows.map((row) => (
                  <li key={row} className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                    {row}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Always free — honesty about what does not need an account. */}
        <Card className="mt-6 border-border/70 bg-muted/20">
          <CardContent className="flex flex-col gap-2 p-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p className="leading-relaxed">
              <span className="font-medium text-foreground">{ar ? "دائماً مجاني وبدون حساب: " : "Always free, no account needed: "}</span>
              {ar
                ? "تصفح الشركات، القوائم المالية المنشورة، النسب، صفحات القطاعات، والمقارنة."
                : "browsing companies, published statements, ratios, sector pages and comparison."}
            </p>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href="/companies">{ar ? "ابدأ البحث" : "Start researching"}</Link>
            </Button>
          </CardContent>
        </Card>

        {/* Legal + trust row. */}
        <div className="mt-6 rounded-xl border border-border/70 px-5 py-4">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {ar
              ? "تفعيل لمرة واحدة لمدة 30 يوماً · مفيش بطاقة بتتخزن · مفيش تجديد تلقائي · الأرقام مش نصيحة استثمارية."
              : "One-time 30-day activation · no card stored · no automatic renewal · figures are not investment advice."}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <Link href="/terms" className="font-medium text-primary underline-offset-2 hover:underline">
              {ar ? "شروط الاستخدام" : "Terms"}
            </Link>
            <Link href="/disclaimer" className="font-medium text-primary underline-offset-2 hover:underline">
              {ar ? "تنبيه المخاطر" : "Risk notice"}
            </Link>
            <Link href="/privacy" className="font-medium text-primary underline-offset-2 hover:underline">
              {ar ? "الخصوصية" : "Privacy"}
            </Link>
            <span className="text-muted-foreground/70">{ar ? TRUST.source.ar : TRUST.source.en}: {ar ? TRUST.sourceFiling.ar : TRUST.sourceFiling.en} · {ar ? TRUST.delayed.ar : TRUST.delayed.en}</span>
          </p>
        </div>

        {/* Real FAQs only. */}
        <section className="mt-10" aria-label={ar ? "أسئلة متكررة" : "Frequently asked questions"}>
          <SectionHeading
            eyebrow={ar ? "أسئلة متكررة" : "FAQ"}
            title={ar ? "أسئلة بتفرق فعلاً" : "Questions that remove doubt"}
            titleClassName="text-xl sm:text-2xl"
          />
          <div className="mt-5 space-y-2">
            {faqs.map((f) => (
              <details key={f.q} className="group rounded-xl border border-border/70 bg-card px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-foreground marker:hidden">
                  {f.q}
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-transform group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <p className="mt-8 text-center text-[11px] text-muted-foreground/80">
          {ar ? BRAND.notAdviceAr : BRAND.notAdviceEn}
        </p>
      </div>
    </LayoutShell>
  )
}
