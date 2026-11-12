-- Market intelligence upgrade — additive migration.
-- Adds:
--   1. MarketPrice.volume / MarketPrice.valueTraded  (session share volume and
--      price × volume from scanner pulls — liquidity history accrues forward;
--      no backfill is fabricated),
--   2. MarketIntelligenceDay (one row per session: whole-market breadth /
--      regime / pulse snapshot JSON + cheap scalar counters for history scans
--      — the durable series behind the A/D line and rotation deltas).
-- No existing column or row is altered or dropped. Rollback = drop the new
-- columns/table.
ALTER TABLE "MarketPrice" ADD COLUMN "volume" DOUBLE PRECISION;
ALTER TABLE "MarketPrice" ADD COLUMN "valueTraded" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "MarketIntelligenceDay" (
    "id" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "advancing" INTEGER NOT NULL,
    "declining" INTEGER NOT NULL,
    "unchanged" INTEGER NOT NULL,
    "regime" TEXT,
    "pulse" INTEGER,
    "sourceName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketIntelligenceDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketIntelligenceDay_day_key" ON "MarketIntelligenceDay"("day");
CREATE INDEX "MarketIntelligenceDay_day_idx" ON "MarketIntelligenceDay"("day");
