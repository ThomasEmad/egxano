"use client"

import Link from "next/link"
import { ShieldAlert } from "lucide-react"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { useI18n } from "@/lib/i18n"
import { TRUST } from "@/lib/brand"

export default function DisclaimerClient() {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const updated = ar ? "آخر تحديث: 9 نوفمبر 2026" : "Last updated: 9 November 2026"

  const sections: { h: string; p: string }[] = ar
    ? [
        {
          h: "1. الغرض",
          p: "Meza أداة بحث ومعلومات للبورصة المصرية. المحتوى على الموقع — بما فيه القوائم المالية والنسب والترتيب والتحليلات والتعليقات — لأغراض معلوماتية فقط. لا يعتبر أي جزء منه نصيحة استثمارية، ولا عرضاً أو طلباً لشراء أو بيع أي أوراق مالية.",
        },
        {
          h: "2. المصادر",
          p: "القوائم المالية والأرقام المعلنة بتتجمع من الإفصاحات المنشورة للشركات. أسعار السوق بتيجي من مصدر أسعار عام متأخر. بنوضّح المصدر جان كل رقم، والأرقام اللي مش منشورة بتظهر كغير متاحة.",
        },
        {
          h: "3. الأسعار متأخرة",
          p: "الأسعار المعروضة متأخرة 15 دقيقة من مصدر عام، وليست أسعاراً لحظية. لا تستخدمها لاتخاذ قرار تنفيذي فوري — راجع مصدر التداول الرسمي قبل أي أمر.",
        },
        {
          h: "4. محسوب مقابل كما ورد",
          p: "في المنصة قيم كما وردت في القوائم، وقيم محسوبة (زي P/E وROE). القيم المحسوبة مبنية على صيغ معلنة وممكن تختلف عن حساب جهة أخرى لو اختلفت طريقة الحساب أو الفترة. بنوضّح الفرق في صفحة الشركة.",
        },
        {
          h: "5. القيم غير المتاحة",
          p: "لو القيمة مش منشورة أو مش متوفرة، بتظهر «—». «—» معناها غير متاح — مش صفر، ومش تقدير، ومش قيمة مفترضة.",
        },
        {
          h: "6. التحليل بالذكاء الاصطناعي",
          p: "بعض الصفحات فيها تعليق مُولَّد بالذكاء الاصطناعي. التعليق ده بيفسّر الأرقام المنشورة المعروضة في نفس الصفحة، وهو تفسير مساعد — مش نصيحة ولا تنبؤ ولا توصية، وممكن يحتوي على أخطاء في الصياغة. راجع الأرقام المصدرية بنفسك.",
        },
        {
          h: "7. مفيش توصيات",
          p: "Meza مش بيصدر توصيات شراء أو بيع، ومش بيحدد أهدافاً سعرية بصفة توصية. أي إشارة فنية أو تقييم معروض هو وصف للبيانات وقت حسابها، مش دعوة لتنفيذ صفقة.",
        },
        {
          h: "8. مسؤولية القرار",
          p: "المستخدم هو المسؤول الوحيد عن قراراته الاستثمارية. استشر مستشاراً مالياً مرخصاً قبل أي قرار. الاستثمار في البورصة ينطوي على مخاطر خسارة رأس المال.",
        },
        {
          h: "9. حدود الضمان",
          p: "البيانات مصدرها إفصاحات عامة ومصدر أسعار عام، وممكن تحتوي على أخطاء أو تأخير أو نقص. لا نضمن دقة أو اكتمال أو ملاءمة أي بيانات أو تحليل. لا نتحمل مسؤولية أي خسائر تنتج عن استخدام الموقع أو الاعتماد على محتواه، بالقدر اللي يسمح به القانون.",
        },
        {
          h: "10. الاستقلال",
          p: "Meza منصة مستقلة وغير تابعة للبورصة المصرية أو أي وسيط أو شركة مُصدِرة، ولا تمثلها.",
        },
      ]
    : [
        {
          h: "1. Purpose",
          p: "Meza is a research and information tool for the Egyptian stock market. Everything on the site — financial statements, ratios, rankings, analyses and commentary — is informational only. Nothing here is investment advice, or an offer or solicitation to buy or sell any security.",
        },
        {
          h: "2. Sources",
          p: "Financial statements and reported figures are collected from companies' published filings. Market prices come from a public delayed market source. The source is shown next to each figure, and figures that are not published show as unavailable.",
        },
        {
          h: "3. Prices are delayed",
          p: "Prices shown are delayed by 15 minutes from a public source and are not live quotes. Do not use them for immediate execution decisions — check the official trading source before any order.",
        },
        {
          h: "4. Calculated vs reported",
          p: "The platform shows values as reported in filings and values calculated by Meza (such as P/E and ROE). Calculated values use published formulas and may differ from another provider's if the formula or period differs. The difference is explained on the company page.",
        },
        {
          h: "5. Unavailable values",
          p: "When a value is not published or not available, it shows as “—”. “—” means unavailable — not zero, not an estimate, and not an assumed value.",
        },
        {
          h: "6. AI-assisted analysis",
          p: "Some pages include AI-generated commentary. That commentary interprets the published figures shown on the same page. It is assisted interpretation — not advice, not a prediction, and not a recommendation, and its wording may contain mistakes. Verify the source figures yourself.",
        },
        {
          h: "7. No recommendations",
          p: "Meza does not issue buy or sell recommendations and does not publish price targets as recommendations. Any technical signal or valuation shown describes the data at the time it was calculated; it is not a call to trade.",
        },
        {
          h: "8. Responsibility for decisions",
          p: "You are solely responsible for your investment decisions. Consult a licensed financial advisor before any decision. Investing in the stock market carries the risk of losing capital.",
        },
        {
          h: "9. Limits of warranty",
          p: "Data comes from public disclosures and a public price source, and may contain errors, delays or omissions. We do not guarantee the accuracy, completeness or suitability of any data or analysis. We are not liable for any losses arising from use of the site or reliance on its content, to the extent permitted by law.",
        },
        {
          h: "10. Independence",
          p: "Meza is independent and is not affiliated with, or acting on behalf of, the Egyptian Exchange, any broker or any issuer.",
        },
      ]

  return (
    <LayoutShell chrome="marketing">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-warning/30 bg-warning/5 text-warning">
            <ShieldAlert className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{ar ? "تنبيه المخاطر وإخلاء المسؤولية" : "Risk notice and disclaimer"}</h1>
            <p className="mt-1 text-xs text-muted-foreground">{updated}</p>
          </div>
        </div>

        <div className="mt-6 space-y-5">
          {sections.map((s) => (
            <section key={s.h} className="space-y-1.5">
              <h2 className="text-sm font-semibold text-foreground">{s.h}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{s.p}</p>
            </section>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-border/70 p-4 text-xs leading-relaxed text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">{ar ? TRUST.source.ar : TRUST.source.en}:</span>{" "}
            {ar ? TRUST.sourceFiling.ar : TRUST.sourceFiling.en} · {ar ? TRUST.delayed.ar : TRUST.delayed.en} ·{" "}
            {ar ? TRUST.aiInterpretation.ar : TRUST.aiInterpretation.en}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
            <Link href="/about" className="font-medium text-primary underline-offset-2 hover:underline">
              {ar ? "من نحن" : "About Meza"}
            </Link>
            <Link href="/status" className="font-medium text-primary underline-offset-2 hover:underline">
              {ar ? "حالة المنصة وحداثة البيانات" : "Platform status and data freshness"}
            </Link>
            <Link href="/terms" className="font-medium text-primary underline-offset-2 hover:underline">
              {ar ? "شروط الاستخدام" : "Terms of Service"}
            </Link>
            <Link href="/privacy" className="font-medium text-primary underline-offset-2 hover:underline">
              {ar ? "سياسة الخصوصية" : "Privacy Policy"}
            </Link>
            <Link href="/premium" className="font-medium text-primary underline-offset-2 hover:underline">
              {ar ? "الاشتراك" : "Premium"}
            </Link>
          </div>
        </div>
      </div>
    </LayoutShell>
  )
}
