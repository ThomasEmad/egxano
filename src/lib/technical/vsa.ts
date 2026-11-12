// =============================================================================
// Volume Spread Analysis (VSA) — deterministic interpretation layer.
//
// Every event pairs a candle observation with its volume context and states
// the ACTUAL numbers. Interpretations are always framed as "consistent with"
// — never as proof of any participant's identity or intention. No event below
// claims insider/institutional activity.
//
// Fixed definitions (versioned — change only with VSA_VERSION bump):
//   baseline     : mean volume of the prior 60 sessions (≥30 required).
//   spreadPct    : (high − low) / priorClose × 100.
//   wideSpread   : spreadPct ≥ 1.6 × median spread of the prior 20 sessions.
//   narrowSpread : spreadPct ≤ 0.6 × median spread of the prior 20 sessions.
//   closeLoc     : (close − low) / (high − low), 0 = closed at the low,
//                  1 = closed at the high (undefined when high = low).
//   volRatio     : session volume / baseline.
//   declinePhase : close is below the close 10 sessions earlier.
//   advancePhase : close is above the close 10 sessions earlier.
//
// Events (scanned over the last `scan` sessions, most meaningful kept):
//   selling_climax   : decline phase + wide spread DOWN + volRatio ≥ 2.5 +
//                      closeLoc ≥ 0.55 (closed well off the lows) — consistent
//                      with heavy selling being absorbed.
//   buying_climax    : advance phase + wide spread UP + volRatio ≥ 2.5 +
//                      closeLoc ≤ 0.45 — consistent with buying into strength
//                      meeting supply.
//   stopping_volume  : decline phase + volRatio ≥ 2.0 + closeLoc ≥ 0.40.
//   no_demand        : up close + closeLoc ≥ 0.60 + volRatio ≤ 0.70 — the
//                      rally is not attracting volume.
//   no_supply        : decline phase + narrow spread + volRatio ≤ 0.70 —
//                      downside lacks participation (weak response).
//   effort_no_result : volRatio ≥ 2.0 with an unusually small body — effort
//                      without result, consistent with absorption-like
//                      behavior near a level.
//   followThrough    : for climax/stopping events — did the NEXT session
//                      recover the event bar's range (recovered / failed)?
// =============================================================================

export const VSA_VERSION = "vsa@1"

import type { Bar } from "./structure"

export interface VsaEvent {
  code: "selling_climax" | "buying_climax" | "stopping_volume" | "no_demand" | "no_supply" | "effort_no_result"
  ts: string
  tone: "bullish-leaning" | "bearish-leaning" | "neutral"
  spreadPct: number
  volRatio: number
  closeLoc: number
  phase: "decline" | "advance" | "flat"
  followThrough: "recovered" | "failed" | null
  text: string
  textAr: string
}

export interface VsaSnapshot {
  version: string
  available: boolean
  reason?: string
  /** volume baseline actually used, in shares, and the window length */
  baselineVolume: number | null
  baselineWindow: number
  events: VsaEvent[] // most recent first
  limitations: string[]
}

const MIN_BASELINE = 30
const BASELINE_WINDOW = 60
const SCAN_SESSIONS = 10
const MAX_EVENTS = 4

const round = (x: number, digits = 2) => {
  const f = 10 ** digits
  return Math.round(x * f) / f
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export function analyzeVsa(bars: Bar[]): VsaSnapshot {
  const empty: VsaSnapshot = {
    version: VSA_VERSION,
    available: false,
    baselineVolume: null,
    baselineWindow: 0,
    events: [],
    limitations: [],
  }
  if (bars.length < MIN_BASELINE + 2) {
    return { ...empty, reason: `needs ≥ ${MIN_BASELINE + 2} sessions with volume context` }
  }

  // Volume-complete suffix: VSA needs real volume on the bars it reads.
  let volStart = 0
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].volume === null) volStart = i + 1
  }
  const series = bars.slice(volStart)
  if (series.length < MIN_BASELINE + 2) {
    return { ...empty, reason: "the volume-complete suffix of the series is too short" }
  }
  const limitations: string[] = []
  if (volStart > 0) {
    limitations.push(`VSA reads the last ${series.length} sessions (the volume-complete window); earlier sessions lack volume.`)
  }

  // Baseline = mean of the 60 sessions preceding the scan window.
  const scanStart = Math.max(0, series.length - SCAN_SESSIONS)
  const baselineEnd = scanStart
  const baselineStart = Math.max(0, baselineEnd - BASELINE_WINDOW)
  const baselineSlice = series.slice(baselineStart, baselineEnd)
  if (baselineSlice.length < MIN_BASELINE) {
    return { ...empty, reason: "not enough volume history ahead of the scan window" }
  }
  let baselineSum = 0
  for (const b of baselineSlice) baselineSum += b.volume ?? 0
  const baseline = baselineSum / baselineSlice.length
  if (baseline <= 0) return { ...empty, reason: "volume baseline is not positive" }

  // Median spread of the 20 sessions before each candidate (computed per bar).
  const spreadPctAt = (i: number) => {
    const prevClose = i > 0 ? series[i - 1].close : series[i].open
    return prevClose > 0 ? ((series[i].high - series[i].low) / prevClose) * 100 : 0
  }

  const events: VsaEvent[] = []
  for (let i = scanStart; i < series.length; i++) {
    const bar = series[i]
    const vol = bar.volume ?? 0
    const volRatio = vol / baseline
    const spreadPct = spreadPctAt(i)
    const range = bar.high - bar.low
    const closeLoc = range > 0 ? (bar.close - bar.low) / range : 0.5
    const medianSpread = median(
      series.slice(Math.max(0, i - 20), i).map((_, k) => k).map((k) => {
        const idx = Math.max(0, i - 20) + k
        const prevClose = idx > 0 ? series[idx - 1].close : series[idx].open
        return prevClose > 0 ? (series[idx].high - series[idx].low) / prevClose : 0
      }),
    )
    const wide = spreadPct >= 1.6 * medianSpread && spreadPct > 0
    const narrow = spreadPct <= 0.6 * medianSpread
    const close10 = i >= 10 ? series[i - 10].close : null
    const phase: VsaEvent["phase"] = close10 === null ? "flat" : bar.close > close10 ? "advance" : bar.close < close10 ? "decline" : "flat"
    const prevClose = i > 0 ? series[i - 1].close : bar.open
    const upClose = bar.close > prevClose
    const downClose = bar.close < prevClose
    const bodyPct = prevClose > 0 ? (Math.abs(bar.close - bar.open) / prevClose) * 100 : 0

    // Follow-through: did the next session recover the event bar's range?
    let followThrough: VsaEvent["followThrough"] = null
    if (i + 1 < series.length && range > 0) {
      const next = series[i + 1]
      const recoveredHigh = next.close >= bar.low + range * 0.5
      followThrough = recoveredHigh ? "recovered" : "failed"
    }

    let ev: { code: VsaEvent["code"]; tone: VsaEvent["tone"] } | null = null
    if (phase === "decline" && downClose && wide && volRatio >= 2.5 && closeLoc >= 0.55) {
      ev = { code: "selling_climax", tone: "bullish-leaning" }
    } else if (phase === "advance" && upClose && wide && volRatio >= 2.5 && closeLoc <= 0.45) {
      ev = { code: "buying_climax", tone: "bearish-leaning" }
    } else if (phase === "decline" && downClose && volRatio >= 2.0 && closeLoc >= 0.4) {
      ev = { code: "stopping_volume", tone: "bullish-leaning" }
    } else if (upClose && closeLoc >= 0.6 && volRatio <= 0.7) {
      ev = { code: "no_demand", tone: "bearish-leaning" }
    } else if (phase === "decline" && narrow && volRatio <= 0.7) {
      ev = { code: "no_supply", tone: "bullish-leaning" }
    } else if (volRatio >= 2.0 && medianSpread > 0 && bodyPct <= 0.35 * medianSpread) {
      ev = { code: "effort_no_result", tone: "neutral" }
    }
    if (!ev) continue

    const closeLocPct = round(closeLoc * 100, 0)
    const ftText =
      followThrough === "recovered"
        ? " The next session recovered the range."
        : followThrough === "failed"
          ? " The next session failed to recover the range."
          : ""

    let text = ""
    let textAr = ""
    if (ev.code === "selling_climax") {
      text = `Selling-climax profile on ${bar.ts}: volume ${round(volRatio)}× the ${Math.round(baselineSlice.length)}-session baseline, spread ${round(spreadPct)}% with the close in the upper part of the range (${closeLocPct}% up the bar) after a decline. Consistent with elevated selling being absorbed — this does not establish who was buying.`
      textAr = `ملف ذروة بيع في ${bar.ts}: الحجم ${round(volRatio)} ضعف متوسط ${Math.round(baselineSlice.length)} جلسة، والانتشار ${round(spreadPct)}% والإغلاق في الجزء العلوي من النطاق (${closeLocPct}%) بعد هبوط. ينسجم مع ضغط بيع يتم امتصاصه — ولا يحدد هوية المشتري.`
    } else if (ev.code === "buying_climax") {
      text = `Buying-climax profile on ${bar.ts}: volume ${round(volRatio)}× baseline, wide ${round(spreadPct)}% advance closing in the lower part of the range (${closeLocPct}% up the bar). Consistent with strong buying meeting supply — this does not establish who was selling.`
      textAr = `ملف ذروة شراء في ${bar.ts}: الحجم ${round(volRatio)} ضعف المتوسط، وانتشار واسع ${round(spreadPct)}% بإغلاق في الجزء السفلي من النطاق (${closeLocPct}%). ينسجم مع شراء قوي يقابله عرض — ولا يحدد هوية البائع.`
    } else if (ev.code === "stopping_volume") {
      text = `Stopping-volume profile on ${bar.ts}: volume ${round(volRatio)}× baseline on a down session that closed ${closeLocPct}% up its range after a decline. Consistent with demand stepping in — not proof of it.${ftText}`
      textAr = `ملف حجم راجع في ${bar.ts}: الحجم ${round(volRatio)} ضعف المتوسط في جلسة هابطة أغلقت عند ${closeLocPct}% من نطاقها بعد هبوط. ينسجم مع دخول طلب — وليس دليلًا عليه.`
    } else if (ev.code === "no_demand") {
      text = `No-demand profile on ${bar.ts}: the session closed higher (${closeLocPct}% up its range) on only ${round(volRatio)}× baseline volume. Consistent with weak demand behind the advance.`
      textAr = `ملف غياب الطلب في ${bar.ts}: الجلسة أغلقت أعلى (${closeLocPct}% من نطاقها) بحجم ${round(volRatio)} ضعف المتوسط فقط. ينسجم مع ضعف الطلب خلف الصعود.`
    } else if (ev.code === "no_supply") {
      text = `No-supply profile on ${bar.ts}: a narrow ${round(spreadPct)}% down session on ${round(volRatio)}× baseline volume during a decline. Consistent with limited selling pressure — a weak response, not proof of support.${ftText}`
      textAr = `ملف غياب العرض في ${bar.ts}: جلسة هابطة ضيقة ${round(spreadPct)}% بحجم ${round(volRatio)} ضعف المتوسط أثناء هبوط. ينسجم مع محدودية ضغط البيع — استجابة ضعيفة وليست دليل دعم.`
    } else {
      text = `Effort-without-result on ${bar.ts}: volume ${round(volRatio)}× baseline but a small body (${round(bodyPct)}% vs ${round(medianSpread * 100, 1)}% median spread) — consistent with absorption-like behavior at this level, direction unresolved.`
      textAr = `جهد بلا نتيجة في ${bar.ts}: الحجم ${round(volRatio)} ضعف المتوسط مع جسم صغير (${round(bodyPct)}% مقابل متوسط انتشار ${round(medianSpread * 100, 1)}%) — ينسجم مع سلوك امتصاصي عند هذا المستوى، والاتجاه غير محسوم.`
    }

    events.push({ ...ev, ts: bar.ts, spreadPct: round(spreadPct), volRatio: round(volRatio), closeLoc: round(closeLoc, 2), phase, followThrough, text, textAr })
  }

  return {
    version: VSA_VERSION,
    available: true,
    baselineVolume: round(baseline, 0),
    baselineWindow: baselineSlice.length,
    events: events.slice(0, MAX_EVENTS),
    limitations,
  }
}
