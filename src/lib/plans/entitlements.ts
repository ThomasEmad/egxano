// Single source of truth for the 3 plans and their REAL, enforced entitlements.
// Every gate in the codebase (signals board rows, portfolio, QA quota, events,
// scanners, ads, PDF report) MUST derive its limit from this file so that the
// marketing copy on /premium can never drift from what the app actually enforces.

export type PlanId = "FREE" | "PRO" | "PRO_PLUS"

export interface PlanLimits {
  /** Rows fully visible on the technical signals board (rest locked). */
  signalsRows: number | "ALL"
  /** Tracked portfolio holdings. */
  portfolioHoldings: number | "UNLIMITED"
  /** AI Q&A per day. */
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
    taglineAr: "جرّب المنصة قبل ما تدفع",
    price: 0,
    offerPrice: null,
    offerActive: false,
    offerLabelAr: null,
    currency: "EGP",
    durationDays: 0,
    featuresAr: [
      "كل الشركات وقوائمها وبياناتها المالية الأساسية",
      "أول 5 شركات في لوحة الإشارات الفنية مع مناطق الدخول والخروج ووقف الخسارة",
      "تتبع شركتين في المحفظة",
      "20 سؤال ذكي في اليوم",
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
    offerLabelAr: "أول شهر بخصم 40%",
    currency: "EGP",
    durationDays: 30,
    featuresAr: [
      "كل مزايا المجانية، وبدون إعلانات",
      "لوحة الإشارات الفنية كاملة: كل الشركات + كل الفلاتر",
      "مناطق الدخول والخروج ووقف الخسارة لكل إشارة",
      "أحداث الشركات والماسحات المحفوظة",
      "محفظة بلا حدود",
      "60 سؤال ذكي في اليوم",
      "30 تنبيه سعر + 50 سهم في قائمة المراقبة",
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
  PRO_PLUS: {
    id: "PRO_PLUS",
    nameAr: "برو بلس",
    nameEn: "Pro Plus",
    taglineAr: "للمحلل اللي عايز كل حاجة على أعلى مستوى",
    price: 300,
    offerPrice: fortyOff(300),
    offerActive: true,
    offerLabelAr: "أول شهر بخصم 40%",
    currency: "EGP",
    durationDays: 30,
    featuresAr: [
      "كل مزايا برو، وبدون إعلانات",
      "تقرير PDF احترافي قابل للطباعة لكل شركة",
      "120 سؤال ذكي في اليوم",
      "100 تنبيه سعر + قائمة مراقبة بلا حدود",
    ],
    limits: {
      signalsRows: "ALL",
      portfolioHoldings: "UNLIMITED",
      qaPerDay: 120,
      alerts: 100,
      watchlist: "UNLIMITED",
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
export const PAID_PLAN_IDS: PlanId[] = ["PRO", "PRO_PLUS"]

export function isPaidPlanId(name: string): boolean {
  return PAID_PLAN_IDS.includes(name as PlanId)
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
