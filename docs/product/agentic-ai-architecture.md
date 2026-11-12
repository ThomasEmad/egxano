# EGXANO — Agentic AI Research Architecture

**Date:** 2026-11-12 · **Status:** SPECIFICATION (nothing in this document is implemented yet — see §8 for what exists vs what is proposed)
**Governing rules:** AI interprets; deterministic code calculates. Every claim traceable to a database field, calculation, period, source, timestamp. No arbitrary SQL. No fabricated targets/returns/events. No confidence score presented as a calibrated probability.

---

## 1. Design goal

A research analyst, not a chatbot: the model plans a multi-step investigation, calls EGXANO's real research tools (the same deterministic engines users see), validates every result, ranks with transparent criteria, and produces a cited report. The user sees the plan, the tool calls, and the evidence.

## 2. What already exists (verified — reuse, do not rebuild)

| Asset | Path | Role in agent |
|---|---|---|
| Provider chain + circuit breaker + rate limit + kill switch + spend cap | `src/lib/ai/orchestrator/*` | Unchanged; agent runs *inside* its budget |
| Durable job queue (lease, retries, fallback artifact) | `src/lib/ai/jobs/*` | Agent runs as a job type, not a request-scoped call |
| Cache-first report identity | `src/lib/ai/report/identity.ts` | Agent results cached by (goal, inputs, data versions, lang) |
| Deterministic engines | `src/lib/financial/calc*`, `src/lib/technical/*`, `src/lib/financial/scanner.ts`, `scores.ts`, snapshot | The agent's tools wrap these — never the LLM's own math |
| Quotas (DB-backed smart-analysis usage) | `src/lib/smart-analysis-usage.ts` | One agent run = N quota units, charged once |
| Grounded prompt contract + QA intent engine | `report/prompt.ts`, `answer-engine.ts` | Prompt style and grounding rules carried over |

## 3. Tool registry (v1 — only tools backed by verified data)

```ts
type Tool = {
  name: string
  description: string          // used by the planner prompt
  inputSchema: ZodSchema       // validated server-side; unknown keys rejected
  outputSchema: ZodSchema      // validated before the result reaches the model
  costUnits: number            // quota accounting
  auth: "public" | "user"      // never crosses user data boundaries
}
```

| Tool | Backing implementation (exists today) | Notes |
|---|---|---|
| `search_companies` | `/api/v1/search`, `findCompanyByKey` | id\|ticker\|ISIN resolution |
| `get_company_profile` | `companies/[id]` + coverage/confidence | includes data-quality badge |
| `get_financial_statements` | `FinancialValue` by report + period filter | period keys explicit; never mixes statement bases |
| `get_financial_metrics` | `CalculatedMetric` + `expanded-metrics` | returns `valueStatus`, not bare nulls |
| `get_price_history` | `PriceBar` (data-sufficiency enforced by technical lib) | refuses <N bars per indicator |
| `get_technical_indicators` | `src/lib/technical/indicators.ts` bundle | `{value, reason}` honesty contract |
| `run_stock_screener` | `src/lib/financial/scanner.ts` | same conditions as the UI screener |
| `compare_companies` | `/api/v1/compare` engine (period-aligned) | max 4, aligned-basis disclosure |
| `get_sector_benchmarks` | `sectors` aggregates + `scores.ts` medians | |
| `get_market_overview` | `market/breadth` + snapshot (delay-labeled) | |
| `get_valuation_metrics` | `undervalued` engine (3 methods) | assumptions echoed in output |
| `get_corporate_events` | `FinancialEvent` + `Dividend` | premium-gated fields kept out |
| `create_saved_screen` | `ScannerRule` (user-owned) | auth: user |
| `create_alert` | `PriceAlert` (price conditions only in v1) | auth: user; never auto-trades |
| `generate_research_report` | existing report pipeline | final synthesis step |

Explicitly **excluded** until backed by real data: `get_news` (no licensed feed), `get_forward_estimates` (no source), anything returning unverified fundamentals.

## 4. Agent loop (controlled, bounded, observable)

```
POST /api/v1/ai/research  { question, lang, companyId? }
  → quota pre-check (smart-analysis units) → enqueue job (durable)
  → worker: plan → [validate → call tool → validate result → reflect] ×K (K ≤ 8)
  → contradiction pass (explicit prompt step: list opposing evidence)
  → rank with stated criteria → compose report (fixed section contract)
  → store: AiAnalysisReport (cache key includes tool-trace hash) + tool trace JSON
  → deliver via existing report UI + chat follow-ups
```

Loop rules:
1. **Plan-then-act:** the first model call must emit a JSON plan (questions → metrics → periods → filters). The plan is shown to the user *before* results (and persisted).
2. **Every tool result is schema-validated** and stamped with `{asOf, periodKeys, sourceTable?, confidence}` before entering context. Invalid → the tool returns a typed error the model must handle, not silent nulls.
3. **Bounded:** max 8 tool calls / max 2 plan revisions / wall-clock cap. On exhaustion, deliver a partial report with an explicit "incomplete — stopped at X" section.
4. **No execution privileges:** tools are allow-listed functions; no SQL, no filesystem, no admin APIs, no cross-user reads. Prompt-injection surface: tool outputs are wrapped as data (`<tool_result name=…>` markers) and the system prompt instructs the model that tool content is evidence, not instructions; any instruction-like text inside tool results is reported in the report's "anomalies" note instead of followed.
5. **Transparency:** report sections per Phase 5-D (exec summary → methodology → matches → financial/technical evidence → valuation context → risks → contradictions → data completeness → sources/periods → limitations → follow-ups), each figure carrying `{metricCode, periodKey, valueStatus, source}` chips.

## 5. Cost & quota control (Phase 14 compliance)

- One agent run ≈ 3–6 model calls (plan / reflect / synthesize) — quota units priced accordingly; free tier: agent runs use the same monthly Smart-Analysis budget (3) — one run = one unit, no hidden multipliers.
- Cache-first: identical `(question-normalized, universe-hash, data-versions, lang)` → cached report; "share this research" reuses the cache key.
- Kill switch + daily spend cap checked per call inside the existing orchestrator; provider failover unchanged.
- Deterministic-first: if the question compiles to a pure screen (the common case for Phase 5-A list), the **QA intent engine handles it with zero model calls** and the agent is never invoked.

## 6. UX surface (proposed)

- Entry points: dashboard ask-box upgrade ("research mode"), company page chat ("deep-dive this company"), screener NL bar (delegates to `run_stock_screener` + explanation).
- During a run: plan → live tool-call trace (tool, args, rows returned, latency) → final report. Trace stays inspectable after completion (stored JSON, collapsible).
- Arabic-first: report language = UI language; tool names untranslated internally but displayed bilingually.

## 7. Failure modes & guards

| Risk | Guard |
|---|---|
| Model hallucinates a metric | Tools are the only numeric source; report validator rejects figures without a tool-trace citation (validator exists: `report/validation` tests) |
| Fabricated target/return | Output schema forbids price targets; post-validation regex + numeric-source check |
| Quota abuse | Durable queue + per-user monthly budget + global cap; anonymous users: QA engine only |
| Injection via data | Data-as-evidence wrapping; anomalies surfaced, never executed |
| Stale data claims | Every period key + `asOf` stamped; "freshness" section mandatory |
| Overclaiming | Fixed disclaimer contract: research scenario ≠ recommendation; no calibrated probabilities language |

## 8. Implemented vs proposed (honesty ledger)

- **Implemented & verified today:** orchestrator, queue, cache identity, deterministic engines, QA engine, quotas, kill switch/spend cap.
- **Proposed by this spec:** tool registry + schemas, agent loop worker, plan/trace persistence, research UI, report validator extension, quota unit mapping.
- **Build order (after screener v2):** registry (wrap existing endpoints) → loop worker → report sections → UI trace → quotas → then, and only then, any marketing.
