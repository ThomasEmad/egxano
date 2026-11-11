"use client"

// Screener (/dashboard#/scanners) — "فلتر بمعنى — ونتيجة بتفسير".
//
// Every preset run returns real matched companies (never just a count) with:
//  · the metric value that triggered the match and the evaluated period,
//  · a per-condition "why matched" / "why not matched" explanation,
//  · actions: open the company, add to compare, star it.
// Coverage is first-class: "N matched · X of Y companies could be assessed —
// Z lacked the data". A run that cannot execute (e.g. Premium required) shows
// the reason and the next step instead of a silent empty pane.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertCircle,
  Clock,
  History,
  Info,
  MinusCircle,
  Play,
  Plus,
  Save,
  Scale,
  Trash2,
  Wand2,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { api, type CompanyScanResult, type ScannerRule, type ScanCondition, type ScanOutput } from "@/lib/client/api"
import { isOperator, type Operator } from "@/lib/financial/scanner"
import { useI18n } from "@/lib/i18n"
import { EmptyState } from "@/components/brand/empty-state"
import { metricGloss } from "@/lib/brand"
import { SECTORS, sectorLabel } from "@/lib/sectors"
import { StarButton, WhyMatchedPanel } from "./shared"

/* ------------------------------------------------------------------ */
/* Copy helpers                                                       */
/* ------------------------------------------------------------------ */

type Basis = "LATEST_ANNUAL" | "LATEST_QUARTERLY" | "LATEST_TTM"

const BASIS_EXPLAINER: Record<Basis, { en: string; ar: string }> = {
  LATEST_ANNUAL: {
    en: "Latest annual statements — one full fiscal year. The fairer basis for comparing companies that file on different calendars.",
    ar: "أحدث قوائم سنوية — سنة مالية كاملة. الأساس الأدق لمقارنة شركات تختلف تقاويمها المالية.",
  },
  LATEST_QUARTERLY: {
    en: "Latest quarter only. Flow metrics (ROE, margins, revenue) are NOT annualised unless the row says so — treat the screen as indicative.",
    ar: "أحدث ربع سنوي فقط. مؤشرات التدفق (ROE والهوامش والإيرادات) ليست سنوية ما لم يُذكر ذلك — تعامل مع النتيجة كإرشادية.",
  },
  LATEST_TTM: {
    en: "Trailing twelve months — four consecutive quarters summed. A like-for-like basis for flow metrics.",
    ar: "آخر ١٢ شهرًا — مجموع أربعة أرباع متتالية. أساس مكافئ لمؤشرات التدفق.",
  },
}

function basisLabel(basis: string, lang: "en" | "ar"): string {
  if (basis === "LATEST_TTM") return lang === "ar" ? "١٢ شهرًا (TTM)" : "TTM"
  if (basis === "LATEST_QUARTERLY") return lang === "ar" ? "ربع سنوي" : "Quarterly"
  return lang === "ar" ? "سنوي (FY)" : "Annual"
}

/** Plain-language meaning + limits for every preset we ship. The DB stores an
 *  English description only, so Arabic and the "what it can miss" line live here
 *  (presentation layer — no data or API change). */
const PRESET_COPY: Record<string, { ar: string; testsEn: string; testsAr: string; missesEn: string; missesAr: string }> = {
  TURNAROUND: {
    ar: "شركات تحوّلت من صافي خسارة إلى صافي ربح في نفس الفترة.",
    testsEn: "Net result moved from a loss to a profit in the same period.",
    testsAr: "تحوّل صافي النتيجة من خسارة إلى ربح في نفس الفترة.",
    missesEn: "One improved period can be seasonal — check the period printed on each row.",
    missesAr: "تحسّن فترة واحدة قد يكون موسميًا — راجع الفترة المعروضة في كل صف.",
  },
  DETERIORATION: {
    ar: "شركات تحوّلت من صافي ربح إلى صافي خسارة.",
    testsEn: "Net result moved from a profit to a loss.",
    testsAr: "تحوّل صافي النتيجة من ربح إلى خسارة.",
    missesEn: "A single weak period is not proof of a trend.",
    missesAr: "فترة ضعيفة واحدة ليست دليلًا على اتجاه.",
  },
  DEBT_REDUCTION: {
    ar: "انخفض إجمالي الدين ٥٪ أو أكثر على أساس نفس الفترة.",
    testsEn: "Total debt decreased by 5% or more on a same-period basis.",
    testsAr: "انخفض إجمالي الدين ٥٪ أو أكثر على أساس نفس الفترة.",
    missesEn: "Debt can fall through repayment or reclassification — the statement shows which.",
    missesAr: "قد ينخفض الدين للسداد أو لإعادة التصنيف — القوائم توضح السبب.",
  },
  STRONG_CASH_FLOW: {
    ar: "التدفق النقدي التشغيلي موجب.",
    testsEn: "Operating cash flow is greater than zero.",
    testsAr: "التدفق النقدي التشغيلي أكبر من صفر.",
    missesEn: "Operating cash flow excludes capital spending and financing.",
    missesAr: "التدفق التشغيلي لا يشمل الإنفاق الرأسمالي أو التمويل.",
  },
  FINANCIAL_RECOVERY: {
    ar: "تحول من خسارة إلى ربح مع نمو إيرادات ١٠٪ أو أكثر وتدفق تشغيلي موجب ودين غير متزايد.",
    testsEn: "Loss→profit with revenue growth ≥10%, positive operating cash flow and non-increasing debt.",
    testsAr: "تحول من خسارة إلى ربح مع نمو إيرادات ١٠٪ أو أكثر وتدفق تشغيلي موجب ودين غير متزايد.",
    missesEn: "All conditions must hold together; a missing figure excludes the company instead of counting as a pass.",
    missesAr: "كل الشروط يجب أن تتحقق معًا؛ غياب أي رقم يستبعد الشركة ولا يُحسب كنجاح.",
  },
  STRONG_ROE: {
    ar: "عائد على حقوق الملكية ١٥٪ أو أكثر.",
    testsEn: "Return on equity of 15% or more.",
    testsAr: "عائد على حقوق الملكية ١٥٪ أو أكثر.",
    missesEn: "ROE can be inflated by high leverage, and one strong year can be one-off.",
    missesAr: "يمكن أن يرتفع ROE بسبب الرفع المالي، وقد تكون السنة القوية استثنائية.",
  },
  HIGH_ASSETS: {
    ar: "أكبر الميزانيات (إجمالي الأصول ١٠ مليار ج.م أو أكثر) — حجم وليس جودة.",
    testsEn: "Largest balance sheets — total assets ≥ EGP 10B.",
    testsAr: "أكبر الميزانيات — إجمالي الأصول ١٠ مليار ج.م أو أكثر.",
    missesEn: "Size says nothing about profitability, leverage or price. Not a quality screen.",
    missesAr: "الحجم لا يقول شيئًا عن الربحية أو الرفع المالي أو السعر. ليس فلتر جودة.",
  },
  DIVIDEND_CALENDAR: {
    ar: "شركات لديها توزيعات معلنة أو قادمة أو مستحقة.",
    testsEn: "Companies with announced, upcoming or eligible dividends.",
    testsAr: "شركات لديها توزيعات معلنة أو قادمة أو مستحقة.",
    missesEn: "Announced is not the same as paid; dates are never inferred.",
    missesAr: "الإعلان لا يعني الصرف؛ ولا تُستنتج التواريخ.",
  },
  VALUE_P_B: {
    ar: "سعر السوق عند ٧٠٪ من القيمة الدفترية للسهم أو أقل.",
    testsEn: "Market price at or below 70% of book value per share — requires a recorded price.",
    testsAr: "سعر السوق عند ٧٠٪ من القيمة الدفترية للسهم أو أقل — يتطلب سعرًا مسجلًا.",
    missesEn: "A negative or very stale book value distorts the ratio.",
    missesAr: "القيمة الدفترية السالبة أو القديمة جدًا تشوّه النسبة.",
  },
  DIVIDEND_YIELD: {
    ar: "عائد توزيعات آخر ١٢ شهرًا ٥٪ أو أكثر.",
    testsEn: "Trailing-12-month dividend yield of 5% or more — requires a recorded price.",
    testsAr: "عائد توزيعات آخر ١٢ شهرًا ٥٪ أو أكثر — يتطلب سعرًا مسجلًا.",
    missesEn: "Yield rises when the price falls; it does not measure whether the payout is sustainable.",
    missesAr: "يرتفع العائد عند انخفاض السعر؛ ولا يقيس استدامة التوزيع.",
  },
}

function presetCopy(presetKey: string | null, rule: ScannerRule, lang: "en" | "ar") {
  const c = presetKey ? PRESET_COPY[presetKey] : undefined
  if (!c) {
    return {
      description: lang === "ar" ? rule.description ?? "" : rule.description ?? "",
      tests: rule.description ?? "",
      misses: "",
    }
  }
  return { description: lang === "ar" ? c.ar : rule.description ?? "", tests: lang === "ar" ? c.testsAr : c.testsEn, misses: lang === "ar" ? c.missesAr : c.missesEn }
}

/* ------------------------------------------------------------------ */
/* Coverage helpers                                                   */
/* ------------------------------------------------------------------ */

function isAssessable(r: CompanyScanResult): boolean {
  return r.evaluation.conditions.length > 0 && r.evaluation.conditions.every((c) => c.status === "OK")
}

function sortResults(results: CompanyScanResult[]): CompanyScanResult[] {
  return [...results].sort(
    (a, b) =>
      Number(b.evaluation.matched) - Number(a.evaluation.matched) ||
      b.evaluation.matchedCount - a.evaluation.matchedCount ||
      a.ticker.localeCompare(b.ticker)
  )
}

/* ------------------------------------------------------------------ */
/* Root                                                               */
/* ------------------------------------------------------------------ */

export function ScannersView({
  mode,
  pendingRuleId,
  onOpenCompany,
  onOpenCustom,
}: {
  mode: "presets" | "custom"
  pendingRuleId: string | null
  onOpenCompany: (id: string) => void
  onOpenCustom: () => void
}) {
  return mode === "presets" ? (
    <PresetScreener key={pendingRuleId ?? "none"} pendingRuleId={pendingRuleId} onOpenCompany={onOpenCompany} onOpenCustom={onOpenCustom} />
  ) : (
    <CustomScreener onOpenCompany={onOpenCompany} />
  )
}

/* ------------------------------------------------------------------ */
/* Result row + results pane (shared by presets and custom)           */
/* ------------------------------------------------------------------ */

function ResultRow({
  result,
  expanded,
  onToggle,
  onOpenCompany,
  selected,
  onToggleSelect,
}: {
  result: CompanyScanResult
  expanded: boolean
  onToggle: () => void
  onOpenCompany: (id: string) => void
  selected: boolean
  onToggleSelect: () => void
}) {
  const { t, lang, pick } = useI18n()
  const metricCond = result.evaluation.conditions.find((c) => c.kind === "metric")
  const metricDisplay = metricCond?.actualDisplay ?? ""
  const matched = result.evaluation.matched
  const assessable = isAssessable(result)

  return (
    <div
      className={`rounded-xl border bg-card p-3 transition-colors ${
        matched ? "border-border/60" : "border-dashed border-border/50 opacity-75"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-3.5 w-3.5 shrink-0 accent-primary"
          aria-label={lang === "ar" ? `اختيار ${result.ticker} للمقارنة` : `Select ${result.ticker} for comparison`}
        />
        <button
          type="button"
          onClick={onToggle}
          className={`flex h-8 shrink-0 items-center justify-center rounded-lg border px-2 text-[11px] font-semibold tabular transition-colors ${
            matched ? "border-primary/40 bg-primary/5 text-primary" : "border-border/60 bg-muted/40 text-muted-foreground"
          }`}
          aria-expanded={expanded}
          aria-label={lang === "ar" ? "تفسير المطابقة" : "Explain the match"}
        >
          {result.evaluation.matchedCount}/{result.evaluation.conditions.length}
        </button>
        <button type="button" onClick={() => onOpenCompany(result.companyId)} className="min-w-0 flex-1 text-start">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold">{result.ticker}</span>
            <span className="truncate text-xs text-muted-foreground">{pick(result.nameEn, result.nameAr)}</span>
            {matched ? (
              <Badge variant="outline" className="border-success/40 bg-success/10 text-[9px] text-success">
                {lang === "ar" ? "مطابقة" : "matched"}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[9px] text-muted-foreground">
                {lang === "ar" ? "غير مطابقة" : "not matched"}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{sectorLabel(result.sector, lang)}</span>
            {result.contextPeriodLabel ? (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span>
                  {t("sc.contextPeriod")}: {result.contextPeriodLabel}
                </span>
              </>
            ) : (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span className="text-warning">{lang === "ar" ? "لا توجد فترة مسجلة" : "no recorded period"}</span>
              </>
            )}
            {!assessable ? (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span className="inline-flex items-center gap-1 text-warning">
                  <MinusCircle className="h-3 w-3" aria-hidden="true" />
                  {lang === "ar" ? "بيانات ناقصة" : "missing data"}
                </span>
              </>
            ) : null}
          </div>
        </button>
        {matched && metricDisplay ? (
          <span className="shrink-0 text-xs font-semibold tabular text-foreground">{metricDisplay}</span>
        ) : null}
        <button
          type="button"
          onClick={onToggle}
          className="p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={expanded}
          aria-label={t("common.details")}
        >
          <svg className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      {expanded ? (
        <div className="mt-3 space-y-2.5 rounded-lg border border-border/40 bg-muted/20 p-3">
          <WhyMatchedPanel conditions={result.evaluation.conditions} matched={matched} />
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onOpenCompany(result.companyId)}>
              {lang === "ar" ? "افتح صفحة الشركة" : "Open company"}
            </Button>
            <StarButton companyId={result.companyId} ticker={result.ticker} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ResultsPane({
  output,
  ruleTitle,
  onOpenCompany,
  onOpenCustom,
  onOpenPremium,
  onRerun,
  isRerunning,
}: {
  output: ScanOutput
  ruleTitle: string
  onOpenCompany: (id: string) => void
  onOpenCustom?: () => void
  onOpenPremium?: () => void
  onRerun?: (basis: Basis) => void
  isRerunning?: boolean
}) {
  const { t, lang } = useI18n()
  const router = useRouter()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [visible, setVisible] = useState(40)

  const total = output.results.length
  const matched = output.matched.length
  const assessable = useMemo(() => output.results.filter(isAssessable).length, [output.results])
  const excluded = total - assessable
  const rows = useMemo(() => {
    const base = showAll ? sortResults(output.results) : sortResults(output.matched)
    return base
  }, [output.results, output.matched, showAll])

  // A new run invalidates the previous selection.
  useEffect(() => {
    // Resetting per-run UI state when a new result object arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected([])
    setExpanded(null)
    setVisible(40)
  }, [output])

  function toggleSelect(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 4 ? prev : [...prev, id]))
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{ruleTitle}</span>
          <Badge variant="outline" className="tabular text-[10px]">
            {basisLabel(output.periodBasis, lang)}
          </Badge>
          <Badge className="tabular text-[10px]">
            {matched} {lang === "ar" ? "مطابقة" : "matched"}
          </Badge>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {lang === "ar"
            ? `${assessable} من ${total} شركة توفّرت لها البيانات للتقييم${excluded > 0 ? ` — ${excluded} شركة استُبعدت لنقص البيانات` : ""}. القيم الغائبة لا تُعامَل كصفر.`
            : `${assessable} of ${total} companies had the data to be assessed${excluded > 0 ? ` — ${excluded} excluded for missing data` : ""}. Missing values are never treated as zero.`}
        </p>
      </div>

      {output.validationErrors.length > 0 ? (
        <div className="flex items-start gap-1.5 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-[11px] text-warning">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{output.validationErrors.join(" · ")}</span>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={Scale}
          title={lang === "ar" ? "لا توجد شركة حققت هذا الشرط على هذا الأساس" : "No company met this condition on this basis"}
          description={
            lang === "ar"
              ? "جرّب أساس ١٢ شهرًا أو أحدث سنة سنوية، أو افتح «كل الشركات المقيّمة» لترى الشركات التي افتقدت البيانات."
              : "Try the trailing-twelve-month or latest-annual basis, or open “all assessed companies” to see which companies lacked the data."
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {onRerun ? (
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={isRerunning} onClick={() => onRerun("LATEST_TTM")}>
                  {lang === "ar" ? "جرّب ١٢ شهرًا" : "Try TTM"}
                </Button>
              ) : null}
              {total > 0 ? (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowAll(true)}>
                  {lang === "ar" ? `اعرض كل الشركات المقيّمة (${assessable})` : `Show all assessed companies (${assessable})`}
                </Button>
              ) : null}
              {onOpenPremium ? (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onOpenPremium}>
                  {lang === "ar" ? "معلومات بريميوم" : "Premium details"}
                </Button>
              ) : null}
            </div>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              {lang === "ar" ? `عرض ${Math.min(rows.length, visible)} من ${rows.length}` : `Showing ${Math.min(rows.length, visible)} of ${rows.length}`}
            </p>
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="h-3 w-3 accent-primary" />
              {lang === "ar" ? "أظهر الشركات غير المطابقة وسبب عدمها" : "Show non-matching companies and why not"}
            </label>
          </div>
          <div className="max-h-[560px] space-y-2 overflow-y-auto pe-1 scrollbar-thin">
            {rows.slice(0, visible).map((r) => (
              <ResultRow
                key={r.companyId}
                result={r}
                expanded={expanded === r.companyId}
                onToggle={() => setExpanded(expanded === r.companyId ? null : r.companyId)}
                onOpenCompany={onOpenCompany}
                selected={selected.includes(r.companyId)}
                onToggleSelect={() => toggleSelect(r.companyId)}
              />
            ))}
            {rows.length > visible ? (
              <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => setVisible((v) => v + 40)}>
                {lang === "ar" ? "تحميل المزيد" : "Load more"}
              </Button>
            ) : null}
          </div>
          {selected.length > 0 ? (
            <div className="sticky bottom-2 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-card/95 p-2.5 shadow-sm backdrop-blur">
              <span className="text-xs font-medium text-foreground">
                {lang === "ar" ? `${selected.length} محددة للمقارنة` : `${selected.length} selected for comparison`}
              </span>
              <Button
                size="sm"
                className="ms-auto h-7 gap-1.5 text-xs"
                disabled={selected.length < 2}
                onClick={() => router.push(`/compare?ids=${selected.join(",")}`)}
              >
                <Scale className="h-3.5 w-3.5" aria-hidden="true" />
                {lang === "ar" ? "قارن" : "Compare"}
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected([])}>
                {lang === "ar" ? "إلغاء" : "Clear"}
              </Button>
            </div>
          ) : null}
          {selected.length === 1 ? (
            <p className="text-[11px] text-muted-foreground">{lang === "ar" ? "اختر شركة أخرى للمقارنة." : "Select one more company to compare."}</p>
          ) : null}
        </>
      )}

      {output.validationErrors.length === 0 && onOpenCustom && rows.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {lang === "ar" ? "تحتاج حدًا مختلفًا؟ " : "Need a different threshold? "}
          <button type="button" onClick={onOpenCustom} className="font-medium text-primary underline-offset-2 hover:underline">
            {lang === "ar" ? "افتح الماسح المخصص" : "Open the custom screener"}
          </button>
        </p>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Preset screener                                                    */
/* ------------------------------------------------------------------ */

function PresetScreener({
  pendingRuleId,
  onOpenCompany,
  onOpenCustom,
}: {
  pendingRuleId: string | null
  onOpenCompany: (id: string) => void
  onOpenCustom: () => void
}) {
  const { lang, pick } = useI18n()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null)
  const [basis, setBasis] = useState<Basis>("LATEST_ANNUAL")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: ruleData, isLoading, isError, refetch } = useQuery({ queryKey: ["scanners"], queryFn: api.scanners })
  const { data: history } = useQuery({ queryKey: ["scan-history"], queryFn: api.scanHistory })

  const presets = useMemo(() => ruleData?.rules.filter((r) => r.isPreset) ?? [], [ruleData])
  const custom = useMemo(() => ruleData?.rules.filter((r) => !r.isPreset) ?? [], [ruleData])

  // pendingRuleId (from /dashboard?preset= or a company badge) may be a rule id
  // or a presetKey — resolve as a derived value; local selection wins.
  const resolvedPending = pendingRuleId
    ? presets.find((r) => r.id === pendingRuleId)?.id ?? presets.find((r) => r.presetKey === pendingRuleId)?.id ?? null
    : null
  const effectiveRuleId = selectedRuleId ?? resolvedPending
  const selectedRule = presets.find((r) => r.id === effectiveRuleId) ?? custom.find((r) => r.id === effectiveRuleId) ?? null

  const lastRunFor = useMemo(() => {
    const map = new Map<string, { matchedCount: number; ranAt: string }>()
    for (const r of history?.runs ?? []) {
      if (r.ruleId && (!map.get(r.ruleId) || new Date(r.ranAt) > new Date(map.get(r.ruleId)!.ranAt))) {
        map.set(r.ruleId, { matchedCount: r.matchedCount, ranAt: r.ranAt })
      }
    }
    return map
  }, [history])

  const runMutation = useMutation({
    mutationFn: (rule: ScannerRule) => api.runScanner({ ruleId: rule.id, periodBasis: basis }),
    onSuccess: () => {
      setErrorMsg(null)
      queryClient.invalidateQueries({ queryKey: ["scanners"] })
      queryClient.invalidateQueries({ queryKey: ["scan-history"] })
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : String(e)
      setErrorMsg(message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteScanner(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scanners"] }),
    onError: (e) =>
      toast({
        title: lang === "ar" ? "فشل الحذف" : "Delete failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      }),
  })

  // Auto-run once per (rule, basis) pair. If the user switches basis while a run
  // is in flight, the pair is not marked as done, so it runs when the current
  // run finishes — no lost requests, no repeat loop.
  const lastRunKey = useRef<string | null>(null)
  const runKey = selectedRule ? `${selectedRule.id}|${basis}` : null
  useEffect(() => {
    if (!selectedRule || !runKey) return
    if (lastRunKey.current === runKey) return
    if (runMutation.isPending) return
    lastRunKey.current = runKey
    // Clear the previous run's error before starting the new one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setErrorMsg(null)
    runMutation.mutate(selectedRule)
  }, [runKey, runMutation.isPending, selectedRule])

  // Preset + basis live in the URL so a screen can be shared or bookmarked.
  useEffect(() => {
    if (typeof window === "undefined" || !selectedRule) return
    const u = new URL(window.location.href)
    u.searchParams.set("preset", selectedRule.presetKey ?? selectedRule.id)
    u.searchParams.set("basis", basis)
    window.history.replaceState(null, "", u.toString())
  }, [selectedRule, basis])

  const isPremiumError = !!errorMsg && /premium|forbidden|subscription/i.test(errorMsg)
  const copy = selectedRule ? presetCopy(selectedRule.presetKey, selectedRule, lang) : null

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{lang === "ar" ? "الماسح" : "Screener"}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {lang === "ar"
              ? "اختر فلترًا جاهزًا لترى الشركات التي تنطبق عليها الشروط، والفترة التي قُيّمت عليها، ولماذا طابقت."
              : "Pick a preset to see which companies met its conditions, the period each was assessed on, and why they matched."}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Label htmlFor="basis" className="whitespace-nowrap text-xs text-muted-foreground">
              {lang === "ar" ? "أساس المقارنة" : "Basis"}
            </Label>
            <Select value={basis} onValueChange={(v) => setBasis(v as Basis)}>
              <SelectTrigger id="basis" className="h-8 w-56 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LATEST_ANNUAL">{lang === "ar" ? "أحدث قوائم سنوية" : "Latest annual statements"}</SelectItem>
                <SelectItem value="LATEST_QUARTERLY">{lang === "ar" ? "أحدث ربع سنوي" : "Latest quarter"}</SelectItem>
                <SelectItem value="LATEST_TTM">{lang === "ar" ? "آخر ١٢ شهرًا (TTM)" : "Trailing twelve months (TTM)"}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="max-w-64 text-[10px] leading-relaxed text-muted-foreground">{BASIS_EXPLAINER[basis][lang]}</p>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        {/* Preset rail */}
        <div className="space-y-3">
          <Card className="p-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{lang === "ar" ? "ماسحات جاهزة" : "Presets"}</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[360px] space-y-1 overflow-y-auto scrollbar-thin">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-md" />)
              ) : isError ? (
                <div className="space-y-2 p-2 text-center">
                  <p className="text-xs text-muted-foreground">{lang === "ar" ? "تعذّر تحميل الماسحات." : "Could not load the presets."}</p>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => refetch()}>
                    {lang === "ar" ? "إعادة المحاولة" : "Retry"}
                  </Button>
                </div>
              ) : (
                presets.map((rule) => {
                  const last = lastRunFor.get(rule.id)
                  const rowCopy = presetCopy(rule.presetKey, rule, lang)
                  return (
                    <button
                      key={rule.id}
                      type="button"
                      onClick={() => setSelectedRuleId(rule.id)}
                      className={`flex w-full items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        effectiveRuleId === rule.id ? "bg-primary/10 text-primary" : "hover:bg-muted"
                      }`}
                      aria-pressed={effectiveRuleId === rule.id}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{pick(rule.name, rule.nameAr)}</span>
                        {rowCopy.description ? (
                          <span className="mt-0.5 block truncate text-[11px] font-normal text-muted-foreground">{rowCopy.description}</span>
                        ) : null}
                        {last ? (
                          <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Clock className="h-2.5 w-2.5" aria-hidden="true" />
                            {timeAgo(last.ranAt, lang)} · {last.matchedCount} {lang === "ar" ? "مطابقة" : "matches"}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  )
                })
              )}
            </CardContent>
          </Card>

          {custom.length > 0 ? (
            <Card className="p-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{lang === "ar" ? "قواعدي المحفوظة" : "My saved rules"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {custom.map((rule) => (
                  <div key={rule.id} className={`group flex items-center justify-between rounded-lg px-1 ${effectiveRuleId === rule.id ? "bg-primary/10" : "hover:bg-muted"}`}>
                    <button
                      type="button"
                      onClick={() => setSelectedRuleId(rule.id)}
                      className="flex-1 truncate px-2 py-2 text-start text-sm"
                      aria-pressed={effectiveRuleId === rule.id}
                    >
                      {pick(rule.name, rule.nameAr)}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(rule.id)}
                      className="p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`${lang === "ar" ? "حذف" : "Delete"} ${rule.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Button variant="outline" className="w-full text-xs" onClick={onOpenCustom}>
            <Wand2 className="h-4 w-4" aria-hidden="true" />
            {lang === "ar" ? "ماسح مخصص" : "Custom screener"}
          </Button>

          <RunHistory />
        </div>

        {/* Results / explanation */}
        <div className="space-y-3">
          {selectedRule ? (
            <Card className="border-border/60 p-0">
              <CardContent className="space-y-1 p-4">
                <h2 className="text-sm font-semibold text-foreground">{pick(selectedRule.name, selectedRule.nameAr)}</h2>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">{lang === "ar" ? "يختبر: " : "Tests: "}</span>
                  {copy?.tests}
                </p>
                {copy?.misses ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">{lang === "ar" ? "قد يغفل: " : "Can miss: "}</span>
                    {copy.misses}
                  </p>
                ) : null}
                <p className="flex items-start gap-1.5 pt-1 text-[10px] text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  {lang === "ar"
                    ? "الماسح يعرض أوضاعًا مالية واقعية — وليس توصية استثمارية."
                    : "The screener reports factual financial conditions — not investment advice."}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {isPremiumError ? (
            <Card className="border-warning/40 bg-warning/10 p-4">
              <p className="text-sm font-medium text-warning">{lang === "ar" ? "تشغيل الماسحات ضمن بريميوم" : "Screener runs are part of Premium"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {lang === "ar"
                  ? "عرض الماسحات والقواعد مجاني؛ تشغيلها على بيانات السوق يحتاج اشتراك بريميوم."
                  : "Browsing the presets is free; running them across the market requires a Premium subscription."}
              </p>
              <Button size="sm" className="mt-2 h-7 text-xs" onClick={() => router.push("/premium")}>
                {lang === "ar" ? "تفاصيل بريميوم" : "Premium details"}
              </Button>
            </Card>
          ) : errorMsg ? (
            <Card className="border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm font-medium text-destructive">{lang === "ar" ? "تعذّر تشغيل الماسح" : "The screener could not run"}</p>
              <p className="mt-1 text-xs text-muted-foreground">{errorMsg}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-7 text-xs"
                onClick={() => selectedRule && runMutation.mutate(selectedRule)}
                disabled={runMutation.isPending}
              >
                {lang === "ar" ? "إعادة المحاولة" : "Retry"}
              </Button>
            </Card>
          ) : null}

          {runMutation.isPending ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : runMutation.isError ? null : runMutation.data ? (
            <ResultsPane
              output={runMutation.data}
              ruleTitle={pick(selectedRule?.name ?? "Screener", selectedRule?.nameAr ?? null)}
              onOpenCompany={onOpenCompany}
              onOpenCustom={onOpenCustom}
              onOpenPremium={() => router.push("/premium")}
              onRerun={(b) => setBasis(b)}
              isRerunning={runMutation.isPending}
            />
          ) : (
            <EmptyState
              icon={Play}
              title={lang === "ar" ? "اختر ماسحًا لعرض النتائج" : "Pick a preset to see results"}
              description={
                lang === "ar"
                  ? "كل نتيجة تُبنى من القيم المخزنة فعلاً، مع تفسير لكل شرط وسبب المطابقة."
                  : "Every result is built from actual stored values, with a per-condition explanation of the match."
              }
            />
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Run history                                                        */
/* ------------------------------------------------------------------ */

function RunHistory() {
  const { t, lang } = useI18n()
  const { data } = useQuery({ queryKey: ["scan-history"], queryFn: api.scanHistory, refetchInterval: 60_000 })
  const runs = data?.runs ?? []
  if (runs.length === 0) return null

  return (
    <Card className="p-0">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <History className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          {t("sc.runsHistory")}
        </CardTitle>
      </CardHeader>
      <CardContent className="max-h-64 space-y-1 overflow-y-auto scrollbar-thin">
        {runs.slice(0, 8).map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2.5 py-1.5 text-[11px]">
            <div className="min-w-0">
              <p className="truncate font-medium">{r.ruleName}</p>
              <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-2.5 w-2.5" aria-hidden="true" />
                {timeAgo(r.ranAt, lang)} · {basisLabel(r.periodBasis, lang)}
              </p>
            </div>
            <Badge variant="secondary" className="shrink-0 tabular text-[10px]">
              {r.matchedCount}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function timeAgo(iso: string, lang: "en" | "ar"): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return lang === "ar" ? "الآن" : "just now"
  if (mins < 60) return lang === "ar" ? `قبل ${mins} د` : `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return lang === "ar" ? `قبل ${hours} س` : `${hours}h ago`
  return lang === "ar" ? `قبل ${Math.floor(hours / 24)} ي` : `${Math.floor(hours / 24)}d ago`
}

/* ------------------------------------------------------------------ */
/* Custom screener                                                    */
/* ------------------------------------------------------------------ */

interface BuilderRow {
  id: number
  kind: "metric" | "event" | "dividend" | "sector"
  code: string
  operator: string
  value: string
  maxValue: string
  eventType: string
  sector: string
  dividendStatuses: "active" | "paid"
}

let rowSeq = 1

function emptyRow(kind: BuilderRow["kind"] = "metric"): BuilderRow {
  return {
    id: rowSeq++,
    kind,
    code: kind === "sector" ? "" : "roe",
    operator: kind === "sector" ? "==" : ">=",
    value: kind === "sector" ? "" : "15",
    maxValue: "",
    eventType: "LOSS_TO_PROFIT",
    sector: "Banks",
    dividendStatuses: "active",
  }
}

const EXAMPLES: { en: string; ar: string; basis: Basis; name: string; nameAr: string; rows: BuilderRow[] }[] = [
  {
    en: "ROE ≥ 15%",
    ar: "عائد حقوق ≥ ١٥٪",
    basis: "LATEST_ANNUAL",
    name: "Strong ROE",
    nameAr: "عائد حقوق قوي",
    rows: [emptyRow("metric")],
  },
  {
    en: "Net margin ≥ 10% & leverage ≤ 0.5",
    ar: "هامش صافي الربح ≥ ١٠٪ والرفع المالي ≤ ٠٫٥",
    basis: "LATEST_ANNUAL",
    name: "Quality & low leverage",
    nameAr: "جودة ورفع مالي منخفض",
    rows: [
      { ...emptyRow("metric"), code: "net_margin", operator: ">=", value: "10" },
      { ...emptyRow("metric"), code: "debt_to_equity", operator: "<=", value: "0.5" },
    ],
  },
  {
    en: "ROE between 10 and 25 (banks)",
    ar: "عائد حقوق بين ١٠ و٢٥ (البنوك)",
    basis: "LATEST_ANNUAL",
    name: "Bank ROE range",
    nameAr: "نطاق عائد حقوق البنوك",
    rows: [
      { ...emptyRow("metric"), code: "roe", operator: "between", value: "10", maxValue: "25" },
      { ...emptyRow("sector"), sector: "Banks" },
    ],
  },
]

function CustomScreener({ onOpenCompany }: { onOpenCompany: (id: string) => void }) {
  const { lang, pick } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<BuilderRow[]>([emptyRow("metric")])
  const [name, setName] = useState("")
  const [nameAr, setNameAr] = useState("")
  const [description, setDescription] = useState("")
  const [basis, setBasis] = useState<Basis>("LATEST_ANNUAL")
  const [output, setOutput] = useState<ScanOutput | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  const { data: registry } = useQuery({ queryKey: ["registry"], queryFn: api.registry })

  const { conditions, rowErrors, hasErrors } = useMemo(() => {
    const conds: ScanCondition[] = []
    const errs: Record<number, string[]> = {}
    let bad = false
    const msg = (en: string, ar: string) => (lang === "ar" ? ar : en)
    for (const r of rows) {
      const e: string[] = []
      if (r.kind === "metric") {
        const def = registry?.calculatedMetrics.find((m) => m.code === r.code) ?? registry?.marketMetrics.find((m) => m.code === r.code)
        if (!def) e.push(msg("Select a metric", "اختر مؤشرًا"))
        else if (r.operator === "between") {
          const mn = Number(r.value)
          const mx = Number(r.maxValue)
          if (!Number.isFinite(mn) || !Number.isFinite(mx) || mn > mx) {
            e.push(msg("Minimum must be less than or equal to maximum.", "الحد الأدنى يجب أن يكون أصغر من أو يساوي الحد الأعلى."))
          } else {
            conds.push({ kind: "metric", code: r.code, operator: "between", value: { min: mn, max: mx } })
          }
        } else {
          if (!isOperator(r.operator)) e.push(msg("Invalid operator.", "معامل غير صالح."))
          const v = Number(r.value)
          if (!Number.isFinite(v)) e.push(msg("Enter a numeric threshold.", "أدخل حدًا رقميًا."))
          else conds.push({ kind: "metric", code: r.code, operator: r.operator as Operator, value: v })
        }
      } else if (r.kind === "sector") {
        if (!r.sector.trim()) e.push(msg("Choose a sector.", "اختر قطاعًا."))
        else conds.push({ kind: "sector", sector: r.sector.trim(), operator: r.operator === "!=" ? "!=" : "==" })
      } else if (r.kind === "event") {
        if (!r.eventType) e.push(msg("Choose an event type.", "اختر نوع الحدث."))
        else conds.push({ kind: "event", eventType: r.eventType })
      } else {
        conds.push({
          kind: "dividend",
          statuses: r.dividendStatuses === "paid" ? ["PAID"] : ["ANNOUNCED", "UPCOMING", "ELIGIBLE"],
        })
      }
      if (e.length) bad = true
      errs[r.id] = e
    }
    return { conditions: conds, rowErrors: errs, hasErrors: bad || conds.length === 0 }
  }, [rows, registry, lang])

  const runMutation = useMutation({
    mutationFn: () => api.runScanner({ conditions, periodBasis: basis, name: name.trim() || undefined }),
    onSuccess: (o) => {
      setOutput(o)
      toast({
        title: o.matched.length === 0 ? (lang === "ar" ? "لا نتائج" : "No matches") : lang === "ar" ? "تم التشغيل" : "Run complete",
        description:
          lang === "ar"
            ? `${o.matched.length} مطابقة من ${o.results.length} شركة مقيّمة`
            : `${o.matched.length} matched of ${o.results.length} companies assessed`,
      })
    },
    onError: (e) =>
      toast({
        title: lang === "ar" ? "فشل التشغيل" : "Run failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      }),
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      api.createScanner({
        name: name.trim(),
        nameAr: nameAr.trim() || undefined,
        description: description.trim() || undefined,
        conditions,
      }),
    onSuccess: () => {
      toast({ title: lang === "ar" ? "تم حفظ القاعدة" : "Rule saved", description: name })
      queryClient.invalidateQueries({ queryKey: ["scanners"] })
    },
    onError: (e) =>
      toast({
        title: lang === "ar" ? "فشل الحفظ" : "Save failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      }),
  })

  const addRow = () => setRows((rs) => [...rs, emptyRow("metric")])
  const removeRow = (id: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs))
  const updateRow = (id: number, patch: Partial<BuilderRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const applyExample = useCallback((ex: (typeof EXAMPLES)[number]) => {
    setRows(ex.rows)
    setName(ex.name)
    setNameAr(ex.nameAr)
    setBasis(ex.basis)
    setOutput(null)
  }, [])

  const metricOptions = useMemo(() => registry?.calculatedMetrics ?? [], [registry])

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{lang === "ar" ? "الماسح المخصص" : "Custom screener"}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {lang === "ar"
              ? "اجمع أكثر من شرط، وكلها يجب أن تتحقق معًا. كل نتيجة مبنية من القيم المخزنة فعلاً — والبيانات الناقصة لا تُعامل كصفر."
              : "Combine several conditions; all of them must hold. Every result is built from actual stored values — missing data is never treated as zero."}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Label htmlFor="custom-basis" className="whitespace-nowrap text-xs text-muted-foreground">
              {lang === "ar" ? "الأساس" : "Basis"}
            </Label>
            <Select value={basis} onValueChange={(v) => setBasis(v as Basis)}>
              <SelectTrigger id="custom-basis" className="h-8 w-56 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LATEST_ANNUAL">{lang === "ar" ? "أحدث قوائم سنوية" : "Latest annual statements"}</SelectItem>
                <SelectItem value="LATEST_QUARTERLY">{lang === "ar" ? "أحدث ربع سنوي" : "Latest quarter"}</SelectItem>
                <SelectItem value="LATEST_TTM">{lang === "ar" ? "آخر ١٢ شهرًا (TTM)" : "Trailing twelve months (TTM)"}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="max-w-64 text-[10px] leading-relaxed text-muted-foreground">{BASIS_EXPLAINER[basis][lang]}</p>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-5">
        <Card className="p-0">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Wand2 className="h-4 w-4 text-primary" aria-hidden="true" />
              {lang === "ar" ? "كل هذه الشروط يجب أن تتحقق" : "All of these conditions must hold"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-4 sm:items-end">
              <div className="sm:col-span-2">
                <Label htmlFor="rule-name" className="text-xs text-muted-foreground">
                  {lang === "ar" ? "اسم القاعدة" : "Rule name"}
                </Label>
                <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={lang === "ar" ? "اسم القاعدة" : "Rule name"} className="mt-1 h-9" />
              </div>
              <div>
                <Label htmlFor="rule-name-ar" className="text-xs text-muted-foreground">
                  {lang === "ar" ? "الاسم بالعربية" : "Name (Arabic)"}
                </Label>
                <Input id="rule-name-ar" value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder={lang === "ar" ? "الاسم بالعربية" : "Name (Arabic)"} className="mt-1 h-9" />
              </div>
              <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !name.trim() || hasErrors}>
                <Save className="h-4 w-4" aria-hidden="true" />
                {lang === "ar" ? "حفظ القاعدة" : "Save rule"}
              </Button>
            </div>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={lang === "ar" ? "وصف القاعدة (اختياري)" : "Rule description (optional)"}
              className="h-9 text-sm"
              aria-label={lang === "ar" ? "وصف القاعدة" : "Rule description"}
            />

            {rows.map((row) => {
              const errors = rowErrors[row.id] ?? []
              const metricDef =
                metricOptions.find((m) => m.code === row.code)
              const gloss = metricDef ? metricGloss(metricDef.code) : null
              return (
                <div key={row.id} className="space-y-1.5 rounded-lg border border-border/60 p-2.5">
                  <div className="grid gap-2 sm:grid-cols-[110px_1fr_auto] sm:items-center">
                    <Select
                      value={row.kind}
                      onValueChange={(v) => {
                        const next = emptyRow(v as BuilderRow["kind"])
                        updateRow(row.id, { kind: next.kind, code: next.code, operator: next.operator, value: next.value, sector: next.sector })
                      }}
                    >
                      <SelectTrigger className="h-9" aria-label={lang === "ar" ? "نوع الشرط" : "Condition type"}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="metric">{lang === "ar" ? "مؤشر" : "Metric"}</SelectItem>
                        <SelectItem value="event">{lang === "ar" ? "حدث مالي" : "Financial event"}</SelectItem>
                        <SelectItem value="dividend">{lang === "ar" ? "حالة التوزيعات" : "Dividend status"}</SelectItem>
                        <SelectItem value="sector">{lang === "ar" ? "قطاع" : "Sector"}</SelectItem>
                      </SelectContent>
                    </Select>

                    {row.kind === "metric" ? (
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Select value={row.code} onValueChange={(v) => updateRow(row.id, { code: v })}>
                          <SelectTrigger className="h-9 min-w-0 flex-1" aria-label={lang === "ar" ? "المؤشر" : "Metric"}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="max-h-72">
                            {metricOptions.map((m) => (
                              <SelectItem key={m.code} value={m.code}>
                                {lang === "ar" ? m.labelAr : m.labelEn}
                                {m.unit ? ` · ${m.unit === "PERCENT" ? "%" : m.unit === "EGP" ? (lang === "ar" ? "ج.م" : "EGP") : m.unit}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={row.operator}
                          onValueChange={(v) => updateRow(row.id, { operator: v, maxValue: v === "between" ? "" : row.maxValue })}
                        >
                          <SelectTrigger className="h-9 w-28" aria-label={lang === "ar" ? "المعامل" : "Operator"}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value=">">{">"}</SelectItem>
                            <SelectItem value=">=">{"≥"}</SelectItem>
                            <SelectItem value="<">{"<"}</SelectItem>
                            <SelectItem value="<=">{"≤"}</SelectItem>
                            <SelectItem value="==">{"="}</SelectItem>
                            <SelectItem value="!=">{"≠"}</SelectItem>
                            <SelectItem value="between">{lang === "ar" ? "بين" : "between"}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ) : row.kind === "sector" ? (
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Select value={row.sector || "Banks"} onValueChange={(v) => updateRow(row.id, { sector: v })}>
                          <SelectTrigger className="h-9 min-w-0 flex-1" aria-label={lang === "ar" ? "القطاع" : "Sector"}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="max-h-72">
                            {SECTORS.filter((s) => s !== "Other").map((s) => (
                              <SelectItem key={s} value={s}>
                                {sectorLabel(s, lang)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={row.operator} onValueChange={(v) => updateRow(row.id, { operator: v })}>
                          <SelectTrigger className="h-9 w-28" aria-label={lang === "ar" ? "المعامل" : "Operator"}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="==">{lang === "ar" ? "هو" : "is"}</SelectItem>
                            <SelectItem value="!=">{lang === "ar" ? "ليس" : "is not"}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ) : row.kind === "event" ? (
                      <Select value={row.eventType} onValueChange={(v) => updateRow(row.id, { eventType: v })}>
                        <SelectTrigger className="h-9" aria-label={lang === "ar" ? "نوع الحدث" : "Event type"}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          {(registry?.eventTypes ?? []).length === 0 ? (
                            <SelectItem value="LOSS_TO_PROFIT">{lang === "ar" ? "خسارة إلى ربح" : "Loss to profit"}</SelectItem>
                          ) : (
                            (registry?.eventTypes ?? []).map((e) => (
                              <SelectItem key={e.type} value={e.type}>
                                {lang === "ar" ? e.labelAr : e.labelEn}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Select value={row.dividendStatuses} onValueChange={(v) => updateRow(row.id, { dividendStatuses: v as "active" | "paid" })}>
                        <SelectTrigger className="h-9" aria-label={lang === "ar" ? "حالة التوزيعات" : "Dividend status"}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">{lang === "ar" ? "معلنة أو قادمة أو مستحقة" : "Announced / upcoming / eligible"}</SelectItem>
                          <SelectItem value="paid">{lang === "ar" ? "مصروفة" : "Paid"}</SelectItem>
                        </SelectContent>
                      </Select>
                    )}

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 justify-self-end text-muted-foreground hover:text-destructive"
                      disabled={rows.length === 1}
                      onClick={() => {
                        if (confirmDeleteId === row.id) {
                          removeRow(row.id)
                          setConfirmDeleteId(null)
                        } else setConfirmDeleteId(row.id)
                      }}
                      aria-label={confirmDeleteId === row.id ? (lang === "ar" ? "تأكيد الحذف" : "Confirm delete") : lang === "ar" ? "حذف الشرط" : "Delete condition"}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>

                  {row.kind === "metric" ? (
                    <div className="flex flex-wrap items-center gap-2 ps-1">
                      {row.operator === "between" ? (
                        <>
                          <Input
                            type="number"
                            step="any"
                            className="h-8 w-28 text-xs tabular"
                            value={row.value}
                            onChange={(e) => updateRow(row.id, { value: e.target.value })}
                            placeholder={lang === "ar" ? "الأدنى" : "Min"}
                            aria-label={lang === "ar" ? "الحد الأدنى" : "Minimum"}
                          />
                          <Input
                            type="number"
                            step="any"
                            className="h-8 w-28 text-xs tabular"
                            value={row.maxValue}
                            onChange={(e) => updateRow(row.id, { maxValue: e.target.value })}
                            placeholder={lang === "ar" ? "الأعلى" : "Max"}
                            aria-label={lang === "ar" ? "الحد الأعلى" : "Maximum"}
                          />
                        </>
                      ) : (
                        <Input
                          type="number"
                          step="any"
                          className="h-8 w-32 text-xs tabular"
                          value={row.value}
                          onChange={(e) => updateRow(row.id, { value: e.target.value })}
                          placeholder={lang === "ar" ? "القيمة" : "Value"}
                          aria-label={lang === "ar" ? "قيمة الحد" : "Threshold value"}
                        />
                      )}
                      {gloss ? <span className="text-[10px] leading-snug text-muted-foreground">{lang === "ar" ? gloss.ar : gloss.en}</span> : null}
                    </div>
                  ) : null}

                  {errors.length > 0 ? (
                    <div className="flex items-start gap-1 ps-1">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                      <span className="text-[10px] leading-tight text-warning">{errors.join(" · ")}</span>
                    </div>
                  ) : null}
                </div>
              )
            })}

            <div className="flex flex-col gap-2 pt-1 sm:flex-row">
              <Button variant="outline" size="sm" onClick={addRow} disabled={hasErrors} className="text-xs">
                <Plus className="h-4 w-4" aria-hidden="true" />
                {lang === "ar" ? "إضافة شرط" : "Add condition"}
              </Button>
              <Button size="sm" onClick={() => runMutation.mutate()} disabled={runMutation.isPending || hasErrors} className="text-xs">
                <Play className="h-4 w-4" aria-hidden="true" />
                {lang === "ar" ? "تشغيل" : "Run"}
              </Button>
            </div>

            {hasErrors ? (
              <div className="flex items-start gap-1.5 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{lang === "ar" ? "صحح الأخطاء في الشروط أعلاه قبل التشغيل." : "Fix the condition errors above before running."}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {output === null && !runMutation.isPending ? (
          <Card className="p-3">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{lang === "ar" ? "أمثلة سريعة" : "Quick examples"}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-3">
              {EXAMPLES.map((ex) => (
                <Button key={ex.name} variant="outline" size="sm" onClick={() => applyExample(ex)} className="h-auto flex-col items-start gap-0.5 py-2 text-start text-xs">
                  <span className="font-medium">{lang === "ar" ? ex.ar : ex.en}</span>
                  <span className="text-[10px] font-normal text-muted-foreground">{basisLabel(ex.basis, lang)}</span>
                </Button>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {runMutation.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : output ? (
          <ResultsPane
            output={output}
            ruleTitle={name.trim() || (lang === "ar" ? "نتيجة الماسح" : "Screener result")}
            onOpenCompany={onOpenCompany}
            onOpenPremium={() => router.push("/premium")}
          />
        ) : (
          <EmptyState
            icon={Play}
            title={lang === "ar" ? "شغّل الماسح لعرض النتائج" : "Run the screener to see results"}
            description={
              lang === "ar"
                ? "كل شركة في النتائج ستُعرض مع سبب المطابقة، والفترة التي قُيّمت عليها."
                : "Every company in the results is shown with the reason it matched and the period it was assessed on."
            }
          />
        )}
      </div>
    </div>
  )
}
