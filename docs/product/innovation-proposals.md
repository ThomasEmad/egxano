# EGXANO — Innovation Proposals

**Date:** 2026-11-12 · Status tags: **[SPEC]** = designed here, not built · **[PARTIAL]** = assets exist · **[BUILT]** = implemented. Each proposal states the investor pain, why EGXANO can win it, data class (per Phase 15), and honest risk.

---

## Top 10 opportunities (ranked by value ÷ feasibility)

1. **Criterion-level quant scorecards [BUILT — this batch].** Piotroski F-Score with per-criterion figures + period labels (competitors: bare badges). Pain: "is this company actually improving?" Answerable in one glance with evidence. Extends to Altman/quality in batch 2.
2. **Advanced screener v2 + NL bar [SPEC].** AND/OR groups, technical conditions, saved-screen permalinks, CSV export, Arabic NL → editable filters. Pain: screening is the #1 daily job; market leader gates sorting behind Pro and has no saved screens. Data: all class B.
3. **Discovery radars (52W, RVOL, improving/deteriorating) [SPEC].** Pre-computed opportunity feeds with published criteria + coverage %. Pain: users don't know what to look at; every competitor's radar is either absent or unexplained. Data: class B (PriceBar).
4. **Verifiable track record / methodology pages [SPEC].** Published formulas, input tables, limitation footers for every model — plus, if/when signals exist, a dated immutable signal ledger. Pain: the entire market asks you to trust opaque numbers; EGXANO makes trust auditable. Zero new data.
5. **Company Change Intelligence ("what changed this period") [PARTIAL].** The `FinancialEvent` engine already detects profit-turns, debt-reduction, etc. — surface a period-over-period change brief on company pages: revenue/margin/debt deltas with statement citations. Pain: nobody re-reads full statements; AskBorsa shows only YoY tables. Data: class B.
6. **Composable alerts with delivery [SPEC].** Price + ratio + event + screen-match conditions; channels: in-app now, Telegram/email when authorized infra lands. Pain: EGX moves fast in session; lazy in-app-only alerts are effectively decorative. Data: class B conditions / C delivery.
7. **Financial Statement Quality Monitor [SPEC].** Score completeness/consistency per company (engine exists: `DataQualityScore`, audit issues) and show it publicly: "this company has 8 of 10 key items for FY2025, consolidated" + per-ticker changelog. Pain: trust in data; converts EGXANO's invisible architecture into brand. Data: class B.
8. **Scenario Analysis Lab [SPEC].** Editable revenue/margin/WACC/multiple inputs → recalculated valuation ranges, clearly labeled hypothetical, sensitivity tables. Pain: "what if margins recover?" is how Egyptians actually think post-devaluation. Data: class B; no forecast invention.
9. **Sector Rotation Intelligence [SPEC].** Relative sector performance over 1M/3M/12M from PriceBar + breadth + contribution lists ("who drove banks this week"). Pain: sector context is scattered; ZBorsa hides its module behind login. Data: class B. Care: correlation ≠ causation language enforced.
10. **Investment Thesis Tracker [SPEC/P3].** User-defined thesis with monitored metrics + invalidation conditions → passive monitoring feed. Pain: long-horizon investors (the EGX reality) have no tool. Data: class B; needs alert engine (#6) first.

## Top 5 unique differentiators (what makes EGXANO hard to replace)

1. **Auditable-by-default quant layer** — every number shows its evidence; competitors structurally can't copy this without rebuilding their presentation contract.
2. **Deterministic core + cache-first AI** — 488k+ validated values, restatement versioning, and zero page-view inference: correctness at scale that three-month-old competitors don't have.
3. **One connected workflow** — market observation → screen → company research → comparison → AI report → saved screen/alert (Phase 5–11 integration); competitors are point tools.
4. **Public trust surfaces** — /status, confidence badges, data-quality changelog: turning data honesty into the brand.
5. **Arabic-first research language with bilingual depth** — Arabic AI reports grounded in Arabic-labeled statements, not translated UI shells.

## The remaining innovations (evaluated, deliberately deferred)

| # | Idea | Verdict | Why deferred |
|---|---|---|---|
| 11 | Egyptian Market Intelligence Graph | Prototype-worthy | High wow, unclear daily utility; needs entity-relationship curation (class B data, heavy editorial). Revisit after screener v2 + radars prove engagement. |
| 12 | "What Changed Today?" daily digest | Worth building (P2) | Valuable but requires reliable intraday freshness (price cron scheduling gap — audit §2.3) and event density (publicationDate 0%). Sequence: fix crons → publication dates → digest. |
| 13 | Research Copilot (session memory) | Fold into agentic AI | The agentic spec's follow-up chat already carries session context; a separate "copilot" product would duplicate chat surfaces. |
| 14 | Research Collaboration / shared workspaces | Defer | Premium Team experiments (AskBorsa charges 9,999 EGP/mo for it) — demand unproven; complexity risk per Phase 12-10. |
| 15 | Financial Anomaly Detection (forensic rules) | Build rules into Change Intelligence (#5) rather than a separate product — receivables-vs-sales, OCF-vs-profit divergence, debt-growth flags become criteria in the deterioration radar (screener spec §5). |

## Data & licensing blockers register

| Need | Class | Blocker | Path |
|---|---|---|---|
| Real-time quotes | D | 15-min delayed source | Licensed vendor or explicit delay-only positioning |
| Index constituents + history | D | No license (code refuses today) | Purchase or derive from disclosures |
| Forward estimates / consensus EPS | C/D | No source | Out of scope until source exists |
| Publication dates (results calendar) | C | coverage 0% | Ingest from filing metadata during review flow |
| Email/Telegram delivery | C | No provider configured | Resend/SMTP exists in `lib/mail.ts`; Telegram bot needs bot token + ToS review |
| Corporate actions (splits) | C | Absent | EGX disclosure scraping (authorized) or vendor |

## Explicit non-goals (product constitution)

No buy/sell recommendations, no price targets, no auto-trading, no fabricated performance claims, no scraping competitor data, no unlicensed redistribution, no presenting delayed data as real-time.
