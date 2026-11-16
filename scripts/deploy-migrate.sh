#!/bin/sh
# Deploy-time schema sync for Vercel builds (2026-11-17).
#
# Why a script and not a bare `prisma migrate deploy`:
#   1. The Prisma datasource declares `directUrl = env("DIRECT_URL")` — but the
#      Vercel project only carries DATABASE_URL (DIRECT_URL was removed during
#      the Supabase cleanup). Without it every prisma command fails instantly
#      ("Environment variable not found: DIRECT_URL") and the deploy dies.
#      Neon's POOLED endpoint runs short DDL fine, so falling back to
#      DATABASE_URL is safe for the additive migrations this repo ships.
#   2. The production ledger state is unknown (schema may have been created
#      via `db push`, i.e. no `_prisma_migrations` table). Chain: try
#      `migrate deploy` (ledger path); if it fails, fall back to
#      `db push` WITHOUT --accept-data-loss — it applies additive changes
#      (like the missing excludeFromRankings column) and REFUSES anything
#      destructive, so it can never silently drop production data.
[ -n "$DIRECT_URL" ] || DIRECT_URL="$DATABASE_URL"
export DIRECT_URL

prisma migrate deploy --skip-generate || prisma db push --skip-generate
