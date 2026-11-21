// =============================================================================
// Stance vision narrative — the EMA-FIRST doctrine builder (2026-11-17).
// =============================================================================
// OWNER MANDATE: «الـ EMA في التحليل هو أهم مؤشر في البورصة المصرية — وأهم من
// الدعوم والمقاومات الثابتة». The backbone of the reading is the EMA20/EMA50
// pair: where the close stands relative to each, the order BETWEEN them
// (ترتيب صعودي/سلبي), and the ONE line whose daily close ends the story
// (e.g. إغلاق يومي تحت EMA50 مع ترتيب سلبي = الخروج من القصة). Static
// supports/resistances are demoted to reference signs in a footnote — they
// never carry the narrative.
//
// ONE SOURCE OF TRUTH: the wording is a pure function of (state, EMA order).
// The unified engine's published state (buy/near/wait/exit — tech-signals@7)
// decides the action sentence; the EMA geometry decides the story sentences.
// When the two disagree the conflict is stated CLEARLY (never mushily), e.g.
// «إشارة الشراء الحالية سبقت تأكيد المتوسطات» — so the page can never say
// «صاعد واضح» while the plan implies a bearish read.
//
// Tone: a knowledgeable friend thinking aloud («أنا بفكّر معاك…») — honest,
// never commanding, no overconfidence. Arabic only, matching the copy doctrine
// of src/lib/position/review.ts. All numbers are REAL inputs (levels 2dp,
// distances 1dp signed) — nothing is invented here.
// =============================================================================

/** The unified engine's published state (null = no engine reading available). */
export type VisionState = "buy" | "near" | "wait" | "exit"

/** The EMA-order verdict — the story's single source of truth. */
export type VisionOrder = "bullish" | "bearish" | "transition" | "unknown"

export interface StanceVisionInput {
  /** the unified engine's state (null → the «ما بعد» bullet says so honestly) */
  state: VisionState | null
  /** last recorded close (2dp level) */
  lastClose: number | null
  /** EMA20 of the adjusted series (null → honest «غير متاحة») */
  ema20: number | null
  /** EMA50 of the adjusted series — the story's backbone line */
  ema50: number | null
}

export interface StanceVision {
  /** the derived EMA order — exposed for tests and future surfaces */
  order: VisionOrder
  /** ONE short paragraph — a beginner understands it in one read */
  paraAr: string
  /** exactly three crisp bullets: الوضع / خط الحكم / ما بعد */
  bulletsAr: { label: string; text: string }[]
  /** the ONE close-based line that ends the story (null when unmeasurable) */
  killLineAr: string | null
  /** static S/R demotion footnote — secondary confirmation only */
  footnoteAr: string
}

const fin = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v)

/** 2-decimal level — matches the tab's fmtN/TechPlanBlock conventions. */
function lvl(v: number): string {
  return v.toFixed(2)
}

/** Signed 1-decimal percent — matches the tab's distPct convention (+X.X%). */
function pct1(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`
}

function distPct(close: number, ema: number): number {
  return ((close - ema) / ema) * 100
}

/**
 * The EMA order — the doctrine's geometry:
 *   bullish    — close above EMA50 AND EMA20 above EMA50 (ترتيب صعودي كامل)
 *   bearish    — close below EMA50 AND EMA20 below EMA50 (ترتيب سلبي كامل)
 *   transition — the close and the pair-order disagree (الصورة متضاربة بوضوح)
 *   unknown    — no measurable EMA50/close
 */
export function deriveEmaOrder(lastClose: number | null, ema20: number | null, ema50: number | null): VisionOrder {
  if (!fin(lastClose) || !fin(ema50)) return "unknown"
  const above50 = lastClose > (ema50 as number)
  const stack = fin(ema20) ? (ema20 as number) > (ema50 as number) : null
  if (above50 && stack === true) return "bullish"
  if (!above50 && stack === false) return "bearish"
  return "transition"
}

function stateLineAr(state: VisionState | null): string | null {
  switch (state) {
    case "buy":
      return "الحالة: شراء — معاها خطة تنفيذية بمستويات مرقّمة في البطاقة اللي فوق، والحكم بالإغلاق اليومي مش باللمسة."
    case "near":
      return "الحالة: قرب التفعيل — محتاجين إغلاق يومي يحسم شرط التفعيل الأول؛ اللمسة جوه اليوم لا تفعّل ولا تُلغي."
    case "wait":
      return "الحالة: انتظار — مفيش إعداد يستاهل النشر اليوم؛ الانتظار هنا قرار محسوب مش تأخير."
    case "exit":
      return "الحالة: خروج — القصة اتقفلت بإغلاق، فالموضوع هنا تأمين اللي موجود مش مطاردة حركة جديدة."
    default:
      return null
  }
}

/** The kill line — the ONE close-based sentence that ends the story. */
function killLineFor(order: VisionOrder, ema20: number | null, ema50: number | null): string | null {
  if (!fin(ema50)) return null
  const e50 = ema50 as number
  switch (order) {
    case "bullish":
      return `إغلاق يومي تحت EMA50 (${lvl(e50)}) مع ترتيب سلبي = الخروج من القصة`
    case "bearish":
      return `إغلاق يومي فوق EMA50 (${lvl(e50)}) هو اللي بيهدي القصة الهابطة — وتحته المتوسطات هي الحاكمة`
    case "transition":
      // the transitional kill line leans on whichever EMA sits ON THE WRONG
      // side of the close: a reclaim attempt dies under EMA20, a failed
      // story dies under EMA50 — still ONE line, still close-based.
      if (fin(ema20)) {
        const e20 = ema20 as number
        return e20 > e50
          ? `إغلاق يومي تحت EMA20 (${lvl(e20)}) بيقفل محاولة التعافي`
          : `إغلاق يومي تحت EMA50 (${lvl(e50)}) بيقفل سيناريو التحول ويرجّع القصة الهابطة`
      }
      return `إغلاق يومي تحت EMA50 (${lvl(e50)}) بيقفل سيناريو التحول`
    default:
      return null
  }
}

/** The «الوضع» bullet — where the close stands vs each EMA, in real numbers. */
function situationBulletAr(lastClose: number | null, ema20: number | null, ema50: number | null, order: VisionOrder): string {
  const orderTxt =
    order === "bullish"
      ? "الترتيب صعودي (EMA20 فوق EMA50)"
      : order === "bearish"
        ? "الترتيب سلبي (EMA20 تحت EMA50)"
        : order === "transition"
          ? "الترتيب بين المتوسطات غير مكتمل"
          : "الترتيب غير متاح"
  if (!fin(lastClose)) return `آخر إغلاق غير متاح على هذه اللقطة — ${orderTxt}.`
  if (!fin(ema50)) return "المتوسطات غير متاحة لحد ما التاريخ السعري يكتمل — الوضع مش قابل للقياس بالموثوقية المطلوبة."
  const e50 = ema50 as number
  const side50 = lastClose > e50 ? "فوق" : "تحت"
  if (!fin(ema20)) {
    return `الإغلاق ${lvl(lastClose)} — ${side50} EMA50 (${lvl(e50)}) بفارق ${pct1(distPct(lastClose, e50))}؛ EMA20 غير متاحة فبيتقري على EMA50 فقط، ${orderTxt}.`
  }
  const e20 = ema20 as number
  const side20 = lastClose > e20 ? "فوق" : "تحت"
  return `الإغلاق ${lvl(lastClose)} — ${side20} EMA20 (${lvl(e20)}) بفارق ${pct1(distPct(lastClose, e20))}، و${side50} EMA50 (${lvl(e50)}) بفارق ${pct1(distPct(lastClose, e50))}؛ ${orderTxt}.`
}

/**
 * Build the EMA-first vision. PURE — same inputs, same strings out.
 */
export function buildStanceVision(input: StanceVisionInput): StanceVision {
  const { state, lastClose, ema20, ema50 } = input
  const order = deriveEmaOrder(lastClose, ema20, ema50)
  const e50txt = fin(ema50) ? lvl(ema50 as number) : ""

  // ---- the story paragraph: observation (geometry) + conclusion (state-aware)
  let paraAr: string
  switch (order) {
    case "bullish": {
      const obs = `أنا بفكّر معاك في القصة ببساطة: الإغلاق فوق EMA50 (${e50txt}) وEMA20 فوق EMA50 — ترتيب صعودي.`
      paraAr =
        state === "exit"
          ? `${obs} لكن إشارة المحرك الحالية خروج — كسر بنيوي سبق المتوسطات، فالصورة في مرحلة إعادة تقييم وإغلاق يومي فوق EMA50 تاني هو اللي يرجّع القصة.`
          : `${obs} ما دام الإغلاق اليومي فوق EMA50، القصة الصاعدة شغالة.`
      break
    }
    case "bearish": {
      const obs = `أنا بفكّر معاك في القصة ببساطة: الإغلاق تحت EMA50 (${e50txt}) وEMA20 تحت EMA50 — ترتيب سلبي.`
      paraAr =
        state === "buy"
          ? `${obs} إشارة الشراء الحالية سبقت تأكيد المتوسطات — هي أسرع من القصة، وأول إغلاق تحت خط الحكم بيقول إن الإشارة خلصت.`
          : `${obs} ما دام الإغلاق اليومي تحت EMA50، مفيش قصة صاعدة قائمة — وأي ارتداد لازم يثبت نفسه بإغلاق فوق المتوسطات الأول.`
      break
    }
    case "transition": {
      // the conflict is stated CLEARLY, not mushily — the close and the pair
      // order disagree, and the daily close is the judge.
      const head = fin(ema20) ? (ema20 as number) > (ema50 as number) : null
      if (head === true) {
        paraAr = `الصورة متضاربة وأقولها بصراحة: السعر تحت EMA50 (${e50txt}) رغم إن EMA20 فوق EMA50 — السهم في مرحلة انتقالية. الإغلاق اليومي هو الحكم: إغلاق فوق EMA50 بيكمّل التحول، وإغلاق تحت EMA20 بيقفل محاولة التعافي.`
      } else if (head === false) {
        paraAr = `الصورة متضاربة وأقولها بصراحة: السعر فوق EMA50 (${e50txt}) لكن EMA20 لسه تحت EMA50 — السهم في مرحلة انتقالية والقصة الصاعدة ما اتأكدتش. الإغلاق اليومي هو الحكم: إغلاقات فوق EMA20 بتكمّل التأكيد، وإغلاق تحت EMA50 بيرجّع القصة للهابطة.`
      } else {
        paraAr = `القصة نص قراءة هنا: الإغلاق ${fin(lastClose) && lastClose > (ema50 as number) ? "فوق" : "تحت"} EMA50 (${e50txt}) لكن EMA20 مش متاحة فالترتيب ناقص التأكيد — بعتبرها مرحلة انتقالية لحد ما البيانات تكتمل، والإغلاق اليومي هو الحكم.`
      }
      if (state === "buy") {
        paraAr += " إشارة الشراء الحالية سبقت التأكيد ده — والالتزام هنا أسرع من المعتاد، فخط الحكم تحت هو اللي بيفصل."
      }
      break
    }
    default:
      paraAr = fin(ema50)
        ? "آخر إغلاق غير متاح على هذه اللقطة — وبدون إغلاق مش هينفع أقيس المسافة عن المتوسطات بمصداقية، فبنقولها صراحة بدل ما ألف. الرؤية بترجع أول ما الإغلاق يتسجل."
        : "مفيش EMA50 متاحة على هذا السهم لحد ما التاريخ السعري يكتمل — وبدونها مش هينفع أقرا القصة بمصداقية، فبنقولها صراحة بدل ما ألف. الرؤية بترجع تظهر أول ما المتوسطات تتحسب."
      break
  }

  const killLineAr = killLineFor(order, ema20, ema50)

  const bulletsAr = [
    { label: "الوضع", text: situationBulletAr(lastClose, ema20, ema50, order) },
    {
      label: "خط الحكم",
      text: killLineAr ?? "مش متاح لحد ما المتوسطات تتكوّن — ومحتاج إغلاقات كفاية أقرا بيها بصراحة.",
    },
    {
      label: "ما بعد",
      text: stateLineAr(state) ?? "مفيش قراءة محرك متاحة على هذه اللقطة — الرؤية دي مبنية على المتوسطات، وبتتحدث أول ما قراءة المحرك تتاح.",
    },
  ]

  const footnoteAr =
    "المناطق الثابتة (الدعوم والمقاومات) مجرد إشارات مرجعية — الخط اللي السوق بيحترم فعلًا هو المتوسطات، والحكم بالإغلاق اليومي مش باللمسة جوه اليوم."

  return { order, paraAr, bulletsAr, killLineAr, footnoteAr }
}
