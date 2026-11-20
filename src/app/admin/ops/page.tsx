"use client"

import { useEffect, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Terminal, Play, RefreshCw, AlertTriangle, ChevronDown, Square } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useI18n } from "@/lib/i18n"
import { toast } from "sonner"

interface WhitelistJob {
  key: string
  script: string
  args: string[]
  destructive: boolean
  labelEn: string
  labelAr: string
  descEn: string
  descAr: string
}

interface Run {
  id: string
  job: string
  script: string
  args: string[]
  startedAt: string
  endedAt: string | null
  exitCode: number | null
  pid: number
  /** execution plane: spawned child of the server, or a GitHub Actions run */
  plane?: "local" | "actions"
  /** GitHub Actions run page (actions plane) */
  htmlUrl?: string
}

interface OpsData {
  jobs: WhitelistJob[]
  running: Run[]
  busy: boolean
  runs: Run[]
  hosting?: { serverless: boolean; fsWritable: boolean; workRoot: string }
  /** GH_OPS_TOKEN is configured — the actions plane can dispatch */
  actionsReady?: boolean
}

const JOB_AR: Record<string, string> = {
  askborsa_plan: "استيراد AskBorsa — تخطيط",
  askborsa_apply: "استيراد AskBorsa — تنفيذ",
  askborsa_rollback: "استيراد AskBorsa — تراجع",
  purge_plan: "تنقية القيم المخترعة — تخطيط",
  purge_apply: "تنقية القيم المخترعة — تنفيذ",
  purge_rollback: "تنقية القيم المخترعة — تراجع",
  audit_run: "تدقيق سلامة البيانات",
  recompute_all: "إعادة حساب كل المقاييس",
  tv_harvest: "حصاد TradingView — جمع القوائم",
  tv_plan: "استيراد TradingView — تخطيط",
  tv_apply: "استيراد TradingView — تنفيذ",
  tv_rollback: "استيراد TradingView — تراجع",
  dividends_plan: "استيراد التوزيعات — تخطيط",
  dividends_apply: "استيراد التوزيعات — تنفيذ",
  dividends_enrich: "إثراء التوزيعات",
  dividends_rollback: "استيراد التوزيعات — تراجع",
}

export default function AdminOpsPage() {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const qc = useQueryClient()
  const [openLog, setOpenLog] = useState<string | null>(null)

  const { data, refetch, isRefetching } = useQuery({
    queryKey: ["admin-ops"],
    queryFn: () => fetch("/api/v1/admin/ops", { credentials: "include" }).then((r) => (r.ok ? (r.json() as Promise<OpsData>) : null)),
    refetchInterval: 5_000,
  })

  const log = useQuery({
    queryKey: ["admin-ops-log", openLog],
    enabled: !!openLog,
    queryFn: () => fetch(`/api/v1/admin/ops?log=${openLog}&lines=200`, { credentials: "include" }).then((r) => (r.ok ? (r.json() as Promise<{ text: string; running: boolean }>) : null)),
    refetchInterval: (q) => (q.state.data?.running ? 3_000 : false),
  })

  const run = useMutation({
    mutationFn: (job: string) =>
      fetch("/api/v1/admin/ops", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ job }) })
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) })),
    onSuccess: ({ status, body }) => {
      const b = body as { ok?: boolean; error?: string; run?: Run }
      if (status >= 400 || !b.ok) {
        toast.error(b.error ?? (ar ? "فشل بدء التشغيل" : "Failed to start"))
        return
      }
      toast.success(ar ? `بدأ التشغيل — ${b.run?.id}` : `Started — ${b.run?.id}`)
      setOpenLog(b.run?.id ?? null)
      qc.invalidateQueries({ queryKey: ["admin-ops"] })
    },
  })

  const stop = useMutation({
    mutationFn: (runId: string) =>
      fetch("/api/v1/admin/ops", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ stop: runId }) })
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) })),
    onSuccess: ({ status, body }) => {
      const b = body as { ok?: boolean; error?: string }
      if (status >= 400 || !b.ok) {
        toast.error(b.error ?? (ar ? "فشل الإيقاف" : "Failed to stop"))
        return
      }
      toast.success(ar ? "تم إرسال إشارة الإيقاف — المحاولة تنتهي خلال ثوانٍ" : "Stop signal sent — the job should exit within seconds")
      qc.invalidateQueries({ queryKey: ["admin-ops"] })
    },
  })

  // keep polling while a job is running
  useEffect(() => {
    if (data?.busy) {
      const t = setInterval(() => refetch(), 4_000)
      return () => clearInterval(t)
    }
  }, [data?.busy, refetch])

  const btn = "inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50"

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <Terminal className="h-5 w-5 text-primary" />
            {ar ? "العمليات والسكريبتات" : "Ops & scripts"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {ar
              ? "تشغيل أدوات البيانات من الموقع: استيراد askborsa (تخطيط/تنفيذ/تراجع)، تنقية القيم المخترعة (تخطيط/تنفيذ/تراجع)، تدقيق السلامة، وإعادة حساب كل المقاييس. سكريبت واحد في نفس اللحظة، وكل تنفيذ يتسجل في سجل التدقيق."
              : "Run the data tools from the site: askborsa import (plan/apply/rollback), imputed-values purge (plan/apply/rollback), integrity audit, and full metric recompute. One job at a time; every run is audit-logged."}
          </p>
        </div>
        <button onClick={() => refetch()} className={btn}>
          <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} />
          {ar ? "تحديث" : "Refresh"}
        </button>
      </div>

      {/* hosting mode banner — the owner must know how jobs execute before
          pressing Run, not after a failed toast (5-second rule) */}
      {data?.hosting?.serverless && (
        <Card className="border-sky-500/40 bg-sky-500/5 p-0">
          <CardContent className="p-3 text-[11px] leading-relaxed text-muted-foreground">
            <p className="mb-1 font-bold text-foreground">
              {ar ? "وضع الاستضافة: سيرفرليس (Vercel) — التنفيذ عبر GitHub Actions:" : "Hosting mode: serverless (Vercel) — jobs run on GitHub Actions:"}
            </p>
            <ul className="list-inside list-disc space-y-0.5">
              <li>{ar ? "كل زر «تشغيل» بيفتح وظيفة على عُدد GitHub بتكتب مباشرة في قاعدة بيانات الإنتاج — نفس البنية اللي بتشغّل تحديث الشموع يوميًا." : "Every Run button dispatches a GitHub Actions job that writes straight to the production database — the same plane that refreshes candles daily."}</li>
              <li>{ar ? "مفيش حد مدة قاتل: الوظائف الطويلة (8-15 دقيقة وأكتر) بتكمل عادي، وسجل التشغيل الكامل على GitHub." : "No function-duration limit: long jobs (8-15+ minutes) run to completion, with the full log on GitHub."}</li>
              <li>{ar ? "ملفات العمل (snapshot/ملفات التراجع) بتنتقل بين التشغيلات تلقائيًا كـ artifact — الحصاد بعده التخطيط بعده التنفيذ بيكمّلوا بعض." : "Work files (snapshots/rollback journals) carry over between runs as an artifact — harvest → plan → apply chain across dispatches."}</li>
              <li>{ar ? "الجاري الآن وآخر التشغيلات بتتسحب من حالة Actions مباشرة، وزر الإيقاف بيلغي الوظيفة على GitHub." : "Running/Recent runs are pulled from the Actions state directly, and Stop cancels the workflow run."}</li>
            </ul>
            {data?.actionsReady === false && (
              <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-400">
                {ar
                  ? "تنبيه: متغير البيئة GH_OPS_TOKEN غير مضبوط على Vercel — التشغيل هيفشل لحد ما يُضاف (توكن GitHub بصلاحية تشغيل الـ workflows)."
                  : "Warning: GH_OPS_TOKEN is not configured on Vercel — dispatches will fail until it is added (a GitHub token with workflow-dispatch permission)."}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* busy banner: the active run may be local OR an Actions run (merged list) */}
      {data?.busy && (() => {
        const active = data.running[0] ?? data.runs.find((r) => r.endedAt === null)
        if (!active) return null
        return (
          <Card className="border-amber-500/50 p-0">
            <CardContent className="flex items-center gap-2 p-3 text-xs">
              <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" /></span>
              {ar ? `سكريبت شغال دلوقتي: ${JOB_AR[active.job] ?? active.job} — بدأ ${new Date(active.startedAt).toLocaleTimeString(ar ? "ar-EG" : "en-GB")}` : `A job is running: ${active.job} (started ${new Date(active.startedAt).toLocaleTimeString()})`}
              {active.htmlUrl && (
                <a href={active.htmlUrl} target="_blank" rel="noreferrer" className="font-semibold text-sky-600 underline underline-offset-2">
                  {ar ? "السجل على GitHub ↗" : "log on GitHub ↗"}
                </a>
              )}
              <button
                onClick={() => stop.mutate(active.id)}
                disabled={stop.isPending}
                className="inline-flex items-center gap-1 rounded-lg border border-red-500/50 px-2 py-1 text-[10px] font-semibold text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50"
              >
                <Square className="h-3 w-3" />
                {ar ? "إيقاف" : "Stop"}
              </button>
            </CardContent>
          </Card>
        )
      })()}

      <div className="grid gap-3 md:grid-cols-2">
        {(data?.jobs ?? []).map((j) => {
          const disabled = run.isPending || data?.busy
          return (
            <Card key={j.key} className={`p-0 ${j.destructive ? "border-amber-500/40" : ""}`}>
              <CardHeader className="pb-1.5">
                <CardTitle className="flex items-center justify-between gap-2 text-sm">
                  <span>{ar ? JOB_AR[j.key] ?? j.labelAr : j.labelEn}</span>
                  {j.destructive ? (
                    <Badge variant="outline" className="shrink-0 border-amber-500/40 text-[9px] text-amber-600">{ar ? "يكتب في الداتا" : "writes to DB"}</Badge>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <p className="text-xs text-muted-foreground">{ar ? j.descAr : j.descEn}</p>
                <div className="flex items-center gap-2">
                  <button
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white ${j.destructive ? "bg-amber-600 hover:bg-amber-600/90" : "bg-primary hover:bg-primary/90"} disabled:opacity-50`}
                    disabled={disabled}
                    onClick={() => {
                      const msg = j.destructive
                        ? ar
                          ? `تشغيل «${j.labelAr}» — هيكتب في قاعدة البيانات. متأكد؟`
                          : `Run "${j.labelEn}" — it writes to the database. Continue?`
                        : undefined
                      if (msg && !confirm(msg)) return
                      run.mutate(j.key)
                    }}
                  >
                    <Play className={`h-3 w-3 ${run.isPending ? "animate-pulse" : ""}`} />
                    {ar ? "تشغيل" : "Run"}
                  </button>
                  <span className="font-mono text-[10px] text-muted-foreground">node {j.script} {j.args.join(" ")}</span>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card className="p-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{ar ? "آخر التشغيلات" : "Recent runs"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {!data?.runs.length ? (
            <p className="py-3 text-center text-xs text-muted-foreground">{ar ? "لا يوجد تشغيلات بعد" : "No runs yet"}</p>
          ) : (
            data.runs.map((r) => {
              const isActions = r.plane === "actions" || r.id.startsWith("gh-")
              const status = r.endedAt === null ? (r.exitCode === null ? (isActions || data.busy ? "running" : "interrupted") : "done") : "done"
              const failed = r.exitCode !== null && r.exitCode !== 0
              return (
                <div key={r.id} className="rounded-lg border border-border/40">
                  <div className="flex flex-wrap items-center gap-2 p-2.5 text-xs">
                    <button onClick={() => setOpenLog(openLog === r.id ? null : r.id)} className="flex items-center gap-1 font-semibold hover:text-primary">
                      {openLog === r.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5 rotate-90 rtl:rotate-[-90deg]" />}
                      {JOB_AR[r.job] ?? r.job}
                    </button>
                    <Badge variant="outline" className={`text-[9px] ${status === "running" ? "border-amber-500/40 text-amber-600" : failed ? "border-red-500/40 text-red-600" : status === "interrupted" ? "border-muted text-muted-foreground" : "border-emerald-500/40 text-emerald-600"}`}>
                      {status === "running" ? (ar ? "شغال…" : "running") : status === "interrupted" ? (ar ? "انقطع" : "interrupted") : (ar ? `خلص (${r.exitCode})` : `exit ${r.exitCode}`)}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{new Date(r.startedAt).toLocaleString(ar ? "ar-EG" : "en-GB", { dateStyle: "short", timeStyle: "medium" })}</span>
                    {isActions && r.htmlUrl && (
                      <a href={r.htmlUrl} target="_blank" rel="noreferrer" className="text-[10px] font-semibold text-sky-600 underline underline-offset-2">
                        {ar ? "سجل GitHub ↗" : "GitHub log ↗"}
                      </a>
                    )}
                    <span className="ms-auto font-mono text-[10px] text-muted-foreground">{r.args.join(" ") || "(plan)"}</span>
                  </div>
                  {openLog === r.id && (
                    <div className="border-t border-border/40 p-2.5">
                      {log.isLoading ? (
                        <p className="text-center text-[11px] text-muted-foreground">…</p>
                      ) : log.data?.text?.startsWith("GITHUB_ACTIONS_LOG:") ? (
                        <a href={log.data.text.slice("GITHUB_ACTIONS_LOG:".length)} target="_blank" rel="noreferrer" className="block rounded-md border border-sky-500/40 bg-sky-500/5 p-3 text-center text-[11px] font-semibold text-sky-600 hover:bg-sky-500/10">
                          {ar ? "السجل الكامل بيشتغل على GitHub Actions — افتحه من هنا ↗" : "The full log runs on GitHub Actions — open it there ↗"}
                        </a>
                      ) : (
                        <pre className="max-h-80 overflow-auto rounded-md bg-zinc-950 p-3 font-mono text-[10px] leading-relaxed text-zinc-200" dir="ltr">
                          {log.data?.text || "(empty log)"}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      <p className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
        {ar
          ? "الأوامر ال destructive بتاخد نسخة احتياطية/ملف تراجع حسب السكريبت نفسه — راجع صفحة التشغيلات أو reports/ للملفات."
          : "Destructive jobs create their own backups/rollback files inside the script — check reports/ for the artifacts."}
      </p>
    </div>
  )
}
