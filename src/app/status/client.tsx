"use client"

import Link from "next/link"
import { Activity, Building2, FileText, Info, LineChart, RefreshCw, Sparkles, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { BRAND, TRUST } from "@/lib/brand"
import { useI18n } from "@/lib/i18n"

export interface StatusPayload {
  status: string
  time: string
  market: { pricesAsOf: string | null; delayMinutes: number | null; trackedPrices: number | null }
  data: {
    companiesTotal: number
    companiesActive: number
    financialReports: number
    marketPricePoints: number
    aiAnalyses: number
    latestReportImportedAt: string | null
  }
  usage?: { activePriceAlerts: number }
}

function fmtDate(value: string | null | undefined, ar: boolean): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" })
}

function fmtTime(value: string | null | undefined, ar: boolean): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleTimeString(ar ? "ar-EG-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit" })
}

function fmtCount(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-EG") : "—"
}

export function StatusView({ data }: { data: StatusPayload | null }) {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const loaded = data !== null

  const cards = [
    {
      icon: Building2,
      label: ar ? "الشركات المغطاة" : "Companies covered",
      value: loaded ? `${fmtCount(data.data.companiesActive)} / ${fmtCount(data.data.companiesTotal)}` : "—",
      hint: ar ? "شركات عليها بيانات حالية" : "companies with current data",
    },
    {
      icon: FileText,
      label: ar ? "القوائم المالية المستوردة" : "Financial statements imported",
      value: loaded ? fmtCount(data.data.financialReports) : "—",
      hint: ar ? "قوائم منشورة تم تحليلها" : "published statements processed",
    },
    {
      icon: LineChart,
      label: ar ? "نقاط الأسعار المسجّلة" : "Recorded price points",
      value: loaded ? fmtCount(data.data.marketPricePoints) : "—",
      hint: ar ? "أسعار سوق مسجّلة (متأخرة)" : "recorded market prices (delayed)",
    },
    {
      icon: Sparkles,
      label: ar ? "تحليلات ذكية محفوظة" : "Cached AI analyses",
      value: loaded ? fmtCount(data.data.aiAnalyses) : "—",
      hint: ar ? "تحليل محفوظ — تفسير مساعد" : "stored analysis — assisted interpretation",
    },
  ]

  const missingCompanies = loaded ? Math.max(0, data.data.companiesTotal - data.data.companiesActive) : null

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card">
          <Activity className={`h-5 w-5 ${loaded ? "text-positive" : "text-warning"}`} aria-hidden />
        </span>
        <h1 className="mt-3 text-xl font-semibold tracking-tight">{ar ? "حالة المنصة وحداثة البيانات" : "Platform status and data freshness"}</h1>
        <div className="mt-2 flex justify-center">
          {loaded ? (
            <Badge variant="outline" className="gap-1.5 border-positive/40 bg-positive/5 text-positive">
              <span className="h-1.5 w-1.5 rounded-full bg-positive" aria-hidden />
              {ar ? "بيانات الحالة متاحة" : "Status data available"}
              {data.time ? <span className="font-normal text-muted-foreground">· {ar ? "آخر فحص" : "checked"} {fmtTime(data.time, ar)}</span> : null}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1.5 border-warning/40 bg-warning/5 text-warning">
              <TriangleAlert className="h-3 w-3" aria-hidden />
              {ar ? "بيانات الحالة غير متاحة" : "Status data unavailable"}
            </Badge>
          )}
        </div>
        <p className="mx-auto mt-3 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {ar
            ? "الصفحة دي بتعرض اللي المنصة قادرة تقرأه فعلاً الآن — تغطية البيانات وحداثة الأسعار. مش ادعاء تسويقي عن الاستمرارية."
            : "This page reports what the platform can actually read right now — data coverage and price freshness. It is not a marketing uptime claim."}
        </p>
      </div>

      {!loaded ? (
        <Card className="mt-6 border-warning/40 bg-warning/5">
          <div className="flex flex-col items-start gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {ar ? "تعذّر قراءة تغذية الحالة" : "We couldn't read the status feed"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {ar
                    ? "ده مش معناه إن كل حاجة شغالة. القيم تحت هتظهر «—» لحد ما القراءة تنجح — «—» مش صفر."
                    : "This is not a statement that everything is fine. Values below show “—” until the read succeeds — “—” is not zero."}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Link href="/status" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted">
                <RefreshCw className="h-3 w-3" aria-hidden />
                {ar ? "إعادة الفحص" : "Check again"}
              </Link>
              <a href="/api/v1/status" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-2 hover:underline">
                {ar ? "التغذية الخام" : "Raw feed"}
              </a>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon
          return (
            <Card key={c.label} className="border-border/70 p-4">
              <Icon className="mb-2 h-4 w-4 text-muted-foreground" aria-hidden />
              <p className="num text-lg font-semibold tracking-tight">{c.value}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{c.label}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground/70">{c.hint}</p>
            </Card>
          )
        })}
      </div>

      {loaded && missingCompanies !== null ? (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {ar
            ? missingCompanies > 0
              ? `${missingCompanies} شركة مالهاش بيانات حالية وبتظهر كغير متاحة — مش كصفر.`
              : "كل الشركات المتتبعة عندها بيانات حالية."
            : missingCompanies > 0
              ? `${missingCompanies} companies have no current data and show as unavailable — not as zero.`
              : "Every tracked company has current data."}
        </p>
      ) : null}

      <section className="mt-8" aria-label={ar ? "حداثة البيانات" : "Data freshness"}>
        <Card className="border-border/70 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <RefreshCw className="h-4 w-4 text-muted-foreground" aria-hidden />
            {ar ? "حداثة البيانات" : "Data freshness"}
          </h2>
          <dl className="mt-3 space-y-2 text-xs">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
              <dt className="text-muted-foreground">{ar ? "آخر تسعيرة سوق مسجّلة" : "Latest recorded market price"}</dt>
              <dd className="tabular-nums">{loaded ? fmtDate(data.market.pricesAsOf, ar) : "—"}</dd>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
              <dt className="text-muted-foreground">{ar ? "تأخير السعر المعروض" : "Price delay shown"}</dt>
              <dd>{loaded && data.market.delayMinutes != null ? `${data.market.delayMinutes} ${ar ? "دقيقة" : "min"}` : "—"}</dd>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
              <dt className="text-muted-foreground">{ar ? "أحدث قائمة مستوردة" : "Latest statement imported"}</dt>
              <dd className="tabular-nums">{loaded ? fmtDate(data.data.latestReportImportedAt, ar) : "—"}</dd>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
              <dt className="text-muted-foreground">{ar ? "وقت فحص الحالة" : "Status checked at"}</dt>
              <dd className="tabular-nums">{loaded ? fmtDate(data.time, ar) : "—"}</dd>
            </div>
          </dl>
        </Card>
      </section>

      <section className="mt-4" aria-label={ar ? "ما تفحصه الصفحة" : "What this page checks"}>
        <Card className="border-border/70 p-5">
          <h2 className="text-sm font-semibold text-foreground">{ar ? "إيه اللي بتفحصه الصفحة دي" : "What this page checks"}</h2>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <li>{ar ? "• تغطية القوائم المالية المنشورة لكل شركة متتبعة." : "• Published-statement coverage for each tracked company."}</li>
            <li>{ar ? "• وقت آخر إفصاح مالي تم استيراده." : "• When the latest financial statement was imported."}</li>
            <li>{ar ? "• آخر سعر سوق مسجّل والتأخير المعلن عنه." : "• The latest recorded market price and its published delay."}</li>
            <li>{ar ? "• إمكانية قراءة تغذية الحالة نفسها (البطاقة فوق)." : "• Whether the status feed itself could be read (badge above)."}</li>
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/80">
            {ar
              ? "مبنقولش «uptime 100%» ومش بنعرض سجلات حوادث لسه — البيانات معروضة زي ما هي. لو في حاجة ناقصة بتظهر «—»."
              : "We don't claim a 100% uptime number and we don't publish an incident log yet — the data is shown as it is. Anything missing shows “—.”"}
          </p>
        </Card>
      </section>

      <section className="mt-4" aria-label={ar ? "المصادر والحدود" : "Sources and limits"}>
        <Card className="border-border/70 p-5 text-xs leading-relaxed text-muted-foreground">
          <p className="text-sm font-semibold text-foreground">{ar ? "المصادر والحدود" : "Sources and limits"}</p>
          <p className="mt-2">
            <span className="font-medium text-foreground">{ar ? TRUST.source.ar : TRUST.source.en}:</span>{" "}
            {ar ? TRUST.sourceFiling.ar : TRUST.sourceFiling.en} {ar ? "للقوائم المالية، ومصدر أسعار سوق عام متأخر للأسعار." : "for financial statements, and a public delayed market source for prices."}
          </p>
          <p className="mt-1.5">
            {ar
              ? "الأسعار متأخرة 15 دقيقة من مصدر عام، ومش أسعار لحظية. القيم غير المتاحة تظهر «—» ولا تُقدَّر. الأرقام مش نصيحة استثمارية."
              : "Prices are delayed 15 minutes from a public source, not live quotes. Unavailable values show “—” and are never estimated. Figures are not investment advice."}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
            <a href="/api/v1/status" className="font-medium text-primary underline-offset-2 hover:underline">/api/v1/status</a>
            <a href="/api/v1/companies/export" className="font-medium text-primary underline-offset-2 hover:underline">{ar ? "تصدير CSV" : "CSV export"}</a>
            <Link href="/companies" className="font-medium text-primary underline-offset-2 hover:underline">{ar ? "تصفح الشركات" : "Browse companies"}</Link>
            <Link href="/about" className="font-medium text-primary underline-offset-2 hover:underline">{ar ? "من نحن" : "About"}</Link>
            <Link href="/disclaimer" className="font-medium text-primary underline-offset-2 hover:underline">{ar ? "تنبيه المخاطر" : "Risk notice"}</Link>
          </div>
        </Card>
      </section>

      <p className="mt-6 text-center text-[11px] text-muted-foreground/70">
        {ar ? BRAND.trustLineAr : BRAND.trustLineEn}
      </p>

    </div>
  )
}
