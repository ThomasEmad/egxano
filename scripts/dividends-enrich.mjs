#!/usr/bin/env node
/**
 * dividends-enrich.mjs — per-distribution entitlement date + yield backfill.
 *
 * What it does (idempotent, additive only):
 *  1. For every dividend row missing `eligibilityDate` (تاريخ الاستحقاق /
 *     نهاية الحق): derive it as the LAST trading day strictly before the
 *     ex-date. Documented EGX convention: "نهاية الحق بإغلاق جلسة يوم X"
 *     and trading WITHOUT the right starts the NEXT session (= ex-date).
 *     Derived rows are marked in `notes`.
 *  2. For rows with an official eligibilityDate but no exDate (FoudaLens
 *     UPCOMING): fill exDate = next trading day after eligibilityDate.
 *  3. For rows with neither exDate nor eligibilityDate (older FoudaLens
 *     disclosures): match a Yahoo dividend event (same ticker, amount within
 *     1%, exDate within [announcementDate, distributionDate]) and adopt its
 *     exDate, then derive eligibility from it.
 *  4. Compute the per-distribution yield: `yieldPct = dividendPerShare ÷
 *     last cum-dividend close × 100`. Reference close = close on the
 *     eligibility day (official or derived), else last trading day before
 *     exDate. Yahoo `close` is split-adjusted but NOT dividend-adjusted,
 *     matching split-adjusted Yahoo DPS → honest per-dividend yield.
 *     Plausibility gate: yieldPct > 30 → stored as null + review note
 *     (consistent with the dividend_yield@3 gate in calc.ts).
 *
 * Data fetching (Yahoo throttles this sandbox's IP hard):
 *   - PRIMARY: spark endpoint `/v8/finance/spark?symbols=≤10 per batch`
 *     with range=10y&interval=1d (daily bars, last 10 years).
 *   - OLD-WINDOW: rows dated before the spark window (2011–2016 dividends)
 *     get one `/v8/finance/chart/TICKER.CA?period1=..&period2=..&interval=1d`
 *     fetch each (explicit periods force DAILY granularity; `range=max`
 *     degrades to monthly). Merged into the ticker cache.
 *   - EVENTS fallback: chart fetch (events=div) for rows needing ex-date
 *     adoption and for sparse tickers.
 *   - Session cookies from finance.yahoo.com are grabbed once per run
 *     (raw https with raised maxHeaderSize — the consent header block is
 *     ~40KB) and refreshed on 429.
 *   - Per-ticker cache under reports/dividends-enrich-charts/ so repeated
 *     runs never re-hit Yahoo for known tickers (resume-friendly).
 *
 * Modes:
 *   --dry                  default; compute and print plan, write nothing
 *   --apply                write updates (chunked, rollback journal first)
 *   --tickers=A,B          scope to specific tickers
 *   --limit-companies=N    only first N companies (testing)
 *   --max-seconds=N        stop fetching after N seconds (resumable)
 *
 * Artifacts:
 *   reports/dividends-enrich-rollback.json  (prior values, incremental)
 *   reports/dividends-enrich-report.json    (summary + samples)
 */

import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const tickersArg = process.argv.find((a) => a.startsWith("--tickers="));
const tickersFilter = tickersArg ? tickersArg.slice("--tickers=".length).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : null;
const limitArg = process.argv.find((a) => a.startsWith("--limit-companies="));
const limitCompanies = limitArg ? Number(limitArg.slice("--limit-companies=".length)) : null;
const maxSecArg = process.argv.find((a) => a.startsWith("--max-seconds="));
const maxSeconds = maxSecArg ? Number(maxSecArg.slice("--max-seconds=".length)) : null;

const ROLLBACK_FILE = path.resolve("reports/dividends-enrich-rollback.json");
const REPORT_FILE = path.resolve("reports/dividends-enrich-report.json");
const CACHE_DIR = path.resolve("reports/dividends-enrich-charts");
const YIELD_GATE_PCT = 30; // single-distribution yields above this are implausible
const CHUNK = 100;
const SPARK_BATCH = 10; // server rejects >10 symbols per spark request (400)
const BATCH_DELAY_MS = 8000; // polite pacing between spark batches
const CHART_DELAY_MS = 5000; // pacing between chart fallback requests

const NOTE_ELIG_DERIVED = "تاريخ الاستحقاق مشتق: آخر يوم تداول قبل بدء التعامل بدون الحق (اصطلاح البورصة المصرية)";
const NOTE_EX_ADOPTED = "تاريخ الإكس مُعتمد من مطابقة أحداث Yahoo";
const NOTE_YIELD_GATE = "عائد التوزيع الواحد غير معقول (>30%) — مراجعة يدوية مطلوبة (غالبًا سعر غير معدل لتقسيم)";

const HEADERS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const SPARK_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

let cachedHits = 0;
let cookieRefreshes = 0;
let yahooCookie = "";

// ---- Yahoo session cookies (429 bypass) ----------------------------------

function grabYahooCookie() {
  return new Promise((resolve) => {
    const req = https.request(
      "https://finance.yahoo.com/",
      {
        method: "GET",
        maxHeaderSize: 131072, // homepage sends ~40KB of set-cookie consent headers
        headers: { "user-agent": HEADERS_UA, accept: "text/html" },
      },
      (res) => {
        const cookies = [].concat(res.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]);
        res.resume();
        res.on("end", () => resolve(cookies.join("; ")));
      },
    );
    req.on("error", () => resolve(""));
    req.setTimeout(20000, () => { req.destroy(); resolve(""); });
    req.end();
  });
}

async function refreshYahooCookie() {
  if (cookieRefreshes >= 6) return yahooCookie;
  cookieRefreshes++;
  const c = await grabYahooCookie();
  if (c) yahooCookie = c;
  return yahooCookie;
}

// ---- cache -----------------------------------------------------------------

function cachePath(ticker) {
  return path.join(CACHE_DIR, `${ticker}.json`);
}
function readCache(ticker) {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(ticker), "utf8"));
    if (!raw || typeof raw !== "object") return null;
    if (raw.failed) return raw;
    if (!Array.isArray(raw.days) || !raw.days.length) return null;
    return raw;
  } catch {
    return null;
  }
}
function writeCache(ticker, data) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath(ticker), JSON.stringify(data));
}

function mergeCache(ticker, { days, divs }) {
  const prev = readCache(ticker);
  const byDs = new Map();
  for (const d of [...(prev?.days ?? []), ...(days ?? [])]) byDs.set(d.ds, d);
  const mergedDays = [...byDs.values()].sort((a, b) => a.ds.localeCompare(b.ds));
  const divMap = new Map();
  for (const v of [...(prev?.divs ?? []), ...(divs ?? [])]) divMap.set(`${v.ds}|${v.amount}`, v);
  writeCache(ticker, { days: mergedDays, divs: [...divMap.values()], fetchedAt: Date.now() });
  return mergedDays;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ds = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

function parseDays(timestamps, closes) {
  const days = [];
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return days;
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (typeof c === "number" && Number.isFinite(c) && c > 0) {
      days.push({ ds: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), close: c });
    }
  }
  const byDs = new Map();
  for (const d of days) byDs.set(d.ds, d);
  return [...byDs.values()].sort((a, b) => a.ds.localeCompare(b.ds));
}

// ---- fetching: spark batches (primary) -------------------------------------

async function fetchSparkBatch(symbols, hostIdxBase) {
  const syms = symbols.map((t) => `${t}.CA`).join(",");
  for (let attempt = 0; attempt < 2; attempt++) {
    const host = SPARK_HOSTS[(hostIdxBase + attempt) % SPARK_HOSTS.length];
    try {
      const res = await fetch(`https://${host}/v8/finance/spark?symbols=${syms}&range=10y&interval=1d`, {
        headers: { "user-agent": HEADERS_UA, accept: "application/json", ...(yahooCookie ? { cookie: yahooCookie } : {}) },
      });
      if (res.status === 429 || res.status === 503) {
        await refreshYahooCookie();
        await sleep(30000);
        continue;
      }
      if (!res.ok) return null;
      const json = await res.json();
      const out = {};
      for (const [symbol, s] of Object.entries(json ?? {})) {
        if (!s || !Array.isArray(s.timestamp)) continue;
        const ticker = symbol.replace(/\.CA$/, "").toUpperCase();
        out[ticker] = parseDays(s.timestamp, s.close);
      }
      return out;
    } catch {
      await sleep(5000);
    }
  }
  return null;
}

// ---- fetching: chart (daily with explicit periods / full events) -----------

async function fetchChart(ticker, { period1, period2 } = {}) {
  const hosts = SPARK_HOSTS;
  for (let attempt = 0; attempt < 2; attempt++) {
    const host = hosts[attempt % hosts.length];
    const q = period1
      ? `period1=${period1}&period2=${period2}&interval=1d&events=div`
      : `range=max&interval=1d&events=div`;
    try {
      const res = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(`${ticker}.CA`)}?${q}`, {
        headers: { "user-agent": HEADERS_UA, accept: "application/json", ...(yahooCookie ? { cookie: yahooCookie } : {}) },
      });
      if (res.status === 429 || res.status === 503) {
        await refreshYahooCookie();
        await sleep(10000);
        continue;
      }
      if (!res.ok) return null;
      const json = await res.json();
      const r = json?.chart?.result?.[0];
      if (!r) return null;
      const days = parseDays(r.timestamp ?? [], r.indicators?.quote?.[0]?.close ?? []);
      const divs = Object.entries(r.events?.dividends ?? {}).map(([, ev]) => ({
        ds: new Date(Number(ev.date) * 1000).toISOString().slice(0, 10),
        amount: Number(ev.amount),
      }));
      return { days, divs };
    } catch {
      await sleep(5000);
    }
  }
  return null;
}

// ---- trading-day helpers ---------------------------------------------------

function lastTradingBefore(days, target) {
  const t = ds(target);
  let best = null;
  for (const d of days) if (d.ds < t) best = d;
  return best;
}
function nextTradingAfter(days, target) {
  const t = ds(target);
  for (const d of days) if (d.ds > t) return d;
  return null;
}
function closeOn(days, target) {
  const t = ds(target);
  return days.find((d) => d.ds === t) ?? null;
}

function appendNote(existing, note) {
  if (!existing) return note;
  if (existing.includes(note)) return existing;
  return `${existing} | ${note}`;
}

// ---- patch computation (pure) ----------------------------------------------

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

function computePatch(row, comp, cache, counters, noPrice) {
  const { days, divs } = cache;
  const patch = {};
  const priorNotes = row.notes;
  let exDate = row.exDividendDate ?? null;

  // 3) adopt exDate from Yahoo events when neither ex nor eligibility exists
  if (!exDate && !row.eligibilityDate && row.distributionDate && row.dividendPerShare != null && divs?.length) {
    const lo = row.announcementDate ?? null;
    const hi = row.distributionDate;
    const cand = divs.filter((v) => {
      if (Math.abs(v.amount - row.dividendPerShare) > Math.max(0.01, row.dividendPerShare * 0.01)) return false;
      if (lo && v.ds < ds(lo)) return false;
      return v.ds <= ds(hi);
    });
    if (cand.length) {
      exDate = cand[cand.length - 1].ds;
      patch.exDividendDate = new Date(`${exDate}T00:00:00.000Z`);
      patch.notes = appendNote(row.notes, NOTE_EX_ADOPTED);
      counters.exAdoptedFromYahoo++;
    } else {
      counters.yahooEventMismatches++;
      noPrice.push({ ticker: comp.ticker, kind: "yahoo-match-miss", dps: row.dividendPerShare, ann: ds(row.announcementDate), dist: ds(row.distributionDate) });
    }
  }

  // 1) derive eligibility: last trading day strictly before ex-date
  let eligRef = row.eligibilityDate ?? null;
  if (!eligRef && exDate) {
    const last = lastTradingBefore(days, exDate);
    if (last) {
      patch.eligibilityDate = new Date(`${last.ds}T00:00:00.000Z`);
      patch.notes = appendNote(patch.notes ?? priorNotes, NOTE_ELIG_DERIVED);
      eligRef = last.ds;
      counters.eligDerived++;
    }
  } else if (eligRef) {
    counters.eligOfficial++;
  }

  // 2) upcoming rows: fill exDate = next trading day after eligibility
  if (!row.exDividendDate && row.eligibilityDate && !patch.exDividendDate) {
    const nxt = nextTradingAfter(days, row.eligibilityDate);
    if (nxt) {
      patch.exDividendDate = new Date(`${nxt.ds}T00:00:00.000Z`);
      exDate = nxt.ds;
      counters.exFilled++;
    }
  }

  // 4) per-distribution yield
  if (row.yieldPct == null && row.dividendPerShare != null && row.dividendPerShare > 0 && (eligRef || exDate)) {
    let refDay = null;
    if (eligRef) refDay = closeOn(days, eligRef) ?? lastTradingBefore(days, eligRef);
    if (!refDay && exDate) refDay = lastTradingBefore(days, exDate);
    if (refDay) {
      const y = (row.dividendPerShare / refDay.close) * 100;
      if (Number.isFinite(y) && y > 0 && y <= YIELD_GATE_PCT) {
        patch.yieldPct = Math.round(y * 100) / 100;
        patch.priceAtEx = Math.round(refDay.close * 100) / 100;
        patch.priceAtExDate = new Date(`${refDay.ds}T00:00:00.000Z`);
        patch.priceSource = "YAHOO_CHART";
        counters.yieldComputed++;
      } else if (y > YIELD_GATE_PCT) {
        patch.notes = appendNote(patch.notes ?? priorNotes, NOTE_YIELD_GATE);
        counters.yieldGated++;
        noPrice.push({ ticker: comp.ticker, kind: "gated", target: ds(eligRef ?? exDate), y: Math.round(y * 100) / 100 });
      } else {
        counters.yieldNoPrice++;
        noPrice.push({ ticker: comp.ticker, kind: "no-ref", target: ds(eligRef ?? exDate), refFound: refDay.ds, dps: row.dividendPerShare });
      }
    } else {
      counters.yieldNoPrice++;
      noPrice.push({ ticker: comp.ticker, kind: "no-ref", target: ds(eligRef ?? exDate), refFound: null, firstDay: days[0]?.ds, dps: row.dividendPerShare });
    }
  }

  return { patch, exDate };
}

// ---- main -------------------------------------------------------------------

async function main() {
  const startedAt = Date.now();
  const outOfBudget = () => (maxSeconds != null && (Date.now() - startedAt) / 1000 > maxSeconds);

  const companies = await prisma.company.findMany({
    where: { isActive: true, ...(tickersFilter ? { ticker: { in: tickersFilter } } : {}) },
    select: { id: true, ticker: true },
    ...(limitCompanies ? { take: limitCompanies } : {}),
    orderBy: { ticker: "asc" },
  });
  const companyById = new Map(companies.map((c) => [c.id, c]));

  const rows = await prisma.dividend.findMany({
    where: { companyId: { in: companies.map((c) => c.id) } },
    select: {
      id: true, companyId: true, announcementDate: true, eligibilityDate: true, exDividendDate: true,
      distributionDate: true, dividendPerShare: true, dividendType: true,
      yieldPct: true, priceAtEx: true, priceAtExDate: true, priceSource: true, notes: true,
    },
    orderBy: [{ exDividendDate: "asc" }, { announcementDate: "asc" }],
  });
  console.log(`companies: ${companies.length} | dividend rows: ${rows.length}`);

  const counters = {
    rows: 0, tickersFetched: 0, tickersFailed: 0,
    eligDerived: 0, eligOfficial: 0, exFilled: 0, exAdoptedFromYahoo: 0,
    yieldComputed: 0, yieldGated: 0, yieldNoPrice: 0, yahooEventMismatches: 0,
    oldWindowFixed: 0,
  };

  yahooCookie = await grabYahooCookie();
  console.log(`yahoo cookies: ${yahooCookie ? "ok" : "none (will retry mid-run)"}`);

  // --- phase A: which tickers need price data ------------------------------
  const needChart = new Set();
  const needEvents = new Set();
  for (const row of rows) {
    const comp = companyById.get(row.companyId);
    if (!comp || !comp.ticker) continue;
    if (row.dividendType !== "CASH") continue;
    const incomplete = !row.eligibilityDate || !row.exDividendDate || row.yieldPct == null;
    if (incomplete) needChart.add(comp.ticker);
    if (!row.exDividendDate && !row.eligibilityDate && row.distributionDate) needEvents.add(comp.ticker);
  }

  // --- phase B: spark batches ----------------------------------------------
  const missing = [...needChart].filter((t) => !readCache(t));
  console.log(`tickers needing prices: ${needChart.size} (cache miss: ${missing.length})`);
  const batches = [];
  for (let i = 0; i < missing.length; i += SPARK_BATCH) batches.push(missing.slice(i, i + SPARK_BATCH));
  let batchIdx = 0;
  for (const batch of batches) {
    if (outOfBudget()) { console.log("-- time budget reached, stopping fetch (re-run to continue)"); break; }
    const got = await fetchSparkBatch(batch, batchIdx);
    batchIdx++;
    if (got) {
      for (const ticker of batch) {
        const days = got[ticker];
        if (days && days.length) {
          writeCache(ticker, { days, divs: readCache(ticker)?.divs ?? [], fetchedAt: Date.now() });
          counters.tickersFetched++;
        } else {
          writeCache(ticker, { failed: true, ts: Date.now() });
          counters.tickersFailed++;
        }
      }
      console.log(`spark batch ${batchIdx}/${batches.length}: ok (${Object.keys(got).length}/${batch.length})`);
    } else {
      for (const ticker of batch) writeCache(ticker, { failed: true, ts: Date.now() });
      counters.tickersFailed += batch.length;
      console.log(`spark batch ${batchIdx}/${batches.length}: FAILED (${batch.length})`);
    }
    await sleep(BATCH_DELAY_MS);
  }

  // --- phase B2: chart-events fallback for adoption/sparse tickers ----------
  for (const ticker of needChart) {
    if (outOfBudget()) break;
    const cache = readCache(ticker);
    const sparse = !cache || cache.failed || !cache.days?.length || cache.days[0].ds > "2017-06-01";
    const hasEvents = cache && !cache.failed && cache.divs?.length > 0;
    if (sparse || (needEvents.has(ticker) && !hasEvents)) {
      const chart = await fetchChart(ticker);
      if (chart && chart.days.length) {
        mergeCache(ticker, chart);
        counters.tickersFetched++;
        console.log(`chart-max ${ticker}: days ${chart.days.length}, from ${chart.days[0]?.ds}`);
      } else {
        counters.tickersFailed++;
      }
      await sleep(CHART_DELAY_MS);
    }
  }

  // --- phase C pass 1 (diagnostic): find rows lacking a reference price so we
  // know which tickers need an old-window (pre-spark) daily fetch -------------
  const diag = { exAdoptedFromYahoo: 0, yahooEventMismatches: 0, eligDerived: 0, eligOfficial: 0, exFilled: 0, yieldComputed: 0, yieldGated: 0, yieldNoPrice: 0 };
  const noPriceTargets = new Map(); // ticker -> min target ds
  const updatesMap = new Map(); // dividend id -> update (rebuilt cleanly in pass 2)

  for (const row of rows) {
    const comp = companyById.get(row.companyId);
    if (!comp || !comp.ticker) continue;
    if (row.dividendType !== "CASH") continue;
    counters.rows++;
    const cache = readCache(comp.ticker);
    if (!cache || cache.failed || !cache.days?.length) continue;
    const noPrice = [];
    computePatch(row, comp, cache, diag, noPrice);
    for (const entry of noPrice) {
      if (entry.kind !== "no-ref" || !entry.target) continue;
      const prev = noPriceTargets.get(comp.ticker);
      if (!prev || entry.target < prev) noPriceTargets.set(comp.ticker, entry.target);
    }
  }
  console.log(`pass 1 (diagnostic): rows needing older price history: ${noPriceTargets.size} tickers`);

  // --- phase D: old-window daily fetch for pre-coverage rows -----------------
  const oldTargets = noPriceTargets;
  console.log(`old-window fetches needed: ${oldTargets.size} tickers`);
  for (const [ticker, minTarget] of oldTargets) {
    if (outOfBudget()) { console.log("-- time budget reached, stopping old-window fetch (re-run to continue)"); break; }
    const cache = readCache(ticker);
    const firstDay = cache?.days?.[0]?.ds;
    if (!firstDay || minTarget >= firstDay) continue; // nothing older to fetch
    const period1 = Math.floor(new Date(`${minTarget}T00:00:00Z`).getTime() / 1000) - 45 * 86400;
    const period2 = Math.floor(new Date(`${firstDay}T00:00:00Z`).getTime() / 1000) + 30 * 86400;
    const chart = await fetchChart(ticker, { period1, period2 });
    if (chart && chart.days.length) {
      const merged = mergeCache(ticker, chart);
      counters.tickersFetched++;
      console.log(`old-window ${ticker}: +${chart.days.length} days from ${chart.days[0]?.ds} (now from ${merged[0]?.ds})`);
    } else {
      console.log(`old-window ${ticker}: no earlier data on Yahoo (before ${firstDay})`);
    }
    await sleep(CHART_DELAY_MS);
  }

  // --- phase C pass 2 (final): recompute every row with clean counters -------
  const finalNoPrice = [];
  for (const row of rows) {
    const comp = companyById.get(row.companyId);
    if (!comp || !comp.ticker) continue;
    if (row.dividendType !== "CASH") continue;
    const cache = readCache(comp.ticker);
    if (!cache || cache.failed || !cache.days?.length) {
      if (row.yieldPct == null && row.dividendPerShare > 0 && (row.eligibilityDate || row.exDividendDate || row.distributionDate)) {
        finalNoPrice.push({ ticker: comp.ticker, kind: "no-cache", target: ds(row.eligibilityDate ?? row.exDividendDate ?? row.distributionDate) });
      }
      continue;
    }
    const { patch, exDate } = computePatch(row, comp, cache, counters, finalNoPrice);
    if (Object.keys(patch).length) updatesMap.set(row.id, { id: row.id, ticker: comp.ticker, dps: row.dividendPerShare, ex: ds(exDate), patch });
  }
  counters.yieldNoPrice = finalNoPrice.filter((x) => x.kind !== "yahoo-match-miss").length;

  const updates = [...updatesMap.values()];
  console.log(`\nrows scanned: ${counters.rows} | tickers fetched=${counters.tickersFetched} failed=${counters.tickersFailed} cookie-refresh=${cookieRefreshes}`);
  console.log(`eligibility official=${counters.eligOfficial} derived=${counters.eligDerived}`);
  console.log(`exDate filled=${counters.exFilled} adopted-from-yahoo=${counters.exAdoptedFromYahoo}`);
  console.log(`yield computed=${counters.yieldComputed} gated=${counters.yieldGated} no-price=${counters.yieldNoPrice}`);
  console.log(`updates to write: ${updates.length}`);
  const misses = finalNoPrice.filter((x) => x.kind === "yahoo-match-miss");
  if (misses.length) {
    console.log(`yahoo-match misses: ${misses.length}`);
    for (const m of misses.slice(0, 3)) console.log("  ", JSON.stringify(m));
  }

  // --- write -------------------------------------------------------------------
  if (APPLY && updates.length) {
    fs.mkdirSync(path.dirname(ROLLBACK_FILE), { recursive: true });
    let journal = [];
    if (fs.existsSync(ROLLBACK_FILE)) {
      try { journal = JSON.parse(fs.readFileSync(ROLLBACK_FILE, "utf8")) ?? []; } catch { journal = []; }
    }
    const journaled = new Set(journal.map((j) => j.id));
    // applied-file: ids whose patch is fully written (resume marker). The
    // rollback journal keeps TRUE original values (captured before first apply).
    const APPLIED_FILE = path.resolve("reports/dividends-enrich-applied.json");
    let appliedIds = [];
    if (fs.existsSync(APPLIED_FILE)) {
      try { appliedIds = JSON.parse(fs.readFileSync(APPLIED_FILE, "utf8")) ?? []; } catch { appliedIds = []; }
    }
    const applied = new Set(appliedIds);
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      const remaining = chunk.filter((u) => !applied.has(u.id));
      if (!remaining.length) continue;
      const fresh = chunk.filter((u) => !journaled.has(u.id));
      if (fresh.length) {
        const prior = await prisma.dividend.findMany({
          where: { id: { in: fresh.map((u) => u.id) } },
          select: { id: true, eligibilityDate: true, exDividendDate: true, yieldPct: true, priceAtEx: true, priceAtExDate: true, priceSource: true, notes: true },
        });
        journal.push(...prior);
        fs.writeFileSync(ROLLBACK_FILE, JSON.stringify(journal, null, 1));
      }
      for (const u of remaining) {
        await prisma.dividend.update({ where: { id: u.id }, data: u.patch });
      }
      for (const u of remaining) applied.add(u.id);
      fs.writeFileSync(APPLIED_FILE, JSON.stringify([...applied]));
      counters.updates = (counters.updates ?? 0) + remaining.length;
      console.log(`applied ${Math.min(i + CHUNK, updates.length)}/${updates.length}`);
    }
    console.log(`APPLIED: ${counters.updates ?? 0} rows updated. journal entries: ${journal.length}`);
  } else if (!APPLY) {
    console.log("DRY RUN — nothing written. Re-run with --apply to write.");
  }

  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(), apply: APPLY, stats: counters,
    samples: updates.slice(0, 8).map((u) => ({ ticker: u.ticker, dps: u.dps, ex: u.ex, patch: { ...u.patch, eligibilityDate: ds(u.patch.eligibilityDate), priceAtExDate: ds(u.patch.priceAtExDate) } })),
    remainingNoPrice: finalNoPrice.slice(0, 60),
    noPriceByYear: finalNoPrice.reduce((m, x) => { const y = (x.target ?? "----").slice(0, 4); m[y] = (m[y] ?? 0) + 1; return m; }, {}),
  }, null, 1));

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("FAIL:", e?.message ?? e);
  await prisma.$disconnect();
  process.exit(1);
});
