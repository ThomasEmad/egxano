"use client"

// Premium page — 3-plan pricing redesign (2026-11-13).
//
// The page sells exactly the 3 real plans from the single source of truth
// (src/lib/plans/entitlements.ts — المجانية / برو / برو بلس with the first-month
// 40% offer), so the marketing copy can never drift from what the app enforces:
//   • the catalog comes from GET /api/v1/plans with the PLANS constant as an
//     instant fallback (no loading flash, works offline of the API),
//   • the comparison table is DERIVED from the same PLANS limits,
//   • subscribing POSTs /api/v1/subscription/request { planId } and the server
//     decides the amount (first-month offer price when active).
// Payment is InstaPay only: the user transfers and writes their REGISTERED
// EMAIL in the transfer note — the admin matches the transfer. There is no
// other contact channel and no social-messaging CTA anywhere on this page.
//
// Hydration-safety gate preserved: React Query reports isLoading=false on the
// server but true on the client's first fetch — both server and first client
// render must agree, and the spinner/interactive state appears only after mount.

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
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
  Mail,
  QrCode,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { useI18n } from "@/lib/i18n"
import { getUserToken } from "@/lib/client/api"
import { PLANS, type PlanDef, type PlanId } from "@/lib/plans/entitlements"

type CatalogPlan = PlanDef

interface SubscribeResult {
  success: boolean
  status: string
  plan: { id: string; name: string; durationDays: number }
  amountToPay: number
  currency: string
}

const PLAN_ORDER: PlanId[] = ["FREE", "PRO", "PRO_PLUS"]

/** Numeric/string limit → Arabic display ("الكل" / "غير محدود" / count). */
function fmtRangeLimit(v: number | "ALL" | "UNLIMITED", allAr: string, unAr: string): string {
  if (v === "ALL") return allAr
  if (v === "UNLIMITED") return unAr
  return String(v)
}

/** Briefing entitlement → "تجربة يوم" (24h trial) or "بلا حدود". */
function fmtBriefing(hours: number | null): string {
  if (hours === null) return "بلا حدود"
  return hours >= 24 ? `تجربة ${hours / 24} يوم` : `تجربة ${hours} ساعة`
}

/** InstaPay QR with a hydration-safe broken-image fallback: the 404 error can
 *  fire before React attaches onError (SSR-rendered <img>), so completeness is
 *  also checked on mount. The real barcode is set by the admin via the
 *  INSTAPAY_QR_URL setting; until then a dashed placeholder renders. */
function InstaPayQr({ src, ar }: { src: string; ar: boolean }) {
  const [broken, setBroken] = useState(false)
  const ref = useRef<HTMLImageElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (el && el.complete && el.naturalWidth === 0) setBroken(true)
  }, [src])
  if (broken) {
    return (
      <div className="flex h-[132px] w-[132px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border/70 bg-muted/30 text-center">
        <QrCode className="h-6 w-6 text-muted-foreground/50" aria-hidden />
        <p className="px-2 text-[10px] leading-snug text-muted-foreground">
          {ar ? "باركود انستاباي — هيظهر هنا" : "InstaPay QR appears here"}
        </p>
      </div>
    )
  }
  return (
    <div className="shrink-0 rounded-xl border border-border/60 bg-white p-2 shadow-sm">
      <img
        ref={ref}
        src={src}
        alt={ar ? "باركود انستاباي للاشتراك" : "InstaPay QR for subscription"}
        width={132}
        height={132}
        className="h-[132px] w-[132px] object-contain"
        onError={() => setBroken(true)}
      />
    </div>
  )
}

export default function PremiumPage() {
  const { lang } = useI18n()
  const ar = lang === "ar"
  // Hydration-safety gate (see header comment) — the canonical isClient
  // pattern: server snapshot false, client true, no setState-in-effect.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  // ---------- data ----------
  const { data: settingsData } = useQuery({
    queryKey: ["public-settings"],
    queryFn: () => fetch("/api/v1/settings/public").then((r) => (r.ok ? r.json() : Promise.resolve({}))),
  })

  // Plans catalog: API first, PLANS constant as the instant fallback.
  const { data: plansData } = useQuery({
    queryKey: ["plans-catalog"],
    queryFn: () => fetch("/api/v1/plans").then((r) => (r.ok ? r.json() : Promise.resolve(null))),
    staleTime: 300_000,
  })
  const plans: CatalogPlan[] =
    (Array.isArray(plansData?.plans) && plansData.plans.length === 3 ? (plansData.plans as CatalogPlan[]) : null) ??
    PLAN_ORDER.map((id) => PLANS[id])

  const { data: subStatus, isLoading: subLoading } = useQuery({
    queryKey: ["my-subscription"],
    queryFn: () => {
      const token = getUserToken()
      if (!token) {
        return Promise.resolve({ isPremium: false, subscription: null, smartAnalysisUsage: null, plan: "FREE" })
      }
      return fetch("/api/v1/subscription/me", { headers: { "x-session-token": token } }).then((r) =>
        r.ok ? r.json() : Promise.resolve({ isPremium: false, subscription: null, smartAnalysisUsage: null, plan: "FREE" }),
      )
    },
    enabled: typeof window !== "undefined",
  })

  const qc = useQueryClient()
  const [successPanel, setSuccessPanel] = useState<SubscribeResult | null>(null)
  const requestSub = useMutation({
    mutationFn: async (planId: "PRO" | "PRO_PLUS"): Promise<SubscribeResult> => {
      const res = await fetch("/api/v1/subscription/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session-token": getUserToken() ?? "" },
        body: JSON.stringify({ planId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.message ?? body?.error ?? "تعذر إرسال طلب الاشتراك")
      return body as SubscribeResult
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["my-subscription"] })
      setSuccessPanel(data)
      if (typeof window !== "undefined") {
        document.getElementById("payment-steps")?.scrollIntoView({ behavior: "smooth", block: "start" })
      }
    },
  })

  // ---------- derived state ----------
  const authed = mounted && !!getUserToken()
  const settings = (settingsData ?? {}) as Record<string, unknown>
  const phone = typeof settings.PAYMENT_PHONE === "string" ? settings.PAYMENT_PHONE : ""
  // InstaPay is the only payment channel: the user scans the QR, transfers the
  // amount, and writes their REGISTERED EMAIL in the InstaPay note — the admin
  // matches the payment to the account from that note and activates.
  const instapayQr = typeof settings.INSTAPAY_QR_URL === "string" && settings.INSTAPAY_QR_URL.trim() !== "" ? settings.INSTAPAY_QR_URL.trim() : "/instapay-qr.png"
  const instructions = typeof settings.PAYMENT_INSTRUCTIONS === "string" ? settings.PAYMENT_INSTRUCTIONS : ""
  const subscription = subStatus?.subscription
  const isPremium = !!subStatus?.isPremium
  const status = subscription?.status
  const usage = subStatus?.smartAnalysisUsage ?? null
  const currentPlanName = typeof subStatus?.plan === "string" ? subStatus.plan : isPremium ? "PRO" : "FREE"

  const benefits = [
    { icon: Gauge, t: ar ? "مؤشر الصحة المالية" : "Financial Health Score", d: ar ? "درجة 0-100 من 5 محاور موثقة مع تفصيل بكل محور" : "0-100 score across 5 verified axes, each one explained" },
    { icon: Sparkles, t: ar ? "أطروحة استثمار بالـ AI" : "AI Investment Thesis", d: ar ? "قوة/ضعف/فرص/مخاطر من البيانات الموثقة فقط — بلا تأليف" : "Strengths, weaknesses, opportunities and risks — from verified data only" },
    { icon: Gem, t: ar ? "فرص التقييم القطاعي" : "Sector Valuation Screen", d: ar ? "الشركات الأقل من وسيط قطاعها في P/E و P/B" : "Companies below their sector median P/E & P/B" },
    { icon: FileCheck2, t: ar ? "أحدث النتائج المعلنة" : "Latest Announced Results", d: ar ? "آخر صافي ربح معلن لكل شركة — الأحدث أولاً" : "Most recent announced net profit per company — newest first" },
    { icon: BellRing, t: ar ? "أحداث استثمارية" : "Investment Events", d: ar ? "انقلاب أرباح، خفض دين، تحسن تدفق نقدي — مع الشرح" : "Profit turns, debt cuts, cash-flow improvements — with explanations" },
    { icon: Layers, t: ar ? "أرباع 2026 موثقة" : "Verified 2026 quarters", d: ar ? "قوائم ربعية بسلاسل زمنية كاملة لكل شركة" : "Quarterly statements with full time series per company" },
  ]

  // Comparison rows — derived from PLANS limits so table and enforcement stay in sync.
  const compareRows: { label: string; values: Record<PlanId, string | boolean> }[] = [
    {
      label: ar ? "شركات لوحة الإشارات الفنية" : "Signals board companies",
      values: {
        FREE: fmtRangeLimit(PLANS.FREE.limits.signalsRows, ar ? "الكل" : "All", ar ? "غير محدود" : "Unlimited"),
        PRO: fmtRangeLimit(PLANS.PRO.limits.signalsRows, ar ? "الكل" : "All", ar ? "غير محدود" : "Unlimited"),
        PRO_PLUS: fmtRangeLimit(PLANS.PRO_PLUS.limits.signalsRows, ar ? "الكل" : "All", ar ? "غير محدود" : "Unlimited"),
      },
    },
    {
      label: ar ? "التحليلات الذكية شهريًا" : "Smart Analyses / month",
      values: {
        FREE: fmtRangeLimit(PLANS.FREE.limits.smartAnalysesPerMonth, ar ? "الكل" : "All", ar ? "غير محدود" : "Unlimited"),
        PRO: fmtRangeLimit(PLANS.PRO.limits.smartAnalysesPerMonth, ar ? "الكل" : "All", ar ? "غير محدود" : "Unlimited"),
        PRO_PLUS: fmtRangeLimit(PLANS.PRO_PLUS.limits.smartAnalysesPerMonth, ar ? "الكل" : "All", ar ? "غير محدود" : "Unlimited"),
      },
    },
    {
      label: ar ? "البريفينج الصوتي" : "Audio briefing",
      values: {
        FREE: fmtBriefing(PLANS.FREE.limits.briefingTrialHours),
        PRO: fmtBriefing(PLANS.PRO.limits.briefingTrialHours),
        PRO_PLUS: fmtBriefing(PLANS.PRO_PLUS.limits.briefingTrialHours),
      },
    },
    { label: ar ? "أحداث الشركات" : "Company events", values: { FREE: PLANS.FREE.limits.events, PRO: PLANS.PRO.limits.events, PRO_PLUS: PLANS.PRO_PLUS.limits.events } },
    { label: ar ? "الماسحات المحفوظة" : "Saved scanners", values: { FREE: PLANS.FREE.limits.scanners, PRO: PLANS.PRO.limits.scanners, PRO_PLUS: PLANS.PRO_PLUS.limits.scanners } },
    { label: ar ? "تقرير PDF قابل للطباعة" : "Printable PDF report", values: { FREE: PLANS.FREE.limits.pdfReport, PRO: PLANS.PRO.limits.pdfReport, PRO_PLUS: PLANS.PRO_PLUS.limits.pdfReport } },
    { label: ar ? "الإعلانات" : "Ads", values: { FREE: PLANS.FREE.limits.ads, PRO: PLANS.PRO.limits.ads, PRO_PLUS: PLANS.PRO_PLUS.limits.ads } },
    {
      label: ar ? "الأسئلة الذكية يوميًا" : "Daily smart Q&A",
      values: { FREE: String(PLANS.FREE.limits.qaPerDay), PRO: String(PLANS.PRO.limits.qaPerDay), PRO_PLUS: String(PLANS.PRO_PLUS.limits.qaPerDay) },
    },
    {
      label: ar ? "تنبيهات الأسعار" : "Price alerts",
      values: {
        FREE: fmtRangeLimit(PLANS.FREE.limits.alerts, ar ? "الكل" : "All", ar ? "بلا حدود" : "Unlimited"),
        PRO: fmtRangeLimit(PLANS.PRO.limits.alerts, ar ? "الكل" : "All", ar ? "بلا حدود" : "Unlimited"),
        PRO_PLUS: fmtRangeLimit(PLANS.PRO_PLUS.limits.alerts, ar ? "الكل" : "All", ar ? "بلا حدود" : "Unlimited"),
      },
    },
  ]

  // ---------- status banner ----------
  const activePlanNameAr = PLANS[(subscription?.planName as PlanId)]?.nameAr ?? subscription?.planName
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
            {ar ? `أنت مشترك في باقة ${activePlanNameAr ?? ""}` : `You are subscribed (${subscription?.planName ?? ""})`}
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
        <p className="font-bold text-warning-foreground">{ar ? "طلبك قيد المراجعة" : "Your request is pending review"}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {ar
            ? "حوّل المبلغ على انستاباي (مع كتابة بريدك المسجّل في الملاحظة) — التفعيل بيتم بعد مطابقة الحوالة، عادة خلال ساعات قليلة."
            : "Transfer via InstaPay (with your registered email in the note) — activation happens once the transfer is matched, usually within hours."}
        </p>
      </div>
    )
  } else if (status === "REJECTED") {
    statusBlock = (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5">
        <p className="font-bold text-destructive">{ar ? "تم رفض الطلب" : "Your request was rejected"}</p>
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => requestSub.mutate(subscription?.planName === "PRO_PLUS" ? "PRO_PLUS" : "PRO")}
          disabled={requestSub.isPending}
        >
          {requestSub.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : ar ? "إعادة المحاولة" : "Try again"}
        </Button>
      </div>
    )
  }

  const canRequest = !isPremium && status !== "PENDING"

  // ---------- card CTA ----------
  function planCta(plan: CatalogPlan) {
    if (plan.id === "FREE") {
      if (!authed) {
        return (
          <Button asChild variant="outline" size="lg" className="w-full">
            <Link href="/register?next=/premium">{ar ? "ابدأ مجانًا" : "Start free"}</Link>
          </Button>
        )
      }
      return (
        <Button
          variant="outline"
          size="lg"
          className="w-full"
          onClick={() => document.getElementById("compare")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          {ar ? "ابدأ مجانًا" : "Start free"}
        </Button>
      )
    }
    const isCurrentPaid = authed && isPremium && status === "ACTIVE" && currentPlanName === plan.id
    if (isCurrentPaid) {
      return (
        <Button variant="outline" size="lg" className="w-full" disabled>
          <Check className="me-1.5 h-4 w-4 text-success" aria-hidden />
          {ar ? "باقتك الحالية" : "Your current plan"}
        </Button>
      )
    }
    if (!authed) {
      return (
        <div className="space-y-2">
          <Button asChild size="lg" className="w-full">
            <Link href="/register?next=/premium">{ar ? "سجّل واشترك" : "Sign up & subscribe"}</Link>
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            {ar ? "عندك حساب؟ " : "Already registered? "}
            <Link href="/login?next=/premium" className="font-semibold text-primary underline underline-offset-2">
              {ar ? "سجّل الدخول" : "Sign in"}
            </Link>
          </p>
        </div>
      )
    }
    return (
      <Button
        size="lg"
        className="w-full gap-2"
        onClick={() => requestSub.mutate(plan.id as "PRO" | "PRO_PLUS")}
        disabled={requestSub.isPending}
      >
        {requestSub.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeft className="h-4 w-4 rtl-flip" aria-hidden />}
        {ar ? `اشترك في ${plan.nameAr}` : `Subscribe to ${plan.nameEn}`}
      </Button>
    )
  }

  function priceBlock(plan: CatalogPlan) {
    if (plan.id === "FREE") {
      return (
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-extrabold tabular text-foreground" dir="ltr">
            {plan.price}
          </span>
          <span className="text-sm font-semibold text-muted-foreground">{ar ? "جنيه — دائمًا" : "EGP — always"}</span>
        </div>
      )
    }
    const offerOn = plan.offerActive && plan.offerPrice != null
    return (
      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-extrabold tabular text-foreground" dir="ltr">
            {offerOn ? plan.offerPrice : plan.price}
          </span>
          <span className="text-sm font-semibold text-muted-foreground">{ar ? "جنيه/شهر" : "EGP / month"}</span>
        </div>
        {offerOn ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground line-through tabular" dir="ltr">
              {plan.price}
            </span>
            <Badge variant="outline" className="border-success/40 bg-success/10 text-[10px] text-success">
              <Crown className="me-1 h-3 w-3" aria-hidden />
              {plan.offerLabelAr ?? (ar ? "أول شهر بخصم 40%" : "First month 40% off")}
            </Badge>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <LayoutShell showMobileNav={true}>
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        {/* ================= HERO ================= */}
        <section className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-6 sm:p-10">
          <div className="pointer-events-none absolute -top-16 -end-16 h-48 w-48 rounded-full bg-primary/20 blur-[70px]" aria-hidden />
          <div className="relative">
            <Badge variant="outline" className="border-gold/50 bg-gold/10 text-gold">
              <Crown className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {ar ? "باقات EGXANO" : "EGXANO plans"}
            </Badge>
            <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              {ar ? "بحث أعمق. قرارات أدق." : "Deeper research. Sharper decisions."}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              {ar
                ? "ثلاث باقات بسيطة: ابدأ مجانًا، وبعد كده افتح لوحة الإشارات الفنية كاملة والتحليلات الذكية بلا حد والبريفينج الصوتي وأحداث الشركات والماسحات — وبرو بلس بيضيف تقرير PDF القابل للطباعة."
                : "Three simple plans: start free, then unlock the full signals board, unlimited Smart Analyses, audio briefings, company events and scanners — Pro Plus adds the printable PDF report."}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
                {ar ? "أول شهر بخصم 40% على برو وبرو بلس" : "First month 40% off on Pro and Pro Plus"}
              </Badge>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
                {ar ? "تفعيل يدوي بعد مطابقة الحوالة — بدون اشتراك تلقائي وبلا تخزين بطاقات" : "Manually activated after the transfer is matched — no auto-renewal, no stored cards"}
              </div>
            </div>
          </div>
        </section>

        {/* ================= STATUS ================= */}
        {statusBlock ? <div className="mt-6">{statusBlock}</div> : null}

        {/* ================= FREE-TIER USAGE (visible counting) ================= */}
        {mounted && !subLoading && !isPremium && usage ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-4">
            <div>
              <p className="text-sm font-bold text-foreground">{ar ? "تحليلاتك الذكية هذا الشهر" : "Your Smart Analyses this month"}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {ar ? "كل تحليل جديد يُحسب — يتجدد الرصيد أول كل شهر." : "Every analysis counts — the window resets on the 1st of each month."}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-lg font-extrabold tabular text-foreground" dir="ltr">
                {usage.usageCount} / {usage.limit}
              </span>
              <div className="h-2 w-28 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, (usage.usageCount / Math.max(1, usage.limit)) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        ) : null}

        {/* ================= ERROR BANNER (subscribe failure) ================= */}
        {requestSub.isError ? (
          <div className="mt-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {requestSub.error instanceof Error ? requestSub.error.message : ar ? "تعذر إرسال طلب الاشتراك — حاول تاني." : "Could not submit the request — try again."}
          </div>
        ) : null}

        {/* ================= PRICING CARDS ================= */}
        <section className="mt-8">
          <h2 className="text-lg font-bold text-foreground">{ar ? "اختار باقتك" : "Choose your plan"}</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-3 lg:items-stretch">
            {plans.map((plan) => {
              const highlighted = plan.id === "PRO"
              const card = (
                <Card
                  className={
                    highlighted
                      ? "relative flex h-full flex-col border-primary/50 bg-gradient-to-br from-primary/8 via-card to-card shadow-md"
                      : "flex h-full flex-col border-border/60 bg-card"
                  }
                >
                  <CardContent className="flex h-full flex-col gap-4 p-5 sm:p-6">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-base font-bold text-foreground">{ar ? plan.nameAr : plan.nameEn}</p>
                      {highlighted ? (
                        <Badge className="bg-gradient-to-l from-primary to-gold text-primary-foreground shadow-sm">
                          <Crown className="me-1 h-3 w-3" aria-hidden />
                          {ar ? "الأكثر اختيارًا" : "Most popular"}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{plan.taglineAr}</p>
                    {priceBlock(plan)}
                    <ul className="mt-auto space-y-2 text-sm">
                      {plan.featuresAr.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-foreground/90">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="pt-2">{planCta(plan)}</div>
                  </CardContent>
                </Card>
              )
              // PRO gets the gradient border wrapper using brand tokens
              return highlighted ? (
                <div
                  key={plan.id}
                  className="rounded-2xl bg-gradient-to-br from-primary via-gold to-primary/40 p-[1.5px] shadow-sm"
                >
                  {card}
                </div>
              ) : (
                <div key={plan.id}>{card}</div>
              )
            })}
          </div>
        </section>

        {/* ================= SUCCESS / PAYMENT PANEL ================= */}
        {successPanel ? (
          <section id="payment-steps" className="mt-8 scroll-mt-20">
            <div className="rounded-2xl border border-success/40 bg-success/5 p-5 sm:p-6">
              <p className="flex items-center gap-2 text-base font-bold text-success">
                <ShieldCheck className="h-5 w-5" aria-hidden />
                {ar
                  ? `طلب اشتراكك في باقة ${PLANS[successPanel.plan.id as PlanId]?.nameAr ?? successPanel.plan.name} اتحط`
                  : `Your ${successPanel.plan.name} request is in`}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {ar ? "باقي خطوة واحدة: التحويل على انستاباي." : "One step left: transfer via InstaPay."}
              </p>
              <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
                <p className="text-sm font-bold text-foreground">
                  {ar ? "المبلغ المطلوب تحويله (أول شهر)" : "Amount to transfer (first month)"}
                </p>
                <p className="mt-1 text-2xl font-extrabold tabular text-foreground" dir="ltr">
                  {successPanel.amountToPay} <span className="text-sm font-semibold text-muted-foreground">{successPanel.currency === "EGP" && ar ? "جنيه" : successPanel.currency}</span>
                </p>
                {(() => {
                  const p = PLANS[successPanel.plan.id as PlanId]
                  return p && p.offerActive && p.offerPrice != null && successPanel.amountToPay === p.offerPrice ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ar ? `ده سعر أول شهر بعد خصم 40% — الشهور التالية ${p.price} جنيه.` : `First-month offer price — later months ${p.price} EGP.`}
                    </p>
                  ) : null
                })()}
              </div>

              <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
                <p className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <QrCode className="h-4 w-4 text-primary" aria-hidden />
                  {ar ? "الدفع عبر انستاباي InstaPay" : "Pay via InstaPay"}
                </p>
                <div className="mt-3 flex items-start gap-4">
                  <InstaPayQr src={instapayQr} ar={ar} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
                      <p className="flex items-start gap-2 text-xs font-bold leading-relaxed text-warning-foreground">
                        <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        {ar
                          ? "مهم: اكتب بريدك الإلكتروني المسجَّل في الموقع داخل خانة الملاحظة على انستاباي — به نطابق الدفع بحسابك ونفعّل اشتراكك."
                          : "Important: write your registered email in the InstaPay note field — we match your payment to your account with it and activate your subscription."}
                      </p>
                    </div>
                    {phone ? (
                      <div>
                        <p className="text-[11px] text-muted-foreground">{ar ? "عنوان الدفع (إن وجد)" : "Payment address (if any)"}</p>
                        <p className="mt-0.5 font-mono text-sm font-semibold tabular text-foreground" dir="ltr">
                          {phone}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {instructions ? (
                <div className="mt-4 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
                  <p className="whitespace-pre-wrap">{instructions}</p>
                </div>
              ) : null}

              <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
                {ar
                  ? "بعد التحويل، المشرف بيطابق الحوالة بالبريد المسجّل وبيفعّل اشتراكك — عادة خلال ساعات قليلة. تقدر تتابع حالة الطلب من هذه الصفحة."
                  : "After the transfer, the admin matches it to your registered email and activates your subscription — usually within hours. You can track the request status on this page."}
              </p>
            </div>
          </section>
        ) : null}

        {/* ================= BENEFITS ================= */}
        <section className="mt-8">
          <h2 className="text-lg font-bold text-foreground">{ar ? "ماذا تفتح الباقات المدفوعة؟" : "What the paid plans unlock"}</h2>
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

        {/* ================= COMPARISON TABLE ================= */}
        <section id="compare" className="mt-8 scroll-mt-20">
          <h2 className="text-lg font-bold text-foreground">{ar ? "مقارنة الباقات" : "Plan comparison"}</h2>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-border/60 bg-card">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="p-3 text-start font-semibold text-muted-foreground">{ar ? "الميزة" : "Feature"}</th>
                  {PLAN_ORDER.map((id) => (
                    <th
                      key={id}
                      className={
                        id === "PRO"
                          ? "bg-primary/5 p-3 text-center font-bold text-primary"
                          : "p-3 text-center font-semibold text-foreground"
                      }
                    >
                      {ar ? PLANS[id].nameAr : PLANS[id].nameEn}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row) => (
                  <tr key={row.label} className="border-b border-border/40 last:border-0">
                    <td className="p-3 text-start text-foreground/90">{row.label}</td>
                    {PLAN_ORDER.map((id) => {
                      const v = row.values[id]
                      return (
                        <td
                          key={id}
                          className={id === "PRO" ? "bg-primary/5 p-3 text-center" : "p-3 text-center text-muted-foreground"}
                        >
                          {typeof v === "boolean" ? (
                            v ? (
                              <span className="inline-flex items-center justify-center" aria-label={ar ? "نعم" : "yes"}>
                                <Check className="h-4 w-4 text-success" aria-hidden />
                              </span>
                            ) : (
                              <span className="inline-flex items-center justify-center" aria-label={ar ? "لا" : "no"}>
                                <X className="h-4 w-4 text-muted-foreground/50" aria-hidden />
                              </span>
                            )
                          ) : (
                            <span className="tabular" dir="auto">
                              {v}
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {ar
              ? "كل القيم في الجدول من نفس المصدر اللي المنصة بتفعّل به الحدود فعليًا — اللي تشوفه هو اللي بيشتغل."
              : "Every value in this table comes from the same source the platform enforces — what you see is what runs."}
          </p>
        </section>

        {/* ================= HOW TO SUBSCRIBE ================= */}
        {canRequest ? (
          <section className="mt-8">
            <h2 className="text-lg font-bold text-foreground">{ar ? "إزاي تشترك؟" : "How to subscribe"}</h2>
            <div className="mt-4 grid gap-4 lg:grid-cols-5">
              {/* Steps */}
              <div className="space-y-2 lg:col-span-2">
                {[
                  { n: 1, t: ar ? "اختار باقتك واضغط اشترك من كروت الأسعار فوق" : "Pick a plan and press subscribe above" },
                  { n: 2, t: ar ? "امسح باركود انستاباي وحوّل المبلغ اللي هيظهرلك بعد الطلب" : "Scan the InstaPay QR and transfer the amount shown after the request" },
                  { n: 3, t: ar ? "اكتب بريدك الإلكتروني في خانة الملاحظة (ملاحظة/Note) على انستاباي" : "Write your registered email in the InstaPay note field" },
                  { n: 4, t: ar ? "المشرف يطابق الحوالة بالبريد ويفعّل حسابك — عادة خلال ساعات قليلة" : "The admin matches the transfer to your email and activates — usually within hours" },
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

                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                    <p className="flex items-center gap-2 text-sm font-bold text-foreground">
                      <QrCode className="h-4 w-4 text-primary" aria-hidden />
                      {ar ? "الدفع عبر انستاباي InstaPay" : "Pay via InstaPay"}
                    </p>
                    <div className="mt-3 flex items-start gap-4">
                      {/* QR — admin-set via the INSTAPAY_QR_URL setting, or the
                          static /instapay-qr.png placeholder until the owner
                          drops the real barcode in. */}
                      <InstaPayQr src={instapayQr} ar={ar} />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
                          <p className="flex items-start gap-2 text-xs font-bold leading-relaxed text-warning-foreground">
                            <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                            {ar
                              ? "مهم: اكتب بريدك الإلكتروني المسجَّل في الموقع داخل خانة الملاحظة على انستاباي — به نطابق الدفع بحسابك ونفعّل اشتراكك."
                              : "Important: write your registered email in the InstaPay note field — we match your payment to your account with it and activate your subscription."}
                          </p>
                        </div>
                        {phone ? (
                          <div>
                            <p className="text-[11px] text-muted-foreground">{ar ? "عنوان الدفع (إن وجد)" : "Payment address (if any)"}</p>
                            <p className="mt-0.5 font-mono text-sm font-semibold tabular text-foreground" dir="ltr">
                              {phone}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {instructions ? (
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
                      <p className="whitespace-pre-wrap">{instructions}</p>
                    </div>
                  ) : null}

                  <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                    {ar
                      ? "اضغط «اشترك» على الباقة اللي تناسبك فوق — بعد الطلب هنبعتلك المبلغ المظبوط وخطوات التحويل هنا في نفس الصفحة."
                      : "Press subscribe on the plan above — the exact amount and transfer steps appear here on this page."}
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
