-- Market tier classification for the EGX company universe.
-- EGX30 | EGX70 = index constituents; MAIN = main market outside the indices;
-- NILEX = Nilex SME board; OTC = خارج المقصورة (not listed for regular trading).
-- Defaults to MAIN so every existing company keeps a sensible classification
-- before the admin seed action assigns index membership.
ALTER TABLE "Company" ADD COLUMN "marketTier" TEXT NOT NULL DEFAULT 'MAIN';
