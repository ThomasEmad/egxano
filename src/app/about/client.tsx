"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Building2, FileCheck2, RefreshCw, ScanSearch, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { SectionHeading } from "@/components/brand/section-heading"
import { BRAND, TRUST } from "@/lib/brand"
import { useI18n } from "@/lib/i18n"

type DashStats = {
  stats?: { companies?: number; reports?: number; validValues?: number; events?: number }
}

export default function AboutPage() {
  const { lang } = useI18n()
  const ar = lang === "ar"

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/v1/dashboard")
      if (!res.ok) throw new Error("DASHBOARD_UNAVAILABLE")
      return (await res.json()) as DashStats
    },
    staleTime: 60_000,
    retry: 1,
  })

  const n = (v: number | undefined) => (typeof v === "number" ? v.toLocaleString("en-EG") : "—")
  const stats = [
    { icon: Building2, label: ar ? "شركات متتبعة" : "Companies tracked", value: n(data?.stats?.companies) },
    { icon: FileCheck2, label: ar ? "قوائم مالية" : "Financial statements", value: n(data?.stats?.reports) },
    { icon: Sparkles, label: ar ? "نقطة بيانات مالية" : "Financial data points", value: n(data?.stats?.validValues) },
    { icon: ScanSearch, label: ar ? "حدث مالي مكتشف" : "Detected events", value: n(data?.stats?.events) },
  ]
  const asOf = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString(ar ? "ar-EG-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit" }) : null

  return (
<<<<<<< HEAD
    <LayoutShell chrome="marketing">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow={ar ? "من نحن" : "About"}
          title={ar ? "منصة أبحاث مستقلة للبورصة المصرية" : "An independent Egyptian Exchange research platform"}
          description={
            ar
              ? "قوائم مالية منشورة، نسب محسوبة، سياق فني ومقارنات منضبطة — مع مصدر وتاريخ كل رقم، وتفسير قبل أي قرار."
              : "Published financial statements, calculated ratios, technical context and fair comparisons — with the source and date of every figure, and an explanation before any decision."
          }
        />

        <p className="mt-5 rounded-xl border border-primary/25 bg-primary/[0.04] px-4 py-3 text-sm leading-relaxed text-foreground">
          <span className="font-semibold">{ar ? "استقلال المنصة. " : "Independence. "}</span>
          {ar
            ? "Meza منصة مستقلة: مش تابعة للبورصة المصرية ولا لأي وسيط أو شركة مُصدِرة، ومش بنقدّم توصيات شراء أو بيع."
            : "Meza is independent: we are not affiliated with the Egyptian Exchange, any broker or any issuer, and we do not issue buy or sell recommendations."}
        </p>
=======
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Gauge className="h-4 w-4" />
            </span>
            <span className="text-sm font-bold">EGXANO</span>
          </Link>
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="h-8 text-xs">
              {ar ? "لوحة التحكم" : "Dashboard"}
            </Button>
          </Link>
        </div>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{ar ? "من نحن" : "About"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {ar ? "منصة إيجيكسّانو" : "EGXANO platform"}
          </p>
        </div>
>>>>>>> b110dc6d46bae06b6754fc83151c5421ad4d72a3

        <section className="mt-10" aria-label={ar ? "كيف نتعامل مع البيانات" : "How we handle data"}>
          <SectionHeading
            eyebrow={ar ? "البيانات" : "The data"}
            title={ar ? "من الإفصاح المنشور إلى الرقم اللي بتشوفه" : "From the published filing to the figure you see"}
            titleClassName="text-xl sm:text-2xl"
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              {
                t: ar ? "المصدر: الإفصاح المالي المنشور" : "Source: the published filing",
                d: ar
                  ? "الأرقام بتتجمع من القوائم المالية المعلنة للشركات، وبتتوحّد وحداتها وبتُفحص حسابياً قبل العرض."
                  : "Figures are collected from companies' published statements, unit-normalised and arithmetically checked before display.",
              },
              {
                t: ar ? "القيم غير المتاحة تظهر «—»" : "Missing values show “—”",
                d: ar
                  ? "لو القيمة مش منشورة أو مش متوفرة، بتظهر غير متاحة — مش صفر، ومش تقدير."
                  : "If a value isn't published or available, it is shown as unavailable — not zero and not an estimate.",
              },
              {
                t: ar ? "محسوب مقابل كما ورد" : "Calculated vs reported",
                d: ar
                  ? "بنفرّق بين القيمة اللي وردت في القائمة والقيمة اللي حسبناها بنفسنا، وبنوضّح طريقة الحساب في صفحة الشركة."
                  : "We distinguish a value as reported from one we calculated, and the formula is explained on the company page.",
              },
              {
                t: ar ? "أسعار السوق متأخرة 15 دقيقة" : "Market prices are delayed 15 minutes",
                d: ar
                  ? "أسعار السوق بتيجي من مصدر عام متأخر — مش أسعار لحظية، وبنقول ده جانب كل رقم سعري."
                  : "Market prices come from a public delayed source — not live quotes — and we label that next to price figures.",
              },
              {
                t: ar ? "تحليل الذكاء الاصطناعي تفسير" : "AI analysis is interpretation",
                d: ar
                  ? "التعليق المولَّد بالذكاء الاصطناعي بيفسّر أرقام منشورة معروضة — مش توصية ولا تنبؤ."
                  : "AI-generated commentary interprets the published figures shown — not advice and not a prediction.",
              },
              {
                t: ar ? "أدوات بحث، مش وسيط" : "Research tools, not a broker",
                d: ar
                  ? "مفيش تنفيذ أوامر أو حسابات تداول داخل المنصة — الأدوات للفهم والمراجعة قبل القرار."
                  : "There is no order execution or trading account inside Meza — the tools are for understanding and reviewing before a decision.",
              },
            ].map((item) => (
              <div key={item.t} className="rounded-xl border border-border/70 bg-card p-4">
                <p className="flex items-start gap-2 text-sm font-medium text-foreground">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  {item.t}
                </p>
                <p className="mt-1.5 ps-6 text-xs leading-relaxed text-muted-foreground">{item.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10" aria-label={ar ? "أرقام المنصة" : "Platform numbers"}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionHeading
              eyebrow={ar ? "الآن" : "Right now"}
              title={ar ? "أرقام المنصة" : "Platform numbers"}
              titleClassName="text-xl sm:text-2xl"
            />
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {isLoading ? (
                <span className="inline-flex items-center gap-1">
                  <RefreshCw className="h-3 w-3 animate-spin" aria-hidden />
                  {ar ? "جارٍ التحميل" : "Loading"}
                </span>
              ) : isError ? (
                <span className="inline-flex items-center gap-1 text-warning">
                  <TriangleAlert className="h-3 w-3" aria-hidden />
                  {ar ? "تعذّر تحميل الأرقام" : "Couldn't load the numbers"}
                </span>
              ) : (
                <span>
                  {ar ? "آخر تحديث للعرض" : "View refreshed"}: {asOf ?? "—"}
                </span>
              )}
              <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} aria-hidden />
                {ar ? "تحديث" : "Refresh"}
              </Button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map((s) => {
              const Icon = s.icon
              return (
                <Card key={s.label} className="border-border/70 p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span className="leading-tight">{s.label}</span>
                  </div>
                  {isLoading ? (
                    <div className="mt-2.5 h-7 w-16 animate-pulse rounded bg-muted" aria-hidden />
                  ) : (
                    <p className="num mt-2.5 text-2xl font-semibold tracking-tight">{isError ? "—" : s.value}</p>
                  )}
                </Card>
              )
            })}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {ar
              ? "«—» تعني أن الإحصائية غير متاحة مؤقتاً — وليست صفراً. الأرقام دي من نفس قاعدة البيانات اللي بتعرضها صفحة الشركة."
              : "“—” means the statistic is temporarily unavailable — it is not zero. These figures come from the same database the company pages display."}
          </p>
        </section>

        <section className="mt-10" aria-label={ar ? "روابط مفيدة" : "Useful links"}>
          <div className="rounded-xl border border-border/70 p-5">
            <p className="text-sm font-medium text-foreground">{ar ? "ابدأ أو تحقق بنفسك" : "Start, or verify for yourself"}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
              <Link href="/companies" className="font-medium text-primary underline-offset-2 hover:underline">
                {ar ? "تصفح الشركات" : "Browse companies"}
              </Link>
              <Link href="/status" className="font-medium text-primary underline-offset-2 hover:underline">
                {ar ? "حالة المنصة وحداثة البيانات" : "Platform status and data freshness"}
              </Link>
              <Link href="/status" className="font-medium text-primary underline-offset-2 hover:underline">
                {ar ? "واجهة الحالة (/api/v1/status)" : "Status API (/api/v1/status)"}
              </Link>
              <Link href="/disclaimer" className="font-medium text-primary underline-offset-2 hover:underline">
                {ar ? "تنبيه المخاطر" : "Risk notice"}
              </Link>
              <Link href="/premium" className="font-medium text-primary underline-offset-2 hover:underline">
                {ar ? "الاشتراك" : "Premium"}
              </Link>
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
              {ar ? BRAND.trustLineAr : BRAND.trustLineEn} · {ar ? BRAND.notAdviceAr : BRAND.notAdviceEn}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground/70">
              {ar ? TRUST.source.ar : TRUST.source.en}: {ar ? TRUST.sourceFiling.ar : TRUST.sourceFiling.en}
            </p>
          </div>
        </section>
      </div>
    </LayoutShell>
  )
}
