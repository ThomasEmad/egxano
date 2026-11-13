-- Canonical technical stance snapshots (single source of truth for levels).
-- Additive, non-destructive: a new table + one optional relation, no data loss.

-- CreateTable
CREATE TABLE "StanceSnapshot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "signalsVersion" TEXT NOT NULL,
    "dataAsOf" TIMESTAMP(3) NOT NULL,
    "stanceJson" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StanceSnapshot_companyId_key" ON "StanceSnapshot"("companyId");
CREATE INDEX "StanceSnapshot_computedAt_idx" ON "StanceSnapshot"("computedAt");

-- AddForeignKey
ALTER TABLE "StanceSnapshot" ADD CONSTRAINT "StanceSnapshot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
