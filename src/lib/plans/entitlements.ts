// Single source of truth for the plans and their REAL, enforced entitlements.
// Every gate in the codebase (signals board rows, portfolio, QA quota, events,
// scanners, ads, PDF report) MUST derive its limit from this file so that the
// marketing copy on /premium can never drift from what the app actually enforces.
//
// 2026-11-14 pricing restructure (owner decision):
//   • "Pro Plus" is REMOVED from the sale — existing PRO_PLUS/PREMIUM
//     subscriptions keep FULL paid access (see LEGACY_PAID_PLAN_IDS) so no
//     paying user ever silently drops to the free tier.
//   • New third plan PRO_3M: 3 months, 450 EGP total, promo = 50% off the
//     FIRST MONTH ONLY (first cycle 375 EGP instead of 450).

export type PlanId = "FREE" | "PRO" | "PRO_3M"

export interface PlanLimits {
  /** Rows fully visible on the technical signals board (rest locked). */
  signalsRows: number | "ALL"
  /** Tracked portfolio holdings. */
  portfolioHoldings: number | "UNLIMITED"
  /** AI Q&A per day (enforced, not advertised). */
  qaPerDay: number
  /** Price alerts. */
  alerts: number | "UNLIMITED"
  /** Watchlist items. */
  watchlist: number | "UNLIMITED"
  /** Company events feed access. */
  events: boolean
  /** Saved scanner runs. */
  scanners: boolean
  /** Printable per-company PDF report. */
  pdfReport: boolean
  /** Site-wide ads. */
  ads: boolean
}

export interface PlanDef {
  id: PlanId
  nameAr: string
  nameEn: string
  taglineAr: string
  price: number
  offerPrice: number | null
  offerActive: boolean
  offerLabelAr: string | null
  currency: "EGP"
  durationDays: number
  /** Marketing bullets — each bullet must map to an enforced limit above. */
  featuresAr: string[]
  limits: PlanLimits
}

const fortyOff = (price: number) => Math.round(price * 0.6)

export const PLANS: Record<PlanId, PlanDef> = {
  FREE: {
    id: "FREE",
    nameAr: "المجانية",
    nameEn: "Free",
    taglineAr: "جرّب المنصة كاملة قبل ما تدفع",
    price: 0,
    offerPrice: null,
    offerActive: false,
    offerLabelAr: null,
    currency: "EGP",
    durationDays: 0,
    featuresAr: [
      "كل الشركات ببياناتها المالية الأساسية وقوائمها الربعية",
      "الخريطة الحرارية وخريطة القطاعات كاملة",
      "المقارنة حتى 4 شركات + التوزيعات + جداول الترتيب",
      "أول 5 شركات كاملة في لوحة الإشارات الفنية — دخول/هدف/وقف خسارة",
      "محفظة لشركتين + قائمة مراقبة 10 أسهم + 5 تنبيهات سعر",
      "نتائج الفلاتر الحقيقية على السوق كامل — التفاصيل المدفوعة مقفولة",
    ],
    limits: {
      signalsRows: 5,
      portfolioHoldings: 2,
      qaPerDay: 20,
      alerts: 5,
      watchlist: 10,
      events: false,
      scanners: false,
      pdfReport: false,
      ads: true,
    },
  },
  PRO: {
    id: "PRO",
    nameAr: "برو",
    nameEn: "Pro",
    taglineAr: "للتاجر اللي بيتابع السوق يوميًا",
    price: 150,
    offerPrice: fortyOff(150),
    offerActive: true,
    offerLabelAr: "أول شهر بخصم 40% — 90 ج أول شهر",
    currency: "EGP",
    durationDays: 30,
    featuresAr: [
      "كل مزايا المجانية — وبدون إعلانات",
      "لوحة الإشارات الفنية كاملة: كل الشركات + كل الفلاتر والفرز",
      "التحليل الفني الشامل لكل شركة (مش أول 5 بس): اتجاه وزخم وحجم ومخاطرة",
      "مناطق الدخول والأهداف ووقف الخسارة لكل إشارة",
      "أحداث الشركات الاستثمارية + الماسحات المخصصة المحفوظة",
      "محفظة بلا حدود + قائمة مراقبة 50 سهم + 30 تنبيه سعر",
    ],
    limits: {
      signalsRows: "ALL",
      portfolioHoldings: "UNLIMITED",
      qaPerDay: 60,
      alerts: 30,
      watchlist: 50,
      events: true,
      scanners: true,
      pdfReport: false,
      ads: false,
    },
  },
  PRO_3M: {
    id: "PRO_3M",
    nameAr: "برو — 3 شهور",
    nameEn: "Pro Quarterly",
    taglineAr: "للتابع المستمر اللي مش عايز يفكر في التجديد كل شهر",
    price: 450,
    offerPrice: 375,
    offerActive: true,
    offerLabelAr: "خصم 50% على أول شهر — أول دورة 375 ج بدل 450",
    currency: "EGP",
    durationDays: 90,
    featuresAr: [
      "نفس كل مزايا باقة برو بالظبط — ما بينها أي فرق",
      "اشتراك 3 شهور كاملة بدفعة واحدة",
      "خصم 50% على أول شهر بس — أول دورة 375 ج بدل 450",
      "بدون تجديد شهري وبدون انقطاع في الإشارات والتنبيهات",
    ],
    limits: {
      signalsRows: "ALL",
      portfolioHoldings: "UNLIMITED",
      qaPerDay: 60,
      alerts: 30,
      watchlist: 50,
      events: true,
      scanners: true,
      pdfReport: true,
      ads: false,
    },
  },
}

/** Rows visible for free users on the signals board (kept for quick import). */
export const FREE_SIGNALS_ROWS = 5

/** First-month price used on PaymentRequest creation when the offer is active. */
export function effectiveFirstMonthPrice(plan: PlanDef): number {
  return plan.offerActive && plan.offerPrice != null ? plan.offerPrice : plan.price
}

/** Which plans count as "paid/premium" for isPremiumUser-style checks. */
export const PAID_PLAN_IDS: PlanId[] = ["PRO", "PRO_3M"]

/**
 * Retired plan names that still map to FULL paid access. Any subscriber whose
 * row predates the pricing restructure (PRO_PLUS / legacy PREMIUM) keeps every
 * paid entitlement — a legacy name must never resolve to the free tier.
 */
const LEGACY_PAID_PLAN_IDS: readonly string[] = ["PRO_PLUS", "PRO PLUS", "PROPLUS", "PREMIUM", "PREMIUM_PLUS", "PREMIUMPLUS"]

export function isPaidPlanId(name: string): boolean {
  const normalized = name.trim().toUpperCase()
  return (
    (PAID_PLAN_IDS as string[]).includes(normalized) || LEGACY_PAID_PLAN_IDS.includes(normalized)
  )
}

// =============================================================================
// FREE-ACCESS UNIVERSE (2026-11-14 hardening — closes the filter-bypass hole)
// =============================================================================
// Product decision: a free user's ENTIRE technical coverage is a FIXED set of
// 5 companies — not "the first 5 rows of whatever the current filter/sort
// produces". Filters, sorting, pagination and direct API calls can shuffle the
// board all they want: for FREE/anonymous callers the API itself intersects
// every response with this set, so no filter combination can ever reveal a
// sixth company and no locked ticker name ever leaves the server.
//
// The five are liquid EGX30 large caps across different sectors with reliable
// candle coverage. Changing this list is a product decision — server-side only.
export const FREE_SIGNAL_TICKERS = ["COMI", "ETEL", "TMGH", "ABUK", "EFID"] as const

export const FREE_SIGNAL_SET: ReadonlySet<string> = new Set(FREE_SIGNAL_TICKERS)

export function isFreeSignalTicker(ticker: string): boolean {
  return FREE_SIGNAL_SET.has(ticker.trim().toUpperCase())
}
