// =============================================================================
// Briefing script builder — deterministic Arabic narration text for the
// per-stock audio briefing ("البريفينج المسموع").
//
// Pure function: the same technical snapshot always produces the same script,
// so sha256(scriptAr) is a stable cache identity for the TTS audio row.
// Every sentence is null-safe — a missing metric drops its sentence entirely;
// the output NEVER contains "null" / "NaN" / "undefined" (guaranteed by tests).
//
// Budget: the z-ai TTS endpoint accepts ≤1024 chars per call, so the script is
// capped at 900 chars — one TTS call per briefing. When the assembled script
// exceeds the cap, optional sections are dropped in a fixed priority order
// (zones → volume → levels → invalidation → momentum → trend → verdict);
// greeting, disclaimer and asOf are never dropped.
// =============================================================================

import type { TechnicalSnapshot } from "@/lib/technical/analyze"
import { computeStanceFromSnapshot } from "@/lib/technical/signals"

/** The briefing reads the exact snapshot the technical tab is built on. */
export type BriefingSnapshot = TechnicalSnapshot

export interface BriefingScriptInput {
  ticker: string
  /** Arabic display name (nullable — falls back to the ticker). */
  nameAr: string | null
  snapshot: BriefingSnapshot
}

export interface BriefingScriptResult {
  scriptAr: string
  sectionsUsed: string[]
}

/** Hard cap: comfortably inside the TTS endpoint's 1024-char input limit. */
export const BRIEFING_SCRIPT_MAX_CHARS = 900

/** WAV 24kHz mono 16-bit ≈ 48,000 bytes per second of audio. */
export function estimateDurationSec(bytes: number): number {
  return Math.round(bytes / 48_000)
}

// ------------------------------------------------------------- tiny helpers

/** Finite number → string (rounded to `digits`), otherwise null. */
function num(v: unknown, digits = 2): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null
  const f = 10 ** digits
  return String(Math.round(v * f) / f)
}

/** Finite number → integer percent string (speech-friendly), otherwise null. */
function pctInt(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null
  return String(Math.round(Math.abs(v)))
}

function cleanText(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null
  const t = v.replace(/\s+/g, " ").trim()
  return t.length > 0 ? t : null
}

/** Normalize the session date to plain YYYY-MM-DD (never fabricates a date). */
function isoDay(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null
  const m = v.trim().match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

// ------------------------------------------------------------- section builders

function greetingSentence(ticker: string, nameAr: string | null): string {
  const name = cleanText(nameAr) ?? cleanText(ticker) ?? "السهم"
  const code = cleanText(ticker) ?? name
  return `تحليل فني معلوماتي لسهم ${name} — كود ${code}.`
}

/** Stance shape from the shared rule engine (signals.ts). */
type Stance = ReturnType<typeof computeStanceFromSnapshot>

function verdictSentence(snapshot: BriefingSnapshot, stance: Stance): string | null {
  // Same stance engine the technical tab and the /signals board use — the
  // briefing never invents its own score vocabulary.
  if (stance.signal === null || stance.score === null || !Number.isFinite(stance.score)) return null
  const word = stance.signal === "buy" ? "إيجابية" : stance.signal === "sell" ? "سلبية" : "محايدة"
  return `الصورة الفنية ${word} — درجة ${Math.round(stance.score)} من 100.`
}

function trendSentence(snapshot: BriefingSnapshot): string | null {
  const close = num(snapshot.lastClose)
  const ema20 = num(snapshot.trend.ema20)
  const ema50 = num(snapshot.trend.ema50)
  if (!ema20 && !ema50) return null
  const parts: string[] = []
  if (close && ema20) parts.push(`السعر عند ${close} ${Number(snapshot.lastClose) > Number(snapshot.trend.ema20) ? "فوق" : "تحت"} متوسط 20 جلسة المتحرك`)
  if (ema20 && ema50) {
    const stack = Number(snapshot.trend.ema20) > Number(snapshot.trend.ema50)
      ? "متوسط 20 فوق متوسط 50 — رصيف متوسطات صاعد"
      : Number(snapshot.trend.ema20) < Number(snapshot.trend.ema50)
        ? "متوسط 20 تحت متوسط 50 — رصيف متوسطات هابط"
        : "متوسط 20 قريب من متوسط 50"
    parts.push(stack)
  } else if (ema20 && !close) {
    parts.push(`متوسط 20 جلسة عند ${ema20}`)
  }
  if (!parts.length) return null
  return `الاتجاه: ${parts.join("، ")}.`
}

function rsiBandAr(rsi: number): string {
  if (rsi >= 70) return "في تشبع شرائي"
  if (rsi <= 30) return "في تشبع بيعي"
  if (rsi > 65) return "قرب التشبع الشرائي"
  if (rsi >= 45) return "في منطقة الزخم الصح"
  return "في منطقة ضعيفة"
}

function momentumSentence(snapshot: BriefingSnapshot): string | null {
  const rsi = num(snapshot.momentum.rsi14)
  const hist = snapshot.momentum.macd.histogram
  const parts: string[] = []
  if (rsi) parts.push(`مؤشر القوة النسبية عند ${rsi} ${rsiBandAr(Number(snapshot.momentum.rsi14))}`)
  if (typeof hist === "number" && Number.isFinite(hist) && num(snapshot.momentum.macd.macd) !== null) {
    const dir = hist > 0 ? "إيجابي" : hist < 0 ? "سلبي" : "متوازن"
    parts.push(`زخم MACD ${dir}`)
  }
  if (!parts.length) return null
  return `الزخم: ${parts.join("، ")}.`
}

function levelsSentence(snapshot: BriefingSnapshot): string | null {
  const sup = snapshot.levels.supports[0]
  const res = snapshot.levels.resistances[0]
  const parts: string[] = []
  if (sup && num(sup.price) && pctInt(sup.distPct)) {
    parts.push(`أقرب دعم عند ${num(sup.price)} (على بُعد ${pctInt(sup.distPct)}% تقريبًا)`)
  }
  if (res && num(res.price) && pctInt(res.distPct)) {
    parts.push(`أقرب مقاومة عند ${num(res.price)} (على بُعد ${pctInt(res.distPct)}% تقريبًا)`)
  }
  if (!parts.length) return null
  return `${parts.join(" و")}.`
}

function zonesSentence(snapshot: BriefingSnapshot): string | null {
  const zones = snapshot.zones?.zones
  if (!Array.isArray(zones) || zones.length === 0) return null
  const demand = zones.find((z) => z && z.kind === "demand")
  const supply = zones.find((z) => z && z.kind === "supply")
  const parts: string[] = []
  if (demand && num(demand.low) && num(demand.high)) parts.push(`أقرب منطقة طلب بين ${num(demand.low)} و${num(demand.high)}`)
  if (supply && num(supply.low) && num(supply.high)) parts.push(`أقرب منطقة عرض بين ${num(supply.low)} و${num(supply.high)}`)
  if (!parts.length) return null
  return `${parts.join(" و")}.`
}

function volumeSentence(snapshot: BriefingSnapshot): string | null {
  const relVol = snapshot.volume.relVol
  const obvSlope = snapshot.volume.obvSlope20
  const relKnown = typeof relVol === "number" && Number.isFinite(relVol)
  const slopeKnown = typeof obvSlope === "number" && Number.isFinite(obvSlope)
  // Volume sentence only when at least one volume metric is actually known.
  if (!relKnown && !slopeKnown) return null
  const relPart = relKnown
    ? (relVol as number) >= 1.2 ? "أعلى من متوسطه" : (relVol as number) <= 0.7 ? "أقل من متوسطه" : "قريب من متوسطه"
    : null
  const slopePart = slopeKnown ? ((obvSlope as number) > 0 ? "مع ميول تجميع" : "مع ميول توزيع") : null
  // "Supports the move" needs the OBV direction — relVol alone stays descriptive.
  if (slopeKnown) {
    const supports = (obvSlope as number) > 0 && (!relKnown || (relVol as number) >= 1)
    return `حجم التداول ${[relPart, slopePart].filter(Boolean).join(" ")} — ${supports ? "بيدعم الحركة" : "مش بيدعم الحركة بوضوح"}.`
  }
  return `حجم التداول ${relPart}.`
}

function invalidationSentence(stance: Stance): string | null {
  const inv = stance.invalidation
  if (!inv || typeof inv.level !== "number" || !Number.isFinite(inv.level)) return null
  const level = num(inv.level)
  if (!level) return null
  return inv.side === "below"
    ? `الإغلاق تحت ${level} بيبطل القراءة دي.`
    : `الإغلاق فوق ${level} بيبطل القراءة دي.`
}

export const DISCLAIMER_SENTENCE = "القراءة دي لأغراض معلوماتية وتعليمية — مش توصية بشراء أو بيع، والقرار النهائي قرارك."

function asOfSentence(snapshot: BriefingSnapshot): string | null {
  const day = isoDay(snapshot.asOf)
  return day ? `آخر جلسة متاحة: ${day}.` : null
}

// ------------------------------------------------------------- assembly

/** Optional-section drop order when the script exceeds the char budget. */
const DROP_ORDER = ["zones", "volume", "levels", "invalidation", "momentum", "trend", "verdict"] as const

export function buildBriefingScript(input: BriefingScriptInput): BriefingScriptResult {
  const s = input.snapshot
  // One shared stance computation feeds both the verdict and the invalidation
  // sentences (pure, deterministic, and cheap — same engine as the tech tab).
  const stance = computeStanceFromSnapshot(s)
  const sections: { key: string; text: string | null }[] = [
    { key: "greeting", text: greetingSentence(input.ticker, input.nameAr) },
    { key: "verdict", text: verdictSentence(s, stance) },
    { key: "trend", text: trendSentence(s) },
    { key: "momentum", text: momentumSentence(s) },
    { key: "levels", text: levelsSentence(s) },
    { key: "zones", text: zonesSentence(s) },
    { key: "volume", text: volumeSentence(s) },
    { key: "invalidation", text: invalidationSentence(stance) },
    { key: "disclaimer", text: DISCLAIMER_SENTENCE },
    { key: "asOf", text: asOfSentence(s) },
  ]

  const usable = sections.filter((x) => typeof x.text === "string" && x.text!.length > 0)
  const join = (list: typeof usable) => list.map((x) => x.text).join(" ")

  // Char-budget guard: drop optional sections in a fixed priority order until
  // the script fits in one TTS call. Deterministic — same input, same result.
  let kept = [...usable]
  for (const dropKey of DROP_ORDER) {
    if (join(kept).length <= BRIEFING_SCRIPT_MAX_CHARS) break
    kept = kept.filter((x) => x.key !== dropKey)
  }

  const scriptAr = join(kept)
  return { scriptAr, sectionsUsed: kept.map((x) => x.key) }
}
