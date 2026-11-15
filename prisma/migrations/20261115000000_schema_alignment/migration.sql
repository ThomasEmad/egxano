-- Align the live database with prisma/schema.prisma.
-- The project's history was written by `db push` up to 2026-11-14, so several
-- schema objects (Plan offer fields, notification outbox, push subscriptions,
-- stock briefings) had no migration of their own, and two indexes existed only
-- in the database. Generated with `prisma migrate diff` (database -> schema).
-- Additive except two redundant indexes that the schema does not declare.

-- DropIndex
DROP INDEX "CorporateAction_companyId_idx";

-- DropIndex
DROP INDEX "StanceSnapshot_computedAt_idx";

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "offerActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "offerLabel" TEXT,
ADD COLUMN     "offerPrice" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "targetPrice" DOUBLE PRECISION NOT NULL,
    "triggerPrice" DOUBLE PRECISION NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 6,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBriefing" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "scriptAr" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "audio" BYTEA,
    "audioMime" TEXT,
    "durationSec" INTEGER,
    "voice" TEXT,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "errorMessage" TEXT,
    "sourceVersion" TEXT NOT NULL DEFAULT 'briefing@1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBriefing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BriefingTrial" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "firstPlayedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BriefingTrial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationOutbox_alertId_key" ON "NotificationOutbox"("alertId");

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_nextAttemptAt_idx" ON "NotificationOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationOutbox_userId_idx" ON "NotificationOutbox"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StockBriefing_companyId_key" ON "StockBriefing"("companyId");

-- CreateIndex
CREATE INDEX "StockBriefing_updatedAt_idx" ON "StockBriefing"("updatedAt");

-- CreateIndex
CREATE INDEX "BriefingTrial_companyId_idx" ON "BriefingTrial"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "BriefingTrial_userId_companyId_key" ON "BriefingTrial"("userId", "companyId");

-- AddForeignKey
ALTER TABLE "StockBriefing" ADD CONSTRAINT "StockBriefing_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefingTrial" ADD CONSTRAINT "BriefingTrial_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
