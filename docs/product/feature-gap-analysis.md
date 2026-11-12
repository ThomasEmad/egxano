# EGXANO — Feature Gap Analysis

**Date:** 2026-11-12 · **Inputs:** `competitive-intelligence.md` (evidence-tiered) × `egxano-product-audit.md` (code-verified).
**Gap classes:** **A** = available in EGXANO today · **B** = derivable from existing data (no new sources) · **C** = needs a new authorized data source · **D** = needs an external paid service · **E** = cannot be implemented reliably today.

## 1. Master gap table

| Capability | AskBorsa | ZBorsa | EGX Scr. | EGXANO | Gap class | Close-by plan |
|---|---|---|---|---|---|---|
| Grounded AI Q&A w/ citations | ~ (demo) | ~ (narrative) | ~ (voice) | ✔ (deterministic QA + AI reports) | A | Extend to agentic tools (P1) |
| Criterion-level Piotroski F-Score | ✖ | ✖ | ~ bare badge, no breakdown | ✖ | **B** | **Implemented this batch** (`piotroski.ts` + API + UI) |
| Altman Z-Score w/ applicability notes | ✖ | ✖ | ~ badge only | ✖ | B | Quant methodology doc → P1 batch 2 |
| 52W high/low + range position | ✖ | ✖ | ✔ fixed 10% bands | ✖ | B (PriceBar) | Screener spec §radars (P1) |
| Volume anomaly (RVOL) | ✖ | ~ hidden | ✔ ≥2× flag | ✖ | B (PriceBar) | Screener spec §activity (P1) |
| Multi-rule screener (AND/OR groups) | ✖ 404 | ~ radars only | ✔ (Pro) | ~ flat metric/event/dividend/sector | B | advanced-screener-spec.md (P1) |
| Natural-language → editable filters | ✖ | ✖ | ✖ | ✖ | B (+AI) | Screener spec §NL (P1/P2) |
| Saved screens + share links | ✖ | ✖ | ✖ none | ~ saved rules only | B | Add share permalink + export (P1) |
| Screen results export (CSV) | ~ Excel Pro | ✖ | ✖ blocked | ✖ | B | Screener spec §exports (P1) |
| Real screen backtesting | ✖ | ~ hidden | ✖ **fake constants** | ✖ | B (point-in-time discipline) | quant-research-methodology.md (P2) — publish nothing until reproducible |
| Methodology pages for models | ✖ | ✖ | ✖ | ✖ | B | Quant doc §disclosure (P1) |
| Comparison (2–4, period-aligned) | ✖ 404 | ✖ | ✖ | ✔ | A | Add shareable link (P1) |
| Health scores per company | ✖ | ✖ | ~ composite/100 opaque | ✔ engine exists | **A but orphaned UI** | **Render HealthTab this batch** |
| Technical tab on company page | ✖ | ✔ narrative | ✔ charts | ✔ engine + UI built | **A but orphaned UI** | **Render TechnicalTab (this batch / next)** |
| Predicted results calendar | ✔ (unique) | ✖ | ~ next earnings | ✖ (publicationDate 0%) | **C** (needs publication dates) | Data ops first (P1) — ingest dates from filings |
| Corporate events/disclosures on company page | ✖ | ✖ | ~ news Pro | ✔ models exist | A (UI wiring) | Surface events tab (P1) |
| Composable alerts + channels | ~ results only | ✔ price/signal | ~ price only | ~ price only, in-app, lazy | B (conditions) / C (email/TG delivery) | Phase 11 design (P1/P2) |
| Portfolio analytics (concentration/sector/health) | ✖ | ✖ | ✔ sophisticated | ~ P/L + weights | B | Phase 10 (P2) |
| AI portfolio analysis | ✖ | ✖ | ✔ claims | ✖ | B | Phase 10, with disclosures (P2) |
| Macro context (CBE/FX) | ✖ | ✔ CBE tiers | ~ FX shield | ✖ | C (manual cur pack is free) | Innovation #9/§macro (P2) |
| Sector-relative valuation bands | ✖ | ✖ | ~ sector P/E | ~ sector medians in scores | B | Quant doc (P1) |
| Financial change detection ("what changed") | ✖ | ✖ | ✖ | ✔ FinancialEvent engine | A (UI) | Company page prominence (P1) |
| Public data-quality changelog | ✖ | ✖ | ~ confidence % | ~ /status + badges | B | Innovation #7 (P1) |
| Per-metric SEO pages / GEO strategy | ✔ period pages | ✔ 311 pages | ✖ robots-blocked | ~ company pages | B | Innovation #roadmap (P1) |
| Telegram/push distribution | ✔ TG | ✔ TG bot + push | ✖ | ✖ | C | Phase 11 (P2) |
| Anomaly detection (statements) | ✖ | ✖ | ✖ | ✖ | B (rules over FinancialValue) | innovation-proposals.md #2 (P2/P3) |
| Market Intelligence Graph | ✖ | ✖ | ✖ | ✖ | B (data exists) | innovation-proposals.md #1 (P3) |
| Scenario/valuation lab | ✖ | ✖ | ~ DCF inputs | ✖ | B | innovation-proposals.md #9 (P2) |
| Thesis tracker | ✖ | ✖ | ✖ | ✖ | B | innovation-proposals.md #5 (P2/P3) |

## 2. The five gaps that decide the market

1. **Verifiable quant scores.** Every competitor shows an opaque number (F-Score badge, /100 score, radar model tags). Criterion-level, figure-cited scores are class-B derivable *now* and directly invert the market's biggest weakness. → **Implemented in this batch.**
2. **A real screener.** The market leader's screener exists but gates sorting, lacks quarterly periods, saved screens and exports. EGXANO has the data layer + a flat v1; the spec'd v2 closes the gap within existing infrastructure.
3. **Honest backtesting (or none).** EGX Screener ships fabricated constants; ZBorsa hides its machinery. EGXANO must either build a reproducible framework (P2, point-in-time discipline) or explicitly not play — never fake it.
4. **Agentic research.** Nobody in this market does multi-step tool-using research with evidence trails. EGXANO's orchestrator + tool data already exist; the architecture doc specifies the controlled registry.
5. **Trust surfaces.** Confidence badges, restatement versioning, /status page — EGXANO owns these assets but under-displays them; competitors' trust claims are self-graded. Making data quality *visible* converts architecture into brand.

## 3. Explicitly out of reach today (do not promise)

- Real-time (non-delayed) quotes — data source is 15-min delayed by license [E until a licensed source is acquired → class D].
- EGX index historical time-series — refused by design in `market/history` (no licensed source) [E/D].
- Earnings-call transcripts, broker forecasts, forward EPS with coverage basis [C/D — no source; forward P/E stays prohibited until then].
- Automated trading, order routing [E — prohibited by product constitution].
