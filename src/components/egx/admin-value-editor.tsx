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
// Every save PATCHes /api/v1/admin/company-values (audited server-side) and
// invalidates the client queries — the page reflects the change immediately.
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
  company: { id: string; ticker: string; nameEn: string; sharesOutstanding: number | null }
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
