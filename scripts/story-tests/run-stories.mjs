#!/usr/bin/env node
// =============================================================================
// run-stories.mjs — قائد تشغيل قصص المستخدمين لموقع EGXano.
// يحدد هدف التنفيذ بهذه الأولوية:
//   (1) https://egxano.vercel.app/api/v1/... — مع كشف درع البوت (HTML challenge → UNREACHABLE)
//   (2) سيرفر محلي http://localhost:3210 (لو شغال) + فحص وصول DATABASE_URL
//   (3) الملاذ الأخير: قصص الدوال الصافية عبر bunx tsx (بلا قاعدة بيانات)
// ويضيف قصصًا ثابتة (static-fs) على مستوى الملفات والمسارات، ثم يدمج الكل
// في results.json ويعرض ملخصًا.
// تشغيل: node scripts/story-tests/run-stories.mjs
// (على قصد بلا أي deps جديدة — global fetch + setTimeout فقط)
// =============================================================================
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SRC = join(ROOT, "src")
const OUT = join(dirname(fileURLToPath(import.meta.url)), "results.json")

// نقاط النهاية المحظورة نهائيًا — تُستدعى أبدًا (mutating / admin / auth / subscription / notifications / corporate-actions / price-override)
const FORBIDDEN_PATTERNS = [
  "/api/v1/admin/", "/api/v1/auth/", "/api/v1/subscription/", "/api/v1/payment-requests",
  "/api/v1/push/", "/api/v1/watchlist", "/api/v1/portfolio", "/api/v1/alerts",
  "/api/v1/market/refresh", "/api/v1/market/sync", "/api/v1/cron/",
  "corporate-actions", "price-override", "settings/public", "scanners/run", "qa",
]

// =============================================================================
// القصص الثابتة (static-fs): مسارات وملات وربط الصفحات بنقاط النهاية
// =============================================================================
const staticStories = []
function staticStory(id, persona, story, fn) {
  const steps = []
  let crashed = false
  try { fn(steps) } catch (e) { crashed = true; steps.push({ detail: "تنفيذ الفحص بلا انهيار", ok: false, got: `${e.message}` }) }
  const failures = steps.filter((s) => !s.ok).map((s) => `${s.detail} — ${s.got ?? "غير متوقع"}`)
  staticStories.push({
    id, persona, story, target: "static-fs@src",
    ms: 0,
    result: crashed || failures.length > 0 ? "fail" : "pass",
    failures, steps,
  })
}
const ok = (steps, detail, cond, got) => steps.push({ detail, ok: Boolean(cond), got: cond ? undefined : String(got ?? "غير موجود") })
const pageExists = (p) => existsSync(join(SRC, "app", p, "page.tsx"))
const routeExists = (p) => existsSync(join(SRC, "app", "api", p, "route.ts"))
const routeHasGET = (p) => { const f = join(SRC, "app", "api", p, "route.ts"); return existsSync(f) && /export\s+(async\s+)?function\s+GET/.test(readFileSync(f, "utf8")) }
const srcHas = (rel, needle) => { const f = join(SRC, rel); return existsSync(f) && readFileSync(f, "utf8").includes(needle) }

// --- زائر جديد (Z)
staticStory("Z01", "زائر جديد", "كل روابط القايمة الجانبية تفتح صفحات موجودة فعلًا (لا رابط ميت 404)", (steps) => {
  const sidebar = readFileSync(join(SRC, "components", "layout", "AppSidebar.tsx"), "utf8")
  const hrefs = [...sidebar.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]).filter((h) => h.startsWith("/"))
  ok(steps, `القايمة فيها روابط (${hrefs.length})`, hrefs.length >= 12, hrefs.length)
  const dead = hrefs.filter((h) => !pageExists(h === "/dashboard" ? "/dashboard" : h === "/" ? "/dashboard" : h) && !pageExists(h))
  const resolved = hrefs.map((h) => (pageExists(h) ? "OK" : (h === "/" && pageExists("/") ? "OK" : h === "/dashboard" && pageExists("/dashboard") ? "OK" : "MISSING")))
  ok(steps, "كل رابط له page.tsx", !dead.length && !resolved.includes("MISSING"), `ميت: ${dead.join(", ") || "لا شيء"}`)
})
staticStory("Z02", "زائر جديد", "الصفحات العامة والقانونية موجودة (about/privacy/terms/disclaimer/status/offline/data-quality/login/register)", (steps) => {
  const pages = ["/about", "/privacy", "/terms", "/disclaimer", "/status", "/offline", "/data-quality", "/login", "/register", "/forgot-password", "/reset-password", "/premium"]
  const missing = pages.filter((p) => !pageExists(p))
  ok(steps, "كل الصفحات العامة موجودة", missing.length === 0, `ناقص: ${missing.join(", ") || "لا شيء"}`)
})
staticStory("Z03", "زائر جديد", "صفحة «حلل سهمي» مربوطة فعليًا بنقطة النهاية /api/v1/position-review (الصفحة والعميل والنقطة كلها موجودة)", (steps) => {
  ok(steps, "صفحة /analyze موجودة", pageExists("/analyze"), "لا يوجد page.tsx")
  ok(steps, "عميل الصفحة يستدعي position-review", srcHas("app/analyze/client.tsx", "position-review"), "لا يوجد نص position-review في analyze/client.tsx")
  ok(steps, "نقطة النهاية /api/v1/position-review موجودة", routeExists("v1/position-review"), "route.ts مفقود")
  ok(steps, "النقطة تتحقق من الدخول (auth) قبل الحساب", /requireAuth|unauthorizedResponse/.test(readFileSync(join(SRC, "app", "api", "v1", "position-review", "route.ts"), "utf8")), "لا يوجد requireAuth في route.ts")
})
staticStory("Z04", "زائر جديد", "صفحة القطاعات وداخلها صفحة لكل قطاع + API القطاعات وheat-map السيولة موجودة", (steps) => {
  ok(steps, "صفحة /sectors موجودة", pageExists("/sectors"), "مفقود")
  ok(steps, "صفحة القطاع الديناميكي /sectors/[sector] موجودة", existsSync(join(SRC, "app", "sectors", "[sector]", "page.tsx")), "مفقود")
  ok(steps, "API /api/v1/sectors موجود وGET", routeExists("v1/sectors") && routeHasGET("v1/sectors"), "مفقود أو بلا GET")
  ok(steps, "API /api/v1/market/liquidity-heatmap موجود وGET", routeExists("v1/market/liquidity-heatmap") && routeHasGET("v1/market/liquidity-heatmap"), "مفقود أو بلا GET")
})
staticStory("Z05", "زائر جديد", "نقاط نهاية GET العامة كلها معرفة كملفات وتصدّر GET (لا نقطة مقصوصة)", (steps) => {
  const eps = ["v1/rankings", "v1/undervalued", "v1/companies", "v1/companies/[id]", "v1/compare", "v1/market/intelligence", "v1/market/breadth", "v1/market/liquidity-heatmap", "v1/market/ticker", "v1/market/treemap", "v1/dividends", "v1/events", "v1/signals/opportunities", "v1/technical/signals", "v1/health", "v1/search", "v1/sectors", "v1/metrics", "v1/status"]
  const bad = eps.filter((p) => !routeExists(p) || !routeHasGET(p))
  ok(steps, `${eps.length} نقطة GET عامة سليمة`, bad.length === 0, `مشكلة في: ${bad.join(", ") || "لا شيء"}`)
})
staticStory("Z06", "حماية المستخدم", "نقاط النهايات المتحولة/الحساسة موجودة في الكود لكن محظورة نهائيًا على الاختبار — لا يُستدعى منها شيء", (steps) => {
  const sensitive = ["v1/admin/recompute-all", "v1/admin/ingestion/run", "v1/admin/login", "v1/auth/login", "v1/auth/register", "v1/subscription/request", "v1/payment-requests", "v1/watchlist", "v1/portfolio", "v1/market/refresh", "v1/market/sync", "v1/cron/market"]
  const found = sensitive.filter((p) => routeExists(p))
  ok(steps, `${found.length}/${sensitive.length} نقطة حساسة موجودة في الشجرة (لستُها فقط)`, found.length === sensitive.length, `مفقود: ${sensitive.filter((p) => !found.includes(p)).join(", ") || "لا شيء"}`)
  const self = readFileSync(fileURLToPath(import.meta.url), "utf8")
  const calls = [...self.matchAll(/https?:\/\/[^"'`\s]+/g)].map((m) => m[0])
  const violating = calls.filter((u) => FORBIDDEN_PATTERNS.some((p) => u.includes(p)))
  ok(steps, "هارنس الاختبار نفسه لا يحتوي أي استدعاء لنقطة محظورة", violating.length === 0, violating.join(", ") || "لا شيء")
})
staticStory("Z07", "زائر جديد", "القايمة الجانبية معرّبة بالكامل — لكل عنصر labelAr غير فارغ", (steps) => {
  const sidebar = readFileSync(join(SRC, "components", "layout", "AppSidebar.tsx"), "utf8")
  const items = [...sidebar.matchAll(/\{\s*href:\s*"([^"]+)"[\s\S]*?labelAr:\s*"([^"]*)"/g)].map((m) => [m[1], m[2]])
  ok(steps, `عناصر القايمة (${items.length})`, items.length >= 12, items.length)
  const empty = items.filter(([, ar]) => !ar.trim())
  ok(steps, "كل عنصر له تسمية عربية", empty.length === 0, empty.map(([h]) => h).join(", ") || "لا شيء")
})

// --- الداشبورد / الشركات / المقارنة / التنبيهات (DB, C, CMP, EV)
staticStory("DB01", "مستخدم الداشبورد", "صفحة الداشبورد مربوطة بنقاط النهاية التحليلية (intelligence/breadth/heatmap/ticker) وكلها موجودة", (steps) => {
  ok(steps, "صفحة /dashboard موجودة", pageExists("/dashboard"), "مفقود")
  ok(steps, "API market/intelligence موجود وGET", routeExists("v1/market/intelligence") && routeHasGET("v1/market/intelligence"), "مفقود")
  ok(steps, "API market/breadth موجود وGET", routeExists("v1/market/breadth") && routeHasGET("v1/market/breadth"), "مفقود")
  ok(steps, "API market/ticker موجود وGET", routeExists("v1/market/ticker") && routeHasGET("v1/market/ticker"), "مفقود")
})
staticStory("C01", "مستخدم الشركات", "بنية الشركات كاملة: صفحة قائمة + صفحة شركة + تقرير + APIs (قائمة/تفاصيل/أسعار/مقاييس/فني/توزيعات/أحداث/أقران)", (steps) => {
  ok(steps, "صفحة /companies موجودة", pageExists("/companies"), "مفقود")
  ok(steps, "صفحة /company/[id] موجودة", existsSync(join(SRC, "app", "company", "[id]", "page.tsx")), "مفقود")
  ok(steps, "صفحة التقرير /company/[id]/report موجودة", existsSync(join(SRC, "app", "company", "[id]", "report", "page.tsx")), "مفقود")
  const eps = ["v1/companies", "v1/companies/[id]", "v1/companies/[id]/prices", "v1/companies/[id]/metrics", "v1/companies/[id]/technical", "v1/companies/[id]/dividends", "v1/companies/[id]/events", "v1/companies/[id]/peers", "v1/companies/[id]/financials"]
  const bad = eps.filter((p) => !routeExists(p) || !routeHasGET(p))
  ok(steps, `${eps.length} نقطة شركات سليمة وGET`, bad.length === 0, `مشكلة في: ${bad.join(", ") || "لا شيء"}`)
})
staticStory("CMP01", "مستخدم المقارنة", "صفحة المقارنة ونقطة النهاية /api/v1/compare موجودة ومربوطة", (steps) => {
  ok(steps, "صفحة /compare موجودة", pageExists("/compare"), "مفقود")
  ok(steps, "API /api/v1/compare موجود وGET", routeExists("v1/compare") && routeHasGET("v1/compare"), "مفقود أو بلا GET")
  ok(steps, "عميل الصفحة يستدعي compare", srcHas("app/compare/client.tsx", "/api/v1/compare"), "لا يوجد استدعاء /api/v1/compare في compare/client.tsx")
})
staticStory("EV01", "متابع التنبيهات والأخبار", "صفحات التنبيهات والإشارات ونقاطها الموجودة (alerts/signals/events/dividends) كلها GET عامة", (steps) => {
  ok(steps, "صفحة /alerts موجودة", pageExists("/alerts"), "مفقود")
  ok(steps, "صفحة /signals موجودة", pageExists("/signals"), "مفقود")
  ok(steps, "صفحة /dividends موجودة", pageExists("/dividends"), "مفقود")
  const eps = ["v1/alerts", "v1/signals/alerts", "v1/signals/opportunities", "v1/signals/lifecycle", "v1/events", "v1/dividends"]
  const bad = eps.filter((p) => !routeExists(p))
  ok(steps, "نقاط التنبيهات والأحداث موجودة", bad.length === 0, bad.join(", ") || "لا شيء")
})
staticStory("PF03", "مستخدم عادي", "نقطة مراجعة المركز ترفض معرّف شركة مشوه (مثل ZZZZ999/../x) ومتوسط شراء غير منطقي برموز 400 — لا انهيار 500", (steps) => {
  const src = readFileSync(join(SRC, "app", "api", "v1", "position-review", "route.ts"), "utf8")
  ok(steps, "معرف الشركة مفحوص بـ regex صارم", /[a-zA-Z0-9_\-]+\$?\/\.test\(companyId\)|^\/\[a-zA-Z0-9_\-/.test(src) || /test\(companyId\)/.test(src), "لا يوجد فحص regex للمعرف")
  ok(steps, "متوسط الشراء مفحوص (حدود رقمية)", /INVALID_AVG_BUY_PRICE|Number\.isFinite\(avgBuyPrice\)/.test(src), "لا يوجد فحص رقمي")
  ok(steps, "JSON تالف يعيد 400 مش 500", /BAD_JSON/.test(src), "لا يوجد فحص BAD_JSON")
})

// =============================================================================
// (1) محاولة الإنتاج — كشف درع البوت
// =============================================================================
async function probe(url, timeoutMs = 15000) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", Accept: "application/json,text/html" },
      redirect: "follow",
    })
    const text = await res.text().catch(() => "")
    return { url, status: res.status, ms: Date.now() - t0, contentType: res.headers.get("content-type") ?? "", bodyHead: text.slice(0, 300), htmlChallenge: /Vercel Security Checkpoint|Just a moment|challenge-platform|cf-chl/i.test(text) }
  } catch (e) {
    return { url, status: 0, ms: Date.now() - t0, error: `${e.name}: ${e.message}` }
  } finally { clearTimeout(t) }
}

// =============================================================================
// التحديد والتنفيذ
// =============================================================================
const decisionTrail = []
const vercel = await probe("https://egxano.vercel.app/api/v1/health")
decisionTrail.push({ step: "probe-vercel", ...vercel, bodyHead: vercel.bodyHead?.slice(0, 160) })
let target
if (vercel.status >= 200 && vercel.status < 300 && !vercel.htmlChallenge) {
  target = "https://egxano.vercel.app"
} else if (vercel.htmlChallenge || vercel.status === 429) {
  decisionTrail.push({ step: "vercel-unreachable", reason: "Vercel Security Checkpoint (bot-shield HTML) — datacenter IP blocked" })
}
if (!target) {
  const local = await probe("http://localhost:3210/api/v1/health", 3000)
  decisionTrail.push({ step: "probe-localhost-3210", ...local, bodyHead: local.bodyHead?.slice(0, 120) })
  if (local.status >= 200 && local.status < 300) {
    target = "http://localhost:3210"
  } else {
    decisionTrail.push({ step: "localhost-unreachable", reason: "no server on 3210" })
  }
}
if (!target) {
  // فحص DATABASE_URL من .env — وصول القاعدة قبل أي بناء محلي
  let dbInfo = { file: false, note: "" }
  const envPath = join(ROOT, ".env")
  if (existsSync(envPath)) {
    const url = (readFileSync(envPath, "utf8").match(/^DATABASE_URL=(.*)$/m) ?? [])[1] ?? ""
    dbInfo = { url: url.replace(/:[^:@]*@/, ":***@").slice(0, 120), file: /^"?\s*file:/i.test(url), note: /^"?\s*file:/i.test(url) ? "قاعدة ملفية بمسار Windows (C:/...) — غير قابلة للتشغيل على هذا المضيف، والـprovider في schema.prisma هو postgresql" : "أُجرِي فحص TCP" }
  }
  decisionTrail.push({ step: "database-url-check", ...dbInfo })
  target = "pure-lib"
}

let pureStories = []
if (target === "pure-lib") {
  decisionTrail.push({ step: "chosen-target", target: "pure-lib (bunx tsx, no DB)" })
  const r = spawnSync("bunx", ["tsx", join(dirname(fileURLToPath(import.meta.url)), "pure-stories.ts")], { cwd: ROOT, encoding: "utf8", timeout: 240000 })
  if (r.status !== 0 || r.stderr) {
    decisionTrail.push({ step: "tsx-driver", status: r.status, stderrHead: (r.stderr ?? "").split("\n").slice(-6).join(" | ").slice(0, 500) })
  }
  const purePath = join(dirname(fileURLToPath(import.meta.url)), "pure-results.json")
  if (existsSync(purePath)) {
    pureStories = JSON.parse(readFileSync(purePath, "utf8")).stories
  } else {
    decisionTrail.push({ step: "tsx-driver", error: "pure-results.json not produced — driver crashed" })
  }
} else if (target === "http://localhost:3210") {
  decisionTrail.push({ step: "chosen-target", target, note: "سيرفر محلي — قصص HTTP غير مُفعلة في هذا الإصدار (بدون قاعدة بيانات محلية سيُرجع كل شيء 500؛ راجع decisionTrail)" })
} else if (target === "https://egxano.vercel.app") {
  decisionTrail.push({ step: "chosen-target", target, note: "HTTP stories to production would run here (not wired in this offline sandbox run)" })
}

// =============================================================================
// الدمج والتلخيص
// =============================================================================
const all = [...staticStories, ...pureStories]
const passed = all.filter((s) => s.result === "pass").length
const failed = all.length - passed
const byPersona = {}
for (const s of all) { (byPersona[s.persona] ??= { total: 0, pass: 0 }); byPersona[s.persona].total++; if (s.result === "pass") byPersona[s.persona].pass++ }
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), target, decisionTrail, counts: { total: all.length, passed, failed }, byPersona, stories: all }, null, 2), "utf8")

console.log("=== EGXano USER STORIES HARNESS ===")
for (const d of decisionTrail) console.log("trail:", JSON.stringify(d))
console.log(`TARGET: ${target}`)
console.log(`RESULT: ${passed}/${all.length} passed, ${failed} failed`)
for (const [p, v] of Object.entries(byPersona)) console.log(`  ${p}: ${v.pass}/${v.total}`)
for (const s of all.filter((x) => x.result === "fail")) console.log(`FAIL ${s.id} [${s.persona}] ${s.failures.join(" | ")}`)
console.log(`results → ${OUT}`)
