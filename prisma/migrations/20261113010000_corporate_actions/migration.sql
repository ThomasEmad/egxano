-- Corporate actions for ex-date price adjustment (additive, non-destructive).
-- Powers the daily-change engine: a bonus/split/rights/cash ex-date is a
-- mechanical price drop, never a market loss.
CREATE TABLE "CorporateAction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ticker" TEXT,
    "actionType" TEXT NOT NULL,
    "exDate" TIMESTAMP(3) NOT NULL,
    "recordDate" TIMESTAMP(3),
    "distributionDate" TIMESTAMP(3),
    "announcementDate" TIMESTAMP(3),
    "ratioNumerator" BIGINT,
    "ratioDenominator" BIGINT,
    "cashPerShare" DOUBLE PRECISION,
    "subscriptionPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "status" TEXT,
    "sourceName" TEXT NOT NULL,
    "sourceId" TEXT,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorporateAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CorporateAction_companyId_idx" ON "CorporateAction"("companyId");
CREATE INDEX "CorporateAction_exDate_idx" ON "CorporateAction"("exDate");
CREATE INDEX "CorporateAction_companyId_exDate_idx" ON "CorporateAction"("companyId", "exDate");

ALTER TABLE "CorporateAction" ADD CONSTRAINT "CorporateAction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Idempotent re-imports: one row per (company, source, upstream id).
CREATE UNIQUE INDEX "CorporateAction_companyId_sourceName_sourceId_key" ON "CorporateAction"("companyId", "sourceName", "sourceId");
