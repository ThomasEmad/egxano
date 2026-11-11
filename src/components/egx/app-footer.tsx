"use client"

import Link from "next/link"
<<<<<<< HEAD
=======
import { BrandMark } from "@/components/brand/logo"
>>>>>>> b110dc6d46bae06b6754fc83151c5421ad4d72a3
import { useI18n } from "@/lib/i18n"
import { EGXANOWordmark } from "@/components/brand/brand-mark"
import { BRAND } from "@/lib/brand"

const RESEARCH_LINKS: Array<{ href: string; en: string; ar: string }> = [
  { href: "/companies", en: "Companies", ar: "الشركات" },
  { href: "/compare", en: "Compare", ar: "المقارنة" },
  { href: "/dashboard", en: "Screener", ar: "الماسح" },
  { href: "/sectors", en: "Sectors", ar: "القطاعات" },
  { href: "/rankings", en: "Rankings", ar: "الترتيب" },
]

const TRUST_LINKS: Array<{ href: string; en: string; ar: string }> = [
  { href: "/status", en: "Data status & freshness", ar: "حالة البيانات والحداثة" },
  { href: "/about", en: "About EGXANO", ar: "عن EGXANO" },
  { href: "/disclaimer", en: "Risk notice", ar: "تنبيه المخاطر" },
  { href: "/terms", en: "Terms", ar: "الشروط" },
  { href: "/privacy", en: "Privacy", ar: "الخصوصية" },
]

const ACCOUNT_LINKS: Array<{ href: string; en: string; ar: string }> = [
  { href: "/premium", en: "Premium", ar: "بريميوم" },
  { href: "/watchlist", en: "Watchlist", ar: "قائمة المتابعة" },
  { href: "/portfolio", en: "Portfolio", ar: "المحفظة" },
  { href: "/login", en: "Sign in", ar: "تسجيل الدخول" },
  { href: "/register", en: "Create account", ar: "إنشاء حساب" },
]

export function AppFooter() {
  const { t, lang } = useI18n()
  const ar = lang === "ar"
  const year = new Date().getFullYear()

  return (
<<<<<<< HEAD
    <footer className="mt-auto border-t border-border bg-surface-secondary">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <EGXANOWordmark lang={lang} size={34} />
            <p className="mt-4 max-w-sm text-xs leading-relaxed text-muted-foreground">
              {ar ? BRAND.descriptionAr : BRAND.descriptionEn}
            </p>
            <p className="mt-3 max-w-sm text-[11px] leading-relaxed text-muted-foreground/80">
              {ar ? BRAND.trustLineAr : BRAND.trustLineEn}
            </p>
=======
    <footer className="mt-auto border-t border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/95">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <BrandMark size={26} />
            <span className="font-extrabold tracking-[0.08em] text-foreground">EGXANO</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{ar ? "حقوق الطبع والنشر" : "©"}</span>
            <span>{new Date().getFullYear()} EGXANO</span>
>>>>>>> b110dc6d46bae06b6754fc83151c5421ad4d72a3
          </div>

          <FooterColumn
            title={ar ? "البحث" : "Research"}
            links={RESEARCH_LINKS}
            ar={ar}
          />
          <FooterColumn
            title={ar ? "البيانات والثقة" : "Data & trust"}
            links={TRUST_LINKS}
            ar={ar}
          />
          <FooterColumn
            title={ar ? "الحساب والباقات" : "Account & plans"}
            links={ACCOUNT_LINKS}
            ar={ar}
          />
        </div>

        <div className="mt-10 border-t border-border/70 pt-6">
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t("ft.disclaimer")}</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/80">{t("ft.demoNotice")}</p>
          <div className="mt-4 flex flex-col gap-2 text-[10px] text-muted-foreground/70 sm:flex-row sm:items-center sm:justify-between">
            <p>
              © {year} EGXANO — {ar ? "أبحاث البورصة المصرية" : "Egyptian stock market research"}
            </p>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link href="/status" className="hover:text-foreground hover:underline">
                {ar ? "حالة المنصة" : "Platform status"}
              </Link>
              <span aria-hidden="true">·</span>
              <Link href="/disclaimer" className="hover:text-foreground hover:underline">
                {ar ? "ليست نصيحة استثمارية" : "Not investment advice"}
              </Link>
              <span aria-hidden="true">·</span>
              <span>{ar ? "الأسعار متأخرة 15 دقيقة" : "Prices delayed 15 min"}</span>
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}

function FooterColumn({
  title,
  links,
  ar,
}: {
  title: string
  links: Array<{ href: string; en: string; ar: string }>
  ar: boolean
}) {
  return (
    <nav aria-label={title}>
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">{title}</h2>
      <ul className="mt-3 space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              {ar ? link.ar : link.en}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
