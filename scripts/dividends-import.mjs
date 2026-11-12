#!/usr/bin/env bun
/**
 * EGX dividends importer — rebuild v2 (Nov 2026)
 *
 * Sources:
 *  1. Yahoo Finance chart API (TICKER.CA, events=div, range=15y)
 *     → full historical cash dividends. Yahoo amounts are split-adjusted,
 *     consistent with split-adjusted prices → honest yields.
 *     announcementDate is set = exDate (documented convention; sumDps12m
 *     aggregates on announcementDate, so TTM DPS includes the payment).
 *  2. FoudaLens /api/corporate-actions (derived from official EGX disclosures)
 *     → current announcements + upcoming distributions (~6 months window).
 *     Requires Referer/Origin headers.
 *
 * Modes:
 *   --plan              dry-run: classify + dedupe, print/save the plan, NO writes
 *   --apply             insert MISSING dividend rows only (never edits existing rows)
 *   --refresh-upcoming  upsert FoudaLens rows: update ANNOUNCED/UPCOMING rows with
 *                       fresher dates/amounts, auto-PAID rows whose ex-date passed,
 *                       insert new ones (dedup applies)
 *   --rollback          delete ids recorded in reports/dividends-journal.json
 *
 * Scope flags: --tickers=COMI,HRHO  --limit=N  --source=yahoo|foudalens|both
 *
 * Safety: chunked writes (150) with an incremental crash-safe rollback journal,
 * near-duplicate guard (±3 days, ≤1% amount), EGP-only, audit log entry.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const db = new PrismaClient();
const CHUNK = 150;
const REPORTS_DIR = "reports";
const JOURNAL_PATH = `${REPORTS_DIR}/dividends-journal.json`;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const argv = process.argv.slice(2);
const flag = (name) => argv.some((a) => a === name);
const opt = (name) => {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : undefined;
};

const MODE = flag("--apply") ? "apply" : flag("--refresh-upcoming") ? "refresh-upcoming" : flag("--rollback") ? "rollback" : "plan";
const SOURCE = opt("source") || "both";
const TICKERS = opt("tickers") ? opt("tickers").split(",").map((t) => t.trim().toUpperCase()) : null;
const LIMIT = opt("limit") ? parseInt(opt("limit"), 10) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dayDiff = (a, b) => (a && b ? Math.abs((new Date(a) - new Date(b)) / 86400000) : null);
const amountClose = (a, b) => a != null && b != null && b > 0 ? Math.abs(a - b) / b <= 0.01 : false;
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
      await sleep(700);
    }
  }
  throw lastErr;
}

// ---------- harvest ----------
async function harvestYahoo(tickers) {
  const out = [];
  const errors = [];
  for (const ticker of tickers) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.CA?range=15y&interval=1mo&events=div`;
      const j = await fetchJson(url, { "User-Agent": UA });
      const events = j?.chart?.result?.[0]?.events?.dividends ?? {};
      for (const ev of Object.values(events)) {
        const amount = Number(ev?.amount);
        if (!Number.isFinite(amount) || amount <= 0 || amount > 100) continue;
        const exDate = new Date(Number(ev?.date) * 1000);
        if (Number.isNaN(exDate.getTime())) continue;
        out.push({
          ticker,
          isin: null,
          announcementDate: exDate, // documented convention
          exDividendDate: exDate,
          eligibilityDate: null,
          distributionDate: null,
          dividendPerShare: amount,
          currency: "EGP",
          status: "PAID",
          sourceName: "Yahoo Finance (chart events)",
          notes: "Historical cash dividend from Yahoo Finance; amount is split-adjusted and consistent with adjusted prices.",
        });
      }
    } catch (e) {
      errors.push({ ticker, error: String(e?.message ?? e).slice(0, 140) });
    }
    await sleep(120);
  }
  return { out, errors };
}

async function harvestFoudaLens() {
  const headers = {
    "User-Agent": UA,
    Referer: "https://foudalens.com/",
    Origin: "https://foudalens.com",
    Accept: "application/json",
  };
  const j = await fetchJson("https://foudalens.com/api/corporate-actions", headers);
  const actions = Array.isArray(j?.actions) ? j.actions : [];
  const today = new Date();
  const out = [];
  for (const a of actions) {
    if (a?.action_type !== "cash_dividend") continue;
    if (String(a?.currency || "EGP").toUpperCase() !== "EGP") continue;
    const amount = Number(a?.cash_amount_per_share);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100) continue;
    const exDate = toDate(a?.ex_date);
    const distDate = toDate(a?.distribution_date);
    let status = "ANNOUNCED";
    let note = "Derived from official EGX disclosure via FoudaLens.";
    if (exDate && exDate < today) {
      status = "PAID";
      if (!distDate || distDate < today) note = "Derived from official EGX disclosure via FoudaLens; ex-date has passed.";
    } else if (exDate) {
      status = "UPCOMING";
    }
    out.push({
      ticker: String(a?.symbol || "").replace(/\.CA$/i, "").toUpperCase() || null,
      isin: a?.isin || null,
      announcementDate: toDate(a?.announcement_date),
      exDividendDate: exDate,
      eligibilityDate: toDate(a?.record_date),
      distributionDate: distDate,
      dividendPerShare: amount,
      currency: "EGP",
      status,
      sourceName: "FoudaLens (EGX disclosures)",
      notes: note,
      installments: a?.cash_installments ?? null,
    });
  }
  return { out, errors: [] };
}

// ---------- journal ----------
function loadJournal() {
  if (!existsSync(JOURNAL_PATH)) return { createdAt: new Date().toISOString(), entries: [] };
  try {
    return JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
  } catch {
    return { createdAt: new Date().toISOString(), entries: [] };
  }
}
function appendJournal(ids) {
  const j = loadJournal();
  j.entries.push(...ids);
  writeFileSync(JOURNAL_PATH, JSON.stringify(j, null, 1));
}

// ---------- dedupe ----------
function isNearDuplicate(cand, existing) {
  if (cand.companyId !== existing.companyId) return false;
  const exD = dayDiff(cand.exDividendDate, existing.exDividendDate);
  const annD = dayDiff(cand.announcementDate, existing.announcementDate);
  const dateMatch = exD != null ? exD <= 3 : annD != null ? annD <= 3 : false;
  if (!dateMatch) return false;
  if (cand.dividendPerShare != null && existing.dividendPerShare != null) {
    return amountClose(cand.dividendPerShare, existing.dividendPerShare);
  }
  return true;
}

// ---------- main ----------
async function main() {
  mkdirSync(REPORTS_DIR, { recursive: true });

  if (MODE === "rollback") {
    const j = loadJournal();
    const ids = j.entries ?? [];
    if (ids.length === 0) return console.log("Rollback journal is empty — nothing to delete.");
    let deleted = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = ids.slice(i, i + CHUNK);
      const res = await db.dividend.deleteMany({ where: { id: { in: part } } });
      deleted += res.count;
      console.log(`rollback chunk: deleted ${res.count}`);
    }
    writeFileSync(JOURNAL_PATH, JSON.stringify({ createdAt: j.createdAt, entries: [], rolledBackAt: new Date().toISOString(), count: deleted }, null, 1));
    console.log(`ROLLBACK DONE — deleted ${deleted} rows.`);
    await db.auditLog.create({ data: { actor: "script:dividends-import", action: "DIVIDENDS_IMPORT", entityType: "Dividend", details: JSON.stringify({ mode: "rollback", deleted }) } });
    return;
  }

  // Load companies (scope applies)
  const companies = await db.company.findMany({
    where: { isActive: true, listingStatus: { in: ["LISTED", "SUSPENDED"] } },
    select: { id: true, ticker: true, isin: true, nameAr: true, nameEn: true },
  });
  const scoped = TICKERS || LIMIT
    ? companies.filter((c) => (TICKERS ? TICKERS.includes(c.ticker.toUpperCase()) : true)).slice(0, LIMIT ?? undefined)
    : companies;
  const scopedSet = new Set(scoped.map((c) => c.id));
  const byId = new Map(scoped.map((c) => [c.id, c]));
  console.log(`Companies in scope: ${scoped.length}`);

  // Harvest
  const yahooRows = SOURCE === "foudalens" ? [] : (await harvestYahoo(scoped.map((c) => c.ticker))).out;
  const flRows = SOURCE === "yahoo" ? [] : (await harvestFoudaLens()).out;
  console.log(`Harvested: Yahoo ${yahooRows.length} rows, FoudaLens ${flRows.length} rows`);

  // Map FoudaLens rows to companies: ISIN first, then ticker
  const isinMap = new Map(companies.filter((c) => c.isin).map((c) => [c.isin.toUpperCase(), c]));
  const tickerMap = new Map(companies.map((c) => [c.ticker.toUpperCase(), c]));
  const unmappedFl = [];
  for (const r of flRows) {
    const c = (r.isin && isinMap.get(String(r.isin).toUpperCase())) || (r.ticker && tickerMap.get(r.ticker));
    if (!c) { unmappedFl.push(r.ticker ?? r.isin); continue; }
    if (!scopedSet.has(c.id)) continue;
    r.companyId = c.id;
    delete r.installments;
  }
  for (const r of yahooRows) {
    const c = tickerMap.get(r.ticker);
    if (!c || !scopedSet.has(c.id)) continue;
    r.companyId = c.id;
  }
  const candidates = [...yahooRows, ...flRows].filter((r) => r.companyId);
  console.log(`Mapped candidates: ${candidates.length} (unmapped FoudaLens tickers: ${unmappedFl.slice(0, 12).join(", ") || "none"})`);

  // Existing rows in scope
  const existingRows = await db.dividend.findMany({
    where: { companyId: { in: [...scopedSet] } },
    select: { id: true, companyId: true, announcementDate: true, exDividendDate: true, distributionDate: true, dividendPerShare: true, status: true },
  });

  if (MODE === "plan") {
    const plan = { mode: "plan", scope: scoped.length, candidates: candidates.length, existing: existingRows.length, byStatus: {}, sample: candidates.slice(0, 20) };
    for (const c of candidates) plan.byStatus[c.status] = (plan.byStatus[c.status] ?? 0) + 1;
    // dedupe projection
    const kept = [];
    for (const cand of candidates) {
      if (existingRows.some((e) => isNearDuplicate(cand, e)) || kept.some((k) => isNearDuplicate(cand, k))) continue;
      kept.push(cand);
    }
    plan.wouldInsert = kept.length;
    plan.keptSample = kept.slice(0, 15).map((k) => ({ ticker: byId.get(k.companyId)?.ticker, dps: k.dividendPerShare, ex: k.exDividendDate, status: k.status }));
    writeFileSync(`${REPORTS_DIR}/dividends-plan.json`, JSON.stringify(plan, null, 1));
    console.log(`PLAN: ${kept.length} rows would be inserted (of ${candidates.length} candidates). Saved reports/dividends-plan.json`);
    return;
  }

  if (MODE === "refresh-upcoming") {
    let updated = 0, autoPaid = 0, inserted = 0;
    const journal = [];
    const today = new Date();
    // 1) auto-PAID existing non-PAID rows whose effective date has passed.
    //    EGX disclosures often omit the ex-date, so fall back to the
    //    distribution date (COALESCE semantics).
    for (const e of existingRows) {
      if (e.status === "PAID" || e.status === "CANCELLED" || e.status === "EXPIRED") continue;
      const effective = e.exDividendDate ?? e.distributionDate ?? null;
      if (!effective || effective >= today) continue;
      await db.dividend.update({
        where: { id: e.id },
        data: { status: "PAID", notes: "Auto-confirmed: ex-date passed (dividends-import refresh-upcoming)." },
      });
      autoPaid++;
    }
    // 2) upsert FoudaLens candidates
    for (const cand of flRows.filter((r) => r.companyId)) {
      const match = existingRows.find((e) => isNearDuplicate(cand, e));
      if (match) {
        if (match.status !== "PAID") {
          await db.dividend.update({
            where: { id: match.id },
            data: {
              announcementDate: cand.announcementDate ?? undefined,
              exDividendDate: cand.exDividendDate ?? undefined,
              eligibilityDate: cand.eligibilityDate ?? undefined,
              distributionDate: cand.distributionDate ?? undefined,
              dividendPerShare: cand.dividendPerShare ?? undefined,
              status: cand.status,
              sourceName: cand.sourceName,
              notes: cand.notes,
            },
          });
          updated++;
        }
        continue;
      }
      const row = await db.dividend.create({
        data: {
          companyId: cand.companyId,
          announcementDate: cand.announcementDate,
          exDividendDate: cand.exDividendDate,
          eligibilityDate: cand.eligibilityDate,
          distributionDate: cand.distributionDate,
          dividendPerShare: cand.dividendPerShare,
          currency: "EGP",
          status: cand.status,
          sourceName: cand.sourceName,
          notes: cand.notes,
        },
        select: { id: true },
      });
      journal.push(row.id);
      inserted++;
      if (journal.length % CHUNK === 0) appendJournal(journal.splice(0));
      await sleep(15);
    }
    if (journal.length) appendJournal(journal);
    const summary = { mode: "refresh-upcoming", updated, autoPaid, inserted };
    writeFileSync(`${REPORTS_DIR}/dividends-refresh.json`, JSON.stringify(summary, null, 1));
    console.log(`REFRESH DONE: updated=${updated} autoPaid=${autoPaid} inserted=${inserted}`);
    await db.auditLog.create({ data: { actor: "script:dividends-import", action: "DIVIDENDS_IMPORT", entityType: "Dividend", details: JSON.stringify(summary) } });
    return;
  }

  if (MODE === "apply") {
    const kept = [];
    const errors = [];
    for (const cand of candidates) {
      if (existingRows.some((e) => isNearDuplicate(cand, e)) || kept.some((k) => isNearDuplicate(cand, k))) continue;
      kept.push({
        companyId: cand.companyId,
        announcementDate: cand.announcementDate,
        exDividendDate: cand.exDividendDate,
        eligibilityDate: cand.eligibilityDate,
        distributionDate: cand.distributionDate,
        dividendPerShare: cand.dividendPerShare,
        currency: "EGP",
        status: cand.status,
        sourceName: cand.sourceName,
        notes: cand.notes,
      });
    }
    console.log(`Would insert ${kept.length} rows (of ${candidates.length} candidates).`);
    if (!flag("--apply")) return;
    const journal = [];
    for (let i = 0; i < kept.length; i += CHUNK) {
      const part = kept.slice(i, i + CHUNK);
      const res = await db.dividend.createManyAndReturn({ data: part, select: { id: true } });
      journal.push(...res.map((r) => r.id));
      appendJournal(journal.splice(0)); // incremental crash-safe journal
      console.log(`chunk ${Math.floor(i / CHUNK) + 1}/${Math.ceil(kept.length / CHUNK)}: inserted ${res.length}`);
      await sleep(60);
    }
    const summary = { mode: "apply", candidates: candidates.length, inserted: kept.length, errors: errors.slice(0, 20) };
    writeFileSync(`${REPORTS_DIR}/dividends-apply.json`, JSON.stringify(summary, null, 1));
    console.log(`APPLY DONE: inserted ${kept.length}.`);
    await db.auditLog.create({ data: { actor: "script:dividends-import", action: "DIVIDENDS_IMPORT", entityType: "Dividend", details: JSON.stringify(summary) } });
    return;
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("FATAL:", e?.message ?? e);
    await db.$disconnect();
    process.exit(1);
  });
