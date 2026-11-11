// =============================================================================
// Report identity — the deterministic cache key of an AI analysis report.
// =============================================================================
// A report is reused by ALL users whenever every input below is identical:
//   company + financial data hash + technical data hash + market price date
//   + prompt version + config version + technical engine version + language
// Page visits never trigger inference; a new price bar / restated filing /
// prompt change invalidates the key and produces a NEW report identity.

import { createHash } from "node:crypto"

export const PROMPT_VERSION = "prompt@5"
export const CONFIG_VERSION = "cfg@1"
export const REPORT_DEPTH = "standard"

export interface ReportIdentityInput {
  companyId: string
  financialDataHash: string
  technicalHash: string | null
  priceAsOf: string | null // ISO date of the latest price point included
  lang: "ar" | "en"
}

export function buildReportKey(input: ReportIdentityInput): string {
  const parts = [
    "v2",
    input.companyId,
    input.financialDataHash,
    input.technicalHash ?? "no-tech",
    input.priceAsOf ?? "no-price",
    PROMPT_VERSION,
    CONFIG_VERSION,
    REPORT_DEPTH,
    input.lang,
  ]
  return createHash("sha256").update(parts.join("|")).digest("hex")
}
