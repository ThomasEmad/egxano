-- AI Analysis Engine v2 — additive migration.
-- Adds: PriceBar (daily OHLCV for the technical engine), AiAnalysisReport
-- (versioned, deterministic-key cached reports), AiAnalysisJob (durable
-- lease-based generation queue), AiProviderUsage (cost accounting),
-- AiAnalysisEvent (pipeline event trail).
-- No existing table or column is altered or dropped — safe and reversible
-- (rollback = DROP the five tables).

-- CreateTable
CREATE TABLE "PriceBar" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "sourceName" TEXT NOT NULL,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceBar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAnalysisReport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "content" TEXT,
    "sections" TEXT,
    "stance" TEXT,
    "dataHash" TEXT NOT NULL,
    "technicalHash" TEXT,
    "priceAsOf" TIMESTAMP(3),
    "financialAsOf" TIMESTAMP(3),
    "periodKey" TEXT,
    "dataCompleteness" TEXT,
    "promptVersion" TEXT NOT NULL,
    "configVersion" TEXT NOT NULL,
    "technicalVersion" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "latencyMs" INTEGER,
    "wordCount" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "inputSummary" TEXT,
    "requestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAnalysisReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAnalysisJob" (
    "id" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "leasedBy" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "requestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiAnalysisJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProviderUsage" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'report',
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "errorKind" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "latencyMs" INTEGER,
    "costUsdEst" DOUBLE PRECISION,
    "companyId" TEXT,
    "reportKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiProviderUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAnalysisEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "reportKey" TEXT,
    "kind" TEXT NOT NULL,
    "details" TEXT,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAnalysisEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceBar_companyId_ts_key" ON "PriceBar"("companyId", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "AiAnalysisReport_reportKey_key" ON "AiAnalysisReport"("reportKey");

-- CreateIndex
CREATE INDEX "AiAnalysisReport_companyId_createdAt_idx" ON "AiAnalysisReport"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AiAnalysisReport_companyId_status_idx" ON "AiAnalysisReport"("companyId", "status");

-- CreateIndex
CREATE INDEX "AiAnalysisReport_dataHash_idx" ON "AiAnalysisReport"("dataHash");

-- CreateIndex
CREATE UNIQUE INDEX "AiAnalysisJob_reportKey_key" ON "AiAnalysisJob"("reportKey");

-- CreateIndex
CREATE INDEX "AiAnalysisJob_status_priority_createdAt_idx" ON "AiAnalysisJob"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "AiAnalysisJob_companyId_status_idx" ON "AiAnalysisJob"("companyId", "status");

-- CreateIndex
CREATE INDEX "AiProviderUsage_provider_createdAt_idx" ON "AiProviderUsage"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "AiProviderUsage_kind_createdAt_idx" ON "AiProviderUsage"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "AiAnalysisEvent_kind_createdAt_idx" ON "AiAnalysisEvent"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "AiAnalysisEvent_companyId_idx" ON "AiAnalysisEvent"("companyId");

-- AddForeignKey
ALTER TABLE "PriceBar" ADD CONSTRAINT "PriceBar_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysisReport" ADD CONSTRAINT "AiAnalysisReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysisJob" ADD CONSTRAINT "AiAnalysisJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
