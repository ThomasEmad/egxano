# EGXANO — Competitive Intelligence

**Date:** 2026-11-12 · **Method:** Public-page fetches + web search only (no auth bypass, no paywall circumvention, no competitor data redistribution). Evidence tiers: **[V]** verified on a public page this session · **[D]** demonstrated in a public preview · **[A]** advertised (pricing/marketing) but not independently verified operational · **[H]** hypothesis.

> Full raw research notes per competitor are summarized below; the feature matrix in §5 is the decision artifact.

---

## 1. AskBorsa (askborsa.com) — "المحلل الذكي للبورصة المصرية"

**Positioning [V]:** AI analyst that reads "today's prices and five years of financial statements for every listed company, and answers with the figure and its source" (https://askborsa.com/, /about). Arabic-first with a full `/en` mirror (sitemap hreflang pairs). Claims 305 companies / 3,577 reports; sitemap confirms 305 company pages + 6,297 company×period statement pages + 33 academy articles (https://askborsa.com/sitemap.xml). Very young product (© 2026, academy articles Sep–Nov 2026). Essentially zero third-party press/review footprint (Bing/DDG searches returned nothing this session).

**What it does exceptionally well:**
1. **Citation-first AI posture [V]:** demo answers carry exact figures + period + YoY delta + citation chips ("📄 Annual 2024 · 📄 Income statement") (/, /en). Page-level citation is claimed ("المصدر والصفحة", /pricing) but only [A] — not verifiable unauthenticated.
2. **Statement-page-per-period architecture [V]:** every company×period has its own SEO-addressable page with YoY table, sourced 3-line summary and official PDF link (e.g. https://askborsa.com/company/COMI/fy-2024).
3. **Provenance footnotes under every table [V]:** honest notes about consolidated-vs-standalone ambiguity and unit normalization (/, /company/COMI).
4. **Fundamentals × price fusion in AI market briefs [V]** (https://askborsa.com/market) — movers tied to their latest annual profits.
5. **Predicted results calendar [V]** with "expected / late" statuses (https://askborsa.com/results/calendar) + no-account publication alerts (email/Telegram).
6. **Deliberate AI-crawler strategy [V]:** robots.txt explicitly allows GPTBot/ClaudeBot/PerplexityBot; FAQPage JSON-LD embeds cited Q&A — they are optimizing to *be the answer* inside LLMs for EGX queries.
7. **Localized payments [A]:** EasyKash/Fawry/Vodafone Cash, plans from 99 EGP/mo (https://askborsa.com/pricing).

**Weaknesses / gaps (all observed):**
1. **Thin statement schema [V]:** ~9–10 pre-extracted line items per period — no revenue, margins, EPS or segments on public pages (they publish an article admitting summary-statement limits: /academy/what-you-can-and-cannot-read-from-summary-statements).
2. **No valuation or ratios visible pre-paywall [V]:** no P/E anywhere public; screener (`/screener` → 404) and comparison (`/compare` → 404) are **advertised on the pricing page but not shipped** [A].
3. **No historical price charts / no technical analysis** beyond the opaque Radar feed [V].
4. **Radar is a black box [V]:** six anonymous model tags ("model-a", "feed-c-swing-x"), "simulation on model record", no methodology or hit-rate statistics (https://askborsa.com/radar).
5. **Data-quality artifacts in public [V]:** ICFC (fertilizers) filed under Banks; SAIB shown in USD inside EGP tables; duplicate tickers; company-count inconsistencies (268 vs 293 vs 305 across pages).
6. **Hard free-tier wall:** 3 AI questions/day + only 2 years of data free (/, /pricing).
7. **No news/disclosure feed** — their own academy redirects users to EGX disclosures.

**Pricing [V copy]:** Free 0 (3 q/day, 2y data, 5-stock watchlist) · Plus 99 EGP (unlimited Q, 5-peer compare, 10 exports) · Pro 999 EGP (screener "50+ ratios", AI report generator, bulk PDF) · Team 9,999 · B2B data API $500–$2,000/mo (https://askborsa.com/pricing).

---

## 2. ZBorsa (zborsa.app) — "رادار الذكاء الاصطناعي للبورصة"

**Positioning [V]:** Quantitative buy/sell signals with targets and stop-loss ("advanced GBDT models") across "all 310 stocks" (https://zborsa.app/). Published 2026-09-20 per JSON-LD — a few months old. SPA: `/pricing`, `/market`, `/terms` all serve the identical homepage shell (md5-verified) — **no server-rendered pricing page**.

**What it does exceptionally well:**
1. **Decision-in-one-glance signal card [V]:** per-stock BUY + composite score /100 (COMI: BUY 89/100, target +8.5%/5 days, stop −3.5%, FX-hedge Tier 1, debt risk "safe") + fused Arabic "Direct Answer" paragraph (https://zborsa.app/stocks/COMI).
2. **Macro localization [V]:** CBE corridor rates (19/20%) wired into per-stock narratives; USD-devaluation hedge tiers; 7 thematic radars incl. "USD hedges" (https://zborsa.app/radar/usd-hedges).
3. **Real ML evaluation machinery — but hidden [V-bundle]:** the public JS bundle contains walk-forward folds, IC/AUC/log-loss, 3-class confusion matrices, champion/challenger, provenance-weighted sources — none of it appears on any crawlable page.
4. **SEO/content moat [V]:** 311 stock pages + 11 sectors + 7 radars + 14 `/learn/` pages targeting competitor queries; bilingual JSON-LD; dynamic OG images.

**Weaknesses / gaps:**
1. **Zero public track record** — the single biggest credibility gap: "every signal, win or loss, published" is marketing copy; no dated signal history is visible anywhere [A].
2. **Coverage-number chaos [V]:** 242 / 276 / 296 / 310 / 311 stocks claimed on different pages.
3. **Methodology opacity [V]:** no feature lists, no tier-score math; flat −3.5% stop regardless of volatility (contradicting its own "volatility-based 2–15% target" FAQ); "consensus of 5 sources" never enumerated.
4. **Self-graded trust markers:** aggregateRating 4.9/5 from 1,280 ratings sits on its own site, unverifiable [V].
5. **Architecture red flags [V-bundle]:** hard-coded owner account (username + phone + PBKDF2 hash) and client-side user tables in the public bundle; engine largely in-browser; much of the paywall is client-side.
6. **Fixed 5-day horizon + alerts capped at 10 even on paid tiers** [V-bundle].

**Pricing [V-bundle]:** Free 0 (15 stocks, 1 alert) · Trial 14d · Pro 99 · Max 199 (featured) · Elite 1,000/yr — Google-Play billing.

---

## 3. EGX Screener (egxscreener.com) — "Analyze, Track, Dominate"

**Positioning [V]:** SPA "terminal" (Alpine.js + Tailwind + Supabase + Chart.js); all routes serve the same ~1.0 MB shell. Multi-market claims (EGX/ADX/Tadawul/US) [V markup]. Sitemap has only **7 URLs, zero company pages**, and robots.txt **blocks all AI crawlers** (https://egxscreener.com/sitemap.xml, /robots.txt). Onboarding friction: email+phone+Telegram+X verification before market data [V].

**What it does exceptionally well:**
1. **Depth per stock [V]:** "360° Company overview" drawer — price ladder, multi-year GAAP matrix, FCF, ROIC, Altman Z, Piotroski badge, forward multiples, dividend extraction-confidence %, official-bulletin P/E, sovereign yield spread with implied ERP.
2. **Evidence discipline [V]:** "✓ AUDITED", "Audited Filing LTM" tags, extraction-confidence percentages, metric-tagged risk register — best epistemic labeling in the market (though formulas stay opaque).
3. **Screener breadth [V markup]:** 23+ sortable fields (F-Score, momentum, FX shield, RSI, SMA50/200, P/E, forward P/E, PEG, P/S, P/FCF, EPS, ROE, yield, revenue growth...), multi-rule builder with 5 operators, presets (Magic Formula, Deep Value, Golden Cross...).
4. **Radars [V]:** 52W High Breakout / Low Deep Value (fixed 10% bands); volume anomaly ≥2.0× vs 10-day baseline with 10/30/60-day averages; unusually honest anomaly disclaimers.
5. **Portfolio analytics [V markup]:** S&R quality oscillators, concentration warnings ("Diworsification"), dividend schedule forecasting, AI rebalance.
6. **Bilingual EN/AR** including a voice AI assistant [V].

**Weaknesses / gaps:**
1. **Backtests are hardcoded constants [V — decisive]:** `/static/screener.js` `getStrategyBacktestData()` returns **identical** per-timeframe stats for all five "strategies" (e.g. 1Y: strategy +96.5% vs EGX30 +38.2%, win-rate 85%, Sharpe 2.85; 5Y: +540% vs +145%) with a "historical simulation" disclaimer. This is a fabricated-performance risk — and EGXANO's single biggest credibility wedge.
2. **No saved/shared screens, no screen permalinks, no exports [V — absence].**
3. **No quarterly period support [V — absence]:** only "TTM Audited"/"Audited Filing LTM" + annual matrix.
4. **Formula/methodology opacity [V]:** F-Score shown as a bare "X/9" badge with no criterion breakdown; Graham/DCF/EPV/consensus-blending weights undisclosed; DCF inputs adjustable but no limitations text.
5. **Sorting is Pro-gated; free tier effectively read-only [V]; paywall is client-side blur/masking [V/H on enforcement].**
6. **Zero SEO surface [V]:** 7-URL sitemap, robots-blocked AI crawlers — invisible to organic and LLM discovery.
7. **No public pricing [V]:** `/pricing` serves an empty shell; Pro modal lists features, EGP prices post-auth only.

---

## 4. Evidence-tier summary

| Claim class | AskBorsa | ZBorsa | EGX Screener |
|---|---|---|---|
| Verified working publicly [V] | Company/period pages, market brief, rankings, calendar, radar feed, Telegram alerts | Signal cards, radars, sectors, learn hub, Telegram bot, PWA | Screener fields (markup), radars, portfolio UI, evidence tags, 360° drawer |
| Advertised, unverified [A] | AI Q&A live, page-number citations, screener, comparison, AI reports | Track record, regime/rotation, WhatsApp, Level-2 depth, ratings | Pricing, DCF/EPV depth for non-Pro, agentic AI room |
| Demonstrably weak [V] | 10-line statements, no valuation, data artifacts, 404 screener | No public stats, coverage chaos, opaque methodology | **Hardcoded backtests**, no saved screens, no quarterly, client-side paywall |
| Not replicated | — | — | — |

**No competitor data was scraped or stored; all observations are from public pages fetched during this session for product analysis only.**

---

## 5. Competitive feature matrix

Legend — competitor status: ✔ working [V] · ~ partial/advertised [A] · ✖ absent/404 [V]. EGXANO status from codebase audit (see `egxano-product-audit.md`). Priority: P0 critical · P1 high · P2 expansion · P3 experimental.

| # | Feature | AskBorsa | ZBorsa | EGX Screener | EGXANO today | Recommendation | Pri |
|---|---|---|---|---|---|---|---|
| 1 | AI research (grounded Q&A) | ~ demo w/ citations; live 3 q/day [A] | ~ fused narrative per stock [V] | ~ voice AI [V] | ✔ grounded reports + QA engine + chat, quota'd | Keep; add tool-using agent (see agentic-ai-architecture) | P1 |
| 2 | Agentic multi-step AI | ✖ | ✖ | ~ "agentic room" blurred [V] | ✖ | Spec'd (Phase 5 doc); build tool registry first | P1/P2 |
| 3 | Financial statements depth | ~ ~10 line items [V] | ✖ | ✔ multi-year GAAP matrix [V] | ✔ 72-code registry, full IS/BS/CF, restatement versioning | Surface EPS/margins/segments on company pages | P1 |
| 4 | Historical price data | ✖ (day bars only) | ✖ | ✔ charts (timeframes Pro) [V] | ✔ PriceBar OHLCV (harvest script; coverage uneven) | Wire price coverage dashboard; ingest continuity | P0 |
| 5 | Financial ratios | ✖ public [V] | ~ inside narrative [V] | ✔ [V] | ✔ deterministic calc + CalculatedMetric | Already ahead; expose more pre-paywall | P1 |
| 6 | Company comparison | ✖ 404 [V] | ✖ | ✖ (portfolio-only sector P/E) | ✔ /compare 2–4, period-aligned | Extend to linkable/shared comparisons | P1 |
| 7 | Technical analysis | ✖ | ✔ narrative signals [V] | ✔ charts + signals [V] | ✔ full indicator lib + guards + TradingView | Render orphaned TechnicalTab; add regime tags | P0/P1 |
| 8 | Fundamental analysis | ✔ statements pages [V] | ✖ | ✔ drawer [V] | ✔ overview reading-order sections | Render orphaned HealthTab (0-100 scores) | P0 |
| 9 | Advanced screener | ✖ 404 [V] | ~ 7 radars [V] | ✔ multi-rule builder [V] | ~ metric/event/dividend/sector filters + saved rules | Big spec (advanced-screener-spec.md): NL→filters, AND/OR groups, exports | P1 |
| 10 | Natural-language screening | ✖ | ✖ | ✖ | ✖ | Spec'd: NL → visible editable filters, Arabic-first | P1/P2 |
| 11 | Valuation models | ✖ | ✖ | ✔ fields, opaque [V] | ✔ undervalued screen (3 methods) | Add methodology pages + editable assumptions | P1 |
| 12 | Quant scoring | ~ radar models (opaque) [V] | ✔ score/100 (opaque) [V] | ✔ F-Score badge (opaque) [V] | ✔ 0-100 health scores + snowflake | **Criterion-level Piotroski (implemented this batch)** + published weights | P0 |
| 13 | Volume anomalies | ✖ | ~ bundle [V-b] | ✔ RVOL ≥2× [V] | ✖ | Derivable from PriceBar — add RVOL filter + flag | P1 |
| 14 | Market overview | ✔ strong brief [V] | ~ SPA market [V] | ✔ overview + heatmap [V] | ✔ breadth, treemap, dashboard | Add advances/declines + turnover story lines | P2 |
| 15 | Sector analysis | ✔ sector pages [V] | ✔ 11 sectors [V] | ✔ 18 sectors [V] | ✔ sector pages + benchmarks | Sector-relative valuation bands | P1 |
| 16 | Macro context | ✖ | ✔ CBE/FX tiers [V] | ~ FX shield label [V] | ✖ | Static CBE/FX context pack (manual, sourced) | P2 |
| 17 | Company news/disclosures | ✖ [V] | ✖ | ✔ news feed [V] | ✔ 7 disclosure models + events | Surface disclosures on company page; EGX feed later | P1 |
| 18 | Corporate events | ✔ calendar [V] | ✖ | ✔ next earnings [V] | ✔ FinancialEvent engine + dividends | Add predicted-results calendar (AskBorsa parity) | P1 |
| 19 | Watchlists | ✔ 5 free [A] | ✖ | ✔ [V] | ✔ zustand + server mirror | Add notes + alert tie-in | P2 |
| 20 | Portfolio analytics | ✖ | ✖ | ✔ sophisticated [V] | ✔ manual positions, P/L, weights | Health/concentration per holding; AI analysis w/ disclosures | P2 |
| 21 | Alerts | ✔ results alerts [V] | ✔ price/signal alerts [V-b] | ✔ price alerts [V] | ~ price ABOVE/BELOW, in-app only, lazy eval | Composable conditions + channels (Phase 11) | P1/P2 |
| 22 | Backtesting | ✖ | ~ hidden machinery [V-b] | ✖ **hardcoded constants [V]** | ✖ | Honest framework (quant-research-methodology.md); do NOT publish until reproducible | P2 |
| 23 | Exporting | ✔ Excel Pro [A] | ✖ | ✖ API blocked [V] | ✔ companies/export + print report | CSV export for screens/comparisons | P1 |
| 24 | Reports (AI) | ✔ AI report Pro [A] | ✖ | ✖ | ✔ cached AR/EN analyst reports | Keep cache-first identity key | P1 |
| 25 | Arabic experience | ✔ native-first [V] | ✔ primary [V] | ✔ bilingual [V] | ✔ AR-first i18n + Arabic AI | Maintain; add Arabic number formatting audit | P0 |
| 26 | Mobile experience | ~ web [V] | ✔ PWA [V] | ~ SPA [V] | ✔ PWA + offline page | Keep; test low-end Android RTL | P1 |
| 27 | SEO / AI-crawler strategy | ✔ aggressive GEO [V] | ✔ 311 pages [V] | ✖ robots-blocked [V] | ~ company pages + sitemap | Add per-metric pages; allow AI crawlers deliberately | P1 |
| 28 | Data transparency | ✔ footnotes [V] | ~ provenance tiers hidden [V-b] | ✔ confidence % [V] | ✔ validation + confidence + /status | Public per-ticker changelog ("what changed & why") | P1 |
| 29 | Free-tier limits | ~ 3 q/day, 2y data [V] | ~ 15 stocks [V-b] | ~ 4-way verification [V] | ✔ 3 analyses/mo + public pages | Keep public read paths free; meter interactive AI | P1 |

---

## 6. Strategic read

1. **All three competitors are months old, trust-poor, and feature-thin where it matters:** nobody ships a working, transparent screener+comparison+valuation triad; AskBorsa 404s its screener, ZBorsa hides its engine, EGX Screener fabricates backtest constants.
2. **EGXANO's existing moat is real:** deterministic calculation engines with validation trails, restatement versioning, cache-first AI, honest data-sufficiency guards — architecture the competitors demonstrably lack (ZBorsa runs the engine client-side; EGX Screener's paywall is CSS blur).
3. **The winning wedge is *verifiable transparency*:** criterion-level scores, published formulas, dated signal/track-record ledgers, per-ticker data changelogs — every competitor's biggest marketing claim is unverifiable; EGXANO can make verifiability the brand.
4. **Arabic-first parity is table stakes**; all three are already Arabic-first. Differentiate on depth + honesty, not on language.
