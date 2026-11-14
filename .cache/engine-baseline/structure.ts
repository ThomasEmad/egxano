// =============================================================================
// Market Structure Analysis — deterministic, documented, tested.
//
// RULES (fixed, versioned; any change must bump STRUCTURE_VERSION):
//  R1 Swing pivot: bar i is a swing HIGH iff high[i] = max(high[i-wing .. i+wing]);
//     swing LOW symmetric. Pivots need `wing` bars on BOTH sides (confirmed late —
//     no repaint inside the wing window; the last `wing` bars can never hold a pivot).
//  R2 Alternation & noise filter: consecutive same-kind pivots collapse to the
//     more extreme one; a pivot that differs from the adjacent opposite pivot by
//     less than `minSwingPct` (default 1.5%) is noise and is dropped.
//  R3 Labels: consecutive swing highs → HH (higher high) / LH (lower high);
//     consecutive swing lows → HL / LL.
//  R4 Trend state (per timeframe): uptrend = last two highs HH AND last two lows HL;
//     downtrend = LH AND LL; otherwise range. Fewer than 2 confirmed highs and
//     2 lows → null (insufficient evidence — never guessed).
//  R5 BOS (break of structure): a CLOSE beyond the most recent confirmed swing
//     level in the DIRECTION of the prevailing trend (close > last swing high in
//     an uptrend / close < last swing low in a downtrend).
//  R6 CHoCH (change of character): a CLOSE beyond the most recent OPPOSING swing
//     against the prevailing trend (close < last higher-low in an uptrend /
//     close > last lower-high in a downtrend) — the first structural evidence of
//     a potential reversal.
//  R7 A break is confirmed by the CLOSE only — a wick through the level is not a
//     break. The break bar's volume ratio (vs its 20-session baseline, when the
//     series carries volume) is recorded as context, never as a requirement.
//  R8 Retest: within `retestWindow` (default 10) sessions after the break, if the
//     price returns to within `retestTolPct` (default 0.75%) of the level, a
//     retest is recorded; if the break level holds on a close basis afterwards,
//     the break stands ("held"), otherwise it is flagged "failed".
//  R9 Invalidation: a bullish break is invalidated when a LATER close is back on
//     the wrong side of the broken level by more than `invalidBufferPct` (0.5%).
//
// Interpretation guardrails: every structural event reports WHICH level broke,
// WHEN, whether the close confirmed it, whether volume supported it, whether a
// retest occurred, and whether it was later invalidated. No event is ever
// called "confirmed accumulation/distribution" — structure is descriptive.
// =============================================================================

export const STRUCTURE_VERSION = "structure@1"

export interface Bar {
  ts: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

export type TrendState = "uptrend" | "downtrend" | "range" | null

export interface Swing {
  ts: string
  price: number
  kind: "high" | "low"
  /** HH | LH | HL | LL — null for the first of its kind */
  label: "HH" | "LH" | "HL" | "LL" | null
}

export interface StructureEvent {
  code: "BOS" | "CHOCH"
  direction: "bullish" | "bearish"
  /** the structural level that was broken */
  level: number
  /** session date of the broken swing */
  levelTs: string
  /** session date of the closing break */
  brokenAt: string
  closeConfirmed: true
  /** break-bar volume / 20-session baseline — null when volume is unavailable */
  volumeRatio: number | null
  volumeSupported: boolean | null
  retest: { occurred: boolean; ts: string | null; held: boolean | null }
  invalidated: boolean
  invalidatedAt: string | null
  text: string
  textAr: string
}

export interface StructureSnapshot {
  version: string
  available: boolean
  reason?: string
  swings: Swing[]
  trend: {
    short: TrendState
    medium: TrendState
    long: TrendState
    consistency: "aligned_bullish" | "aligned_bearish" | "mixed" | null
    basis: string
  }
  events: StructureEvent[] // most recent first, capped
  keyLevels: { kind: "swing_high" | "swing_low"; price: number; ts: string; distPct: number; role: string }[]
  limitations: string[]
}

const DEFAULTS = {
  wing: 3,
  minSwingPct: 1.5,
  retestWindow: 10,
  retestTolPct: 0.75,
  invalidBufferPct: 0.5,
  maxEvents: 6,
  maxSwings: 12,
}

// ---------------------------------------------------------------- pivots (R1-R2)

interface Pivot {
  idx: number
  ts: string
  price: number
  kind: "high" | "low"
}

/** Raw fractal pivots per R1. */
export function rawPivots(bars: Bar[], wing: number): Pivot[] {
  const out: Pivot[] = []
  for (let i = wing; i < bars.length - wing; i++) {
    let isHigh = true
    let isLow = true
    for (let j = i - wing; j <= i + wing; j++) {
      if (j === i) continue
      if (bars[j].high >= bars[i].high) isHigh = false
      if (bars[j].low <= bars[i].low) isLow = false
      if (!isHigh && !isLow) break
    }
    if (isHigh) out.push({ idx: i, ts: bars[i].ts, price: bars[i].high, kind: "high" })
    else if (isLow) out.push({ idx: i, ts: bars[i].ts, price: bars[i].low, kind: "low" })
  }
  return out
}

/** R2: collapse same-kind runs to the extreme, drop sub-`minSwingPct` noise. */
export function cleanPivots(bars: Bar[], wing: number, minSwingPct: number): Pivot[] {
  const raw = rawPivots(bars, wing)
  // Collapse consecutive same-kind pivots (keep the extreme).
  const collapsed: Pivot[] = []
  for (const p of raw) {
    const last = collapsed[collapsed.length - 1]
    if (last && last.kind === p.kind) {
      const better = p.kind === "high" ? p.price > last.price : p.price < last.price
      if (better) collapsed[collapsed.length - 1] = p
      continue
    }
    collapsed.push(p)
  }
  // Noise filter vs the adjacent OPPOSITE pivot.
  const kept: Pivot[] = []
  for (const p of collapsed) {
    const last = kept[kept.length - 1]
    if (last) {
      const diffPct = (Math.abs(p.price - last.price) / last.price) * 100
      if (diffPct < minSwingPct) {
        // Too small to matter: keep whichever is more structurally conservative
        // (a high is dropped if it is lower than the previous high's zone).
        const pIsExtreme = p.kind === "high" ? p.price < last.price : p.price > last.price
        if (pIsExtreme || diffPct < minSwingPct / 2) continue
        kept[kept.length - 1] = p // replace the earlier, smaller swing
        continue
      }
    }
    kept.push(p)
  }
  return kept
}

// ---------------------------------------------------------------- labels (R3)

/** Attach HH/LH/HL/LL labels to a cleaned pivot sequence. */
export function labelPivots(pivots: Pivot[]): Swing[] {
  const last = { high: null as Pivot | null, low: null as Pivot | null }
  const out: Swing[] = []
  for (const p of pivots) {
    let label: Swing["label"] = null
    if (p.kind === "high") {
      if (last.high) label = p.price > last.high.price ? "HH" : "LH"
      last.high = p
    } else {
      if (last.low) label = p.price > last.low.price ? "HL" : "LL"
      last.low = p
    }
    out.push({ ts: p.ts, price: p.price, kind: p.kind, label })
  }
  return out
}

// ---------------------------------------------------------------- trend (R4)

/** Trend state from a labeled swing sequence, per R4. */
export function trendFromSwings(swings: Swing[]): { state: TrendState; basis: string } {
  const highs = swings.filter((s) => s.kind === "high").slice(-2)
  const lows = swings.filter((s) => s.kind === "low").slice(-2)
  if (highs.length < 2 || lows.length < 2 || highs[0].label === null || lows[0].label === null) {
    return { state: null, basis: "fewer than two confirmed highs and lows" }
  }
  const hh = highs[1].label === "HH"
  const hl = lows[1].label === "HL"
  if (hh && hl) return { state: "uptrend", basis: `higher high (${highs[1].ts}) + higher low (${lows[1].ts})` }
  if (!hh && !hl) return { state: "downtrend", basis: `lower high (${highs[1].ts}) + lower low (${lows[1].ts})` }
  return { state: "range", basis: "mixed swing labels — no clean directional structure" }
}

// ---------------------------------------------------------------- events (R5-R9)

/** Detect BOS/CHoCH events over the session series. Returns most-recent-first. */
export function structureEvents(
  bars: Bar[],
  pivots: Pivot[],
  opts: Pick<typeof DEFAULTS, "retestWindow" | "retestTolPct" | "invalidBufferPct" | "maxEvents"> = DEFAULTS,
): StructureEvent[] {
  if (bars.length < 10 || pivots.length < 2) return []
  const volBaseline = volumeBaseline(bars)
  const events: StructureEvent[] = []

  // Walk closes after each pivot; the "prevailing trend" at each moment comes
  // from the labeled swings UP TO that pivot (point-in-time — no look-ahead).
  const swings = labelPivots(pivots)
  const pivotByTs = new Map(pivots.map((p) => [p.ts, p]))

  for (let s = 1; s < swings.length; s++) {
    const cur = swings[s]
    const prevOpp = findPrevOpposite(swings, s) // most recent opposite-kind swing before cur
    if (!prevOpp) continue
    const curPivot = pivotByTs.get(cur.ts)
    if (!curPivot) continue

    // Trend from swings strictly before the current pivot's confirmation zone.
    const hist = swings.slice(0, s)
    const t = trendFromSwings(hist)

    // Scan closes AFTER the pivot was confirmed (pivot idx + wing).
    const startIdx = curPivot.idx + DEFAULTS.wing
    for (let i = startIdx; i < bars.length; i++) {
      const bar = bars[i]
      // BOS candidate (R5): close beyond cur pivot in trend direction.
      const bosCandidate =
        t.state === "uptrend" && cur.kind === "high" && bar.close > curPivot.price
          ? "bullish"
          : t.state === "downtrend" && cur.kind === "low" && bar.close < curPivot.price
            ? "bearish"
            : null
      // CHoCH candidate (R6): in an uptrend, a close BELOW the most recent
      // higher-low (prevOpp = opposite kind = low); in a downtrend, a close
      // ABOVE the most recent lower-high. prevOpp is the opposite-kind swing
      // that precedes cur by construction.
      const chochCandidate =
        t.state === "uptrend" && cur.kind === "high" && prevOpp.kind === "low" && bar.close < prevOpp.price
          ? "bearish"
          : t.state === "downtrend" && cur.kind === "low" && prevOpp.kind === "high" && bar.close > prevOpp.price
            ? "bullish"
            : null
      const code: StructureEvent["code"] | null = bosCandidate ? "BOS" : chochCandidate ? "CHOCH" : null
      if (!code) continue
      const direction = (bosCandidate ?? chochCandidate) as "bullish" | "bearish"
      const level = code === "BOS" ? curPivot.price : prevOpp.price
      const levelTs = code === "BOS" ? curPivot.ts : prevOpp.ts

      // Skip duplicates at the same level broken in the same direction that are
      // already recorded (re-breaks of an already-broken level are not new events
      // unless the level was reclaimed in between — handled by invalidation).
      const dup = events.find(
        (e) => e.code === code && e.direction === direction && Math.abs(e.level - level) / level < 0.001 && e.invalidated === false,
      )
      if (dup) continue

      const volumeRatio = volRatioAt(bars, i, volBaseline)
      const volumeSupported = volumeRatio === null ? null : volumeRatio >= 1.2

      // Retest scan (R8) and invalidation scan (R9) over subsequent sessions.
      const retest = scanRetest(bars, i, level, direction, opts)
      const invalidatedInfo = scanInvalidation(bars, i, level, direction, opts)

      events.push({
        code,
        direction,
        level: round(level),
        levelTs,
        brokenAt: bar.ts,
        closeConfirmed: true,
        volumeRatio: volumeRatio === null ? null : round(volumeRatio, 2),
        volumeSupported,
        retest,
        invalidated: invalidatedInfo.invalidated,
        invalidatedAt: invalidatedInfo.ts,
        text: eventText(code, direction, level, bar.ts, volumeRatio, retest, invalidatedInfo.invalidated),
        textAr: eventTextAr(code, direction, level, bar.ts, volumeRatio, retest, invalidatedInfo.invalidated),
      })
      break // this pivot's story is told; move to the next swing
    }
  }

  return events.slice(-opts.maxEvents).reverse() // most recent first
}

function findPrevOpposite(swings: Swing[], idx: number): Swing | null {
  const kind = swings[idx].kind
  const want = kind === "high" ? "low" : "high"
  for (let i = idx - 1; i >= 0; i--) {
    if (swings[i].kind === want) return swings[i]
  }
  return null
}

/** 20-session mean volume ending at (excluding) bar i; null when incomplete. */
function volumeBaseline(bars: Bar[]): (i: number) => number | null {
  return (i: number) => {
    if (i < 21) return null
    let sum = 0
    for (let j = i - 20; j < i; j++) {
      const v = bars[j].volume
      if (v === null || !Number.isFinite(v)) return null
      sum += v
    }
    return sum > 0 ? sum / 20 : null
  }
}

function volRatioAt(bars: Bar[], i: number, baseline: (i: number) => number | null): number | null {
  const v = bars[i].volume
  const b = baseline(i)
  if (v === null || b === null) return null
  return v / b
}

function scanRetest(
  bars: Bar[],
  fromIdx: number,
  level: number,
  direction: "bullish" | "bearish",
  opts: { retestWindow: number; retestTolPct: number },
): StructureEvent["retest"] {
  const tol = level * (opts.retestTolPct / 100)
  for (let i = fromIdx + 1; i <= Math.min(bars.length - 1, fromIdx + opts.retestWindow); i++) {
    const bar = bars[i]
    const touched = direction === "bullish" ? bar.low <= level + tol && bar.low >= level - tol * 3 : bar.high >= level - tol && bar.high <= level + tol * 3
    if (!touched) continue
    // Held = subsequent closes stay on the post-break side.
    for (let j = i; j <= Math.min(bars.length - 1, i + 5); j++) {
      const c = bars[j].close
      if (direction === "bullish" && c < level - tol) return { occurred: true, ts: bar.ts, held: false }
      if (direction === "bearish" && c > level + tol) return { occurred: true, ts: bar.ts, held: false }
    }
    return { occurred: true, ts: bar.ts, held: true }
  }
  return { occurred: false, ts: null, held: null }
}

function scanInvalidation(
  bars: Bar[],
  fromIdx: number,
  level: number,
  direction: "bullish" | "bearish",
  opts: { invalidBufferPct: number },
): { invalidated: boolean; ts: string | null } {
  const buf = level * (opts.invalidBufferPct / 100)
  for (let i = fromIdx + 1; i < bars.length; i++) {
    const c = bars[i].close
    if (direction === "bullish" && c < level - buf) return { invalidated: true, ts: bars[i].ts }
    if (direction === "bearish" && c > level + buf) return { invalidated: true, ts: bars[i].ts }
  }
  return { invalidated: false, ts: null }
}

// ---------------------------------------------------------------- texts

const round = (x: number, digits = 2) => {
  const f = 10 ** digits
  return Math.round(x * f) / f
}

function eventText(
  code: StructureEvent["code"],
  direction: "bullish" | "bearish",
  level: number,
  ts: string,
  volumeRatio: number | null,
  retest: StructureEvent["retest"],
  invalidated: boolean,
): string {
  const kind = code === "BOS" ? "Break of structure" : "Change of character"
  const dir = direction === "bullish" ? "bullish" : "bearish"
  const vol =
    volumeRatio === null
      ? ""
      : volumeRatio >= 1.2
        ? ` Volume on the break bar ran at ${round(volumeRatio)}× its 20-session baseline, supporting the move.`
        : ` Break-bar volume was only ${round(volumeRatio)}× its baseline — the break lacks participation and is treated cautiously.`
  const rt = retest.occurred
    ? retest.held
      ? " The level was retested and held on a closing basis."
      : " The retest failed — closes returned through the level."
    : retest.ts === null
      ? " No retest has occurred yet."
      : ""
  const inv = invalidated ? " NOTE: the break was later invalidated by a close back through the level." : ""
  return `${kind} (${dir}): a session close broke the ${level} ${direction === "bullish" ? "swing high" : "swing low"} from ${ts}.${vol}${rt}${inv}`
}

function eventTextAr(
  code: StructureEvent["code"],
  direction: "bullish" | "bearish",
  level: number,
  ts: string,
  volumeRatio: number | null,
  retest: StructureEvent["retest"],
  invalidated: boolean,
): string {
  const kind = code === "BOS" ? "كسر هيكلي" : "تغيّر في طبيعة الهيكل"
  const dir = direction === "bullish" ? "صاعد" : "هابط"
  const vol =
    volumeRatio === null
      ? ""
      : volumeRatio >= 1.2
        ? ` حجم شمعة الكسر بلغ ${round(volumeRatio)} ضعف متوسط 20 جلسة، بما يدعم الحركة.`
        : ` حجم شمعة الكسر ${round(volumeRatio)} ضعف فقط من المتوسط — الكسر بلا مشاركة ويُعامل بحذر.`
  const rt = retest.occurred
    ? retest.held
      ? " المستوى أُعيد اختباره وصدّ على أساس الإغلاق."
      : " فشل الاختبار — عادت الإغلاقات إلى ما وراء المستوى."
    : " لم يحدث اختبار للكسر بعد."
  const inv = invalidated ? " تنبيه: الكسر أُبطل لاحقًا بإغلاق عائد عبر المستوى." : ""
  return `${kind} (${dir}): إغلاق جلسة كسر ${direction === "bullish" ? "قمة" : "قاع"} ${level} المؤرخة في ${ts}.${vol}${rt}${inv}`
}

// ---------------------------------------------------------------- entry point

/** Analyze the daily series and its two derived timeframes (weekly resample). */
export function analyzeStructure(
  bars: Bar[],
  opts: Partial<typeof DEFAULTS> = {},
): StructureSnapshot {
  const cfg = { ...DEFAULTS, ...opts }
  const empty: StructureSnapshot = {
    version: STRUCTURE_VERSION,
    available: false,
    swings: [],
    trend: { short: null, medium: null, long: null, consistency: null, basis: "" },
    events: [],
    keyLevels: [],
    limitations: [],
  }
  if (bars.length < 15) {
    return { ...empty, reason: "fewer than 15 sessions — structure requires swing context" }
  }

  // --- Medium term: the daily series itself (primary timeframe) ---
  const pivots = cleanPivots(bars, cfg.wing, cfg.minSwingPct)
  const swings = labelPivots(pivots)
  const medium = trendFromSwings(swings)

  // --- Short term: last ~60 sessions with a tighter wing ---
  const shortBars = bars.slice(-60)
  const shortPivots = cleanPivots(shortBars, Math.max(2, cfg.wing - 1), cfg.minSwingPct)
  const shortTrend = trendFromSwings(labelPivots(shortPivots))

  // --- Long term: weekly resample (only when there are enough weeks) ---
  const weeks = resampleWeekly(bars)
  let longTrend: { state: TrendState; basis: string } = { state: null, basis: "" }
  let limitations: string[] = []
  if (weeks.length >= 12) {
    const longPivots = cleanPivots(weeks, 4, cfg.minSwingPct)
    longTrend = trendFromSwings(labelPivots(longPivots))
  } else {
    limitations.push(`Long-term structure needs ≥12 weekly candles (${weeks.length} available) — long timeframe omitted.`)
  }

  const consistency = consistencyOf(shortTrend.state, medium.state, longTrend.state)

  // --- Events on the primary timeframe ---
  const events = structureEvents(bars, pivots, cfg)

  // --- Key structural levels: unbroken recent swings near current price ---
  const lastClose = bars[bars.length - 1].close
  const keyLevels = swings
    .slice(-6)
    .reverse()
    .map((s) => ({
      kind: (s.kind === "high" ? "swing_high" : "swing_low") as "swing_high" | "swing_low",
      price: round(s.price),
      ts: s.ts,
      distPct: round(((s.price - lastClose) / lastClose) * 100, 2),
      role:
        s.label === "HH"
          ? "highest recent high"
          : s.label === "LH"
            ? "recent lower high"
            : s.label === "HL"
              ? "recent higher low"
              : s.label === "LL"
                ? "recent lower low"
                : "swing level",
    }))

  if (pivots.length < 4) {
    limitations.push("Fewer than four clean swings in the retained window — trend state is provisional.")
  }

  return {
    version: STRUCTURE_VERSION,
    available: true,
    swings: swings.slice(-cfg.maxSwings).map((s) => ({ ...s, price: round(s.price) })),
    trend: {
      short: shortTrend.state,
      medium: medium.state,
      long: longTrend.state,
      consistency,
      basis: `short: ${shortTrend.basis || "n/a"}; medium: ${medium.basis || "n/a"}; long: ${longTrend.basis || "n/a"}`,
    },
    events,
    keyLevels,
    limitations,
  }
}

function consistencyOf(short: TrendState, medium: TrendState, long: TrendState): StructureSnapshot["trend"]["consistency"] {
  const states = [short, medium, long].filter((s) => s !== null) as Exclude<TrendState, null>[]
  if (!states.length) return null
  const bulls = states.filter((s) => s === "uptrend").length
  const bears = states.filter((s) => s === "downtrend").length
  if (bulls === states.length) return "aligned_bullish"
  if (bears === states.length) return "aligned_bearish"
  return "mixed"
}

/** Aggregate daily bars into ISO-week candles (open=first close-week open, etc.). */
export function resampleWeekly(bars: Bar[]): Bar[] {
  const weeks = new Map<string, Bar>()
  for (const b of bars) {
    const d = new Date(b.ts + "T00:00:00Z")
    // ISO week key: Monday of that week.
    const day = (d.getUTCDay() + 6) % 7
    const monday = new Date(d)
    monday.setUTCDate(d.getUTCDate() - day)
    const key = monday.toISOString().slice(0, 10)
    const w = weeks.get(key)
    if (!w) {
      weeks.set(key, { ...b, ts: key })
    } else {
      w.high = Math.max(w.high, b.high)
      w.low = Math.min(w.low, b.low)
      w.close = b.close
      if (b.volume !== null && w.volume !== null) w.volume += b.volume
      else w.volume = null
    }
  }
  return [...weeks.values()].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
}
