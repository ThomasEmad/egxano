// =============================================================================
// market-lexicon.ts — عبارات أهل السوق (the EGX analyst phrasebook). PURE.
// Zero runtime imports (types only) — it can never cycle with review.ts.
//
// OWNER MANDATE (2026-11-18): «لازم يكون متعلم من كل محللين الفيس بوك الخبراء
// ومتعلم ثري جدا في المعلومات واللغة المصرية» — the review must speak the
// language Egypt's EGX analyst community actually speaks: the Facebook and
// Telegram phrasebook everyone reads («اللمسة مش كسر», «كسر الغطاء»,
// «التجميعة», «الدفعة اللمّية», «السحب والضخ», «الفوليوم بيكلم قبل السعر»,
// «الأرقام المستديرة أرضيات وسقوف»…). Every idiom is re-voiced in the
// review's own register — thinking aloud, never commanding: the phrase is
// quoted as SHARED WISDOM («من العبارات اللي بتتكرر عند أهل السوق…», «ومن
// كلام المحللين اللي بيتكتب كل يوم…»), never as an imperative order.
//
// LINE ANATOMY (the owner's information-density bar — every line):
//   1) OBSERVATION — a real number from the MarketContext (levels at 2dp,
//      percents at 1dp, ×multiples; the 0.7× / 1.3× volume-trend bounds are
//      the MarketContext's own documented thresholds, same style as
//      review.ts's veteran lines citing 2.5× / 0.7× class bounds),
//   2) MARKET LAW — why the community treats this pattern the way it does,
//   3) WATCH-NEXT — «اللي بنراقبه: …» naming the session evidence that
//      would move the reading next.
// HONESTY: a line fires ONLY on its own trigger carrying non-null context
// data; an honestly-null context yields [] — the phrasebook never invents
// a number. At most one line per trigger; the merged pass in review.ts
// (narrativeLinesAr) owns the global cap of 4 (merged with maker games + market map).
// =============================================================================

import type { MarketContext } from "./market-context"
import type { VeteranOpts } from "./review"

// ---- tiny local formatters (mirror review.ts's helper style; local copies,
// not imports — keeps this module free of any runtime edge) ----
/** 2-decimal level, e.g. 210.00 */
const fmt = (x: number) => x.toFixed(2)
/** 1-decimal percent WITHOUT a sign — for unsigned quantities like a
 *  round-level distance or a consolidation tightness. */
const pctPlain = (x: number) => `${x.toFixed(1)}٪`
/** 1-decimal ×multiple — for the documented volume-trend class bounds. */
const mult1 = (x: number) => `${x.toFixed(1)}×`

/** Arabic session count: جلسة واحدة / جلستين / {n} جلسات. */
function sessionsAr(n: number): string {
  if (n === 1) return "جلسة واحدة"
  if (n === 2) return "جلستين"
  return `${n} جلسات`
}

/** The phrasebook: trigger → line. Branch-gated exactly like the veteran
 *  ladder (the VeteranOpts shape mirrors review.ts); the round-number line
 *  fires on ANY branch, the rest follow their branch family. */
export function lexiconLinesAr(ctx: MarketContext, opts: VeteranOpts): string[] {
  const lines: string[] = []
  const add = (s: string) => lines.push(s)
  const b = opts.branch
  const profitRide = b === "hold" || b === "takeProfit"
  const lossWait = b === "deepLoss" || b === "cushionWait"
  const redExit = b === "farCushionExit" || b === "engineExit"
  const up = opts.trendAr.startsWith("صاعد")
  const down = opts.trendAr.startsWith("هابط")

  // ---- A1) the round-number line («الأرقام المستديرة أرضيات وسقوف») — any
  // branch. The context reports {level, distPct ≥ 0}; whether the level is a
  // ceiling or a floor lives in the caller's arithmetic — here: level vs the
  // live close (opts.close), read against the surrounding trend. The idiom
  // «اللمسة مش كسر» belongs to this line: round numbers get probed and
  // rejected all the time; only a DAILY CLOSE settles the role.
  if (ctx.roundLevelNear !== null) {
    const { level, distPct } = ctx.roundLevelNear
    if (level > opts.close) {
      // ceiling: the round number sits ABOVE the price — the sell wall
      add(
        `«الأرقام المستديرة أرضيات وسقوف» — من العبارات اللي بتتكرر عند أهل السوق كل يوم من غير مجاملة: السهم قارب من رقم مستدير عند ${fmt(level)} (فارق ${pctPlain(distPct)} عن إغلاق ${fmt(opts.close)})، وده فوق السعر يعني سقف وغطاء مبيعات بيتراكم عنده${
          up ? "، وفي اتجاه صاعد ده أول معركة حقيقية قدام الحركة" : down ? "، وفي اتجاه هابط الرقم ده بيقف سقف قدام أي ارتداد محتمل" : ""
        } — واللمسة مش كسر: الشموع بتخبط في الغطاء وترجع أكتر من مرة، والكسر الحقيقي بيثبت بإغلاق يومي فوقه بس. اللي بنراقبه: أول إغلاق يومي فوق ${fmt(level)} — لحظتها كسر الغطاء بيفتح شمال لسه فاضي لهدف جديد، ولحد اللحظة الرقم حاجز محترم.`,
      )
    } else if (level < opts.close) {
      // floor: the round number sits BELOW the price — the bids' shelf
      add(
        `«الأرقام المستديرة أرضيات وسقوف» — من كلام المحللين اللي بيتكتب كل يوم وبيتأكد على الشاشة: الرقم المستدير ${fmt(level)} قاعد تحت الإغلاق ${fmt(opts.close)} بفارق ${pctPlain(distPct)}، وده أرضية نفسية الطلبات بتتجمع عندها${
          down ? "، وفي اتجاه هابط الأرضية دي بتتاختبر كل يوم" : up ? "، وفي اتجاه صاعد هي أرضية الرحلة اللي بتحمل الاتجاه" : ""
        } — واللمسة مش كسر: اختبار الرقم وثباته بالإغلاق هو اللي بيحوله من رقم مكتوب لأرضية فعلية. اللي بنراقبه: أي إغلاق يومي تحت ${fmt(level)} — عشان الأرقام المستديرة لما بتتكسر بتقلب أدوار وبتدير سقف على الرحلة الجاية.`,
      )
    } else {
      // standing exactly on the round number (distPct 0 — that is a fact too)
      add(
        `السهم واقف بالظبط على الرقم المستدير ${fmt(level)} — «الأرقام المستديرة أرضيات وسقوف» عند أهل السوق، والعناد على الرقم ده معناه إن الطلب والعرض متكافئين على خط واحد، والرقم بيتصرف كسقف وأرضية في نفس الوقت. اللي بنراقبه: الإغلاق الجاي — فوق الرقم أو تحته، بالإغلاق مش باللمسة، هو اللي بيحدد مين بياخد المستوى ده.`,
      )
    }
  }

  // ---- A2) the ceiling consolidation («التجميعة عند السقف») — profit rides.
  // A flat stretch pressing the range top is the community's fuel-under-the-
  // ceiling picture: absorption above, pressure building. «ما تطاردش السهم»
  // rides here as wisdom (never an order): late entries come with the
  // documented close, not ahead of it.
  if (profitRide && ctx.consolidation !== null && ctx.nearRangeTop === true) {
    const { sessions, tightnessPct } = ctx.consolidation
    add(
      `تجميعة ${sessionsAr(sessions)} بمدى ${pctPlain(tightnessPct)} تحت السقف — من كلام المحللين اللي بيتكتب كل يوم: التجميعة عند السقف هي وقود الحركة الجاية، لأن كل جلسة استقرار عند القمة بتمتص البايعين المترددين والضغط الشرائي بيتكدس تحت الغطاء، واللي فاته الدخول من تحت ما تطاردش السهم فوق السقف — الدخول الصح بيجي مع الكسر موثّق مش قبله. اللي بنراقبه: جلسة بتكسر سقف التجميعة بإغلاق وفوليوم — كسرها بالإغلاق هو اللي بيفتح الهدف الجديد، مش اللمسة.`,
    )
  }

  // ---- A3) the bottom consolidation («التجميعة في القاع») — loss waits.
  // Sellers capitulated, but a bottom is a PROCESS («القاع بيتصنع بالتدريج»),
  // and the lift needs a collective, volume-backed push — hope is not one.
  if (lossWait && ctx.consolidation !== null && ctx.nearRangeBottom === true) {
    const { sessions, tightnessPct } = ctx.consolidation
    add(
      `السهم بيتجمع في القاع بمدى ${pctPlain(tightnessPct)} على ${sessionsAr(sessions)} — ودي صورة أهل الخبرة بيوقفوا عندها: التجميعة في القاع بتقول إن البايعين استكانوا ومفيش عرض بيسحق السعر أكتر، بس القاع بيتصنع بالتدريج مش بشمعة واحدة، والطلعة بتحتاج دفعة لمّية بفوليوم تثبت إن الطلب رجع بجد مش بشائعة. اللي بنراقبه: أول جلسة صاعدة بفوليوم أعلى من عادتها — الدفعة اللمّية دي هي اللي بتفرق بين قاع بيتصنع فعلاً وراحة قصيرة بين موجتي بيع.`,
    )
  }

  // ---- A4) the drying climb («سيولة مدّارة») — hold at the range top.
  // The 5-session volume mean is FALLING (≤ 0.7× of the 30-session baseline —
  // the context's own documented bound) while the price presses the range
  // top: the last leg of the climb ran on parked money. «الفوليوم بيكلم قبل
  // السعر» + «السحب والضخ» live here: quiet liquidity pull shows in volume
  // before price.
  if (b === "hold" && ctx.volTrend5 === "falling" && ctx.nearRangeTop === true) {
    add(
      `«الفوليوم بيكلم قبل السعر» — ودي من الدروس اللي السوق بيعلّمها ببلاش: متوسط فوليوم آخر 5 جلسات نازل (تحت ${mult1(0.7)} من متوسط 30 جلسة) والسعر ولّس واقف عند قمة مداه — يعني الطلعة الأخيرة ماشية بسيولة مدّارة، فلوس قاعدة على الشط مستنية الحسم، وده سحب سيولة هادي: السحب والضخ بيتعملوا بالفوليوم قبل ما السعر يتكلم، والاندفاع بلا فوليوم هش بطبيعته. الحذر قبل الحسم مش بعده. اللي بنراقبه: رجوع الفوليوم فوق متوسطه قبل أي تكسير جديد — ولو التذبذب اتوسع عند القمة، فالتذبذب الواسع عند القمة بيحكي عن توزيع مش عن استعداد.`,
    )
  }

  // ---- A5) the documented break — red exits, rising volume trend (≥ 1.3×,
  // the context's documented bound). A break WITH swelling volume is the
  // collective entering the move — it documents the break, not the touch:
  // «الكسر الكاذب بيصطاد العجلة», but not this kind of break. On a LIVE
  // session (2026-11-19 doctrine gate) the certainty softens: الحسم
  // بالإغلاق النهائي، مش بلحظة اللمسة.
  if (redExit && ctx.volTrend5 === "rising") {
    const certainty = opts.lastBarFinal === false
      ? "والحسم بين كسر موثق وفخ لمّي بيتكتب بالإغلاق النهائي للمستوى"
      : "ودي الحالات اللي ما بترجعش بسرعة"
    add(
      `الفوليوم بتضخم تدريجيًا على آخر 5 جلسات (فوق ${mult1(1.3)} من متوسطه) ونازل مع الكسر — في لغة أهل السوق ده دخول لمّي على الحركة، وده اللي بيوثّق الكسر مش اللمسة: «الكسر الكاذب بيصطاد العجلة»، بس الكسر اللي بيتكتب بفوليوم صاعد مش من عيلة الكسور الكاذبة، ${certainty}. اللي بنراقبه: أي ارتداد لمستوى الكسر — بفوليوم جاف يفضل فخ، ولو قفل يومي فوق المستوى ساعتها بس نعيد الحساب مع بعض.`,
    )
  }

  // ---- A6) the first injection hint («الضخ») — loss waits, rising volume
  // trend while the price still sits at its bottom: money arriving BEFORE
  // the price moves — possibly the first stone of a gradual bottom.
  if (lossWait && ctx.volTrend5 === "rising") {
    add(
      `الفوليوم بدأ يتضخم على آخر 5 جلسات (فوق ${mult1(1.3)} من متوسطه) والسهم لسه قاعد عند قاعه — دي أول علامة ضخ محتمل في لغة السوق: حد بيدفع فلوس بالهدوء والسعر لسه ما اتحركش، والقاع بيتصنع بالتدريج، والضخ الأولاني ده ممكن يكون أول طوبة فيه. اللي بنراقبه: ثبات السعر مع استمرار الفوليوم — لو الإغلاقات فضلت ماسكة المكان والفوليوم كمّل، الدفعة اللمّية ممكن تكون في الطريق، ولو الفوليوم خف تاني يبقى دي كانت رمشة مش حركة.`,
    )
  }

  return lines
}
