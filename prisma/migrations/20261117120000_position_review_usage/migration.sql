// Owner mandate 2026-11-17: the «حلل سهمي» position-review tool gets a
// free-tier daily quota — 2 stocks per day, unlimited for Premium. One row
// per (user, EGX session day); the day key is the Africa/Cairo session date
// so the window rolls over with the trading day.
CREATE TABLE "PositionReviewUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "companyIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PositionReviewUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PositionReviewUsage_userId_day_key" ON "PositionReviewUsage"("userId", "day");

CREATE INDEX "PositionReviewUsage_userId_day_idx" ON "PositionReviewUsage"("userId", "day");

ALTER TABLE "PositionReviewUsage" ADD CONSTRAINT "PositionReviewUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
