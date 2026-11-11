"use client"

import Link from "next/link"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { useI18n } from "@/lib/i18n"
import { BRAND } from "@/lib/brand"

export default function TermsClient() {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const updated = ar ? "آخر تحديث: 9 نوفمبر 2026" : "Last updated: 9 November 2026"

  const sections: { h: string; p: string }[] = ar
    ? [
        {
          h: "1. قبول الشروط",
          p: "باستخدامك Meza أو إنشاء حساب، أنت توافق على الشروط دي. لو مش موافق، ما تستخدمش الخدمة. الشروط بتنطبق على التصفح والبحث وأي حساب بتفتحه.",
        },
        {
          h: "2. الخدمة",
          p: "Meza منصة بحث ومعلومات للبورصة المصرية: قوائم مالية منشورة، نسب محسوبة، مقارنات، ترتيب، سياق فني، وأدوات بحث. Meza مش وسيط ولا منصة تنفيذ أوامر، ومفيش حسابات تداول أو تحويل أموال للبورصة من خلالها.",
        },
        {
          h: "3. الحساب",
          p: "لازم تكون 18 سنة على الأقل. أنت مسؤول عن صحة بيانات حسابك وعن الحفاظ على كلمة المرور، وعن كل نشاط بيحصل من حسابك. بلّغنا فوراً لو حصل استخدام غير مصرح به. ممكن نعلّق أو نوقف حساباً في حالة إساءة الاستخدام أو محاولة تجاوز ضوابط الوصول.",
        },
        {
          h: "4. البيانات وحدودها",
          p: "بيانات القوائم المالية مصدرها الإفصاحات المنشورة للشركات، وأسعار السوق مصدرها مصدر أسعار عام متأخر 15 دقيقة. البيانات ممكن تحتوي على أخطاء أو تأخير أو نقص، والقيم غير المتاحة تظهر «—» ولا تُقدَّر. التفاصيل الكاملة في تنبيه المخاطر.",
        },
        {
          h: "5. الخصوصية",
          p: "بنعالج بيانات الحساب والاستخدام حسب سياسة الخصوصية المنشورة على الموقع. سياسة الخصوصية جزء من الشروط دي.",
        },
        {
          h: "6. Premium: تفعيل يدوي لمرة واحدة",
          p: "الوصول إلى Premium بيتم تفعيله يدوياً لمدة 30 يوماً بعد التحقق من تحويل بنكي أو دفع من محفظة. مفيش بيانات بطاقات بتتخزن ومفيش أي مبلغ بيتحصّل تلقائياً. مفيش تجديد تلقائي: لما المدة تخلص، الحساب بيرجع للخطة المجانية إلا لو بعتت طلب جديد. السعر والمدة الحاليين معروضين في صفحة Premium قبل ما تبعت الطلب، وممكن يتغيروا للطلبات الجديدة. لو تعذّر التحقق من التحويل، بيتم تسجيل ده على طلبك وتقدر تعيد الإرسال مع إثبات التحويل. المدفوعات غير قابلة للاسترداد إلا حيث يقتضي القانون.",
        },
        {
          h: "7. الاستخدام المقبول",
          p: "ممنوع استخدام الخدمة في أي غرض غير قانوني، أو محاولة تعطيلها أو تجاوز ضوابط الوصول أو حدود المعدل، أو إعادة نشر محتوى الخدمة تجارياً أو إعادة بيعه بدون إذن كتابي، أو استخدام آلي مكثف يضر بالخدمة.",
        },
        {
          h: "8. التوفر والتغييرات",
          p: "بنطوّر الخدمة باستمرار، وممكن نضيف أو نعدّل أو نوقف ميزات مع إشعار معقول. حالة الخدمة وحداثة البيانات منشورة في صفحة الحالة. مفيش ضمان لتوفر مستمر بدون انقطاع.",
        },
        {
          h: "9. إخلاء المسؤولية وحدودها",
          p: "الخدمة مقدَّمة «كما هي» بدون ضمانات من أي نوع. البيانات والتحليلات مش نصيحة استثمارية ولا توصية شراء أو بيع. لا نتحمل مسؤولية أي خسائر مباشرة أو غير مباشرة تنتج عن استخدام الخدمة أو الاعتماد على محتواها، بالقدر اللي يسمح به القانون.",
        },
        {
          h: "10. إنهاء الاستخدام",
          p: "ممكن نوقف أو نلغي وصولك للخدمة في حالة انتهاك الشروط. ممكن تطلب حذف حسابك في أي وقت من خلال قناة التواصل المنشورة، مع مراعاة أي التزامات قانونية للاحتفاظ بالسجلات.",
        },
        {
          h: "11. القانون الحاكم",
          p: "الشروط دي تُفسَّر وتُطبَّق وفق قوانين جمهورية مصر العربية. أي نزاع يختص به القضاء المصري المختص.",
        },
        {
          h: "12. التواصل والتحديثات",
          p: "بنحدّث الشروط من وقت لآخر وننشر التاريخ الجديد هنا. قناة تواصل مباشرة (بريد دعم) هتتنشر هنا أول ما تتوفر؛ لحد ساعتها، معلومات المنصة وحالتها متاحة في صفحتي «من نحن» و«حالة المنصة».",
        },
      ]
    : [
        {
          h: "1. Acceptance",
          p: "By using Meza or creating an account you agree to these terms. If you do not agree, do not use the service. The terms apply to browsing, research and any account you open.",
        },
        {
          h: "2. The service",
          p: "Meza is an Egyptian stock market research and information platform: published financial statements, calculated ratios, comparisons, rankings, technical context and research tools. Meza is not a broker or an execution venue, and there are no trading accounts or exchange money transfers through it.",
        },
        {
          h: "3. Accounts",
          p: "You must be at least 18. You are responsible for the accuracy of your account details, for keeping your password safe, and for all activity under your account. Tell us immediately about unauthorised use. We may suspend or close an account for abuse or attempts to bypass access controls.",
        },
        {
          h: "4. Data and its limits",
          p: "Financial statement data comes from companies' published filings; market prices come from a public source delayed by 15 minutes. Data may contain errors, delays or omissions, and unavailable values show as “—” and are never estimated. Full detail is in the risk notice.",
        },
        {
          h: "5. Privacy",
          p: "We process account and usage data as described in the privacy policy published on the site. The privacy policy forms part of these terms.",
        },
        {
          h: "6. Premium: one-off manual activation",
          p: "Premium access is activated manually for a fixed 30-day period after we verify a bank transfer or wallet payment. Card details are not stored and nothing is charged automatically. There is no auto-renewal: when the period ends your account returns to the free plan unless you submit a new request. The current price and period are shown on the Premium page before you request, and may change for future requests. If a payment cannot be verified, your request is marked as such and you may resubmit with proof of transfer. Payments are non-refundable except where required by law.",
        },
        {
          h: "7. Acceptable use",
          p: "You may not use the service for unlawful purposes, attempt to disrupt it or bypass access controls or rate limits, republish or resell its content commercially without written permission, or run intensive automated access that harms the service.",
        },
        {
          h: "8. Availability and changes",
          p: "We keep developing the service and may add, change or retire features with reasonable notice. Service state and data freshness are published on the status page. Continuous, uninterrupted availability is not guaranteed.",
        },
        {
          h: "9. Disclaimers and limitation of liability",
          p: "The service is provided “as is” without warranties of any kind. Data and analyses are not investment advice or a recommendation to buy or sell. We are not liable for any direct or indirect losses arising from use of the service or reliance on its content, to the extent permitted by law.",
        },
        {
          h: "10. Termination",
          p: "We may suspend or end your access for a breach of these terms. You may request deletion of your account at any time through the published contact channel, subject to legal record-retention obligations.",
        },
        {
          h: "11. Governing law",
          p: "These terms are interpreted and applied under the laws of the Arab Republic of Egypt. Disputes are subject to the competent Egyptian courts.",
        },
        {
          h: "12. Contact and updates",
          p: "We update these terms from time to time and publish the new date here. A direct support contact address will be published here when available; until then, platform information and service state are available on the About and Status pages.",
        },
      ]

  return (
    <LayoutShell chrome="marketing">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">{ar ? "شروط الاستخدام" : "Terms of Service"}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{updated}</p>
        <p className="mt-4 rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {ar
            ? "باختصار: Meza أداة بحث مش وسيط، البيانات من إفصاحات منشورة وأسعار متأخرة، وPremium تفعيل يدوي لمرة واحدة 30 يوماً بدون تجديد تلقائي."
            : "In short: Meza is a research tool, not a broker; data comes from published filings and delayed prices; Premium is a one-off 30-day manual activation with no auto-renewal."}
        </p>

        <div className="mt-6 space-y-5">
          {sections.map((s) => (
            <section key={s.h} className="space-y-1.5">
              <h2 className="text-sm font-semibold text-foreground">{s.h}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{s.p}</p>
            </section>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-border/70 p-4 text-[11px] leading-relaxed text-muted-foreground">
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            <Link href="/disclaimer" className="font-medium text-primary underline-offset-2 hover:underline">
              {ar ? "تنبيه المخاطر" : "Risk notice"}
            </Link>
            <Link href="/privacy" className="font-medium text-primary underline-offset-2 hover:underline">
              {ar ? "سياسة الخصوصية" : "Privacy Policy"}
            </Link>
            <Link href="/premium" className="font-medium text-primary underline-offset-2 hover:underline">
              {ar ? "الاشتراك" : "Premium"}
            </Link>
            <Link href="/about" className="font-medium text-primary underline-offset-2 hover:underline">
              {ar ? "من نحن" : "About Meza"}
            </Link>
            <Link href="/status" className="font-medium text-primary underline-offset-2 hover:underline">
              {ar ? "حالة المنصة" : "Platform status"}
            </Link>
          </div>
          <p className="mt-3">{ar ? BRAND.notAdviceAr : BRAND.notAdviceEn}</p>
        </div>
      </div>
    </LayoutShell>
  )
}
