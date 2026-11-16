"use client"

// =============================================================================
// AdminValueEditor — the owner's live value editor (2026-11-16 mandate).
//
// Rendered ONLY for an authenticated admin session (checked via /api/v1/admin/
// me — regular users get null and never learn this surface exists). Floating
// button on the company page opens a drawer with three tabs:
//   • السعر الحالي  — set the session price (persisted override + today's feed
//     row), or clear it back to the market feed
//   • الشموع        — edit the last 15 daily bars (OHLC/volume) by hand
//   • القوائم       — edit any financial statement value of the selected report
//   • الإجراءات     — record/corporate actions LIVE on the company page
//     (split / merger / bonus / rights / cash dividend + gap detection) —
//     owner request 2026-11-16: "عايز أعدل live من صفحات الموقع الأساسية"
//     instead of walking to the /admin dashboard. Saves hit the SAME
//     /api/v1/admin/corporate-actions write path the dashboard uses; the
//     ex-date adjustment engine applies to the chart/technical series on the
//     next refetch (invalidateQueries fires immediately).
// Users never see any marker that a value was hand-set (owner decision, full
// owner responsibility; the server audit log is the owner's traceability).
// =============================================================================

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useI18n } from "@/lib/i18n"
import { SECTORS } from "@/lib/sectors"
import { MARKET_TIERS, TIER_AR, type MarketTier } from "@/lib/market/tiers"
import { Switch } from "@/components/ui/switch"

interface PriceState {
  asOf: string
  price: number
  volume: number | null
  sourceName: string
}
interface BarRow {
  id: string
  ts: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}
interface ReportRow {
  id: string
  periodLabel: string
  periodType: string
  statementType: string
  fiscalYear: number
}
interface ValueRow {
  id: string
  metricCode: string
  originalLabel: string
  value: number
  unit: string
  normalizedValue: number
  statementType: string
  group: string | null
}
interface EditorPayload {
  company: { id: string; ticker: string; nameEn: string; nameAr?: string | null; sharesOutstanding: number | null; sector?: string; marketTier?: string; excludeFromRankings?: boolean }
  price: PriceState | null
  override: { price: number; volume?: number | null; updatedAt: string } | null
  bars: BarRow[]
  reports: ReportRow[]
  selectedReportId: string | null
  values: ValueRow[]
}

export function AdminValueEditor({ companyId }: { companyId: string }) {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  // admin session check — null render for everyone else (invisible surface)
  const { data: me } = useQuery({
    queryKey: ["admin-me"],
    queryFn: () =>
      fetch("/api/v1/admin/me", { credentials: "include" }).then((r) => (r.ok ? (r.json() as Promise<{ isAdmin?: boolean }>) : null)),
    staleTime: 5 * 60_000,
  })
  const isAdminUser = me?.isAdmin === true

  const { data, refetch } = useQuery({
    queryKey: ["admin-company-values", companyId],
    queryFn: () =>
      fetch(`/api/v1/admin/company-values?companyId=${companyId}`, { credentials: "include" }).then((r) =>
        r.ok ? (r.json() as Promise<EditorPayload>) : null,
      ),
    enabled: isAdminUser && open,
  })

  // live reflection: after any successful edit, every page query refetches
  const edit = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetch("/api/v1/admin/company-values", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyId, ...body }),
      }).then(async (r) => {
        const json = (await r.json()) as { ok?: boolean; message?: string }
        if (!r.ok || json.ok === false) throw new Error(json.message ?? `HTTP ${r.status}`)
        return json
      }),
    onSuccess: () => {
      toast.success(ar ? "تم الحفظ — الموقع كله بيتحدث بالقيمة الجديدة الآن" : "Saved — every surface refetches now")
      void qc.invalidateQueries()
      void refetch()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : ar ? "فشل الحفظ" : "Save failed"),
  })

  if (!isAdminUser) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={ar ? "وضع الأدمن — تعديل أي قيمة يدويًا" : "Admin mode — edit any value"}
        className="fixed bottom-4 end-4 z-50 inline-flex items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-2 text-xs font-semibold text-muted-foreground shadow-lg transition-colors hover:border-primary/50 hover:text-primary"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
        {ar ? "وضع الأدمن" : "Admin mode"}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={ar ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-sm">
              <Pencil className="h-4 w-4 text-primary" aria-hidden />
              {ar ? "تعديل القيم — " : "Value editor — "}
              <span dir="ltr">{data?.company.ticker ?? ""}</span>
            </SheetTitle>
          </SheetHeader>

          <Tabs defaultValue="price" className="mt-2">
            <TabsList className="w-full">
              <TabsTrigger value="price" className="flex-1">{ar ? "السعر" : "Price"}</TabsTrigger>
              <TabsTrigger value="bars" className="flex-1">{ar ? "الشموع" : "Bars"}</TabsTrigger>
              <TabsTrigger value="financial" className="flex-1">{ar ? "القوائم" : "Statements"}</TabsTrigger>
              <TabsTrigger value="actions" className="flex-1">{ar ? "الإجراءات" : "Actions"}</TabsTrigger>
              <TabsTrigger value="company" className="flex-1">{ar ? "الشركة" : "Co."}</TabsTrigger>
            </TabsList>

            <TabsContent value="price" className="space-y-3 pt-3">
              <PriceTab data={data ?? undefined} saving={edit.isPending} onSave={(body) => edit.mutate(body)} ar={ar} />
            </TabsContent>
            <TabsContent value="bars" className="pt-3">
              <BarsTab data={data ?? undefined} saving={edit.isPending} onSave={(body) => edit.mutate(body)} ar={ar} />
            </TabsContent>
            <TabsContent value="financial" className="pt-3">
              <FinancialTab data={data ?? undefined} saving={edit.isPending} onSave={(body) => edit.mutate(body)} ar={ar} />
            </TabsContent>
            <TabsContent value="actions" className="pt-3">
              <ActionsTab companyId={companyId} ar={ar} />
            </TabsContent>
            <TabsContent value="company" className="pt-3">
              <CompanyTab data={data ?? undefined} companyId={companyId} ar={ar} />
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
    </>
  )
}

function PriceTab({
  data,
  saving,
  onSave,
  ar,
}: {
  data: EditorPayload | undefined
  saving: boolean
  onSave: (body: Record<string, unknown>) => void
  ar: boolean
}) {
  const [price, setPrice] = useState("")
  const [volume, setVolume] = useState("")
  useEffect(() => {
    if (!data) return
    // defer one microtask — synchronous setState inside an effect cascades
    queueMicrotask(() => {
      setPrice(String(data.override?.price ?? data.price?.price ?? ""))
      setVolume(
        data.override?.volume != null ? String(data.override.volume) : data.price?.volume != null ? String(Math.round(data.price.volume)) : "",
      )
    })
  }, [data])
  if (!data) return <p className="py-4 text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
  const num = (v: string) => (v.trim() === "" ? null : Number(v))
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {ar
          ? "الحفظ يطبّق السعر على الموقع كله فورًا (لوحة السوق، الإشارات، التقييم، الشارت) ويُسجل في سجل التعديلات."
          : "Saving applies the price site-wide immediately (board, signals, valuation, chart) and writes the audit trail."}
      </p>
      <div className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2 text-xs" dir="ltr">
        feed: {data.price ? `${data.price.price} (${data.price.asOf.slice(0, 10)})` : "—"}
        {data.override ? ` · override: ${data.override.price}` : ""}
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{ar ? "السعر الحالي" : "Current price"}</Label>
        <Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} dir="ltr" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{ar ? "حجم الجلسة (اختياري)" : "Session volume (optional)"}</Label>
        <Input type="number" min={0} step="1" value={volume} onChange={(e) => setVolume(e.target.value)} dir="ltr" />
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={saving || num(price) === null} onClick={() => onSave({ kind: "price", price: Number(price), volume: num(volume) })}>
          {ar ? "حفظ" : "Save"}
        </Button>
        {data.override ? (
          <Button size="sm" variant="outline" disabled={saving} onClick={() => onSave({ kind: "price", clearOverride: true })}>
            {ar ? "العودة لسعر الفيد" : "Back to feed"}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function BarsTab({
  data,
  saving,
  onSave,
  ar,
}: {
  data: EditorPayload | undefined
  saving: boolean
  onSave: (body: Record<string, unknown>) => void
  ar: boolean
}) {
  // per-row drafts so each bar saves independently
  const [drafts, setDrafts] = useState<Record<string, BarRow>>({})
  useEffect(() => {
    if (!data) return
    queueMicrotask(() => setDrafts(Object.fromEntries(data.bars.map((b) => [b.id, b]))))
  }, [data])
  const rows = useMemo(() => (data ? data.bars.map((b) => drafts[b.id] ?? b) : []), [data, drafts])
  if (!data) return <p className="py-4 text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
  const set = (id: string, field: keyof BarRow, v: string) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [field]: field === "ts" ? v : v === "" ? null : Number(v) } }))
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {ar ? "آخر 15 شمعة — عدّل أي قيمة بيدها (تؤثر على المؤشرات والمستويات فورًا)." : "Last 15 bars — edit any figure; indicators and levels update immediately."}
      </p>
      {rows.map((b) => (
        <div key={b.id} className="rounded-lg border border-border/60 p-2">
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground" dir="ltr">
            <span>{b.ts}</span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              disabled={saving}
              onClick={() => onSave({ kind: "bar", ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })}
            >
              {ar ? "حفظ" : "Save"}
            </Button>
          </div>
          <div className="grid grid-cols-5 gap-1">
            {(["open", "high", "low", "close"] as const).map((f) => (
              <div key={f}>
                <Label className="text-[9px] uppercase text-muted-foreground">{f}</Label>
                <Input
                  className="h-7 px-1 text-xs"
                  type="number"
                  step="0.01"
                  value={String(b[f] ?? "")}
                  onChange={(e) => set(b.id, f, e.target.value)}
                  dir="ltr"
                />
              </div>
            ))}
            <div>
              <Label className="text-[9px] uppercase text-muted-foreground">vol</Label>
              <Input
                className="h-7 px-1 text-xs"
                type="number"
                step="1"
                value={b.volume === null ? "" : String(b.volume)}
                onChange={(e) => set(b.id, "volume", e.target.value)}
                dir="ltr"
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function FinancialTab({
  data,
  saving,
  onSave,
  ar,
}: {
  data: EditorPayload | undefined
  saving: boolean
  onSave: (body: Record<string, unknown>) => void
  ar: boolean
}) {
  const [reportId, setReportId] = useState<string | null>(null)
  useEffect(() => {
    if (!data?.selectedReportId) return
    queueMicrotask(() => setReportId(data.selectedReportId))
  }, [data])
  if (!data) return <p className="py-4 text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">{ar ? "الفترة" : "Period"}</Label>
        <select
          value={reportId ?? ""}
          onChange={(e) => setReportId(e.target.value)}
          className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
        >
          {data.reports.map((r) => (
            <option key={r.id} value={r.id}>
              {r.periodLabel} · {r.statementType}
            </option>
          ))}
        </select>
      </div>
      <ValuesEditor reportId={reportId} companyId={data.company.id} saving={saving} ar={ar} onSave={onSave} />
    </div>
  )
}

function ValuesEditor({
  reportId,
  companyId,
  saving,
  ar,
  onSave,
}: {
  reportId: string | null
  companyId: string
  saving: boolean
  ar: boolean
  onSave: (body: Record<string, unknown>) => void
}) {
  const { data } = useQuery({
    queryKey: ["admin-company-values", companyId, reportId],
    queryFn: () =>
      fetch(`/api/v1/admin/company-values?companyId=${companyId}${reportId ? `&reportId=${reportId}` : ""}`, { credentials: "include" }).then((r) =>
        r.ok ? (r.json() as Promise<EditorPayload>) : null,
      ),
    enabled: !!reportId,
  })
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!data?.values) return
    queueMicrotask(() => setDrafts(Object.fromEntries(data.values.map((v) => [v.id, String(v.value)]))))
  }, [data])
  if (!reportId) return null
  if (!data) return <p className="py-3 text-xs text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-muted-foreground">
        {ar
          ? "عدّل أي بند — المقاييس المحسوبة (نسب الربحية والنمو) تتحدث تلقائيًا بعد الحفظ."
          : "Edit any line — computed ratios refresh automatically after saving."}
      </p>
      {data.values.map((v) => (
        <div key={v.id} className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium" title={v.originalLabel}>
              {v.metricCode}
              {v.group ? <span className="ms-1 text-[10px] text-muted-foreground">({v.group})</span> : null}
            </p>
            <p className="text-[10px] text-muted-foreground">{v.statementType} · {v.unit}</p>
          </div>
          <Input
            className="h-7 w-28 text-xs"
            type="number"
            step="0.01"
            value={drafts[v.id] ?? String(v.value)}
            onChange={(e) => setDrafts((d) => ({ ...d, [v.id]: e.target.value }))}
            dir="ltr"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            disabled={saving || drafts[v.id] === undefined || drafts[v.id] === String(v.value)}
            onClick={() => onSave({ kind: "financial", valueId: v.id, value: Number(drafts[v.id]) })}
          >
            {ar ? "حفظ" : "Save"}
          </Button>
        </div>
      ))}
    </div>
  )
}

// =============================================================================
// ActionsTab — corporate actions edited LIVE on the company page (owner
// request 2026-11-16: "عايز أعدل live من صفحات الموقع الأساسية"). Same write
// path as the /admin dashboard (/api/v1/admin/corporate-actions): POST
// records the action (the ex-date adjustment engine then rescales the chart/
// technical series on refetch), DELETE removes a wrong row, ?detect= audits
// the stored series for unrecorded >12% drops. Every success invalidates ALL
// client queries so the chart reflects the change at once.
// =============================================================================

interface CompanyActionRow {
  id: string
  companyId: string
  actionType: string
  sharesPerShare: number | null
  cashPerShare: number | null
  exDate: string
  subscriptionPrice: number | null
  status: string | null
  sourceName: string
  notes: string | null
}

interface ActionGap {
  ts: string
  prevTs: string
  dropPct: number
  hasAction: boolean
}

const ACTION_TYPE_AR: Record<string, string> = {
  rights: "اكتتاب",
  stock_dividend: "بونص",
  split: "تقسيم",
  merger: "اندماج",
  cash_dividend: "توزيعة نقدية",
}

function ActionsTab({ companyId, ar }: { companyId: string; ar: boolean }) {
  const qc = useQueryClient()

  const listQ = useQuery({
    queryKey: ["admin-company-actions", companyId],
    queryFn: () =>
      fetch(`/api/v1/admin/corporate-actions?companyId=${encodeURIComponent(companyId)}`, { credentials: "include" }).then((r) =>
        r.ok ? (r.json() as Promise<{ ok: boolean; actions: CompanyActionRow[] }>) : { ok: false, actions: [] as CompanyActionRow[] },
      ),
  })

  // one shared mutation shape: POST records, DELETE ?id= removes — both then
  // refresh the whole page (chart, technicals, dividends surfaces)
  const write = useMutation({
    mutationFn: async ({ method, body }: { method: "POST" | "DELETE"; body?: Record<string, unknown> }) => {
      const url =
        method === "DELETE"
          ? `/api/v1/admin/corporate-actions?id=${encodeURIComponent(String(body?.id))}`
          : "/api/v1/admin/corporate-actions"
      const r = await fetch(url, {
        method,
        ...(method === "POST" ? { headers: { "Content-Type": "application/json" } } : {}),
        credentials: "include",
        ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
      })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!r.ok || j.ok === false) throw new Error(j.error ?? `HTTP ${r.status}`)
      return j
    },
    onSuccess: () => {
      toast.success(ar ? "اتسجل — الشارت والتحليل الفني بيتحدثوا دلوقتي" : "Recorded — chart and technicals refetch now")
      void qc.invalidateQueries()
      void listQ.refetch()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : ar ? "فشل التسجيل" : "Failed"),
  })

  // ── add form state ──────────────────────────────────────────────────────────
  const [type, setType] = useState("stock_dividend")
  const [ratio, setRatio] = useState("")
  const [subPrice, setSubPrice] = useState("")
  const [cash, setCash] = useState("")
  const [exDate, setExDate] = useState("")
  const [notes, setNotes] = useState("")

  const submitAdd = () => {
    if (!exDate) {
      toast.error(ar ? "حدد تاريخ الإجراء (ex-date)" : "Pick the ex-date")
      return
    }
    const body: Record<string, unknown> = { companyId, actionType: type, exDate, ...(notes.trim() ? { notes: notes.trim() } : {}) }
    if (type === "cash_dividend") {
      const c = Number(cash)
      if (!cash.trim() || !Number.isFinite(c) || c <= 0) {
        toast.error(ar ? "اكتب التوزيعة النقدية للسهم (أكبر من صفر)" : "Cash per share must be > 0")
        return
      }
      body.cashPerShare = c
    } else if (type === "merger") {
      // exchange ratio OPTIONAL — empty records an informational merger
      if (ratio.trim()) {
        const s = Number(ratio)
        if (!Number.isFinite(s) || s <= 0) {
          toast.error(ar ? "نسبة التبادل لازم تكون رقم أكبر من صفر" : "Exchange ratio must be > 0")
          return
        }
        // string form keeps the typed decimals exact ("0.35" stays 7/20)
        body.sharesPerShare = ratio.trim()
      }
    } else {
      const s = Number(ratio)
      if (!ratio.trim() || !Number.isFinite(s) || s <= 0) {
        toast.error(ar ? "اكتب كام سهم لكل سهم (أكبر من صفر)" : "Shares per share must be > 0")
        return
      }
      body.sharesPerShare = ratio.trim()
      if (type === "rights") {
        const sp = Number(subPrice)
        if (!subPrice.trim() || !Number.isFinite(sp) || sp <= 0) {
          toast.error(ar ? "اكتب سعر الاكتتاب" : "Subscription price must be > 0")
          return
        }
        body.subscriptionPrice = sp
      }
    }
    write.mutate(
      { method: "POST", body },
      {
        onSuccess: () => {
          // reset only the add-form fields (the company context stays)
          setRatio("")
          setSubPrice("")
          setCash("")
          setExDate("")
          setNotes("")
        },
      },
    )
  }

  // ── gap detection ───────────────────────────────────────────────────────────
  const [gaps, setGaps] = useState<ActionGap[] | null>(null)
  const detect = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/v1/admin/corporate-actions?detect=${encodeURIComponent(companyId)}`, { credentials: "include" })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; gaps?: ActionGap[] }
      if (!r.ok || j.ok === false) throw new Error(`HTTP ${r.status}`)
      return j.gaps ?? []
    },
    onSuccess: (g) => setGaps(g),
    onError: () => toast.error(ar ? "فشل فحص الفجوات" : "Gap scan failed"),
  })

  const ratioText = (a: CompanyActionRow): string => {
    if (a.actionType === "cash_dividend") return a.cashPerShare != null ? `${a.cashPerShare} ج` : "—"
    if (a.actionType === "merger" && a.sharesPerShare == null) return ar ? "معلوماتي" : "info"
    return a.sharesPerShare != null ? `${a.sharesPerShare} سهم/سهم` : "—"
  }

  const actions = listQ.data?.actions ?? []

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {ar
          ? "سجل الإجراء هنا والسيرفر يطبّق التعديل تلقائيًا على الشارت والتحليل الفني في يوم الإجراء — من غير ما تعدّل أي شارت يدويًا."
          : "Record the action here — the engine rescales the chart/technical series on the ex-date automatically."}
      </p>

      {/* add form */}
      <div className="space-y-2 rounded-lg border border-border/60 p-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">{ar ? "النوع" : "Type"}</Label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
              aria-label={ar ? "نوع الإجراء" : "Action type"}
            >
              {(["stock_dividend", "split", "merger", "rights", "cash_dividend"] as const).map((t) => (
                <option key={t} value={t}>
                  {ACTION_TYPE_AR[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">{ar ? "تاريخ الإجراء" : "Ex-date"}</Label>
            <Input type="date" dir="ltr" className="h-8 text-xs" value={exDate} onChange={(e) => setExDate(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {type === "cash_dividend" ? (
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">{ar ? "التوزيعة (جنيه/سهم)" : "Cash/share"}</Label>
              <Input type="number" min={0} step="0.01" dir="ltr" className="h-8 text-xs" value={cash} onChange={(e) => setCash(e.target.value)} />
            </div>
          ) : (
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">
                {ar
                  ? type === "merger"
                    ? "نسبة التبادل (اختياري)"
                    : "كام سهم لكل سهم"
                  : type === "merger"
                    ? "Exchange ratio (optional)"
                    : "Shares per share"}
              </Label>
              <Input type="number" min={0} step="0.0001" dir="ltr" className="h-8 text-xs" value={ratio} onChange={(e) => setRatio(e.target.value)} />
            </div>
          )}
          {type === "rights" ? (
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">{ar ? "سعر الاكتتاب" : "Sub. price"}</Label>
              <Input type="number" min={0} step="0.01" dir="ltr" className="h-8 text-xs" value={subPrice} onChange={(e) => setSubPrice(e.target.value)} />
            </div>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">{ar ? "ملاحظات (اختياري)" : "Notes (optional)"}</Label>
          <Input className="h-8 text-xs" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={ar ? "مصدر الإعلان…" : "announcement source…"} />
        </div>
        <Button size="sm" className="w-full" disabled={write.isPending} onClick={submitAdd}>
          {write.isPending ? (ar ? "بيسجل…" : "Saving…") : ar ? "سجل الإجراء" : "Record action"}
        </Button>
      </div>

      {/* recorded actions for THIS company */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold">{ar ? `الإجراءات المسجلة (${actions.length})` : `Recorded (${actions.length})`}</p>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={detect.isPending} onClick={() => detect.mutate()}>
            {detect.isPending ? (ar ? "بيفحص…" : "scanning…") : ar ? "فحص الفجوات" : "Scan gaps"}
          </Button>
        </div>
        {listQ.isLoading ? (
          <p className="py-2 text-[11px] text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
        ) : actions.length === 0 ? (
          <p className="py-2 text-[11px] text-muted-foreground">{ar ? "مفيش إجراءات مسجلة للشركة دي" : "No recorded actions"}</p>
        ) : (
          actions.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium">
                  {ACTION_TYPE_AR[a.actionType] ?? a.actionType}
                  <span className="ms-1 tabular-nums text-muted-foreground" dir="ltr">
                    {a.exDate.slice(0, 10)}
                  </span>
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {ratioText(a)}
                  {a.notes ? <span className="ms-1">· {a.notes}</span> : null}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 shrink-0 p-0 text-red-500"
                title={ar ? "حذف" : "Delete"}
                disabled={write.isPending}
                onClick={() => {
                  if (confirm(ar ? `حذف ${ACTION_TYPE_AR[a.actionType] ?? a.actionType} ${a.exDate.slice(0, 10)}؟` : `Delete ${a.actionType} ${a.exDate.slice(0, 10)}?`)) {
                    write.mutate({ method: "DELETE", body: { id: a.id } })
                  }
                }}
              >
                ×
              </Button>
            </div>
          ))
        )}
      </div>

      {/* gap scan results */}
      {gaps ? (
        <div className="space-y-1 rounded-lg border border-border/60 p-2">
          {gaps.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{ar ? "مفيش فجوات مشبوهة فوق 12% في السلسلة." : "No suspicious >12% drops."}</p>
          ) : (
            gaps.map((g) => (
              <p key={`${g.ts}-${g.prevTs}`} className={`text-[11px] ${g.hasAction ? "text-muted-foreground" : "font-semibold text-amber-600 dark:text-amber-400"}`}>
                {g.hasAction
                  ? `${ar ? "هبوط" : "drop"} ${g.dropPct}% ${g.ts} — ${ar ? "مغطى بإجراء مسجل" : "covered by a recorded action"}`
                  : `${ar ? "فجوة مشبوهة" : "suspicious gap"} ${g.dropPct}% ${g.ts}`}
              </p>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}


// =============================================================================
// CompanyTab — company identity edited LIVE (owner mandate 2026-11-16: "الادمن
// يقدر يعدل على كل تفصيلة صغيرة في الموقع"): ticker, names, sector, market
// tier, and the excludeFromRankings pull-out (an illogical figure leaves the
// rankings / valuation screen / sector medians without touching the data).
// PATCHes /api/v1/admin/company-ops (audited) and invalidates all queries.
// =============================================================================

function CompanyTab({ data, companyId, ar }: { data: EditorPayload | undefined; companyId: string; ar: boolean }) {
  const qc = useQueryClient()
  const co = data?.company
  const [ticker, setTicker] = useState("")
  const [nameEn, setNameEn] = useState("")
  const [nameAr, setNameAr] = useState("")
  const [sector, setSector] = useState("")
  const [tier, setTier] = useState("")
  const [exclude, setExclude] = useState(false)

  useEffect(() => {
    if (!co) return
    queueMicrotask(() => {
      setTicker(co.ticker)
      setNameEn(co.nameEn)
      setNameAr(co.nameAr ?? "")
      setSector(co.sector ?? "")
      setTier(co.marketTier ?? "")
      setExclude(co.excludeFromRankings ?? false)
    })
  }, [co])

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const r = await fetch("/api/v1/admin/company-ops", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: companyId, ...body }),
      })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!r.ok || j.ok === false) throw new Error(j.error ?? `HTTP ${r.status}`)
      return j
    },
    onSuccess: () => {
      toast.success(ar ? "اتحفظ — كل صفحات الموقع بتتحدث بالقيمة الجديدة" : "Saved — every surface refetches now")
      void qc.invalidateQueries()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : ar ? "فشل الحفظ" : "Save failed"),
  })

  if (!data) return <p className="py-4 text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>

  const dirty = co && (ticker !== co.ticker || nameEn !== co.nameEn || nameAr !== (co.nameAr ?? "") || sector !== (co.sector ?? "") || tier !== (co.marketTier ?? "") || exclude !== (co.excludeFromRankings ?? false))

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">{ar ? "الرمز (ticker)" : "Ticker"}</Label>
          <Input className="h-8 text-xs" dir="ltr" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">{ar ? "القطاع" : "Sector"}</Label>
          <select value={sector} onChange={(e) => setSector(e.target.value)} className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs" aria-label={ar ? "القطاع" : "Sector"}>
            {SECTORS.map((sec) => (
              <option key={sec} value={sec}>{sec}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">{ar ? "الاسم بالإنجليزية" : "Name (EN)"}</Label>
        <Input className="h-8 text-xs" dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">{ar ? "الاسم بالعربية" : "Name (AR)"}</Label>
        <Input className="h-8 text-xs" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">{ar ? "الطبقة السوقية" : "Market tier"}</Label>
        <select value={tier} onChange={(e) => setTier(e.target.value)} className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs" aria-label={ar ? "الطبقة السوقية" : "Market tier"}>
          {MARKET_TIERS.map((t) => (
            <option key={t} value={t}>{ar ? TIER_AR[t].full : TIER_AR[t].en}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
        <div className="min-w-0 pe-2">
          <p className="text-[11px] font-medium">{ar ? "استبعاد من كل الترتيبات" : "Exclude from all rankings"}</p>
          <p className="text-[10px] text-muted-foreground">
            {ar ? "لما رقم يبقى غير منطقي — تختفي من الترتيبات وفحص التقييم ومن وسط القطاع (من غير حذف بيانات)." : "Hides from rankings, valuation screen and sector medians — data stays intact."}
          </p>
        </div>
        <Switch checked={exclude} onCheckedChange={(v) => setExclude(v)} aria-label={ar ? "استبعاد من الترتيبات" : "Exclude from rankings"} />
      </div>
      <Button
        size="sm"
        className="w-full"
        disabled={!dirty || save.isPending}
        onClick={() =>
          save.mutate({
            ...(ticker !== co?.ticker ? { ticker } : {}),
            ...(nameEn !== co?.nameEn ? { nameEn } : {}),
            ...(nameAr !== (co?.nameAr ?? "") ? { nameAr } : {}),
            ...(sector !== (co?.sector ?? "") ? { sector } : {}),
            ...(tier !== (co?.marketTier ?? "") ? { marketTier: tier } : {}),
            ...(exclude !== (co?.excludeFromRankings ?? false) ? { excludeFromRankings: exclude } : {}),
          })
        }
      >
        {save.isPending ? (ar ? "بيحفظ…" : "Saving…") : ar ? "حفظ بيانات الشركة" : "Save company"}
      </Button>
    </div>
  )
}