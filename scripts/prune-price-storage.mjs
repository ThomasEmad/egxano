#!/usr/bin/env bun
/**
 * Price-storage slimming (user-requested, 2026-11-12; PriceBar retention
 * widened 2026-11-14 when the Yahoo candles ingest unfroze the table):
 *  - PriceBar stores ~1y of daily OHLCV candles per company (admin ingest in
 *    src/lib/market/candles.ts, per-company retention keeps the newest 380
 *    sessions). This script is the global date-based safety net: keep the
 *    last 420 days, delete older rows.
 *    365 trading sessions ≈ 500+ calendar days is not needed; 420 days
 *    covers a full year of sessions with margin while keeping the table small.
 *  - MarketPrice: keep the last 400 days (52w context + breadth fallbacks),
 *    delete older rows (unchanged).
 *  - Both tables are backed up to reports/*.csv.gz BEFORE any deletion.
 * Idempotent and safe to re-run.
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const DIR = "reports";

const csvEscape = (v) => (v == null ? "" : typeof v === "string" ? `"${v.replaceAll('"', '""')}"` : String(v));

async function backupTable(table, orderBy, cols) {
  const path = `${DIR}/${table}-backup.csv`;
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  const out = [cols.join(",")];
  let cursor = null;
  let total = 0;
  for (;;) {
    const rows = await db.$queryRawUnsafe(
      `SELECT ${cols.map((c) => `"${c}"`).join(",")} FROM "${table}" ${cursor ? `WHERE "${orderBy}" > $1` : ""} ORDER BY "${orderBy}" ASC LIMIT 5000`,
      ...(cursor ? [cursor] : [])
    );
    if (!rows.length) break;
    for (const r of rows) out.push(cols.map((c) => csvEscape(r[c] instanceof Date ? r[c].toISOString() : r[c])).join(","));
    cursor = rows[rows.length - 1][orderBy];
    total += rows.length;
  }
  writeFileSync(path, out.join("\n"));
  execSync(`gzip -f "${path}"`);
  return { rows: total, file: `${path}.gz`, bytes: statSync(`${path}.gz`).size };
}

async function main() {
  console.log("Backing up PriceBar …");
  const pb = await backupTable("PriceBar", "ts", ["id", "companyId", "ts", "open", "high", "low", "close", "volume", "currency", "sourceName"]);
  console.log("PriceBar backup:", pb);
  console.log("Backing up MarketPrice …");
  const mp = await backupTable("MarketPrice", "asOf", ["id", "companyId", "asOf", "price", "currency", "sourceName"]);
  console.log("MarketPrice backup:", mp);

  if (!APPLY) {
    console.log("DRY-RUN done (no deletions). Re-run with --apply to prune.");
    await db.$disconnect();
    return;
  }

  const pbRes = await db.$executeRawUnsafe(`DELETE FROM "PriceBar" WHERE ts < NOW() - INTERVAL '420 days'`);
  const mpRes = await db.$executeRawUnsafe(`DELETE FROM "MarketPrice" WHERE "asOf" < NOW() - INTERVAL '400 days'`);
  const after = await db.$queryRawUnsafe(`SELECT pg_size_pretty(pg_total_relation_size('"PriceBar"')) AS pb, pg_size_pretty(pg_total_relation_size('"MarketPrice"')) AS mp`);
  console.log(`Pruned: PriceBar -${pbRes} rows, MarketPrice -${mpRes} rows`);
  console.log("Sizes after:", JSON.stringify(after));
  await db.auditLog.create({
    data: {
      actor: "script:prune-price-storage",
      action: "PRICE_STORAGE_PRUNE",
      entityType: "PriceBar",
      details: JSON.stringify({ priceBarDeleted: pbRes, marketPriceDeleted: mpRes, backups: { pb: pb.file, mp: mp.file } }),
    },
  });
  await db.$disconnect();
}

main().catch(async (e) => { console.error("FATAL:", e?.message ?? e); await db.$disconnect(); process.exit(1); });
