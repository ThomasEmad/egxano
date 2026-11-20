// Admin operations runner — executes whitelisted data jobs and keeps a
// persistent journal + per-run log files.
//
// Security model:
//   • only the fixed WHITELIST below is runnable — no arbitrary commands.
//   • every caller must already be authenticated as admin (checked in the API
//     route; this module never reads cookies itself).
//   • at most ONE data job runs at a time (they all mutate the same database —
//     concurrent runs would race each other).
//
// Execution planes (owner bug report 2026-11-20: no ops job ever reflected on
// the production database from egxano.vercel.app):
//   • SELF-HOSTED (Docker/standalone, writable FS): spawn the .mjs script as a
//     background child of the server — exactly the historical behavior.
//   • SERVERLESS (Vercel): a lambda cannot host a 5-45 min child process, and
//     the data sources (Yahoo/TradingView) BLOCK Vercel egress entirely
//     (verified 2026-11-13 in candles-refresh.yml). The heavy jobs therefore
//     run on a GitHub Actions runner via workflow_dispatch (ops-job.yml) — the
//     same plane candles-refresh has used successfully — writing straight to
//     the production DB with the repo's secrets. Run status/logs are pulled
//     from the Actions API so the page shows real progress, not a lost pid.
//
// The journal lives in reports/admin-ops-journal.json so self-hosted run
// history survives server restarts; liveness of a pid is re-checked with
// process.kill(pid, 0).
//
// This module MUST run in Node.js runtime (not Edge) because it uses
// Node.js filesystem APIs and child_process.spawn.
export const runtime = 'nodejs'

import { spawn } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync, existsSync, openSync, unlinkSync } from "node:fs"
import os from "node:os"
import path from "node:path"

// The standalone server chdirs to .next/standalone (server.js does
// process.chdir(__dirname)), so the project root must come from the launcher
// via EGX_ROOT — otherwise journal/log paths and script cwds would land inside
// the build output and be wiped on the next rebuild.
const ROOT = process.env.EGX_ROOT || process.cwd()

// -----------------------------------------------------------------------------
// Hosting probe: on serverless the deployment root is READ-ONLY, so journal/log
// writes fail at startJob time. Probe for a writable root and fall back to
// /tmp — the child's cwd (and EGX_ROOT) point there, so every relative
// `reports/…` artifact lands somewhere writable. Self-hosted (Docker/
// standalone): ROOT stays writable → identical behavior as always.
// -----------------------------------------------------------------------------
export interface OpsHosting {
  serverless: boolean
  fsWritable: boolean
  /** where the child's cwd + journal + logs live (basename only) */
  workRoot: string
}

let _probe: { root: string; fsWritable: boolean } | null = null

function writableRoot(): { root: string; fsWritable: boolean } {
  if (_probe) return _probe
  const candidates = [ROOT, path.join(os.tmpdir(), "egx-ops")]
  for (const cand of candidates) {
    try {
      const dir = path.join(cand, "reports")
      mkdirSync(dir, { recursive: true })
      const probe = path.join(dir, ".writable-probe")
      writeFileSync(probe, "1", "utf8")
      unlinkSync(probe)
      _probe = { root: cand, fsWritable: cand === ROOT }
      return _probe
    } catch {
      // read-only (Vercel) — try the next candidate
    }
  }
  // os.tmpdir() is always writable on every supported runtime; unreachable in practice
  _probe = { root: candidates[candidates.length - 1], fsWritable: false }
  return _probe
}

const PROBE = writableRoot()
const ROOT_WRITABLE = PROBE.fsWritable
const IS_SERVERLESS = !ROOT_WRITABLE || process.env.VERCEL === "1"

/** Hosting mode of the current server process — surfaced to the admin UI. */
export function opsHosting(): OpsHosting {
  return {
    serverless: IS_SERVERLESS,
    fsWritable: ROOT_WRITABLE,
    workRoot: path.basename(PROBE.root),
  }
}

const LOG_DIR = path.join(PROBE.root, "reports", "admin-ops-logs")
const JOURNAL = path.join(PROBE.root, "reports", "admin-ops-journal.json")

export interface WhitelistEntry {
  key: string
  script: string
  args: string[]
  destructive: boolean
  labelEn: string
  labelAr: string
  descEn: string
  descAr: string
}

export const WHITELIST: WhitelistEntry[] = [
  {
    key: "askborsa_plan",
    script: "scripts/askborsa-sync.mjs",
    args: [],
    destructive: false,
    labelEn: "AskBorsa import — plan (dry run)",
    labelAr: "استيراد AskBorsa — تخطيط (بدون كتابة)",
    descEn: "Harvests all company pages from askborsa.com and builds the import plan. Writes nothing to the database.",
    descAr: "يجمع كل صفحات الشركات من askborsa.com ويبني خطة الاستيراد — لا يكتب أي شيء في قاعدة البيانات.",
  },
  {
    key: "askborsa_apply",
    script: "scripts/askborsa-sync.mjs",
    args: ["--apply", "--recompute"],
    destructive: true,
    labelEn: "AskBorsa import — apply",
    labelAr: "استيراد AskBorsa — تنفيذ",
    descEn: "Runs the same pipeline and WRITES: creates missing reports, fills empty slots only (never overwrites), rollback file + audit log, then recomputes derived metrics. Takes ~8-15 minutes.",
    descAr: "يستورد الفترات الناقصة فقط (لا يعدّل أي قيمة موجودة) مع ملف تراجع وسجل تدقيق، ثم يعيد بناء كل الحسابات. يستغرق 8-15 دقيقة.",
  },
  {
    key: "askborsa_rollback",
    script: "scripts/askborsa-sync.mjs",
    args: ["--rollback"],
    destructive: true,
    labelEn: "AskBorsa import — undo last apply",
    labelAr: "استيراد AskBorsa — تراجع عن آخر تنفيذ",
    descEn: "Reverts the last AskBorsa apply using its rollback file (values + created reports).",
    descAr: "يرجع كل ما أضافه آخر تنفيذ للاستيراد باستخدام ملف التراجع (القيم والتقارير الجديدة).",
  },
  {
    key: "purge_plan",
    script: "scripts/purge-imputed-values.mjs",
    args: [],
    destructive: false,
    labelEn: "Imputed values purge — plan (dry run)",
    labelAr: "تنقية القيم المخترعة — تخطيط (بدون كتابة)",
    descEn: "Counts carry-forward copies, fabricated templates, annual-copy quarters, cross-quarter duplicates and zero placeholders. Writes nothing.",
    descAr: "يعدّ القيم المنسوخة/المصطنعة (نسخ الربع السابق، القوالب، نسخ السنوي، الأصفار البديلة) — بدون أي كتابة.",
  },
  {
    key: "purge_apply",
    script: "scripts/purge-imputed-values.mjs",
    args: ["--apply"],
    destructive: true,
    labelEn: "Imputed values purge — apply",
    labelAr: "تنقية القيم المخترعة — تنفيذ",
    descEn: "Deletes the imputed/non-observed values (with DB backup + full rollback file + audit log) so AskBorsa can re-import real data into the freed slots.",
    descAr: "يحذف القيم المخترعة (مع نسخة احتياطية من القاعدة وملف تراجع كامل) حتى يستوردها السكريبت الحقيقي من جديد.",
  },
  {
    key: "purge_rollback",
    script: "scripts/purge-imputed-values.mjs",
    args: ["--rollback"],
    destructive: true,
    labelEn: "Imputed values purge — undo last apply",
    labelAr: "تنقية القيم المخترعة — تراجع",
    descEn: "Restores the values and empty reports removed by the last purge apply, verbatim.",
    descAr: "يرجع كل قيمة وتقرير حذفه آخر تنفيذ للتنقية حرفيًا كما كان.",
  },
  {
    key: "audit_run",
    script: "scripts/admin-audit-job.mjs",
    args: [],
    destructive: false,
    labelEn: "Integrity audit — run now",
    labelAr: "تدقيق سلامة البيانات — تشغيل الآن",
    descEn: "Runs the full integrity audit engine over all active companies (balance-sheet identity, TTM coherence, cross-period coherence, provenance, coverage, pricing sanity), records an AuditRun with issues + confidence scores. Results appear in Admin → Data quality. Takes a few minutes.",
    descAr: "تشغيل محرك التدقيق الكامل على كل الشركات (توازن الميزانية، تماسك الفترات، المصادر، التغطية، أسعار السوق) — النتائج والملاحظات تظهر في صفحة جودة البيانات. يستغرق دقائق.",
  },
  {
    key: "recompute_all",
    script: "scripts/admin-recompute-job.mjs",
    args: [],
    destructive: false,
    labelEn: "Recompute all metrics — run now",
    labelAr: "إعادة حساب كل المقاييس — تشغيل الآن",
    descEn: "Re-runs the calculation + event engines for every active company (after formula upgrades or bulk fixes) and refreshes the scanner/dashboard caches. Read-only for source values. Takes a few minutes.",
    descAr: "يعيد تشغيل محركات الحساب والأحداث على كل الشركات (بعد تعديل معادلة أو إصلاح بالجملة) ويحدّث كاش السكانر ولوحة القيادة. لا يعدّل القيم المصدرية. يستغرق دقائق.",
  },
  {
    key: "tv_harvest",
    script: "scripts/tradingview-financials-import.mjs",
    args: ["--harvest-only", "--workers=2", "--delay-ms=3500"],
    destructive: false,
    labelEn: "TradingView harvest — collect statements",
    labelAr: "حصاد TradingView — جمع القوائم",
    descEn: "Harvests income/balance/cash-flow statements from TradingView's public symbol pages for every company not yet harvested (resume-aware, polite pacing, auto-cooldown on rate limits). Writes nothing to the database. Auto-stops after 45 minutes — run again to continue where it left off.",
    descAr: "يجمع قوائم الدخل والميزانية والتدفقات النقدية من صفحات الشركات العامة على TradingView لكل شركة لم تُجمع بعد (يستكمل من حيث توقف ويهدأ تلقائياً عند الحظر). لا يكتب في قاعدة البيانات. يتوقف تلقائياً بعد 45 دقيقة — أعد تشغيله للمتابعة من نفس المكان.",
  },
  {
    key: "tv_plan",
    script: "scripts/tradingview-financials-import.mjs",
    args: ["--from-snapshot"],
    destructive: false,
    labelEn: "TradingView import — plan (dry run)",
    labelAr: "استيراد TradingView — تخطيط (بدون كتابة)",
    descEn: "Classifies and validates the harvested snapshot against the database (conflicts, quarter sum-checks, period identity) and prints the import plan. Writes nothing.",
    descAr: "يصنّف ويتحقق من البيانات المجمّعة مقابل قاعدة البيانات (تعارضات، تحقق مجاميع الأرباع، مطابقة الفترات) ويعرض خطة الاستيراد — بدون أي كتابة.",
  },
  {
    key: "tv_apply",
    script: "scripts/tradingview-financials-import.mjs",
    args: ["--from-snapshot", "--apply", "--recompute"],
    destructive: true,
    labelEn: "TradingView import — apply + recompute",
    labelAr: "استيراد TradingView — تنفيذ + إعادة حساب",
    descEn: "Writes the validated plan: creates missing reports, fills empty slots only (never overwrites), rollback file + audit log, then recomputes all derived metrics.",
    descAr: "يكتب الخطة المتحقق منها: ينشئ التقارير الناقصة ويملأ الخانات الفارغة فقط (لا يعدّل أي قيمة موجودة) مع ملف تراجع وسجل تدقيق، ثم يعيد بناء كل الحسابات المشتقة.",
  },
  {
    key: "tv_rollback",
    script: "scripts/tradingview-financials-import.mjs",
    args: ["--rollback"],
    destructive: true,
    labelEn: "TradingView import — undo last apply",
    labelAr: "استيراد TradingView — تراجع عن آخر تنفيذ",
    descEn: "Reverts the last TradingView apply using its rollback file (values + created reports).",
    descAr: "يرجع كل ما أضافه آخر تنفيذ لاستيراد TradingView باستخدام ملف التراجع (القيم والتقارير الجديدة).",
  },
  {
    key: "dividends_plan",
    script: "scripts/dividends-import.mjs",
    args: [],
    destructive: false,
    labelEn: "Dividends import — plan (dry run)",
    labelAr: "استيراد التوزيعات — تخطيط (بدون كتابة)",
    descEn: "Harvests dividend history from Yahoo (TICKER.CA chart events) + official EGX disclosures via FoudaLens (recent window + upcoming) and prints the classification plan. Writes nothing.",
    descAr: "يجمع تاريخ التوزيعات من Yahoo + الإفصاحات الرسمية للبورصة عبر FoudaLens (النافذة الحديثة والقادمة) ويعرض خطة التصنيف — بدون أي كتابة.",
  },
  {
    key: "dividends_apply",
    script: "scripts/dividends-import.mjs",
    args: ["--apply", "--recompute"],
    destructive: true,
    labelEn: "Dividends import — apply + recompute",
    labelAr: "استيراد التوزيعات — تنفيذ + إعادة حساب",
    descEn: "Writes MISSING dividend rows only (never edits existing rows) with a rollback journal + audit log, then recomputes derived metrics. Run 'Dividends enrich' afterwards to fill entitlement dates and per-distribution yields.",
    descAr: "يكتب صفوف التوزيعات الناقصة فقط (لا يعدّل أي صف موجود) مع ملف تراجع وسجل تدقيق، ثم يعيد بناء الحسابات المشتقة. شغّل «إثراء التوزيعات» بعده لتعبئة تواريخ الاستحقاق والعائد لكل توزيع.",
  },
  {
    key: "dividends_enrich",
    script: "scripts/dividends-enrich.mjs",
    args: ["--apply", "--max-seconds=2400"],
    destructive: true,
    labelEn: "Dividends enrich — entitlement dates + per-distribution yields",
    labelAr: "إثراء التوزيعات — تواريخ الاستحقاق والعائد لكل توزيع",
    descEn: "Backfills تاريخ الاستحقاق (eligibility date) and the per-distribution yield for every dividend row: derives eligibility as the last trading day before the ex-date (EGX convention), adopts missing ex-dates from official disclosures/Yahoo events, and computes DPS ÷ last cum-dividend close for each distribution (implausible yields >30% are flagged for review). Resumable; caches Yahoo price history under reports/dividends-enrich-charts.",
    descAr: "يعبّئ تاريخ الاستحقاق والعائد لكل توزيع لكل صف: يشتق الاستحقاق كآخر يوم تداول قبل تاريخ الإكس (اصطلاح البورصة المصرية)، ويعتمد تواريخ الإكس الناقصة من الإفصاحات/أحداث Yahoo، ويحسب DPS ÷ آخر إغلاق قبل الاستحقاق لكل توزيع (العوائد غير المعقولة >30% تُوسم للمراجعة). قابل للاستكمال مع كاش لأسعار Yahoo.",
  },
  {
    key: "dividends_rollback",
    script: "scripts/dividends-import.mjs",
    args: ["--rollback"],
    destructive: true,
    labelEn: "Dividends import — undo last apply",
    labelAr: "استيراد التوزيعات — تراجع عن آخر تنفيذ",
    descEn: "Deletes the dividend ids recorded in reports/dividends-journal.json from the last import apply (never touches rows that existed before it).",
    descAr: "يحذف صفوف التوزيعات المسجلة في ملف التراجع من آخر عملية استيراد (لا يمس الصفوف التي كانت موجودة قبله).",
  },
]

export interface JournalEntry {
  id: string
  job: string
  script: string
  args: string[]
  startedAt: string
  endedAt: string | null
  exitCode: number | null
  pid: number
  logFile: string
  /** execution plane: a spawned child of this server, or a GitHub Actions run */
  plane?: "local" | "actions"
  /** GitHub Actions run page (actions plane only) */
  htmlUrl?: string
  /** who terminated the process before it exited on its own */
  stoppedBy?: "admin" | "watchdog"
}

const running = new Map<string, { child: ReturnType<typeof spawn>; entry: JournalEntry }>()

// Watchdog: a hung script would block the single-flight runner forever (and
// the database with it). The longest legitimate job is the AskBorsa apply
// (~15 min), so 45 min is a safe ceiling — after that the runner kills the
// process and frees the slot.
const MAX_RUNTIME_MS = 45 * 60 * 1000
const SIGKILL_GRACE_MS = 10_000
const watchdogs = new Map<string, ReturnType<typeof setTimeout>>()

function readJournal(): JournalEntry[] {
  try {
    if (!existsSync(JOURNAL)) return []
    const raw = JSON.parse(readFileSync(JOURNAL, "utf8"))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function writeJournal(entries: JournalEntry[]) {
  // Serverless filesystems may be read-only — the journal is a self-hosting
  // nicety, not a correctness requirement. Persist best-effort.
  try {
    mkdirSync(path.dirname(JOURNAL), { recursive: true })
    writeFileSync(JOURNAL, JSON.stringify(entries.slice(-40), null, 2), "utf8")
  } catch {
    // read-only FS or missing permissions — skip journal persistence
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function anyRunning(): boolean {
  for (const { entry } of running.values()) if (pidAlive(entry.pid)) return true
  return false
}

export function jobByKey(key: string): WhitelistEntry | undefined {
  return WHITELIST.find((j) => j.key === key)
}

// -----------------------------------------------------------------------------
// GitHub Actions relay (serverless plane)
// -----------------------------------------------------------------------------

const GH_REPO = process.env.GH_OPS_REPO || "ThomasEmad/egxano"
const GH_TOKEN = process.env.GH_OPS_TOKEN ?? ""
const GH_WORKFLOW = "ops-job.yml"
const GH_API = "https://api.github.com"

/** True when the serverless plane can actually dispatch jobs. */
export function actionsConfigured(): boolean {
  return !!GH_TOKEN
}

async function ghApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GH_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${GH_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
    // keep the caller's window safe — a hung GH API call must not eat the lambda
    signal: AbortSignal.timeout(15_000),
    // Actions run status must never be cached by the serverless platform
    cache: "no-store",
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`GitHub API ${res.status} on ${path}: ${body.slice(0, 180)}`)
  }
  return res.json() as Promise<T>
}

interface GhWorkflowRun {
  id: number
  status: "queued" | "in_progress" | "completed" | string
  conclusion: string | null
  created_at: string
  run_started_at: string | null
  updated_at: string
  html_url: string
  event: string
}

// job-key cache: the dispatch inputs are not echoed back by the runs API, so
// the key is read once from the run's "ops:<key>" step name and memoized.
const runJobCache = new Map<number, string>()

async function jobKeyForRun(run: GhWorkflowRun): Promise<string> {
  const cached = runJobCache.get(run.id)
  if (cached) return cached
  try {
    const jobs = await ghApi<{ jobs: Array<{ steps: Array<{ name: string }> }> }>(
      `/repos/${GH_REPO}/actions/runs/${run.id}/jobs?per_page=1`
    )
    const step = jobs.jobs?.[0]?.steps?.find((s) => s.name.startsWith("ops:"))
    const key = step ? step.name.slice(4) : "unknown"
    runJobCache.set(run.id, key)
    return key
  } catch {
    return "unknown"
  }
}

function conclusionToExitCode(conclusion: string | null): number | null {
  switch (conclusion) {
    case "success": return 0
    case "failure": return 1
    case "cancelled": return 143
    case "timed_out": return 124
    default: return 1
  }
}

/** Recent workflow_dispatch runs of ops-job.yml, mapped to the Run shape. */
export async function listActionsRuns(limit = 10): Promise<JournalEntry[]> {
  if (!GH_TOKEN) return []
  try {
    const data = await ghApi<{ workflow_runs: GhWorkflowRun[] }>(
      `/repos/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/runs?event=workflow_dispatch&per_page=${limit}`
    )
    const out: JournalEntry[] = []
    for (const run of data.workflow_runs ?? []) {
      const key = await jobKeyForRun(run)
      const wl = jobByKey(key)
      const completed = run.status === "completed"
      out.push({
        id: `gh-${run.id}`,
        job: key,
        script: wl?.script ?? "(admin-ops workflow)",
        args: wl?.args ?? [],
        startedAt: run.run_started_at || run.created_at,
        endedAt: completed ? run.updated_at : null,
        exitCode: completed ? conclusionToExitCode(run.conclusion) : null,
        pid: 0,
        logFile: run.html_url,
        plane: "actions",
        htmlUrl: run.html_url,
      })
    }
    return out
  } catch (e) {
    // rate-limited / token revoked — degrade to an empty list, never break GET
    console.error("listActionsRuns failed:", e instanceof Error ? e.message.slice(0, 200) : e)
    return []
  }
}

/** Dispatch a whitelisted job on the ops-job.yml workflow (serverless plane). */
async function startActionsJob(key: string): Promise<{ ok: true; entry: JournalEntry } | { ok: false; error: string }> {
  const job = jobByKey(key)
  if (!job) return { ok: false, error: `unknown job "${key}"` }
  if (!GH_TOKEN) {
    return {
      ok: false,
      error: "تشغيل السكريبتات على استضافة Vercel يتم عبر GitHub Actions — المطلوب إضافة متغير البيئة GH_OPS_TOKEN (توكن GitHub بصلاحية تشغيل الـ workflows) في إعدادات المشروع.",
    }
  }
  // Cross-instance single-flight: any queued/running dispatch run blocks a new
  // one — the in-memory `running` map alone cannot see other lambda instances.
  const active = (await listActionsRuns(15)).find((r) => r.endedAt === null)
  if (active) {
    return {
      ok: false,
      error: `في وظيفة شغالة حاليًا على GitHub Actions: ${active.job} — استنى تخلص أو شوف السجل.`,
    }
  }

  const before = Date.now() - 5_000
  const res = await fetch(`${GH_API}/repos/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${GH_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
    },
    body: JSON.stringify({ ref: "main", inputs: { job: key } }),
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 204) {
    // dispatched — resolve the run id (the response body is empty)
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 1_200))
      try {
        const data = await ghApi<{ workflow_runs: GhWorkflowRun[] }>(
          `/repos/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/runs?event=workflow_dispatch&per_page=5`
        )
        const run = (data.workflow_runs ?? []).find((r) => Date.parse(r.created_at) >= before)
        if (run) {
          runJobCache.set(run.id, key)
          return {
            ok: true,
            entry: {
              id: `gh-${run.id}`,
              job: key,
              script: job.script,
              args: job.args,
              startedAt: new Date().toISOString(),
              endedAt: null,
              exitCode: null,
              pid: 0,
              logFile: run.html_url,
              plane: "actions",
              htmlUrl: run.html_url,
            },
          }
        }
      } catch {
        // retry on the next tick
      }
    }
    // dispatched but the run record wasn't visible yet — it will appear in the
    // merged runs list on the next poll; hand back a provisional entry
    return {
      ok: true,
      entry: {
        id: `gh-pending-${key}-${Date.now()}`,
        job: key,
        script: job.script,
        args: job.args,
        startedAt: new Date().toISOString(),
        endedAt: null,
        exitCode: null,
        pid: 0,
        logFile: "",
        plane: "actions",
      },
    }
  }
  const body = await res.text().catch(() => "")
  if (res.status === 403 || res.status === 401) {
    return { ok: false, error: "توكن GitHub لا يملك صلاحية تشغيل الـ workflows (Actions:write) — حدّث GH_OPS_TOKEN." }
  }
  if (res.status === 422) {
    return { ok: false, error: "الـ workflow غير موجود على الفرع main — تأكد من نشر .github/workflows/ops-job.yml." }
  }
  return { ok: false, error: `GitHub API ${res.status}: ${body.slice(0, 160)}` }
}

/** Cancel a GitHub Actions run (the Stop button for the actions plane). */
async function cancelActionsRun(runId: string): Promise<{ ok: boolean; error?: string }> {
  const numeric = runId.slice("gh-".length)
  if (!/^\d+$/.test(numeric)) return { ok: false, error: "run not found" }
  try {
    const res = await fetch(`${GH_API}/repos/${GH_REPO}/actions/runs/${numeric}/cancel`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${GH_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 202 || res.status === 204) return { ok: true }
    if (res.status === 409) return { ok: false, error: "run already finished" }
    return { ok: false, error: `GitHub API ${res.status}` }
  } catch {
    return { ok: false, error: "cancel request failed" }
  }
}

// -----------------------------------------------------------------------------
// Job start — routes to the right plane
// -----------------------------------------------------------------------------

export async function startJob(key: string): Promise<{ ok: true; entry: JournalEntry } | { ok: false; error: string }> {
  const job = jobByKey(key)
  if (!job) return { ok: false, error: `unknown job "${key}"` }

  // Serverless: dispatch to GitHub Actions (writes to the production DB with
  // the repo secrets — Yahoo/TradingView also block Vercel egress entirely).
  if (IS_SERVERLESS) return startActionsJob(key)

  // Self-hosted: spawn locally, unchanged historical behavior.
  for (const [id, r] of running) if (!pidAlive(r.entry.pid)) running.delete(id)
  if (running.size > 0) {
    return { ok: false, error: `another job is still running: ${[...running.values()][0].entry.job} — wait for it to finish or check its log` }
  }

  let id: string
  let fd: number
  let logFile: string
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    id = `${key}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`
    logFile = path.join(LOG_DIR, `${id}.log`)
    // @ts-ignore - dynamic filesystem access is intentional for admin ops
    fd = openSync(/* turbopackIgnore: true */ logFile, "a")
  } catch {
    return { ok: false, error: "Admin ops require a writable server filesystem (not available on serverless hosting)" }
  }
  // @ts-ignore - dynamic spawn is intentional for admin job execution
  const child = spawn(process.execPath, [/* turbopackIgnore: true */ path.join(ROOT, job.script), ...job.args], {
    // cwd = the WRITABLE root: every relative `reports/…` artifact the script
    // writes (snapshots, rollback files, caches) lands somewhere writable,
    // while the script file itself is read from the deployment bundle.
    cwd: PROBE.root,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, EGX_ROOT: PROBE.root },
  })
  const entry: JournalEntry = {
    id,
    job: job.key,
    script: job.script,
    args: job.args,
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    pid: child.pid ?? 0,
    logFile,
    plane: "local",
  }
  writeJournal([...readJournal(), entry])
  running.set(id, { child, entry })

  const finish = () => {
    const w = watchdogs.get(id)
    if (w) { clearTimeout(w); watchdogs.delete(id) }
  }
  child.on("exit", (code, signal) => {
    entry.endedAt = new Date().toISOString()
    // a process killed by a signal reports code=null — record the conventional
    // exit status so the UI can tell "stopped" from "done"
    entry.exitCode = code ?? (signal === "SIGKILL" ? 137 : signal ? 143 : null)
    const all = readJournal().map((e) => (e.id === id ? entry : e))
    writeJournal(all)
    running.delete(id)
    finish()
  })

  const watchdog = setTimeout(() => {
    watchdogs.delete(id)
    if (running.has(id) && pidAlive(entry.pid)) {
      killJob(id, "watchdog")
    }
  }, MAX_RUNTIME_MS)
  watchdogs.set(id, watchdog)

  return { ok: true, entry }
}

/**
 * Stop a running job (admin action or watchdog). Actions-plane runs are
 * cancelled through the GitHub API; local children get SIGTERM → SIGKILL.
 */
export function killJob(
  runId: string,
  by: "admin" | "watchdog" = "admin"
): { ok: true; entry: JournalEntry } | { ok: false; error: string } {
  if (runId.startsWith("gh-")) {
    // synchronous signature kept for the route — fire and let the caller poll
    void cancelActionsRun(runId)
    const entry = readJournal().find((e) => e.id === runId)
    return {
      ok: true,
      entry: entry ?? { id: runId, job: "unknown", script: "", args: [], startedAt: new Date().toISOString(), endedAt: null, exitCode: null, pid: 0, logFile: "", plane: "actions" },
    }
  }
  const entry = running.get(runId)?.entry ?? readJournal().find((e) => e.id === runId)
  if (!entry) return { ok: false, error: "run not found" }
  if (entry.endedAt !== null) return { ok: false, error: "run already finished" }
  if (!pidAlive(entry.pid)) return { ok: false, error: "process is not running" }

  const child = running.get(runId)?.child
  if (child) {
    child.kill("SIGTERM")
  } else {
    try {
      process.kill(entry.pid, "SIGTERM")
    } catch {
      return { ok: false, error: "process could not be signalled" }
    }
  }

  entry.stoppedBy = by
  // escalate to SIGKILL if the process ignores SIGTERM
  setTimeout(() => {
    if (!pidAlive(entry.pid)) return
    if (running.get(runId)?.child) {
      running.get(runId)!.child.kill("SIGKILL")
    } else {
      try { process.kill(entry.pid, "SIGKILL") } catch {}
    }
  }, SIGKILL_GRACE_MS)

  // reconcile the journal even if the exit event never fires (orphaned pid)
  setTimeout(() => {
    if (pidAlive(entry.pid)) return
    if (entry.endedAt === null) {
      entry.endedAt = new Date().toISOString()
      entry.exitCode = entry.exitCode ?? 143
      writeJournal(readJournal().map((e) => (e.id === entry.id ? entry : e)))
    }
    running.delete(runId)
  }, SIGKILL_GRACE_MS + 1_000)

  return { ok: true, entry }
}

/** Journal + liveness reconciliation (works across server restarts). */
export function listRuns(limit = 20): JournalEntry[] {
  const all = readJournal().filter((e) => e.plane !== "actions").slice().reverse()
  const liveIds = new Set([...running.values()].map((r) => r.entry.id))
  return all.slice(0, limit).map((e) =>
    e.endedAt === null && !liveIds.has(e.id) && !pidAlive(e.pid)
      ? { ...e, endedAt: null, exitCode: null, logFile: e.logFile + " (process not running — probably killed by a server restart)" }
      : e
  )
}

export function runningJobs(): JournalEntry[] {
  for (const [id, r] of running) if (!pidAlive(r.entry.pid)) running.delete(id)
  return [...running.values()].map((r) => r.entry)
}

/** Last N lines of a run's log (local plane; actions-plane logs live on GitHub). */
export function tailLog(runId: string, lines = 120): { ok: true; text: string; running: boolean } | { ok: false; error: string } {
  const entry = readJournal().find((e) => e.id === runId)
  if (!entry) return { ok: false, error: "run not found" }
  const isRunning = [...running.values()].some((r) => r.entry.id === runId) && pidAlive(entry.pid)
  try {
    if (!existsSync(entry.logFile)) return { ok: true, text: "", running: isRunning }
    const buf = readFileSync(entry.logFile, "utf8")
    const arr = buf.split("\n")
    return { ok: true, text: arr.slice(-lines).join("\n"), running: isRunning }
  } catch {
    return { ok: false, error: "log unreadable" }
  }
}
