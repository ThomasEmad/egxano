// End-to-end sample generation: pull a real company's verified-data report
// context from the production database and run the NEW analyst-craft prompt
// (report/prompt.ts v4) against the configured LLM provider, exactly like the
// job worker does. Read-only on the DB; the output goes to download/.
//
// Usage: DATABASE_URL=... AI_API_KEY=... AI_BASE_URL=... AI_MODEL=... \
//        npx tsx scripts/sample-analyst-note.ts <TICKER> [ar|en]

import { buildReportContext, buildPromptPayload } from "../src/lib/ai/report/builder"
import {
  SYSTEM_PROMPT,
  AR_INSTRUCTION,
  EN_INSTRUCTION,
  LENGTH_BUDGET,
} from "../src/lib/ai/report/prompt"
import { chatComplete } from "../src/lib/ai/provider"
import { db } from "../src/lib/db"

async function main() {
  const ticker = (process.argv[2] || "").toUpperCase()
  const lang = ((process.argv[3] || "ar").toLowerCase() === "en" ? "en" : "ar") as "ar" | "en"
  if (!ticker) throw new Error("usage: tsx scripts/sample-analyst-note.ts <TICKER> [ar|en]")

  const company = await db.company.findFirst({
    where: { OR: [{ ticker }, { isin: ticker }] },
  })
  if (!company) throw new Error(`company ${ticker} not found`)
  console.error(`[sample] company=${company.ticker} name=${company.nameEn} sector=${company.sector}`)

  const ctx = await buildReportContext(company, lang)
  if (!ctx.hasFinancialData) throw new Error("no verified financial data for this company")
  console.error(
    `[sample] reportKey=${ctx.reportKey.slice(0, 12)}… periods=${ctx.promptPeriodCount} technical=${ctx.technical ? `yes(v${ctx.technical.version}, sessions=${(ctx.technical as unknown as { sessions?: number }).sessions})` : "no"} priceAsOf=${ctx.priceAsOf ?? "-"}`
  )

  const payload = buildPromptPayload(ctx)
  console.error(`[sample] payload chars=${payload.length}`)

  const result = await chatComplete({
    system: SYSTEM_PROMPT,
    user: "Company report data (JSON):\n" + payload + (lang === "ar" ? AR_INSTRUCTION : EN_INSTRUCTION) + LENGTH_BUDGET,
    timeoutMs: 100_000,
  })
  console.error(`[sample] model=${result.model} chars=${result.content.length}`)
  process.stdout.write(result.content)
}

main()
  .catch((e) => {
    console.error("[sample] FAILED:", e instanceof Error ? e.message : e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
