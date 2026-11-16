-- Owner mandate 2026-11-16: the admin can pull a company out of ranking
-- surfaces (rankings / valuation screen / sector medians) when a figure is
-- illogical — an honest exclusion instead of publishing nonsense.
ALTER TABLE "Company" ADD COLUMN "excludeFromRankings" BOOLEAN NOT NULL DEFAULT false;
