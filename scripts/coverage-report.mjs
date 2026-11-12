// Symbol-by-symbol data coverage report (production DB).
// Outputs: reports/market-coverage.json + reports/market-coverage.md
// Read-only — no writes to the database.
import { PrismaClient } from "@prisma/client";
import { writeFileSync, mkdirSync } from "node:fs";

const prisma = new PrismaClient();

const q = String.raw`
WITH bars AS (
  SELECT "companyId",
         COUNT(*)::int AS sessions,
         MIN(ts) AS first_ts,
         MAX(ts) AS last_ts,
         COUNT(volume) FILTER (WHERE volume IS NOT NULL)::int AS vol_sessions
  FROM "PriceBar" GROUP BY "companyId"
), prices AS (
  SELECT "companyId",
         COUNT(*)::int AS price_days,
         MIN("asOf") AS first_asof,
         MAX("asOf") AS last_asof
  FROM "MarketPrice" GROUP BY "companyId"
)
SELECT c.ticker, c."nameEn", c."listingStatus",
       COALESCE(b.sessions,0) AS bar_sessions,
       b.first_ts, b.last_ts,
       COALESCE(b.vol_sessions,0) AS bar_vol_sessions,
       COALESCE(p.price_days,0) AS price_days,
       p.first_asof, p.last_asof
FROM "Company" c
LEFT JOIN bars b ON b."companyId" = c.id
LEFT JOIN prices p ON p."companyId" = c.id
ORDER BY c.ticker;
`;

async function main() {
  const rows = await prisma.$queryRawUnsafe(q);
  const now = new Date().toISOString();
  const withBars = rows.filter((r) => r.bar_sessions > 0);
  const withPrices = rows.filter((r) => r.price_days > 0);
  // Rows carry Date objects — sort numerically via valueOf, never lexically.
  const minDate = (arr, pick) =>
    arr.map(pick).sort((a, b) => a.valueOf() - b.valueOf())[0] ?? null;
  const maxDate = (arr, pick) =>
    arr.map(pick).sort((a, b) => b.valueOf() - a.valueOf())[0] ?? null;
  const summary = {
    generatedAt: now,
    companies: rows.length,
    listed: rows.filter((r) => r.listingStatus === "LISTED").length,
    priceBarCoverage: {
      companiesWithBars: withBars.length,
      totalSessions: rows.reduce((s, r) => s + r.bar_sessions, 0),
      sessionsWithVolume: rows.reduce((s, r) => s + r.bar_vol_sessions, 0),
      volumeCoveragePct:
        withBars.reduce((s, r) => s + r.bar_sessions, 0) > 0
          ? Math.round(
              (rows.reduce((s, r) => s + r.bar_vol_sessions, 0) /
                rows.reduce((s, r) => s + r.bar_sessions, 0)) * 1000,
            ) / 10
          : 0,
      oldestBar: minDate(withBars, (r) => new Date(r.first_ts)),
    },
    marketPriceCoverage: {
      companiesWithPrices: withPrices.length,
      totalRows: rows.reduce((s, r) => s + r.price_days, 0),
      newestPrice: maxDate(withPrices, (r) => new Date(r.last_asof)),
    },
    noDataAtAll: rows.filter((r) => r.bar_sessions === 0 && r.price_days === 0).map((r) => r.ticker),
  };

  const md = [
    "# EGXANO Market Coverage Report (generated)",
    "",
    `Generated: ${now}`,
    "",
    `- Companies: **${summary.companies}** (listed: ${summary.listed})`,
    `- PriceBar (daily OHLCV, pruned to 120d): ${summary.priceBarCoverage.companiesWithBars} companies, ${summary.priceBarCoverage.totalSessions} sessions, volume present in ${summary.priceBarCoverage.volumeCoveragePct}%`,
    `- MarketPrice (daily closes from scanner refreshes, pruned to 400d): ${summary.marketPriceCoverage.companiesWithPrices} companies, ${summary.marketPriceCoverage.totalRows} rows, newest ${summary.marketPriceCoverage.newestPrice}`,
    `- Companies with NO price data at all: ${summary.noDataAtAll.length ? summary.noDataAtAll.join(", ") : "none"}`,
    "",
    "## Per-symbol coverage",
    "",
    "| ticker | bar sessions | bar first | bar last | bar vol sessions | price days | price last |",
    "|---|---:|---|---|---:|---:|---|",
    ...rows.map(
      (r) =>
        `| ${r.ticker} | ${r.bar_sessions} | ${r.first_ts ? new Date(r.first_ts).toISOString().slice(0, 10) : "—"} | ${r.last_ts ? new Date(r.last_ts).toISOString().slice(0, 10) : "—"} | ${r.bar_vol_sessions} | ${r.price_days} | ${r.last_asof ? new Date(r.last_asof).toISOString().slice(0, 10) : "—"} |`,
    ),
    "",
  ].join("\n");

  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/market-coverage.json", JSON.stringify({ summary, rows }, null, 2));
  writeFileSync("reports/market-coverage.md", md);
  console.log(JSON.stringify(summary, null, 2));
  console.log("per-symbol rows:", rows.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
