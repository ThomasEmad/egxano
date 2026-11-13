#!/usr/bin/env node
/**
 * EGX corporate-actions importer — bonus issues / splits / rights / cash.
 *
 * Source: FoudaLens /api/corporate-actions (derived from official EGX
 * disclosures; ~6-month window + upcoming). Requires Referer/Origin headers.
 * Every row carries record_date — the field the user explicitly asked for.
 *
 * Why this exists: a bonus issue (e.g. CANA 2026-11-12, 0.5 share per share)
 * mechanically halves the quote. Without the ex-date terms the site reports
 * the mechanical drop as a market loss. These rows feed
 * src/lib/market/corporate-actions.ts (daily-change engine).
 *
 * Modes:
 *   --plan      dry-run: fetch + classify + dedupe, print/save the plan, NO writes
 *   --apply     insert MISSING CorporateAction rows only (never edits existing)
 *   --rollback  delete ids recorded in reports/corporate-actions-journal.json
 *   --tickers=A,B  --limit=N
 *
 * Safety: chunked writes (150) with an incremental crash-safe journal,
 * idempotent by (companyId, sourceName, sourceId), audit log entry.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const db = new PrismaClient();
const CHUNK = 150;
const REPORTS_DIR = "reports";
const JOURNAL_PATH = `${REPORTS_DIR}/corporate-actions-journal.json`;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const argv = process.argv.slice(2);
const flag = (name) => argv.some((a) => a === name);
const opt = (name) => {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : undefined;
};

const MODE = flag("--apply") ? "apply" : flag("--rollback") ? "rollback" : "plan";
const TICKERS = opt("tickers") ? opt("tickers").split(",").map((t) => t.trim().toUpperCase()) : null;
const LIMIT = opt("limit") ? parseInt(opt("limit"), 10) : null;

const toDate = (s) => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00Z`) : null);

async function fetchJson(url, headers, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(25_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}

const KNOWN_TYPES = new Set(["stock_dividend", "cash_dividend", "split", "rights", "rights_issue"]);
/** Upstream type → engine type (rights_issue is FoudaLens's spelling). */
const TYPE_MAP = { rights_issue: "rights" };

/** Map one upstream row → the import plan row (or null with a reason). */
function mapRow(r, company) {
  const rawType = String(r.action_type || "").trim().toLowerCase();
  if (!KNOWN_TYPES.has(rawType)) return { skip: `unknown action_type=${rawType || "∅"}` };
  const type = TYPE_MAP[rawType] || rawType;
  const ex = toDate(r.ex_date);
  if (!ex) return { skip: "no ex_date" };
  const num = r.ratio_numerator != null ? BigInt(r.ratio_numerator) : null;
  const den = r.ratio_denominator != null ? BigInt(r.ratio_denominator) : null;
  if ((type === "stock_dividend" || type === "split" || type === "rights") && (num === null || den === null || den === 0n)) {
    return { skip: `${type} without ratio` };
  }
  if (type === "cash_dividend" && !(r.cash_amount_per_share > 0)) return { skip: "cash without amount" };
  return {
    companyId: company.id,
    ticker: company.ticker,
    actionType: type,
    exDate: ex,
    recordDate: toDate(r.record_date),
    distributionDate: toDate(r.distribution_date),
    announcementDate: toDate(r.announcement_date),
    ratioNumerator: num,
    ratioDenominator: den,
    cashPerShare: r.cash_amount_per_share != null ? Number(r.cash_amount_per_share) : null,
    subscriptionPrice: r.subscription_price != null ? Number(r.subscription_price) : null,
    currency: r.currency || "EGP",
    status: r.status || null,
    sourceName: "FOUDALENS_CORPORATE_ACTIONS",
    sourceId: r.id ? String(r.id) : null,
    notes: r.source ? `upstream source: ${r.source}` : null,
  };
}

async function chunkedCreate(rows, journal) {
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const ids = [];
    for (const row of part) {
      const created = await db.corporateAction.create({ data: row, select: { id: true } });
      ids.push(created.id);
      written++;
    }
    journal.push(...ids);
    writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, 1));
    console.log(`  wrote ${written}/${rows.length}`);
  }
  return written;
}

async function main() {
  mkdirSync(REPORTS_DIR, { recursive: true });

  if (MODE === "rollback") {
    if (!existsSync(JOURNAL_PATH)) {
      console.log("no journal — nothing to roll back");
      return;
    }
    const ids = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
    const res = await db.corporateAction.deleteMany({ where: { id: { in: ids }, sourceName: "FOUDALENS_CORPORATE_ACTIONS" } });
    console.log(`rolled back ${res.count} rows`);
    writeFileSync(JOURNAL_PATH, "[]");
    return;
  }

  const headers = { Referer: "https://foudalens.com/", Origin: "https://foudalens.com", "User-Agent": UA };
  console.log(`[${new Date().toISOString()}] fetching FoudaLens corporate-actions…`);
  const j = await fetchJson("https://foudalens.com/api/corporate-actions", headers);
  const rows = Array.isArray(j) ? j : j.data || j.rows || j.actions || [];
  console.log(`upstream rows: ${rows.length}`);

  // Classify: symbol CANA.CA → CANA; fall back to ISIN.
  const companies = await db.company.findMany({
    select: { id: true, ticker: true, isin: true, isActive: true },
  });
  const byTicker = new Map(companies.map((c) => [c.ticker.toUpperCase(), c]));
  const byIsin = new Map(companies.filter((c) => c.isin).map((c) => [c.isin.toUpperCase(), c]));

  const plan = [];
  const skips = [];
  const seen = new Set();
  for (const r of rows) {
    if (LIMIT && plan.length >= LIMIT) break;
    const sym = String(r.symbol || "").toUpperCase().replace(/\.CA$/, "");
    const isin = String(r.isin || "").toUpperCase();
    const company = byTicker.get(sym) || byIsin.get(isin) || null;
    if (!company) {
      skips.push({ symbol: r.symbol, reason: "no matching company" });
      continue;
    }
    if (TICKERS && !TICKERS.includes(company.ticker.toUpperCase())) continue;
    const mapped = mapRow(r, company);
    if (mapped.skip) {
      skips.push({ symbol: r.symbol, reason: mapped.skip });
      continue;
    }
    const key = `${mapped.companyId}|${mapped.actionType}|${mapped.exDate.toISOString()}|${mapped.ratioNumerator}/${mapped.ratioDenominator}|${mapped.cashPerShare}`;
    if (seen.has(key)) continue; // upstream duplicate
    seen.add(key);
    plan.push(mapped);
  }

  // What is genuinely NEW? (companyId, sourceName, sourceId) idempotence +
  // a semantic near-duplicate guard (same company+type, ex-date ±3 days,
  // same ratio/amount → treat as already-imported under a different sourceId).
  const existing = await db.corporateAction.findMany({
    where: { sourceName: "FOUDALENS_CORPORATE_ACTIONS", companyId: { in: plan.map((p) => p.companyId) } },
    select: { companyId: true, sourceId: true, actionType: true, exDate: true, ratioNumerator: true, ratioDenominator: true, cashPerShare: true },
  });
  const bySourceId = new Set(existing.map((e) => `${e.companyId}|${e.sourceId}`));
  const nearDup = (p) =>
    existing.some(
      (e) =>
        e.companyId === p.companyId &&
        e.actionType === p.actionType &&
        Math.abs(e.exDate.getTime() - p.exDate.getTime()) <= 3 * 86400000 &&
        (p.ratioNumerator === null || (e.ratioNumerator === p.ratioNumerator && e.ratioDenominator === p.ratioDenominator)) &&
        (p.cashPerShare === null || (e.cashPerShare != null && Math.abs(e.cashPerShare - p.cashPerShare) / p.cashPerShare <= 0.01)),
    );
  const fresh = plan.filter((p) => {
    if (p.sourceId && bySourceId.has(`${p.companyId}|${p.sourceId}`)) return false;
    if (nearDup(p)) return false;
    return true;
  });

  console.log(`classified: ${plan.length} | new: ${fresh.length} | skips: ${skips.length}`);
  for (const s of skips.slice(0, 12)) console.log(`  skip ${s.symbol}: ${s.reason}`);
  for (const p of fresh.slice(0, 25)) {
    const ratio = p.ratioNumerator !== null ? ` ratio=${p.ratioNumerator}/${p.ratioDenominator}` : "";
    const cash = p.cashPerShare != null ? ` cash=${p.cashPerShare}` : "";
    console.log(`  ${p.ticker.padEnd(8)} ${p.actionType.padEnd(14)} ex=${p.exDate.toISOString().slice(0, 10)} record=${p.recordDate?.toISOString().slice(0, 10) ?? "-"}${ratio}${cash}`);
  }
  writeFileSync(`${REPORTS_DIR}/corporate-actions-plan.json`, JSON.stringify({ at: new Date().toISOString(), mode: MODE, total: plan.length, fresh: fresh.length, skips }, null, 1));

  if (MODE === "apply") {
    if (!fresh.length) {
      console.log("nothing to apply");
      return;
    }
    let journal = existsSync(JOURNAL_PATH) ? JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) : [];
    const written = await chunkedCreate(fresh, journal);
    console.log(`APPLIED ${written} CorporateAction rows`);
  } else {
    console.log("PLAN ONLY (use --apply to write)");
  }
}

main()
  .catch((e) => {
    console.error("ERR:", e instanceof Error ? e.message.slice(0, 300) : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
