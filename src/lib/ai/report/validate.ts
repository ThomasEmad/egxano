// =============================================================================
// Report output validation — structured checks BEFORE anything is persisted
// or shown. A response that fails validation is treated as a provider failure
// (the orchestrator falls back / the job retries), never shown to users.
// =============================================================================

import { z } from "zod"

export const REQUIRED_SECTIONS = [
  "Investment Thesis",
  "Key Numbers",
  "Financial Analysis",
  "Technical Analysis",
  "Combined View",
  "Key Risks & Red Flags",
  "What Would Invalidate This Analysis",
  "Monitoring Points",
  "Overall Assessment",
] as const

export const AR_SECTION_ALIASES: Record<string, string> = {
  "أطروحة الاستثمار": "Investment Thesis",
  "أبرز الأرقام": "Key Numbers",
  "التحليل المالي": "Financial Analysis",
  "التحليل الفني": "Technical Analysis",
  "الرؤية المدمجة": "Combined View",
  "المخاطر الجوهرية والعلامات الحمراء": "Key Risks & Red Flags",
  "ما الذي يُبطل هذا التحليل": "What Would Invalidate This Analysis",
  "نقاط المراقبة": "Monitoring Points",
  "التقييم العام": "Overall Assessment",
}

export type Stance = "bullish" | "cautiously_positive" | "neutral" | "bearish"

export interface ValidationResult {
  ok: boolean
  /** normalized section map (canonical English keys) — only when ok */
  sections?: Record<string, string>
  stance?: Stance | null
  wordCount?: number
  errors: string[]
}

/** Split a markdown report into ## sections. Tolerates bolded headings. */
export function parseSections(markdown: string): Record<string, string> {
  const sections: Record<string, string> = {}
  const lines = markdown.split(/\r?\n/)
  let current: string | null = null
  let buf: string[] = []
  const flush = (): void => {
    if (current) sections[current] = buf.join("\n").trim()
  }
  for (const line of lines) {
    const m = /^#{2,3}\s*(.+?)\s*$/.exec(line.trim())
    if (m) {
      flush()
      current = m[1].replace(/^\*\*(.+)\*\*$/, "$1").replace(/[:：]\s*$/, "")
      buf = []
    } else if (current) {
      buf.push(line)
    }
  }
  flush()
  return sections
}

/** Normalize (possibly Arabic) section headings to canonical keys. */
export function normalizeSections(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    const canon = AR_SECTION_ALIASES[k] ?? k
    out[canon] = v
  }
  return out
}

export function extractStance(markdown: string): Stance | null {
  const text = markdown.toLowerCase()
  const arText = markdown
  if (/bullish|صاعد|إيجابي متفائل/.test(text) && !/cautiously positive| cautiously/.test(text)) return "bullish"
  if (/cautiously positive|متحفظ إيجابي|إيجابي بحذر/.test(text) || /إيجابي/.test(arText) && /تحفظ/.test(arText)) return "cautiously_positive"
  if (/bearish|هابط|سلبي/.test(text)) return "bearish"
  if (/neutral|محايد/.test(text)) return "neutral"
  return null
}

function countWords(markdown: string): number {
  return markdown.split(/\s+/).filter(Boolean).length
}

/** A Key Numbers section must be a real table when the company has data. */
function keyNumbersLooksLikeTable(body: string): boolean {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean)
  const tableLines = lines.filter((l) => l.startsWith("|"))
  if (tableLines.length === 0) return false // section absent data — allowed, model omits rather than pads
  return tableLines.length >= 3 && tableLines.some((l) => /^\|[\s:|-]+\|$/.test(l))
}

const zodEnvelope = z.object({
  markdown: z.string().min(200).max(60_000),
})

/**
 * Full validation of a generated report:
 *  - non-empty, bounded
 *  - all required sections present (English or Arabic headings)
 *  - Key Numbers is a markdown table when present
 *  - stance extractable
 */
export function validateReport(output: unknown, opts: { lang: "ar" | "en"; hasFinancialData: boolean }): ValidationResult {
  const errors: string[] = []
  const parsed = zodEnvelope.safeParse(output)
  if (!parsed.success) {
    return { ok: false, errors: ["output shape invalid or out of bounds"] }
  }
  const markdown = parsed.data.markdown
  const normalized = normalizeSections(parseSections(markdown))
  const missing = REQUIRED_SECTIONS.filter((s) => !(normalized[s] && normalized[s].length > 0))
  if (missing.length) errors.push(`missing sections: ${missing.join(", ")}`)
  if (opts.hasFinancialData && normalized["Key Numbers"] && !keyNumbersLooksLikeTable(normalized["Key Numbers"])) {
    errors.push("Key Numbers section is not a proper markdown table")
  }
  const stance = extractStance(normalized["Overall Assessment"] ?? markdown)
  const wordCount = countWords(markdown)
  if (wordCount < 120) errors.push(`report too short (${wordCount} words)`)
  if (wordCount > 6000) errors.push(`report too long (${wordCount} words)`)
  if (/\b(as an ai|language model)\b/i.test(markdown)) errors.push("model self-reference leaked into the report")
  if (errors.length) return { ok: false, errors, wordCount }
  return { ok: true, sections: normalized, stance, wordCount, errors: [] }
}

/** Rule-based degraded fallback — deterministic, clearly labeled, bilingual. */
export function buildRuleBasedReportMarkdown(input: {
  companyName: string
  ticker: string
  lang: "ar" | "en"
  financialSummary: string[]
  technicalSummary: string[]
  limitations: string[]
}): string {
  const ar = input.lang === "ar"
  const L: string[] = []
  L.push(`## ${ar ? "أطروحة الاستثمار" : "Investment Thesis"}`)
  L.push(
    ar
      ? `هذا ملخص قائم على القواعد للشركة ${input.companyName} (${input.ticker}) — لم يتوفر نموذج لغوي عند الطلب. الأرقام أدناه مقروءة حرفياً من البيانات الموثقة.`
      : `This is a rule-based summary for ${input.companyName} (${input.ticker}) — no language model was available when the report was requested. The figures below are read directly from the verified data.`
  )
  L.push(`## ${ar ? "أبرز الأرقام" : "Key Numbers"}`)
  L.push(input.financialSummary.length ? input.financialSummary.map((s) => `- ${s}`).join("\n") : ar ? "- لا توجد بيانات مالية موثقة بعد." : "- No verified financial data yet.")
  L.push(`## ${ar ? "التحليل المالي" : "Financial Analysis"}`)
  L.push(ar ? "استناداً إلى القيم الموثقة أعلاه فقط؛ الأرقام غير المتوفرة لم تُقدَّر." : "Based strictly on the verified values above; unavailable figures were not estimated.")
  L.push(`## ${ar ? "التحليل الفني" : "Technical Analysis"}`)
  L.push(input.technicalSummary.length ? input.technicalSummary.map((s) => `- ${s}`).join("\n") : ar ? "- لا يوجد تاريخ أسعار يومي مخزن بعد." : "- No daily price history stored yet.")
  L.push(`## ${ar ? "الرؤية المدمجة" : "Combined View"}`)
  L.push(ar ? "يُنصح بقراءة الأرقام أعلاه مباشرة حتى يتوفر التحليل الكامل." : "Read the figures above directly until the full expert report becomes available.")
  L.push(`## ${ar ? "المخاطر الجوهرية والعلامات الحمراء" : "Key Risks & Red Flags"}`)
  L.push(ar ? "- حدود البيانات أدناه يجب أخذها في الحساب." : "- The data limitations below must be considered.")
  L.push(`## ${ar ? "ما الذي يُبطل هذا التحليل" : "What Would Invalidate This Analysis"}`)
  L.push(ar ? "- أي تغيير جوهري في البيانات الأساسية المعروضة أعلاه." : "- Any material change in the underlying data displayed above.")
  L.push(`## ${ar ? "نقاط المراقبة" : "Monitoring Points"}`)
  L.push(ar ? "- القوائم المالية القادمة وتحديثات الأسعار اليومية." : "- Upcoming financial statements and daily price updates.")
  L.push(`## ${ar ? "التقييم العام" : "Overall Assessment"}`)
  L.push(ar ? "الموقف: محايد (وضع بديل دون نموذج لغوي — أعد التوليد لاحقاً للحصول على التحليل الخبير الكامل)." : "Stance: neutral (degraded mode without a language model — regenerate later for the full expert report).")
  if (input.limitations.length) {
    L.push(`**${ar ? "حدود البيانات" : "Data limitations"}:** ${input.limitations.join(" | ")}`)
  }
  return L.join("\n\n")
}
