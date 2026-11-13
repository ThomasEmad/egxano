// Market-tier classification for the EGX universe.
//
// One tier per company, stored on Company.marketTier (default "MAIN"):
//   EGX30 — heavy-weight blue-chip index constituents
//   EGX70 — mid/small-cap index constituents
//   MAIN  — main market, outside both indices (Nilex companies are folded
//           in here since the Nilex board tier was retired as a category)
//   OTC   — خارج المقصورة (suspended / not listed for regular trading)
//
// The constituent lists below are REAL data gathered from egxbot.com and
// egx.com.eg in November 2026. They are seed lists only — the admin can
// override any company's tier through the market-tier API, and the seed's
// activity-based sweep re-classifies MAIN companies with no recent price
// activity into OTC (see /api/v1/admin/market-tier).

export const MARKET_TIERS = ["EGX30", "EGX70", "MAIN", "OTC"] as const

export type MarketTier = (typeof MARKET_TIERS)[number]

/** Arabic display labels for UI surfaces (short = badges, full = detail rows). */
export const TIER_AR: Record<MarketTier, { short: string; full: string; en: string }> = {
  EGX30: { short: "مؤشر 30", full: "ضمن مؤشر EGX30 الثقيل", en: "EGX30 index" },
  EGX70: { short: "مؤشر 70", full: "ضمن مؤشر EGX70", en: "EGX70 index" },
  MAIN: { short: "الرئيسي", full: "السوق الرئيسي — خارج المؤشرات", en: "Main market" },
  OTC: { short: "خارج المقصورة", full: "خارج المقصورة — غير مدرج للتداول العادي", en: "OTC / suspended" },
}

/**
 * EGX30 constituents — exactly 30 names (egxbot.com + egx.com.eg, November
 * 2026). VLMRA = Valmore Holding's primary listed class; VLMR (the second
 * share class) and CANA are deliberately excluded — neither is an EGX30 or
 * EGX70 constituent.
 */
export const EGX30_TICKERS = [
  "ETEL", "EAST", "CCAP", "COMI", "TMGH", "FWRY", "ORAS", "BTFH", "ORHD", "GBCO",
  "AMOC", "ABUK", "EGAL", "PHDC", "JUFO", "MFPC", "EMFD", "HELI", "MCQE", "ISPH",
  "RMDA", "VLMRA", "HRHO", "ADIB", "EFIH", "SKPC", "RAYA", "EFID", "CLHO", "ALCN",
]

/** EGX70 constituents (egxbot.com, November 2026). */
export const EGX70_TICKERS = [
  "MPCO", "MPCI", "POUL", "NIPH", "AIHC", "PRCL", "HDBK", "SIPC", "AMER", "PHAR",
  "ENGC", "ATQA", "NCCW", "EGTS", "SCEM", "ICFC", "GPIM", "ZMID", "BONY", "ATLC",
  "MCRO", "ETRS", "SWDY", "MPRC", "EGCH", "ARAB", "SVCE", "ISMA", "MBSC", "OIH",
  "LCSW", "IDRE", "CIEB", "ORWE", "ELSH", "IEEC", "GOUR", "UEGC", "KABO", "AIFI",
  "ELEC", "ARCC", "AIDC", "DSCW", "MASR", "SDTI", "OCDI", "ASPI", "MTIE", "PRDC",
  "DAPH", "OFH", "AMIA", "TAQA", "EXPA", "ELKA", "ACTF", "MOED", "MEPA", "ZEOT",
  "OBRI", "ISMQ", "EHDR", "UNIP", "VALU", "GDWA", "COSG", "CSAG", "ASCM", "CNFN",
]

/** Type guard: true only for a tier string in MARKET_TIERS. */
export function isMarketTier(v: unknown): v is MarketTier {
  return typeof v === "string" && (MARKET_TIERS as readonly string[]).includes(v)
}
