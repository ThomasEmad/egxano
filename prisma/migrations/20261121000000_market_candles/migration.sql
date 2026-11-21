-- Daily OHLCV candles: the ONE verified history every analysis reads.
-- One row per (companyId, tradeDate). Rows that passed candle-quality
-- validation are stored with verified=true; failed fetches/reconciliations
-- are stored verified=false for audit and are never read by analysis.
CREATE TABLE IF NOT EXISTS "MarketCandle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "tradeDate" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION,
    "sourceName" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketCandle_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "MarketCandle_companyId_tradeDate_key" ON "MarketCandle"("companyId", "tradeDate");
CREATE INDEX IF NOT EXISTS "MarketCandle_companyId_tradeDate_idx" ON "MarketCandle"("companyId", "tradeDate");

-- Symbol resolution cache: which Yahoo symbol actually carries each EGX
-- ticker's history (ticker.CA direct, or the name-search fallback), so the
-- daily refresh never re-pays the search/probe cost.
CREATE TABLE IF NOT EXISTS "MarketCandleSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "yahooSymbol" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "sourceFirstTradeDate" TIMESTAMP(3),
    "lastFetchAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketCandleSource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "MarketCandleSource_companyId_key" ON "MarketCandleSource"("companyId");
