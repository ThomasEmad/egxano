// EGX trading session helpers — shared by the live-refresh hook and UI badges.
//
// The Egyptian Exchange trades Sunday–Thursday (weekend is Friday/Saturday):
//   • opening auction  09:30–10:00 Cairo
//   • continuous trade 10:00–14:30 Cairo
//   • closing auction  14:30–14:45 Cairo
// We treat 09:45–14:45 on a trading day as "market live" — data can genuinely
// move inside that window, so the dashboard polls faster there and relaxes
// outside it. All arithmetic is done in Africa/Cairo via Intl APIs, never via
// the server's timezone, so a UTC lambda and a Cairo browser agree.

export const EGX_TIMEZONE = "Africa/Cairo"

/** Weekday in Cairo: 0=Sunday … 6=Saturday (Intl "short" maps to this order via en-US weekdays). */
function cairoParts(date: Date): { weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: EGX_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]))
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const weekday = weekdays.indexOf(parts.weekday)
  const hour = Number(parts.hour) % 24
  const minutes = hour * 60 + Number(parts.minute)
  return { weekday, minutes }
}

/** Trading days: Sunday (0) through Thursday (4). */
export function isEgxTradingDay(date: Date = new Date()): boolean {
  const { weekday } = cairoParts(date)
  return weekday >= 0 && weekday <= 4
}

export const EGX_OPEN_MINUTES = 9 * 60 + 45 // 09:45 — opening auction underway
export const EGX_CLOSE_MINUTES = 14 * 60 + 45 // 14:45 — closing auction done

/** True while the session can actually move prices (trading day, 09:45–14:45 Cairo). */
export function isEgxMarketLive(date: Date = new Date()): boolean {
  if (!isEgxTradingDay(date)) return false
  const { minutes } = cairoParts(date)
  return minutes >= EGX_OPEN_MINUTES && minutes <= EGX_CLOSE_MINUTES
}

export interface EgxMarketStatus {
  live: boolean
  tradingDay: boolean
  /** Arabic label for the badge, e.g. "السوق مفتوح الآن" / "السوق مقفول — يفتح الأحد ٩:٤٥ ص" */
  ar: string
  en: string
  /** Minutes (may be fractional) until the next market open; 0 when open. */
  minutesToOpen: number
}

const DAY_AR = ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"]
const DAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function fmtTime(minutes: number): string {
  const h24 = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  const arH = h24 > 12 ? h24 - 12 : h24
  const suffixAr = h24 >= 12 ? "م" : "ص"
  return `${arH}${m ? ":" + String(m).padStart(2, "0") : ""}${suffixAr}`
}

export function egxMarketStatus(date: Date = new Date()): EgxMarketStatus {
  const { weekday, minutes } = cairoParts(date)
  const tradingDay = isEgxTradingDay(date)
  const live = tradingDay && minutes >= EGX_OPEN_MINUTES && minutes <= EGX_CLOSE_MINUTES
  if (live) {
    const minutesLeft = EGX_CLOSE_MINUTES - minutes
    const closeHintAr = minutesLeft <= 30 ? ` — هيفصل بعد ${minutesLeft} دقيقة` : ""
    return {
      live: true,
      tradingDay,
      ar: `السوق مفتوح الآن${closeHintAr}`,
      en: "Market is live now",
      minutesToOpen: 0,
    }
  }

  // Find the next open: same day if before the open, else the next trading day.
  let day = weekday
  let minutesToOpen: number
  if (tradingDay && minutes < EGX_OPEN_MINUTES) {
    minutesToOpen = EGX_OPEN_MINUTES - minutes
  } else {
    minutesToOpen = (24 * 60 - minutes) + EGX_OPEN_MINUTES
    for (let i = 1; i <= 7; i++) {
      const candidate = (weekday + i) % 7
      day = candidate
      if (candidate <= 4) break // Sun..Thu
      minutesToOpen += 24 * 60
    }
  }
  return {
    live: false,
    tradingDay,
    ar: `السوق مقفول — يفتح ${DAY_AR[day]} ${fmtTime(EGX_OPEN_MINUTES)}`,
    en: `Market closed — opens ${DAY_EN[day]} 09:45 AM`,
    minutesToOpen,
  }
}
