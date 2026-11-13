// استيراد الشمعات الناقصة — تيكرات من غير أي PriceBar نهائياً.
//
// بيطابق conventions بتاعة src/lib/market/candles.ts حرفياً:
//   • Yahoo chart `${ticker}.CA?range=1y&interval=1d` — UA متصفح، مهلة 12 ثانية
//   • ts كل شمعة = تاريخ الجلسة UTC منتصف الليل (sessions متوافقة مع باقي الصفوف)
//   • الشمعة لازم OHLC كامل — أي قيمة ناقصة أو غير منطقية بتتسقط
//   • upsert جماعي INSERT ... ON CONFLICT ("companyId","ts") بمصدر "YAHOO_CANDLES_1Y"
//     (Yahoo بيرجّع الشمعات معدّلة للتقسيمات والمزايدات — بنخزنها AS-IS بدون أي إعادة تعديل)
//   • pacing 250ms بين التيكرات — لباقة مع Yahoo
//   • retention: الاحتفاظ بآخر 380 جلسة لكل شركة
//
// الوضع الافتراضي DRY-RUN: بيجيب الداتا من Yahoo ويعرض اللي هيتخزن
// (عدد الشمعات، أول/آخر جلسة) من غير أي كتابة. --apply للكتابة الفعلية.
//
// ملاحظة ملكية (مهم): السكريبت ده لا يلمس MarketPrice نهائياً — سعر اليوم
// ملك بايپلاين TradingView scanner (sourceName "TRADINGVIEW_SCANNER")،
// أي كاتب تاني هيكونفيكت مع نفس جلسة اليوم ويبوّظ قراءة الحركة. الكتابة هنا
// على جدول PriceBar فقط.
//
// التيكرات الغائبة غالباً إما suspended (مفيش داتا على Yahoo — بتطلع NO_BARS
// ونتعامل معاها بهدوء) أو فشل fetch سابق (زي MOPCO من EGX30 — تعاد تجربته).
//
// الاستخدام:
//   node scripts/import-missing-candles.mjs                        # dry-run على القائمة الافتراضية
//   node scripts/import-missing-candles.mjs --apply                # كتابة فعلية
//   node scripts/import-missing-candles.mjs --tickers=MOPCO,QNBA   # قائمة بديلة (ممكن مع --apply)
//
// يتطلب DATABASE_URL في البيئة (PrismaClient بيقرأه مباشرة). Exit code:
// 0 لو مفيش أخطاء، 1 لو فيه ERROR (وضع --apply أو dry-run).

import { Prisma, PrismaClient } from "@prisma/client"

const db = new PrismaClient()

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
const FETCH_TIMEOUT_MS = 12_000
const PACING_MS = 250
/** الاحتفاظ بآخر N جلسة لكل شركة (نفس KEEP_SESSIONS في candles.ts). */
const KEEP_SESSIONS = 380
const SOURCE_NAME = "YAHOO_CANDLES_1Y"

// تقرير التغطية 2026-11-12 (reports/market-coverage.json): 25 تيكر بدون PriceBar.
const DEFAULT_TICKERS = [
  "AIHC", "AMPH", "CNFG", "CPC", "DOMTY", "ECCW", "EDBE", "EFOOD", "EIPC",
  "EZDK", "IBPH", "MEGM", "MESF", "MNHD", "MOPCO", "NAPR", "OPHC", "PHAE",
  "PSFL", "QNBA", "RMDT", "RMTV", "RPCO", "SBAG", "VODE",
]

// --- CLI -------------------------------------------------------------------
const args = process.argv.slice(2)
const apply = args.includes("--apply")
const tickersArg = args.find((a) => a.startsWith("--tickers="))
const tickers = tickersArg
  ? tickersArg
      .slice("--tickers=".length)
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean)
  : DEFAULT_TICKERS
if (tickers.length === 0) {
  console.error("لا يوجد تيكرات للفحص — استخدم --tickers=T1,T2 أو شغّل بدونها للقائمة الافتراضية")
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shortErr = (e) => String(e?.message || e).slice(0, 120)
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : "-")

// --- Yahoo fetch + parse (نسخة مطابقة لمنطق candles.ts) ---------------------

/** جلب + تحويل شارت تيكر واحد. يرجع null عند أي فشل شبكة/HTTP. */
async function fetchYahooChart(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.CA?range=1y&interval=1d`
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    })
    if (!res.ok) return null
    const j = await res.json()
    return j.chart ?? null
  } catch {
    return null
  }
}

/** شمعات OHLC كامل فقط (شمعة ناقصة open/high/low بتتسقط)، الطوابع متحوّلة
 * لتاريخ جلسة UTC منتصف الليل. volume=null يفضل null. مصفوفة فاضية لو
 * مفيش حاجة صالحة. */
function parseChartBars(chart) {
  const r = chart?.result?.[0]
  const ts = r?.timestamp
  const q = r?.indicators?.quote?.[0]
  const bars = []
  if (!ts || !q) return bars
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i]
    const h = q.high?.[i]
    const l = q.low?.[i]
    const c = q.close?.[i]
    // الشمعة لازم رباعية OHLC كاملة: close ناقصة/أقل من أو يساوي صفر مالهاش
    // لازمة لأي مؤشر، والصفوف الناقصة بتفسد حسابات المدى.
    if (typeof o !== "number" || typeof h !== "number" || typeof l !== "number" || typeof c !== "number") continue
    if (![o, h, l, c].every((x) => Number.isFinite(x) && x > 0)) continue
    // طوابع الجلسات اليومية — تطبيع لـ UTC midnight علشان تواريخ الجلسات
    // تتماشى مع كل صفوف PriceBar التانية.
    bars.push({
      ts: new Date(new Date(ts[i] * 1000).toISOString().slice(0, 10) + "T00:00:00Z"),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: typeof q.volume?.[i] === "number" && Number.isFinite(q.volume[i]) ? q.volume[i] : null,
    })
  }
  return bars
}

/** upsert جماعي لشمعات شركة واحدة في statement واحد (ON CONFLICT لكل صف —
 * إعادة تشغيل نفس الجلسة بتكتب فوق القيم القديمة وبتحافظ على مصدر الحقيقة).
 * الأعمدة currency (EGP) و isDemoData (false) و createdAt بياخدوا الـ DB
 * defaults؛ الـ id بيتولد في SQL لأن cuid default بيطبّقه Prisma client
 * مش الداتابيز. */
async function storeBars(companyId, bars) {
  const rows = bars.map(
    (b) =>
      Prisma.sql`(md5(random()::text), ${companyId}::text, ${b.ts}::timestamp(3), ${b.open}::double precision, ${b.high}::double precision, ${b.low}::double precision, ${b.close}::double precision, ${b.volume}::double precision, ${SOURCE_NAME}::text)`
  )
  await db.$executeRaw`
    INSERT INTO "PriceBar" ("id", "companyId", "ts", "open", "high", "low", "close", "volume", "sourceName")
    VALUES ${Prisma.join(rows)}
    ON CONFLICT ("companyId", "ts") DO UPDATE SET
      "open" = EXCLUDED."open",
      "high" = EXCLUDED."high",
      "low" = EXCLUDED."low",
      "close" = EXCLUDED."close",
      "volume" = EXCLUDED."volume",
      "sourceName" = EXCLUDED."sourceName"
  `
}

/** retention: الاحتفاظ بآخر KEEP_SESSIONS جلسة لكل شركة (الصفوف unique على
 * (companyId, ts) فمفيش تعارض في الترتيب). */
async function pruneOldSessions(companyId) {
  const boundary = await db.priceBar.findMany({
    where: { companyId },
    orderBy: { ts: "desc" },
    skip: KEEP_SESSIONS,
    take: 1,
    select: { ts: true },
  })
  if (boundary.length === 0) return 0
  const r = await db.priceBar.deleteMany({ where: { companyId, ts: { lte: boundary[0].ts } } })
  return r.count
}

// --- الحلقة الرئيسية ---------------------------------------------------------

let mode
if (apply) mode = "APPLY — الكتابة على PriceBar مفعّلة"
else mode = "DRY-RUN — عرض فقط، لن يُكتب شيء على الداتابيز"
console.log(`وضع التشغيل: ${mode}`)
console.log(`التيكرات (${tickers.length}): ${tickers.join(", ")}`)
console.log("ملكية MarketPrice: لا يُكتب عليه نهائياً — مصدره TradingView scanner فقط.\n")

const companies = await db.company.findMany({
  where: { ticker: { in: tickers } },
  select: { id: true, ticker: true, nameAr: true, listingStatus: true },
})
const byTicker = new Map(companies.map((c) => [c.ticker, c]))

const results = []
for (let i = 0; i < tickers.length; i++) {
  const ticker = tickers[i]
  if (i > 0) await sleep(PACING_MS)

  const co = byTicker.get(ticker)
  if (!co) {
    results.push({ ticker, status: "SKIPPED", bars: 0, note: "مش موجود في جدول Company" })
    continue
  }
  // نفس فلتر ingest الرسمي: DELISTED مش هدف للاستيراد.
  if (co.listingStatus === "DELISTED") {
    results.push({ ticker, status: "SKIPPED", bars: 0, note: "listingStatus=DELISTED" })
    continue
  }

  // إعادة محاولة واحدة عند فشل الـ fetch (الخطأ الشائع: 429/انقطاع شبكة).
  let chart = await fetchYahooChart(ticker)
  if (!chart) {
    await sleep(500)
    chart = await fetchYahooChart(ticker)
  }
  if (!chart) {
    results.push({ ticker, status: "ERROR", bars: 0, note: "FETCH_FAILED (بعد إعادة المحاولة)" })
    continue
  }

  const bars = parseChartBars(chart)
  if (bars.length === 0) {
    // غالباً شركة موقوفة بدون بيانات على Yahoo — نتعامل معاها بهدوء.
    results.push({ ticker, status: "NO_BARS", bars: 0, note: "مفيش شمعات صالحة على Yahoo" })
    continue
  }

  const first = bars[0].ts
  const last = bars[bars.length - 1].ts
  if (!apply) {
    results.push({ ticker, status: "STORED_DRY", bars: bars.length, first, last, note: "dry-run — لن يُكتب شيء" })
    continue
  }

  try {
    await storeBars(co.id, bars)
    const pruned = await pruneOldSessions(co.id)
    results.push({
      ticker,
      status: "STORED",
      bars: bars.length,
      first,
      last,
      note: pruned > 0 ? `خُزّنت (retention حذف ${pruned})` : "خُزّنت",
      nameAr: co.nameAr,
    })
  } catch (e) {
    results.push({ ticker, status: "ERROR", bars: bars.length, first, last, note: `STORE_FAILED: ${shortErr(e)}` })
  }
}

await db.$disconnect()

// --- جدول الملخص -------------------------------------------------------------
const pad = (s, n) => String(s).slice(0, n).padEnd(n)
console.log("")
console.log("الملخص:")
console.log(
  `${pad("TICKER", 7)} ${pad("STATUS", 12)} ${pad("BARS", 7)} ${pad("FIRST", 12)} ${pad("LAST", 12)} NOTE`
)
const counts = { STORED: 0, STORED_DRY: 0, SKIPPED: 0, NO_BARS: 0, ERROR: 0 }
for (const r of results) {
  counts[r.status] = (counts[r.status] || 0) + 1
  console.log(
    `${pad(r.ticker, 7)} ${pad(r.status, 12)} ${pad(r.bars, 7)} ${pad(day(r.first), 12)} ${pad(day(r.last), 12)} ${r.note}`
  )
}
console.log("")
console.log(
  `الإجمالي: stored=${counts.STORED} dry=${counts.STORED_DRY} skipped=${counts.SKIPPED} no-bars=${counts.NO_BARS} error=${counts.ERROR}`
)
if (counts.ERROR > 0) process.exit(1)
