-- Per-distribution yield fields for Dividend (additive, non-destructive).
-- yieldPct: this dividend alone (DPS ÷ last cum-dividend close × 100).
-- priceAtEx/priceAtExDate: reference close used (split-adjusted Yahoo close).
ALTER TABLE "Dividend" ADD COLUMN "yieldPct" DOUBLE PRECISION;
ALTER TABLE "Dividend" ADD COLUMN "priceAtEx" DOUBLE PRECISION;
ALTER TABLE "Dividend" ADD COLUMN "priceAtExDate" TIMESTAMP(3);
ALTER TABLE "Dividend" ADD COLUMN "priceSource" TEXT;
