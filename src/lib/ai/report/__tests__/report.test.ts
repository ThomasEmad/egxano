// Report identity + validation tests.
import { describe, expect, it } from "vitest"
import { buildReportKey, PROMPT_VERSION } from "../identity"
import { parseSections, normalizeSections, validateReport, extractStance, REQUIRED_SECTIONS } from "../validate"

describe("report identity", () => {
  const base = {
    companyId: "c1",
    financialDataHash: "hash1",
    technicalHash: "tech1",
    priceAsOf: "2026-11-05",
    lang: "en" as const,
  }
  it("is deterministic", () => {
    expect(buildReportKey(base)).toBe(buildReportKey({ ...base }))
    expect(buildReportKey(base)).toMatch(/^[0-9a-f]{64}$/)
  })
  it("changes when ANY input changes", () => {
    const keys = [
      buildReportKey(base),
      buildReportKey({ ...base, companyId: "c2" }),
      buildReportKey({ ...base, financialDataHash: "hash2" }),
      buildReportKey({ ...base, technicalHash: "tech2" }),
      buildReportKey({ ...base, technicalHash: null }),
      buildReportKey({ ...base, priceAsOf: "2026-11-04" }),
      buildReportKey({ ...base, lang: "ar" }),
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })
  it("includes the prompt version", () => {
    expect(PROMPT_VERSION).toMatch(/^prompt@\d+$/)
  })
})

const GOOD_REPORT = `## Investment Thesis
COMI trades at a P/E of 5.5 (FY 2025) while ROE stands at 43.9% — the market prices structural doubt into an exceptionally profitable bank. The price sits 2% below its 50-session average with RSI(14) at 54.

## Key Numbers
| Metric | Value | Period |
|---|---|---|
| Revenue | EGP 53.2B | FY 2025 |
| Net profit | EGP 21.4B | FY 2025 |
| P/E | 5.5 | FY 2025 |

## Financial Analysis
Net margin reached 41.7% in FY 2025. Deposit funding remains the engine.

## Technical Analysis
The stock is in a mixed trend: price above SMA200 but below SMA20. RSI is neutral at 54. Support zone near 62.5 (1.5% below the last close).

## Combined View
Fundamentals are strong while the technical picture is neutral — the tension resolves with the next quarterly report.

## Trader & Investor Lens
Short-term trader: the last close sits 1.5% above the 62.5 support zone while RSI(14) is neutral at 54 — a daily close below 62.5 on expanded volume would end the current setup; ATR keeps the realistic one-session range near ±2%. Long-term investor: ROE of 43.9% (FY 2025) with P/E 5.5 prices structural doubt into the franchise; dividend coverage and a CET1 above 12% are the thesis keepers. Market psychology: volume has been steady rather than expanding — no chase signal is inferable from the provided data; illiquidity is not a present concern at current traded values.

## Key Risks & Red Flags
- Earnings quality: operating cash flow at 0.9x net profit (FY 2025).
- Concentration risk in the loan book.

## What Would Invalidate This Analysis
- A CET1 ratio falling below 12%.
- A decisive close below the 60 support zone.

## Monitoring Points
- Q1 2026 report.
- The 62.5 support zone behavior.

## Overall Assessment
Financial: strong. Technical: neutral. Stance: cautiously positive with moderate conviction; invalidated by a capital-adequacy breach or a break below 60.`

describe("report validation", () => {
  it("accepts a complete, well-formed report", () => {
    const res = validateReport({ markdown: GOOD_REPORT }, { lang: "en", hasFinancialData: true })
    expect(res.ok).toBe(true)
    expect(res.errors).toEqual([])
    expect(res.sections?.["Key Numbers"]).toBeTruthy()
    expect(res.wordCount).toBeGreaterThan(120)
  })
  it("rejects truncated or empty output", () => {
    expect(validateReport({ markdown: "short" }, { lang: "en", hasFinancialData: true }).ok).toBe(false)
    expect(validateReport(null, { lang: "en", hasFinancialData: true }).ok).toBe(false)
    expect(validateReport({ markdown: "" }, { lang: "en", hasFinancialData: true }).ok).toBe(false)
  })
  it("lists the missing sections precisely", () => {
    const partial = GOOD_REPORT.split("## Financial Analysis")[0] + "## Overall Assessment\nStance: neutral."
    const res = validateReport({ markdown: partial }, { lang: "en", hasFinancialData: true })
    expect(res.ok).toBe(false)
    expect(res.errors[0]).toContain("Financial Analysis")
  })
  it("accepts Arabic headings and normalizes them", () => {
    const arReport = GOOD_REPORT
      .replace("## Investment Thesis", "## أطروحة الاستثمار")
      .replace("## Key Numbers", "## أبرز الأرقام")
      .replace("## Financial Analysis", "## التحليل المالي")
      .replace("## Technical Analysis", "## التحليل الفني")
      .replace("## Combined View", "## الرؤية المدمجة")
      .replace("## Trader & Investor Lens", "## عدسة المضارب والمستثمر")
      .replace("## Key Risks & Red Flags", "## المخاطر الجوهرية والعلامات الحمراء")
      .replace("## What Would Invalidate This Analysis", "## ما الذي يُبطل هذا التحليل")
      .replace("## Monitoring Points", "## نقاط المراقبة")
      .replace("## Overall Assessment", "## التقييم العام")
    const res = validateReport({ markdown: arReport }, { lang: "ar", hasFinancialData: true })
    expect(res.ok).toBe(true)
    expect(Object.keys(res.sections!).sort()).toEqual([...REQUIRED_SECTIONS].sort())
  })
  it("rejects a Key Numbers section that is not a table", () => {
    const bad = GOOD_REPORT.replace(
      /\| Metric[\s\S]*?FY 2025 \|/,
      "Revenue 53.2B, Net profit 21.4B"
    )
    const res = validateReport({ markdown: bad }, { lang: "en", hasFinancialData: true })
    expect(res.ok).toBe(false)
    expect(res.errors.some((e) => e.includes("table"))).toBe(true)
  })
  it("extracts the stance", () => {
    expect(extractStance("Stance: bullish with high conviction")).toBe("bullish")
    expect(extractStance("Stance: bearish")).toBe("bearish")
    expect(extractStance("Stance: neutral")).toBe("neutral")
  })
  it("flags model self-reference", () => {
    const leaky = GOOD_REPORT.replace("COMI trades", "As an AI language model, COMI trades")
    const res = validateReport({ markdown: leaky }, { lang: "en", hasFinancialData: true })
    expect(res.ok).toBe(false)
  })
})

describe("section parsing", () => {
  it("splits on ## headings and tolerates bold", () => {
    const s = normalizeSections(parseSections("## **Investment Thesis**\nBody A\n## Key Numbers\n| a |\n|---|\n| 1 |"))
    expect(s["Investment Thesis"]).toBe("Body A")
    expect(s["Key Numbers"]).toContain("| 1 |")
  })
})
