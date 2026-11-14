# EGXANO Market-Data Layer Audit — Ground Truth Report

**Auditor:** Financial Data Engineering (sandbox audit)
**Date of audit:** 2026-11-14 (Saturday; EGX closed — last full session Thursday 2026-11-12)
**Repo audited:** fresh clone at `/tmp/egx-work` (HEAD `1851804`; note: the working tree carries uncommitted changes to `src/lib/market/tiers.ts`, `src/lib/technical/board-filters.ts` and others — **the deployed production build runs the committed HEAD versions**, and where behavior differs this report says so and cites the empirical production evidence)
**Production tested:** `https://egxano.vercel.app` (read-only GETs only; no auth, no DB access)
**Artifacts:** `docs/notes/data/*.json` (raw fetched data), `docs/notes/data/history-samples/*.json`, `scripts/invest/*` (reproducible fetch/check scripts)

Every number below comes from (1) production API responses fetched on 2026-11-14 (raw JSON preserved under `docs/notes/data/`) or (2) code read in this repo at the cited file path. Nothing is estimated.

---

## Executive verdict (TL;DR)

| Question | Verdict |
|---|---|
| Is there enough history for indicator warm-ups? | **Yes for the close-based engine.** ~172–190 daily sessions per verified company (≈12 calendar months, 2025-11 → 2026-11-12). All engine indicators (EMA20, EMA50, RSI14, rangePos60, perfM1/M3 needing 21/50/60/63 sessions) are satisfiable. A stored SMA200 is NOT possible at current depth (max observed 190 sessions). |
| Is there enough history for backtesting? | **Marginal: ~8.5–9 trading months (~172–190 sessions) per company, verified for 5 free-entitlement tickers.** Enough for single-pass walk-forward demos, not for multi-year robustness. Deep history (>1y) is actively *prevented* by design: Yahoo ingest uses `range=1y` and retention prunes to 380 sessions. |
| Phantom Fri/Sat sessions in what the engine consumes? | **No** (candles contain 0 Fri/Sat rows across 913 sessions; Fri/Sat quotes are anchored to Thursday by `effectiveEgxSessionDate`). **Yes** in the *public* `/history` endpoint, which does NOT anchor (5 of 16 sampled points per ticker are Fri/Sat timestamps). |
| Are series corporate-action-adjusted? | **The technical engine's input is a consistently adjusted series** (Yahoo bars are split/bonus-adjusted at source; a read-time two-pass engine de-adjusts and re-adjusts everything against the project's own CorporateAction+Dividend ledger). **The public `/history` series is raw/unadjusted** (CANA's −24.4% bonus drop is visible as a "price crash" on 2026-11-12). |
| Is the universe/tier mapping consistent? | **Yes.** All 100 seed tickers (EGX30=30, EGX70=70) exist as company rows; production tier counts **EGX30=30, EGX70=69, MAIN=145, OTC=0** over 246 active companies; zero seed↔production tier mismatches. |

---

## A) History depth & quality (empirical)

### A.1 The two price-history stores (code facts)

| Store | Writer | Contents | Depth policy | Evidence |
|---|---|---|---|---|
| `MarketPrice` | TradingView scanner pipeline (`sourceName="TRADINGVIEW_SCANNER"`, `src/lib/market/refresh.ts`) | one row per company per **UTC day** (`price`, `volume`, `valueTraded`); today's row is deleted+replaced on every intraday refresh | grows by one row/day while refresh runs | `src/lib/market/refresh.ts` lines 249–292 |
| `PriceBar` | Yahoo candle ingest (`sourceName="YAHOO_CANDLES_1Y"`, `src/lib/market/candles.ts` + `scripts/import-missing-candles.mjs`) | daily **OHLCV** bars, `range=1y&interval=1d` from `query1.finance.yahoo.com/.../chart/<TICKER>.CA`, full-OHLC-quadruple filter, bars stored **AS-IS** (never re-adjusted at write time) | **retention prunes to newest 380 sessions** (`KEEP_SESSIONS=380`); source range caps at 1 year | `src/lib/market/candles.ts` lines 29–31, 86–100, 165–177 |

**Operational red flag found in code:** `scripts/import-missing-candles.mjs` header comment states *"Yahoo بيحجب egress الخاص بـ Vercel Lambda (فشل 100% من الإنتاج بتاريخ 2026-11-13)"* — Yahoo blocks Vercel Lambda egress, production candle ingestion failed 100% on 2026-11-13, and full imports must be run off-Vercel. Consistent with the empirical observation below: the newest stored candle is **2026-11-12** while today is 2026-11-14.

### A.2 The public `/api/v1/market/history` endpoint — contract + empirical content

Code contract (`src/app/api/v1/market/history/route.ts`):

- Params: **`symbol`** (not `ticker`; default "EGX30"), **`interval`** (1D/1W/1M/3M/6M/1Y/5Y — validated but **never used** to shape data), **`range`** (1D…5Y).
- Response: `{ symbol, interval, range, data: [{ timestamp, price }], asOf }` — **price-only**: no open/high/low, **no volume**, no adjustment flags, no source attribution.
- Row cap: SQL `LIMIT` = 100 (1D/1W) or **500** (everything else); index symbols (`EGX30`, `EGX70`, `EGX100`, `EGX30CAPPED`) deliberately 404 with `INDEX_HISTORY_UNAVAILABLE` (no licensed index time-series).
- Reads **`MarketPrice` only** — it does NOT read `PriceBar`, so it never serves the OHLC candles the technical engine uses.

Empirical fetch (2026-11-14, `range=5Y`, raw JSON in `docs/notes/data/history-samples/<T>.json`):

| Ticker | Profile | Points | First | Last | Fri pts | Sat pts | Dups | Sorted | Gaps >±20% |
|---|---|---|---|---|---|---|---|---|---|
| COMI | mega-cap | 16 | 2025-11-01 | 2026-11-14 | 2 | 3 | 0 | yes | 1 (+30.1%) |
| ETEL | mega telecom | 16 | 2025-11-01 | 2026-11-14 | 2 | 3 | 0 | yes | 1 (+20.9%) |
| ABUK | EGX30 | 16 | 2025-11-01 | 2026-11-14 | 2 | 3 | 0 | yes | 2 |
| TMGH | EGX30 real estate | 16 | 2025-11-01 | 2026-11-14 | 2 | 3 | 0 | yes | 1 |
| HRHO | mega fintech | 16 | 2025-11-01 | 2026-11-14 | 2 | 3 | 0 | yes | 0 |
| HDBK | EGX70 bank | 16 | 2025-11-01 | 2026-11-14 | 2 | 3 | 0 | yes | 3 (+45.0%, −44.7%, +26.7%) |
| SWDY | EGX70 industrial | 16 | 2025-11-01 | 2026-11-14 | 2 | 3 | 0 | yes | 1 |
| CANA | recently volatile (0.5 bonus ex 2026-11-12) | **5** | 2026-09-30 | 2026-11-14 | 1 | 1 | 0 | yes | 1 (−24.4%) |
| MEPA | low-liquidity EGX70 seed | 16 | 2025-11-01 | 2026-11-14 | 2 | 3 | 0 | yes | 1 (price 1.62→1.29 EGP) |
| ZEOT | low-liquidity EGX70 seed | 16 | 2025-11-01 | 2026-11-14 | 2 | 3 | 0 | yes | 2 (+63.8%) |

Structure of those 16 points (identical shape across tickers; CANA has only the 5 scanner rows):

1. **11 "monthly" points at month-start UTC midnights** (2025-11-01 … 2026-09-01), some on **weekend dates** (2025-11-01 = Saturday, 2026-05-01 = Friday, 2026-08-01 = Saturday) — legacy seed rows, several carrying float32 artifacts (e.g. `102.6420745849609`) typical of Yahoo bars, others round values (135, 133). These are not trading-session data.
2. **4–5 real scanner day-rows** (2026-09-30, 2026-11-04, 2026-11-12, 2026-11-13, 2026-11-14) — the last two are **Friday and Saturday pulls restating Thursday's close** (COMI/ETEL/etc. all show the identical price 128.75 at Fri 06:31Z and Sat 14:47Z; CANA shows 34.74 on both). The endpoint does NOT anchor weekend quotes to the Thursday session (no `effectiveEgxSessionDate` here), so the **public series contains phantom Fri/Sat sessions with duplicated closes**.

**Verdict on `/history`: not analyzable as a time series.** 16 points over 13 months, no OHLC/volume, no adjustment, mixes monthly legacy rows with sparse scanner days, contains weekend timestamps, and can never exceed 500 rows even when data exists. Zero-volume checks and OHLC validity are not applicable to this endpoint (fields do not exist).

### A.3 What the technical engine actually consumes — canonical adjusted candles (empirical)

`/api/v1/companies/<TICKER>/technical` (gated to the 5 free-entitlement tickers COMI/ETEL/TMGH/ABUK/EFID; non-free returns 403 `PREMIUM_REQUIRED` — empirically confirmed with HDBK) exposes `candles` = the merged, corporate-action-adjusted daily series capped at the last 260 bars (`src/lib/technical/analyze.ts` line 414: `adjustedBars.slice(-260)`; DB read cap `MAX_BARS=400`; board window `WINDOW_DAYS=300` calendar days in `src/lib/technical/signals-service.ts`).

Raw JSON: `docs/notes/data/history-samples/technical-candles-<T>.json`. Quality check: `scripts/invest/data-quality.py` → `docs/notes/data/quality-report.json`.

| Ticker | Sessions | First | Last | Fri/Sat rows | Dups | Sorted | high<low | close outside [l,h] | open outside [l,h] | gaps >±20% | ~2x overnight (unadjusted-split signature) | volume field |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| COMI | 172 | 2025-11-12 | 2026-11-12 | 0 / 0 | 0 | yes | 0 | 0 | 5 | 0 | 0 | none |
| ETEL | 186 | 2025-11-17 | 2026-11-12 | 0 / 0 | 0 | yes | 0 | 0 | 5 | 0 | 0 | none |
| TMGH | 182 | 2025-11-13 | 2026-11-12 | 0 / 0 | 0 | yes | 0 | 0 | 0 | 0 | 0 | none |
| ABUK | 183 | 2025-11-12 | 2026-11-12 | 0 / 0 | 0 | yes | 0 | 0 | 0 | 0 | 0 | none |
| EFID | 190 | 2025-11-13 | 2026-11-12 | 0 / 0 | 0 | yes | 0 | 0 | 0 | 2 | 0 | none |

Weekday totals over all 913 candle sessions: Sun 157 / Mon 207 / Tue 179 / Wed 201 / Thu 169 / **Fri 0 / Sat 0** — a clean Sun–Thu series.

Findings:

1. **Depth: 172–190 sessions ≈ 12 calendar months** per verified company. Session counts differ per ticker (172–190), i.e. Yahoo's EGX coverage is not perfectly uniform across names.
2. **Phantom sessions: none** in the engine input — the Fri/Sat anchoring (`src/lib/market/egx-session.ts`) demonstrably works; the last candle is Thursday 2026-11-12 even though production was queried on Saturday 2026-11-14.
3. **OHLC validity: structurally clean.** Zero `high<low`, zero close-outside-range. 10 rows (COMI 5, ETEL 5) have `open` outside `[low,high]` by **≤0.02 EGP** — sub-piastre rounding artifacts of the 4-decimal rescale in `applyCorporateActionAdjustments` (`toFixed(4)` on independently scaled fields), not data corruption. Immaterial for analysis, worth knowing if anyone rebuilds candlestick patterns on them.
4. **Adjustment signature: adjusted.** No ~2x overnight discontinuities anywhere in 913 sessions. (The raw market's CANA event — 45.96 → 34.74 across the 2026-11-12 ex-date — appears only in the unadjusted `/history` series, confirming the two stores have opposite adjustment semantics.)
5. **Suspicious cluster needing review: EFID, September 2026** — 20.80 (Thu 2026-09-17) → 13.56 (Sun 2026-09-21, **−34.8%**) then 12.64 (Sun 2026-09-28) → 18.75 (Mon 2026-09-29, **+48.4%**). This exceeds the repo's own 12% suspicious-gap threshold (`detectSuspiciousGaps`, `src/lib/market/corporate-actions.ts`); it is either a real crash/rebound or an action missing from the ledger (e.g. rights/TERP pattern). Flagged for the research team; cannot be resolved without the corporate-actions table (DB not reachable).
6. **Volume: not exposed** in the candle payload (`{t,o,h,l,c}` only). Volume exists in `PriceBar`/`MarketPrice` and feeds `relVol` in the signals engine, but researchers cannot pull a public per-ticker volume series.
7. **Staleness: last candle = 2026-11-12** on all five tickers while today is 2026-11-14 — matches the code-documented Yahoo↔Vercel egress block (A.1). The scanner day-rows keep flowing (MarketPrice has 2026-11-14 rows), so the board still prices today, but the stored candle depth is frozen until off-Vercel ingest resumes.

### A.4 Raw-vs-adjusted policy in the repo (A4 answer)

Search performed: `grep -rn "split|dividend|adjust" src/lib src/app/api` — the entire adjustment machinery lives in **`src/lib/market/corporate-actions.ts`** (573 lines) and is wired into `src/lib/market/refresh.ts` (snapshot change%) and `src/lib/technical/signals-service.ts` (board) and `src/lib/technical/analyze.ts` (company tab). The policy:

- **At write time:** bars are stored AS-IS. Yahoo's chart bars are already split/bonus-adjusted (documented with the CANA case: raw 2026-11-11 close 51.02 comes back as 34.01); Yahoo does NOT adjust cash dividends or rights.
- **At read time (`applyCorporateActionAdjustments`):** two passes — (1) de-adjust Yahoo-sourced bars back to RAW terms using the project's own event ledger (multiply pre-ex-date bars by `1+b` for bonus / `s` for split), (2) re-adjust the uniform raw series newest→oldest via `adjustPrevClose` (bonus `prev/(1+b)`, split `prev/s`, cash `prev−d`, rights TERP `(prev + r·S)/(1+r)`). Sources of events: `CorporateAction` table (imported from **foudalens.com** `api/corporate-actions`, ~6 months coverage per code comments) + `Dividend` ledger (years of coverage; cash dividends deliberately read only from this table to avoid double-subtraction).
- **MarketPrice/scanner rows are RAW** and never stored adjusted; today's change% for action companies is rebuilt from Yahoo's adjusted prev-close, with the scanner's change as fallback.
- **Admin safety net:** any close-to-close drop >12% without a recorded action within ±3 days is flagged (`detectSuspiciousGaps`) — exactly the EFID cluster found in A.3.

---

## B) Universe / tier mapping diff

### B.1 `/api/v1/companies` — contract + full snapshot

- Params (code): `search`, `sector`, `page`, **`pageSize` (max 50)**, `ids`, `status`, `tickers`, `sort`, `dir` + numeric filters. There is **no** `limit`/`offset`/`all` param; full-universe fetch = `page=1..ceil(total/50)`.
- Response company fields: id, ticker, isin, nameEn, nameAr, sector, industry, listingStatus, egxCategory, irUrl, isDemoData, counts, snapshot, marketPrice, marketCap. **`marketTier` is NOT exposed by this endpoint** (only `/api/v1/technical/signals` rows and the admin-only `/api/v1/admin/market-tier` carry it).
- **Empirical production bug:** with `sort=ticker` (the SQL pagination path), pages ≥2 return **0 companies** while `total=246` (tested `?page=2&pageSize=50&sort=ticker&dir=asc`, and without `dir`). The default `sort=marketCap` (in-memory) path paginates correctly. Snapshot was therefore fetched with the default sort: **246/246 companies** → `docs/notes/data/companies-snapshot.json`.
- Snapshot facts: all 246 active companies have `listingStatus="LISTED"`; `isDemoData` false on the sampled rows; sectors present in snapshot: Banks, Basic Materials, Building Materials, Construction, Consumer, Education, Energy, Financial Services, Food, Healthcare, Industrial, Insurance, Media, Petrochemicals, Real Estate, Telecom, Transport, … (18 distinct; the signals response's own `sectors` facet lists only 8 — a deployed-build truncation).

### B.2 `/api/v1/technical/signals` — tier facet (cross-check, B3)

Anonymous GET (2026-11-14, cached whole-market compute; response metadata):

```
universe=246  scored=242  weakData=2
tiers facet = { "EGX70": 69, "MAIN": 145, "EGX30": 30 }   (no OTC key ⇒ 0)
```

This matches the product owner's reported production DB counts exactly: **EGX70=69, EGX30=30, MAIN=145**, and adds **OTC=0**. The facet counts *priced rows* (244 = 246 universe − 2 companies with no price data at all).

### B.3 Ticker→tier enumeration (how the mapping was obtained without admin access)

Method (`scripts/invest/fetch-universe.mjs`, raw result `docs/notes/data/tier-enumeration.json`): sector-slice the signals board (sector list taken from the companies snapshot, since the deployed `sectors` facet is truncated to 8), partition capped slices by `signal=buy/hold/sell`, and read `marketTier` off every returned identity row. Deployed-build filter facts verified empirically: filters **do** compose (`?tier=EGX30&sector=Banks` → 2 rows, both EGX30); `?tier=EGX70` **falls back to "all"** on the deployed build (HEAD comment: "the term is removed from the site — the constituent list is incomplete"); `?tier=OTC` is accepted and matched **0 rows**.

Result: **243 distinct tickers** with tier labels — EGX30=30, MAIN=145, EGX70=68 visible. Reconciliation of the 3 tickers not visible in signals rows (cross-checked against the snapshot):

| Ticker | Why invisible | Snapshot evidence |
|---|---|---|
| AMER (EGX70 seed) | priced but `signal=null` (weak row) — sorted last, hidden under the 24-locked-row cap in every slice | has a marketPrice; absent from all slice rows |
| AIHC (EGX70 seed) | **no price data at all** (no MarketPrice, no signals row) | `marketPrice: null` |
| NAPR | no price data at all | `marketPrice: null` |
| MKIT | has PriceBar history (appears in enumeration) but no scanner marketPrice | in enumeration, not in the no-price list |

### B.4 Diff vs seed lists (`src/lib/market/tiers.ts`, egxbot.com + egx.com.eg, November 2026)

Seed sizes: **EGX30_TICKERS = 30, EGX70_TICKERS = 70** (the file's own header claims 70 seed tickers; production prices 69 of them). Full diff in `docs/notes/data/tier-diff.json`.

| Check | Result |
|---|---|
| (a) Seed tickers with **no matching company row** | **EGX30: none (30/30 found). EGX70: none (70/70 found).** |
| (b) Companies with production tier EGX30/EGX70 **not in the seeds** | **None** (0 extra in both tiers) |
| Seed↔production tier mismatches (seed says EGX30/EGX70, production says other) | **None** |
| (c) Counts per tier (production facet / enumerated) | **EGX30 30 / 30 · EGX70 69 / 68 visible (+1 weak row) · MAIN 145 / 145 · OTC 0 / 0** |
| (d) OTC rows | **0 priced OTC rows; `?tier=OTC` matched 0; all 246 active companies are `listingStatus=LISTED`.** The admin seed's OTC sweeps (listingStatus sweep + 45-day-activity sweep in `/api/v1/admin/market-tier`) exist in code but production currently holds no OTC-classified company. |

Note on the EGX70 69-vs-70 arithmetic: the seed has 70 tickers; the priced universe carries 69 EGX70-labeled rows. The seed tickers AMER and AIHC are the two that cannot be confirmed as EGX70-labeled from public data (AMER is a priced weak row, AIHC has no price data); their DB `marketTier` exists but is only readable via the admin API. This is the single residual ambiguity in the tier mapping, and it is bounded to those two tickers.

---

## C) Calendar / session / execution constraints (code-level)

### C.1 Trading calendar & non-trading-day handling

- **Session model:** `src/lib/market/egx-hours.ts` — EGX trades **Sunday–Thursday**, Cairo time (`Africa/Cairo` via Intl, never server-local); opening auction 09:30–10:00, continuous 10:00–14:30, closing auction 14:30–14:45; "market live" = 09:45–14:45 on a trading day. Used for live badges and refresh pacing.
- **Phantom-session anchoring:** `src/lib/market/egx-session.ts` — a quote that arrives on **Friday → anchored to Thursday**, **Saturday → anchored to Thursday**; scheduled trading days take the quote's UTC date. Written explicitly to kill phantom Fri/Sat sessions that "inflated the session count, flattened the day change to 0.00% and shifted every indicator (observed live 2026-11-14: COMI board buy 71 → wait 50)". Applied in the board merge (`signals-service.ts` line 113) and the analyze bundle. **Not applied** in `/api/v1/market/history` (hence the Fri/Sat points in the public series).
- **Holiday table: NONE.** `grep -i holiday` over `src/`, `prisma/schema.prisma`, `db/` finds no holiday model. The code says so itself (`egx-session.ts`): *"Scheduled holidays (Sunday etc.) cannot be detected without an external calendar; the quote then legitimately belongs to that weekday and is deduped by the normal per-day bucketing"* — and `corporate-actions.ts` `scannerChangeSessions`: *"Holidays are ignored (worst case: an adjustment is skipped for one day — never fabricated)"*. Consequence: on an EGX holiday (Sun–Thu), scanner quotes are written as a MarketPrice day-row for that weekday and the engine treats it as a session (a close-equal-to-yesterday bar). History fetches on such days can mint holiday "sessions" for actively-refreshed tickers.
- History in snapshots: `MarketPrice` rows are bucketed per **UTC day** (not Cairo day) — a Thursday 23:50Z pull is Friday 01:50 Cairo but still buckets to Thursday by design (`egx-session.ts` docstring).

### C.2 Price-limit / tick-size modeling

`grep -rn "tick|priceLimit|limit up|round"` over `src/lib` (excluding ticker-substring noise) finds **no EGX price-limit model and no tick-size model anywhere**:

- No ±20% daily price-limit band is enforced or simulated on any write or read path.
- No tick-size grid or price rounding to a trading increment. Prices are stored exactly as received (scanner floats or Yahoo float32 artifacts — e.g. `102.6420745849609` in the seed rows); the only rounding is `toFixed(4)` cosmetic clean-up after read-time adjustment (`corporate-actions.ts` lines 371–376) and display formatting.
- The only execution-adjacent guards are generic plausibility caps, not market rules: **±50%** day-change cap for movers (`refresh.ts` line 138 — chosen so a 1:1 bonus's raw −50% survives adjustment), the same ±50% cap in the ticker route, and the **>12%** suspicious-gap detector for admins (`corporate-actions.ts` `GAP_DROP_FRACTION=0.12`).
- Implication for research: any backtest or trade-plan simulation in this data layer implicitly allows limit-locked days and off-tick fills that real EGX microstructure would reject. (EGX's actual price-limit/tick rules are per-board and change over time; the platform models neither.)

### C.3 Upstream sources (what feeds the market-data layer, and the delay)

| # | Upstream | Endpoint | Provides | Delay / cadence (code) |
|---|---|---|---|---|
| 1 | **TradingView public scanner** | `POST https://scanner.tradingview.com/egypt/scan` (`refresh.ts` line 33) | per-stock `close`, `change`, `volume`, `market_cap_basic`, `total_shares_outstanding` (columns list line 198); indices `EGX:EGX30`, `EGX:EGX70EWI`, `EGX:EGX100EWI`, `EGX:EGX30CAPPED`; range [0,1000] rows | **`delayMinutes: 15` hardcoded** in every snapshot (`refresh.ts` line 161; snapshot comment: "the same authorized public TradingView EGX scanner… 15-minute delayed, no paywall bypass"). **The 15-min delay claim is confirmed in code.** Refresh triggers: `/api/v1/cron/market` (Bearer CRON_SECRET), opportunistic kick when the snapshot is >20 min stale inside the session window, and the daily audit cron tail. Prices change once/day effectively; the client polls /ticker every 90s against a 60s cache. |
| 2 | **Yahoo chart API** | `GET query1.finance.yahoo.com/v8/finance/chart/<T>.CA?range=1y&interval=1d` (`candles.ts` line 88; same conventions in `scripts/import-missing-candles.mjs`) | daily OHLCV bars (split/bonus-adjusted), source of ALL stored `PriceBar` depth | Admin-triggered chunked ingest (≤40 companies/chunk, 250 ms pacing); NOT a Vercel cron (vercel.json has only audit/alerts-push). **Documented production outage: Yahoo blocks Vercel Lambda egress — 100% fetch failure from production 2026-11-13; imports must run off-Vercel.** |
| 3 | **Yahoo events/spark** | `?range=15y&interval=1mo&events=div` (`scripts/dividends-import.mjs`), `v8/finance/spark?range=10y` (`scripts/dividends-enrich.mjs`) | dividend events + long history for dividend enrichment | offline scripts, not runtime |
| 4 | **FoudaLens** | `GET https://foudalens.com/api/corporate-actions` (`scripts/corporate-actions-import.mjs`) | bonus/split/rights ledger into `CorporateAction` (~6 months coverage per code comment) | offline import; feeds the read-time adjustment engine |
| 5 | **askborsa.com / mubasher.info / TradingView symbol+financials pages** | various scrapers in `scripts/` | company financial statements, index constituent pages, share counts | offline imports; fundamentals, not prices |

Delay summary: **all quote surfaces are ≥15-min delayed by construction** (single upstream snapshot stamped `delayMinutes: 15`); there is no realtime feed anywhere in the runtime paths. Candles additionally lag by the ingest cadence — and are currently stale (last session 2026-11-12) due to the Yahoo↔Vercel egress block.

`vercel.json` crons (whole list): `cron/audit?type=daily` 06:00 daily, `cron/audit?type=weekly` Mon 04:00, `cron/alerts-push` 14:00 daily. **No market-data cron in vercel.json** — the price refresh relies on the opportunistic >20-min-stale kick plus external scheduling, and candle ingest is admin/offline only.

---

## Limitations (explicit disclosures)

1. **Neon DB unreachable** from this sandbox. All DB-level claims above are derived from the production HTTP API (which is backed by that DB) plus code reading. Row counts inside `PriceBar` for non-free tickers could not be sampled directly; depth for gated tickers is inferred from the shared pipeline, not measured.
2. **Yahoo is unreachable from this sandbox too** (direct `query1.finance.yahoo.com` returns HTTP 429 from this IP), so the bars could not be cross-checked against the upstream source. The 403 on `investing.com` and the unreachability of `egx.com.eg` mean **official EGX constituent verification was NOT performed — the egxbot.com/egx.com.eg November-2026 seed list remains the project's authoritative source**, and this audit verified internal consistency (seed↔DB), not external correctness. If the EGX re-shuffles constituents, nothing in the pipeline will detect it.
3. **Tier labels for 2 of 246 companies unverified** (AMER, AIHC — priced-weak and no-data respectively; their DB tier exists but is only admin-readable). All other 243 verified individually. OTC=0 relies on the facet + all-LISTED listing statuses.
4. **Deployed build ≠ working tree.** The local repo has uncommitted changes (e.g. `tier=EGX70` filter re-added, `OTC` option removed, sector facet fix). Production behavior documented here is the *deployed* behavior, verified empirically where the two could differ.
5. **Candle volume is not publicly exposed** (signals `relVol` uses it internally), so volume-based quality checks (zero-volume days) could only be run conceptually, not empirically, on the candle payload.
6. **Two no-data companies (AIHC, NAPR) and one weak row (AMER)** carry no analyzable price series at all; the "usable universe" for technical analysis is 243–244 companies, not 246.
7. The **EFID Sep-2026 gap cluster** (−34.8% / +48.4%) is flagged but unresolved — needs the corporate-actions ledger (DB) or EGX notices to classify.
8. /history pagination bug (`sort=ticker` pages ≥2 empty) was observed empirically on production; root cause is in the deployed route build, not the working-tree code shown here.
9. Housekeeping: an untracked `.cache/` directory appeared in the clone root during the audit window with fetch artifacts this audit's scripts do not produce (e.g. `probe-stooq.csv`, `companies-p*.json`) — likely a parallel process sharing this clone. It was left untouched; none of this report's inputs or outputs depend on it.

---

## Artifacts index

| File | Content |
|---|---|
| `docs/notes/data-audit.md` | this report |
| `docs/notes/data/companies-snapshot.json` | all 246 active companies (ticker, names, sector, listingStatus, egxCategory, marketPrice, marketCap, counts) + pagination-bug note |
| `docs/notes/data/signals-facets.json` | production signals board metadata: universe/scored/weak, tiers/styles/sectors facets, matched distribution, free full rows (with live technical metrics) |
| `docs/notes/data/tier-enumeration.json` | 30 fetch slices + 243-ticker ticker→tier map with method notes |
| `docs/notes/data/tier-diff.json` | seed↔production diff: missing seeds, extra tier rows, mismatches, per-tier counts, OTC facts |
| `docs/notes/data/quality-report.json` | machine-readable A.2/A.3 quality check results |
| `docs/notes/data/history-samples/<T>.json` | `/history` responses for COMI, ETEL, ABUK, TMGH, HRHO, HDBK, SWDY, CANA, MEPA, ZEOT |
| `docs/notes/data/history-samples/technical-candles-<T>.json` | canonical adjusted OHLC candles for COMI, ETEL, TMGH, ABUK, EFID + the HDBK 403 gate proof |
| `docs/notes/data/history-samples/_fetch-summary.json` | fetch manifest with per-ticker HTTP status |
| `scripts/invest/fetch-history.mjs` | A2 fetcher (reproducible) |
| `scripts/invest/fetch-technical-candles.mjs` | candle fetcher incl. 403 gate test |
| `scripts/invest/fetch-universe.mjs` | B1/B3 fetcher (companies pagination + facets + enumeration) |
| `scripts/invest/tier-diff.mjs` | B2 diff computation |
| `scripts/invest/data-quality.py` | A3 quality checks (weekday/phantom/dup/sort/gap/OHLC/2x-signature) |

*No files under `src/**` were modified; nothing was committed.*
