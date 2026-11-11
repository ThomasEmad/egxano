// EGXANO — brand constants and the metric glossary used by the UI.
//
// Everything here must stay truthful to what the product does. Copy that
// promises profits, accuracy beyond the published filings, or "live" prices
// does not belong in this file.

import { formatEgp } from "@/lib/financial/units"

export const BRAND = {
  name: "EGXANO",
  nameAr: "إيجيكسّانو",
  taglineAr: "افهم السهم قبل ما تقرر.",
  taglineEn: "Understand the stock before you decide.",
  supportAr:
    "افهم الشركات، قارن أداءها، وشوف الصورة المالية والفنية للسوق المصري من مكان واحد — مع مصدر وتاريخ كل رقم.",
  supportEn:
    "Understand the companies, compare their performance, and see the financial and technical picture of the Egyptian market in one place — with the source and date of every figure.",
  descriptionAr:
    "منصة بحث للبورصة المصرية: القوائم المالية المنشورة، النسب المحسوبة، المقارنات المنضبطة، والسياق الفني — بالعربي والإنجليزي.",
  descriptionEn:
    "Egyptian stock market research: published financial statements, calculated ratios, fair comparisons and technical context — in Arabic and English.",
  trustLineAr: "بيانات من الإفصاحات المنشورة · القيم غير المتاحة تظهر «—» · أسعار متأخرة 15 دقيقة",
  trustLineEn: "Data from published filings · unavailable values show “—” · prices delayed 15 min",
  notAdviceAr: "أداة بحث ومعلومات — ليست نصيحة استثمارية.",
  notAdviceEn: "A research and information tool — not investment advice.",
} as const

export const TRUST = {
  source: { ar: "المصدر", en: "Source" },
  sourceFiling: { ar: "الإفصاح المالي المنشور", en: "Published financial filing" },
  lastUpdated: { ar: "آخر تحديث", en: "Last updated" },
  reportingPeriod: { ar: "الفترة المالية", en: "Reporting period" },
  calculated: { ar: "قيمة محسوبة", en: "Calculated" },
  reported: { ar: "قيمة كما وردت", en: "As reported" },
  unavailable: { ar: "غير متاح — لم يُنشر", en: "Not reported" },
  delayed: { ar: "أسعار متأخرة 15 دقيقة", en: "Prices delayed 15 min" },
  aiInterpretation: {
    ar: "تحليل بالذكاء الاصطناعي — تفسير مساعد، ليس توصية",
    en: "AI-assisted analysis — interpretation, not advice",
  },
  needsReview: { ar: "تحت المراجعة", en: "Under review" },
  comparablePeriod: { ar: "فترة قابلة للمقارنة", en: "Comparable period" },
  incompleteCoverage: { ar: "تغطية بيانات غير مكتملة", en: "Incomplete data coverage" },
} as const

export interface MetricGloss {
  en: string
  ar: string
  /** Short label used under a value, e.g. "السعر ÷ الربحية" */
  formulaEn?: string
  formulaAr?: string
}

/**
 * Plain-language explanations for the metrics that appear most often in the
 * UI. Keep descriptions descriptive, never an instruction to buy or sell.
 */
export const METRIC_GLOSSARY: Record<string, MetricGloss> = {
  revenue: {
    en: "Total revenue reported in the income statement for the period.",
    ar: "إجمالي الإيرادات المعلنة في قائمة الدخل عن الفترة.",
  },
  net_profit: {
    en: "Profit after tax attributable to the period, as reported or calculated from the published statement.",
    ar: "صافي الربح بعد الضرائب عن الفترة، كما ورد في القوائم المنشورة أو محسوبًا منها.",
  },
  total_assets: {
    en: "Everything the company owns, from the balance sheet.",
    ar: "إجمالي ما تملكه الشركة، من قائمة المركز المالي.",
  },
  total_equity: {
    en: "Shareholders' equity — assets minus liabilities.",
    ar: "حقوق الملكية — الأصول ناقص الالتزامات.",
  },
  eps: {
    en: "Earnings per share: net profit divided by the number of shares.",
    ar: "ربحية السهم: صافي الربح مقسومًا على عدد الأسهم.",
    formulaEn: "Net profit ÷ shares",
    formulaAr: "صافي الربح ÷ عدد الأسهم",
  },
  roe: {
    en: "Return on equity — how much profit the company generates on shareholders' equity. Not meaningful for loss-making periods.",
    ar: "العائد على حقوق الملكية — مقدار الربح المتحقق على حقوق المساهمين. لا يكون ذا معنى في فترات الخسارة.",
  },
  roa: {
    en: "Return on assets — profit relative to total assets.",
    ar: "العائد على الأصول — الربح منسوبًا إلى إجمالي الأصول.",
  },
  net_margin: {
    en: "Net profit as a share of revenue.",
    ar: "صافي الربح كنسبة من الإيرادات.",
    formulaEn: "Net profit ÷ revenue",
    formulaAr: "صافي الربح ÷ الإيرادات",
  },
  gross_margin: {
    en: "Gross profit as a share of revenue.",
    ar: "إجمالي الربح كنسبة من الإيرادات.",
  },
  operating_margin: {
    en: "Operating profit as a share of revenue.",
    ar: "الربح التشغيلي كنسبة من الإيرادات.",
  },
  p_e: {
    en: "Price-to-earnings: the share price divided by earnings per share. Shown only when earnings are positive.",
    ar: "مضاعف الربحية: سعر السهم مقسومًا على ربحية السهم. يظهر فقط عندما تكون الأرباح موجبة.",
    formulaEn: "Price ÷ EPS",
    formulaAr: "السعر ÷ ربحية السهم",
  },
  p_b: {
    en: "Price-to-book: share price relative to book value per share.",
    ar: "مضاعف القيمة الدفترية: سعر السهم مقارنةً بالقيمة الدفترية للسهم.",
  },
  debt_to_equity: {
    en: "Total debt relative to shareholders' equity — a leverage measure.",
    ar: "إجمالي الدين مقارنةً بحقوق الملكية — مؤشر على الرفع المالي.",
  },
  interest_coverage: {
    en: "How many times operating profit covers interest expense.",
    ar: "عدد المرات التي يغطي فيها الربح التشغيلي مصروف الفائدة.",
  },
  current_ratio: {
    en: "Current assets divided by current liabilities — short-term liquidity.",
    ar: "الأصول المتداولة مقسومة على الالتزامات المتداولة — السيولة قصيرة الأجل.",
  },
  free_cash_flow: {
    en: "Cash generated by operations after capital spending.",
    ar: "النقد المتولد من التشغيل بعد الإنفاق الرأسمالي.",
  },
  dividend_yield: {
    en: "Dividend per share relative to the share price. Shown only when a distribution is recorded.",
    ar: "التوزيع لكل سهم منسوبًا إلى سعر السهم. يظهر فقط عند تسجيل توزيع.",
  },
  market_cap: {
    en: "Market value: share price multiplied by shares outstanding.",
    ar: "القيمة السوقية: سعر السهم مضروبًا في عدد الأسهم.",
  },
  book_value_per_share: {
    en: "Shareholders' equity divided by shares outstanding.",
    ar: "حقوق الملكية مقسومة على عدد الأسهم.",
  },
  total_debt: {
    en: "Borrowings and debt obligations from the balance sheet.",
    ar: "القروض والالتزامات المالية من قائمة المركز المالي.",
  },
  working_capital: {
    en: "Current assets minus current liabilities.",
    ar: "الأصول المتداولة ناقص الالتزامات المتداولة.",
  },
}

export function metricGloss(code: string): MetricGloss | null {
  return METRIC_GLOSSARY[code] ?? null
}

/** Arabic label shown next to the English ticker when a company has one. */
export function companyDisplayName(
  company: { nameEn: string; nameAr?: string | null },
  lang: "en" | "ar",
): string {
  return lang === "ar" ? (company.nameAr ?? company.nameEn) : company.nameEn
}

/**
 * EGP amount with the Arabic currency label in AR mode, keeping Latin digits
 * and tabular alignment. Presentation-only: the number itself always comes
 * from the financial formatting helpers.
 */
export function formatMoney(
  value: number | null | undefined,
  lang: "en" | "ar",
  opts?: { withCurrency?: boolean; decimals?: number },
): string {
  const text = formatEgp(value, opts)
  return lang === "ar" ? text.replace("EGP", "ج.م") : text
}

/** Bilingual date formatter: Latin digits, locale-aware month names. */
export function formatDate(
  value: string | Date | null | undefined,
  lang: "en" | "ar",
  opts?: Intl.DateTimeFormatOptions,
): string {
  if (!value) return "—"
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...opts,
  }).format(date)
}
