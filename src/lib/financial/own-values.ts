// CURRENT-vs-comparative column selection for harvested FinancialValue rows.
//
// A harvested report often stores two columns per metric: CURRENT (the period
// being reported) and PREVIOUS/Q1…Q4 (the comparative column). Consumers that
// merged rows last-write-wins ended up with a comparative value poisoning
// their maps (the bug that broke TTM sums / ROE in the recompute engine — see
// recompute.ts ownValues()). This helper is that engine's selection rule,
// extracted so read-path consumers (analytics gather, undervalued screen)
// apply the same rule instead of re-introducing the last-write-wins bug:
//   CURRENT wins; otherwise the sub-period matching the report type
//   (Q1..Q4 / H1 / 9M); a single unambiguous value is accepted; anything else
//   is ambiguous and skipped.
//
// Validation filtering (VALID/PENDING, quarantined rows) stays with the
// caller — this helper only resolves the column ambiguity.

export interface OwnValueRow {
  metricCode: string
  normalizedValue: number
  subPeriod: string | null
}

/** Sub-period token carried by the report itself (Q1..Q4 / H1 / 9M). */
function subOf(r: { periodType: string; periodLabel: string }): string | null {
  const l = r.periodLabel.toUpperCase()
  if (r.periodType === "QUARTERLY") { const m = l.match(/Q([1-4])/); return m ? `Q${m[1]}` : null }
  if (r.periodType === "SEMIANNUAL") { const m = l.match(/H([1-2])/); return m ? `H${m[1]}` : null }
  if (r.periodType === "NINE_MONTH") return "9M"
  return null
}

/**
 * Per metric, choose the value that belongs to THIS report's own period.
 * Pure and order-independent: the chosen set never depends on row order.
 */
export function selectOwnValues<T extends OwnValueRow>(r: {
  periodType: string
  periodLabel: string
  values: readonly T[]
}): T[] {
  const byMetric = new Map<string, T[]>()
  for (const v of r.values) {
    if (!byMetric.has(v.metricCode)) byMetric.set(v.metricCode, [])
    byMetric.get(v.metricCode)!.push(v)
  }
  const expected = subOf(r)
  const out: T[] = []
  for (const list of byMetric.values()) {
    const current = list.find(v => v.subPeriod === "CURRENT")
    let chosen: T | undefined
    if (current) chosen = current
    else {
      const matching = expected ? list.find(v => v.subPeriod === expected) : undefined
      if (matching) chosen = matching
      else if (list.length === 1) chosen = list[0]
    }
    if (chosen) out.push(chosen)
  }
  return out
}
