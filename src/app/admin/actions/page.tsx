"use client"

// إجراءات الشركات — شاشة الإدارة.
// تسجيل الإجراء (اكتتاب / بونص / تقسيم / توزيعة نقدية) هنا بمجرد الإعلان،
// ومحرك التعديل في السيرفر بيطبّقه تلقائيًا على الأسعار والتحليل الفني في
// يوم الإجراء (ex-date). الصفحة دي كذلك بتشخّص الفجوات المشبوهة، وتحدّث
// تصنيف السوق، وتستوعب شموع سنة كاملة لكل سهم.

import { Fragment, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  ChevronDown,
  Database,
  Layers,
  Plus,
  Search,
  Trash2,
  TrendingDown,
} from "lucide-react"
import { TIER_AR, MARKET_TIERS } from "@/lib/market/tiers"

interface Co {
  id: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
}

interface ActionRow {
  id: string
  companyId: string
  ticker: string | null
  nameAr?: string | null
  actionType: string
  sharesPerShare: number | null
  cashPerShare: number | null
  exDate: string
  subscriptionPrice: number | null
  status: string | null
  sourceName: string
  notes: string | null
  createdAt: string
}

interface Gap {
  ts: string
  prevTs: string
  dropPct: number
  hasAction: boolean
}

interface TierSeedResult {
  ok?: boolean
  error?: string
  message?: string
  seeded?: Record<string, { matched?: number; unmatched?: string[] | number }>
  otcSwept?: number
  matched?: number
  unmatched?: number
  results?: { list?: string; label?: string; matched?: number; unmatched?: string[] | number }[]
}

const TYPE_AR: Record<string, string> = {
  rights: "اكتتاب (حق انتساب)",
  stock_dividend: "توزيع أسهم مجانية (بونص)",
  split: "تقسيم",
  cash_dividend: "توزيعة نقدية",
  other: "أخرى",
}

// تصنيفات السوق — من lib/market/tiers (تسميات عربية قصيرة، مع حماية لو
// الملف/المفتاح مش موجود بعد).
const TIER_REC = (TIER_AR ?? {}) as Record<string, { short?: string; full?: string; en?: string }>
const TIER_KEYS: string[] = (Array.isArray(MARKET_TIERS) ? MARKET_TIERS : []) as string[]
const tierLabel = (t: string): string => TIER_REC[t]?.short ?? t

const fmtNum = (n: number): string => String(Number(n.toFixed(6)))
const day = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : "—")

function numOrUndef(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v ? v.slice(0, 10) : null
}

export default function AdminActionsPage() {
  const router = useRouter()
  const qc = useQueryClient()
  const [adminOk, setAdminOk] = useState<boolean | null>(null)

  // ── gate ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    fetch("/api/v1/admin/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        setAdminOk(!!d.isAdmin)
        if (!d.isAdmin) router.replace("/admin/login")
      })
      .catch(() => {
        if (cancelled) return
        setAdminOk(false)
        router.replace("/admin/login")
      })
    return () => {
      cancelled = true
    }
  }, [router])

  // ── data ───────────────────────────────────────────────────────────────────
  const companiesQ = useQuery({
    queryKey: ["admin-actions-companies"],
    enabled: adminOk === true,
    queryFn: () =>
      fetch("/api/v1/admin/company-ops", { credentials: "include" }).then((r) =>
        r.ok ? (r.json() as Promise<{ companies: Co[] }>) : { companies: [] as Co[] }
      ),
  })
  const companies = companiesQ.data?.companies ?? []

  const actionsQ = useQuery({
    queryKey: ["admin-corporate-actions"],
    enabled: adminOk === true,
    queryFn: () =>
      fetch("/api/v1/admin/corporate-actions", { credentials: "include" }).then((r) =>
        r.ok ? (r.json() as Promise<{ actions: ActionRow[] }>) : { actions: [] as ActionRow[] }
      ),
  })
  const actions = actionsQ.data?.actions ?? []

  // ── form state ─────────────────────────────────────────────────────────────
  const [coSearch, setCoSearch] = useState("")
  const [companyId, setCompanyId] = useState("")
  const [actionType, setActionType] = useState<"rights" | "stock_dividend" | "split" | "cash_dividend">("stock_dividend")
  const [sharesPerShare, setSharesPerShare] = useState("")
  const [subscriptionPrice, setSubscriptionPrice] = useState("")
  const [cashPerShare, setCashPerShare] = useState("")
  const [exDate, setExDate] = useState("")
  const [notes, setNotes] = useState("")

  const filteredCompanies = useMemo(
    () =>
      companies.filter(
        (c) =>
          !coSearch ||
          c.ticker.toLowerCase().includes(coSearch.toLowerCase()) ||
          (c.nameAr || "").includes(coSearch) ||
          c.nameEn.toLowerCase().includes(coSearch.toLowerCase())
      ),
    [companies, coSearch]
  )

  const resetForm = () => {
    setCompanyId("")
    setActionType("stock_dividend")
    setSharesPerShare("")
    setSubscriptionPrice("")
    setCashPerShare("")
    setExDate("")
    setNotes("")
  }

  // ── add ────────────────────────────────────────────────────────────────────
  const addAction = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const r = await fetch("/api/v1/admin/corporate-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error ?? `فشل تسجيل الإجراء (${r.status})`)
      return j
    },
    onSuccess: () => {
      toast.success("اتسجل الإجراء", { description: "التعديل اتطبق تلقائيًا على التحليل الفني — من غير ما تعدّل أي شارت يدويًا." })
      qc.invalidateQueries({ queryKey: ["admin-corporate-actions"] })
      resetForm()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل تسجيل الإجراء"),
  })

  const submit = () => {
    if (!companyId) return toast.error("اختار الشركة الأول")
    if (!exDate) return toast.error("حدد تاريخ الإجراء (ex-date)")
    if (actionType === "cash_dividend") {
      const cash = Number(cashPerShare)
      if (!cashPerShare.trim() || !Number.isFinite(cash) || cash <= 0) return toast.error("اكتب التوزيعة النقدية للسهم (رقم أكبر من صفر)")
    } else {
      const s = Number(sharesPerShare)
      if (!sharesPerShare.trim() || !Number.isFinite(s) || s <= 0) return toast.error("اكتب كام سهم لكل سهم (رقم أكبر من صفر)")
      if (actionType === "rights") {
        const sub = Number(subscriptionPrice)
        if (!subscriptionPrice.trim() || !Number.isFinite(sub) || sub <= 0) return toast.error("اكتب سعر الاكتتاب للسهم الجديد (رقم أكبر من صفر)")
      }
    }
    addAction.mutate({
      companyId,
      actionType,
      // الإرسال كنص بيحافظ على الكسور العشرية زي ما هي (0.35 بتفضل 7/20 مش 0.35 البتاع الفلود)
      ...(actionType === "cash_dividend" ? { cashPerShare: Number(cashPerShare) } : { sharesPerShare: sharesPerShare.trim() }),
      ...(actionType === "rights" ? { subscriptionPrice: Number(subscriptionPrice) } : {}),
      exDate,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    })
  }

  // ── delete ─────────────────────────────────────────────────────────────────
  const del = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/v1/admin/corporate-actions?id=${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error ?? `فشل الحذف (${r.status})`)
    },
    onSuccess: () => {
      toast.success("اتحذف الإجراء")
      qc.invalidateQueries({ queryKey: ["admin-corporate-actions"] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل حذف الإجراء"),
  })

  // ── gap detector ───────────────────────────────────────────────────────────
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [gapsByCompany, setGapsByCompany] = useState<Record<string, Gap[]>>({})

  const detect = useMutation({
    mutationFn: async (cid: string) => {
      const r = await fetch(`/api/v1/admin/corporate-actions?detect=${encodeURIComponent(cid)}`, { credentials: "include" })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error ?? `فشل فحص الفجوات (${r.status})`)
      return (j.gaps ?? []) as Gap[]
    },
    onSuccess: (gaps, cid) => setGapsByCompany((prev) => ({ ...prev, [cid]: gaps })),
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل فحص الفجوات"),
  })

  const toggleExpand = (a: ActionRow) => {
    const next = expandedId === a.id ? null : a.id
    setExpandedId(next)
    if (next && a.companyId && !gapsByCompany[a.companyId] && !detect.isPending) detect.mutate(a.companyId)
  }

  // ── market tiers ───────────────────────────────────────────────────────────
  const [tierTicker, setTierTicker] = useState("")
  const [tierValue, setTierValue] = useState<string>("")
  const [tierSeedResult, setTierSeedResult] = useState<TierSeedResult | null>(null)

  const tierSeed = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/v1/admin/market-tier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "seed" }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) throw new Error(j.message ?? j.error ?? `فشل تحديث التصنيف (${r.status})`)
      return j as TierSeedResult
    },
    onSuccess: (j) => {
      setTierSeedResult(j)
      toast.success("تحديث التصنيف خلص")
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل تحديث التصنيف"),
  })

  const tierSet = useMutation({
    mutationFn: async (v: { ticker: string; tier: string }) => {
      const r = await fetch("/api/v1/admin/market-tier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "set", ...v }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) throw new Error(j.message ?? j.error ?? `فشل ضبط التصنيف (${r.status})`)
      return j
    },
    onSuccess: () => toast.success("اتحدث تصنيف السهم"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل ضبط التصنيف"),
  })

  // ── candles ingestion (سنة شموع لكل سهم، 25 شركة في الدفعة) ─────────────────
  const [candleProgress, setCandleProgress] = useState<string | null>(null)
  const [candleStats, setCandleStats] = useState<{ with200?: number; total?: number; oldest?: string | null } | null>(null)

  const candleIngest = useMutation({
    mutationFn: async () => {
      let cursor: string | undefined
      let iterations = 0
      let fetched = 0
      let lastStats: Record<string, unknown> | null = null
      while (iterations < 40) {
        iterations++
        const r = await fetch("/api/v1/admin/candles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          // بنترسل المفتاحين بالشكلين (cursor و nextCursor) — الاندماج النهائي هيربط النقل اللي في السيرفر
          body: JSON.stringify({ limit: 25, ...(cursor ? { cursor, nextCursor: cursor } : {}) }),
        })
        const j = (await r.json().catch(() => ({}))) as {
          ok?: boolean
          done?: boolean
          nextCursor?: string | null
          processed?: number
          succeeded?: number
          total?: number
          stats?: Record<string, unknown>
          error?: string
        }
        if (!r.ok || j.ok === false) throw new Error(j.error ?? `فشل الاستيعاب (${r.status})`)
        if (j.stats && typeof j.stats === "object") lastStats = j.stats
        const batch = Number(j.processed ?? 0)
        if (Number.isFinite(batch) && batch > 0) fetched += batch
        const totalSrv = Number(j.total ?? 0)
        setCandleProgress(
          totalSrv > 0
            ? `اتجلب ${fetched} من ${totalSrv} شركة… (دفعة ${iterations})`
            : `اتجلب ${fetched} شركة… (دفعة ${iterations})`
        )
        // حارس ضد اللوب اللانهائي: إما done من السيرفر أو 40 دفعة كحد أقصى.
        if (j.done === true || !j.nextCursor) break
        cursor = j.nextCursor
      }
      try {
        const sr = await fetch("/api/v1/admin/candles", { credentials: "include" })
        const sj = (await sr.json().catch(() => ({}))) as Record<string, unknown>
        if (sr.ok) {
          const s = ((sj.stats ?? sj) ?? {}) as Record<string, unknown>
          setCandleStats({
            with200: numOrUndef(s.companiesWith200Plus ?? s.companiesWith300Plus ?? s.with300),
            total: numOrUndef(s.totalCompanies ?? s.total ?? s.companies) ?? (companies.length || undefined),
            oldest: strOrNull(s.oldestBar ?? s.oldestSession ?? s.oldest),
          })
        } else if (lastStats) {
          setCandleStats({
            with200: numOrUndef(lastStats.companiesWith200Plus ?? lastStats.companiesWith300Plus),
            total: companies.length || undefined,
            oldest: strOrNull(lastStats.oldestBar),
          })
        }
      } catch {
        if (lastStats) {
          setCandleStats({
            with200: numOrUndef(lastStats.companiesWith200Plus ?? lastStats.companiesWith300Plus),
            total: companies.length || undefined,
            oldest: strOrNull(lastStats.oldestBar),
          })
        }
      }
      return { iterations }
    },
    onSuccess: () => {
      setCandleProgress(null)
      toast.success("الاستيعاب خلص — الشموع متخزنة والتحليل الفني بيشتغل عليها")
    },
    onError: (e) => {
      setCandleProgress(null)
      toast.error(e instanceof Error ? e.message : "فشل الاستيعاب")
    },
  })

  // ── render helpers ─────────────────────────────────────────────────────────
  const ratioText = (a: ActionRow): string => {
    if (a.actionType === "cash_dividend") return a.cashPerShare != null ? `${fmtNum(a.cashPerShare)} جنيه للسهم` : "—"
    return a.sharesPerShare != null ? `${fmtNum(a.sharesPerShare)} سهم لكل سهم` : "—"
  }

  const statusBadge = (a: ActionRow) => {
    const st = a.status
    const label = st === "upcoming" ? "قادم" : st === "executed" ? "تم التنفيذ" : (st ?? "—")
    const cls =
      st === "upcoming"
        ? "border-amber-500/40 text-amber-600"
        : st === "executed"
          ? "border-emerald-500/40 text-emerald-600"
          : ""
    return (
      <Badge variant="outline" className={`text-[9px] ${cls}`}>
        {label}
      </Badge>
    )
  }

  if (adminOk === null || adminOk === false) return null

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4" dir="rtl">
      {/* a) الهيدر */}
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <Layers className="h-5 w-5 text-primary" />
          إجراءات الشركات — اكتتاب / توزيع أسهم / تقسيم
        </h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          سجل الإجراء هنا بمجرد الإعلان، والسيرفر بيطبّق التعديل تلقائيًا على الأسعار والتحليل الفني في يوم الإجراء (ex-date) — من غير ما تحتاج تعدّل أي شارت يدويًا.
        </p>
      </div>

      {/* b) إضافة إجراء جديد */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Plus className="h-4 w-4 text-primary" />
            إضافة إجراء جديد
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">الشركة</Label>
              <div className="relative">
                <Search className="absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="فلترة بالكود أو الاسم…"
                  value={coSearch}
                  onChange={(e) => setCoSearch(e.target.value)}
                  className="h-9 ps-7 text-xs"
                />
              </div>
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                aria-label="اختيار الشركة"
              >
                <option value="">— اختار الشركة ({filteredCompanies.length}) —</option>
                {filteredCompanies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.ticker} — {c.nameAr || c.nameEn}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">نوع الإجراء</Label>
              <select
                value={actionType}
                onChange={(e) => setActionType(e.target.value as typeof actionType)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                aria-label="نوع الإجراء"
              >
                <option value="rights">{TYPE_AR.rights}</option>
                <option value="stock_dividend">{TYPE_AR.stock_dividend}</option>
                <option value="split">{TYPE_AR.split}</option>
                <option value="cash_dividend">{TYPE_AR.cash_dividend}</option>
              </select>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {actionType === "cash_dividend"
                  ? "التوزيعة النقدية بتتخصم من سعر الإغلاق السابق في يوم الإجراء."
                  : actionType === "rights"
                    ? "الاكتتاب بيتحسب بمعادلة TERP — سعر الاكتتاب لازم."
                    : actionType === "split"
                      ? "التقسيم بيقسم سعر الإغلاق السابق على النسبة."
                      : "البونص بيضبط الإغلاق السابق على معامل (1 + النسبة)."}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {actionType !== "cash_dividend" && (
              <div className="space-y-1.5">
                <Label className="text-xs">كام سهم لكل سهم؟</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  placeholder="مثال: 0.5"
                  value={sharesPerShare}
                  onChange={(e) => setSharesPerShare(e.target.value)}
                  className="h-9 text-xs tabular-nums"
                />
                <p className="text-[10px] text-muted-foreground">0.5 = نص سهم، 1 = سهم لكل سهم</p>
              </div>
            )}

            {actionType === "rights" && (
              <div className="space-y-1.5">
                <Label className="text-xs">سعر الاكتتاب للسهم الجديد (جنيه)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  placeholder="مثال: 10"
                  value={subscriptionPrice}
                  onChange={(e) => setSubscriptionPrice(e.target.value)}
                  className="h-9 text-xs tabular-nums"
                />
              </div>
            )}

            {actionType === "cash_dividend" && (
              <div className="space-y-1.5">
                <Label className="text-xs">التوزيعة النقدية للسهم (جنيه)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  placeholder="مثال: 1.2"
                  value={cashPerShare}
                  onChange={(e) => setCashPerShare(e.target.value)}
                  className="h-9 text-xs tabular-nums"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">تاريخ الإجراء — اليوم اللي السهم هيتقسم فيه (ex-date)</Label>
              <Input
                type="date"
                dir="ltr"
                value={exDate}
                onChange={(e) => setExDate(e.target.value)}
                className="h-9 text-xs tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">ملاحظات (اختياري)</Label>
            <Textarea
              placeholder="مصدر الإعلان أو أي تفاصيل…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[64px] text-xs"
            />
          </div>

          <Button onClick={submit} disabled={addAction.isPending} className="w-full sm:w-auto">
            {addAction.isPending ? "بيسجل…" : "سجل الإجراء"}
          </Button>
        </CardContent>
      </Card>

      {/* c) الإجراءات المسجلة */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">الإجراءات المسجلة ({actions.length})</CardTitle>
          <Button variant="outline" size="sm" onClick={() => actionsQ.refetch()} disabled={actionsQ.isFetching}>
            تحديث
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[560px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b">
                  <th className="p-2 text-start">الكود</th>
                  <th className="p-2 text-start">النوع</th>
                  <th className="p-2 text-start">النسبة</th>
                  <th className="p-2 text-start">تاريخ الإجراء</th>
                  <th className="p-2 text-start">سعر الاكتتاب</th>
                  <th className="p-2 text-center">الحالة</th>
                  <th className="p-2 text-center">المصدر</th>
                  <th className="p-2 text-center">أوامر</th>
                </tr>
              </thead>
              <tbody>
                {actionsQ.isLoading ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-muted-foreground">بيجيب الإجراءات…</td>
                  </tr>
                ) : actions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-muted-foreground">مفيش إجراءات مسجلة لسه</td>
                  </tr>
                ) : (
                  actions.map((a) => (
                    <Fragment key={a.id}>
                      <tr className="border-b hover:bg-muted/40">
                        <td className="p-2">
                          <span className="font-mono font-semibold" dir="ltr">{a.ticker ?? "—"}</span>
                          {a.nameAr ? <span className="block text-[10px] text-muted-foreground">{a.nameAr}</span> : null}
                        </td>
                        <td className="p-2">{TYPE_AR[a.actionType] ?? a.actionType}</td>
                        <td className="p-2 tabular-nums">{ratioText(a)}</td>
                        <td className="p-2 font-mono tabular-nums" dir="ltr">{day(a.exDate)}</td>
                        <td className="p-2 tabular-nums">{a.subscriptionPrice != null ? fmtNum(a.subscriptionPrice) : "—"}</td>
                        <td className="p-2 text-center">{statusBadge(a)}</td>
                        <td className="p-2 text-center">
                          <Badge variant="secondary" className="text-[9px]">
                            {a.sourceName === "MANUAL_ADMIN" ? "إداري" : "استيراد"}
                          </Badge>
                        </td>
                        <td className="p-2">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[10px]"
                              title="فحص الفجوات"
                              onClick={() => toggleExpand(a)}
                            >
                              <ChevronDown className={`h-3 w-3 transition-transform ${expandedId === a.id ? "rotate-180" : ""}`} />
                              فحص الفجوات
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-red-500"
                              title="حذف الإجراء"
                              onClick={() => {
                                if (confirm(`حذف إجراء ${a.ticker ?? ""} (${TYPE_AR[a.actionType] ?? a.actionType}) بتاريخ ${day(a.exDate)}؟`)) del.mutate(a.id)
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {expandedId === a.id && (
                        <tr className="border-b bg-muted/20">
                          <td colSpan={8} className="p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[10px]"
                                onClick={() => a.companyId && detect.mutate(a.companyId)}
                                disabled={detect.isPending && detect.variables === a.companyId}
                              >
                                <TrendingDown className="h-3 w-3" />
                                {detect.isPending && detect.variables === a.companyId ? "بيفحص…" : "فحص الفجوات من جديد"}
                              </Button>
                              {a.notes ? <span className="text-[10px] text-muted-foreground">ملاحظات: {a.notes}</span> : null}
                            </div>
                            {(() => {
                              const gaps = a.companyId ? gapsByCompany[a.companyId] : undefined
                              if (detect.isPending && detect.variables === a.companyId) {
                                return <p className="mt-2 text-[11px] text-muted-foreground">بيفحص السلسلة…</p>
                              }
                              if (!gaps) return null
                              if (gaps.length === 0) {
                                return <p className="mt-2 text-[11px] text-muted-foreground">مفيش فجوات مشبوهة فوق 12% في السلسلة.</p>
                              }
                              return (
                                <ul className="mt-2 space-y-1">
                                  {gaps.map((g) => (
                                    <li
                                      key={`${g.ts}-${g.prevTs}`}
                                      className={`text-[11px] ${g.hasAction ? "text-muted-foreground" : "font-semibold text-amber-600 dark:text-amber-400"}`}
                                    >
                                      {g.hasAction
                                        ? `هبوط ${g.dropPct}% يوم ${g.ts} — مغطى بإجراء مسجل (خلال ±3 أيام).`
                                        : `فجوة مشبوهة ${g.dropPct}% يوم ${g.ts} من غير إجراء مسجل`}
                                    </li>
                                  ))}
                                </ul>
                              )
                            })()}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* d) تصنيف السوق */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Layers className="h-4 w-4 text-primary" />
            تصنيف السوق
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => tierSeed.mutate()}
              disabled={tierSeed.isPending}
              className="h-9 text-xs"
            >
              {tierSeed.isPending ? "بيحدّث…" : "تحديث التصنيف من القوائم الرسمية (مؤشر 30/70 + النيل + خارج المقصورة)"}
            </Button>
            {tierSeedResult && (
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                {typeof tierSeedResult.matched === "number" && typeof tierSeedResult.unmatched === "number" ? (
                  <span className="text-muted-foreground">
                    متطابق: {tierSeedResult.matched} — غير متطابق: {tierSeedResult.unmatched}
                  </span>
                ) : null}
                {tierSeedResult.seeded &&
                  Object.entries(tierSeedResult.seeded).map(([tier, v]) => {
                    const un = Array.isArray(v?.unmatched) ? v.unmatched.length : typeof v?.unmatched === "number" ? v.unmatched : undefined
                    return (
                      <Badge key={`seed-${tier}`} variant="outline" className="text-[9px]">
                        {tierLabel(tier)}: متطابق {v?.matched ?? 0}
                        {un !== undefined ? ` / غير موجود ${un}` : ""}
                      </Badge>
                    )
                  })}
                {typeof tierSeedResult.otcSwept === "number" && tierSeedResult.otcSwept > 0 ? (
                  <span className="text-muted-foreground">اتنقلوا لخارج المقصورة: {tierSeedResult.otcSwept}</span>
                ) : null}
                {Array.isArray(tierSeedResult.results) &&
                  tierSeedResult.results.map((r, i) => {
                    const un = Array.isArray(r?.unmatched) ? r.unmatched.length : typeof r?.unmatched === "number" ? r.unmatched : undefined
                    return (
                      <Badge key={`${r.list ?? i}-${i}`} variant="outline" className="text-[9px]">
                        {r.label ?? r.list ?? "قائمة"}: متطابق {r.matched ?? 0}
                        {un !== undefined ? ` / غير موجود ${un}` : ""}
                      </Badge>
                    )
                  })}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">الكود</Label>
              <Input
                dir="ltr"
                placeholder="CANA"
                value={tierTicker}
                onChange={(e) => setTierTicker(e.target.value.toUpperCase())}
                className="h-9 w-28 font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">التصنيف</Label>
              <select
                value={tierValue}
                onChange={(e) => setTierValue(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                aria-label="تصنيف السوق"
              >
                <option value="">— اختار —</option>
                {TIER_KEYS.map((t) => (
                  <option key={t} value={t}>
                    {tierLabel(t)}
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="outline"
              className="h-9 text-xs"
              disabled={tierSet.isPending || !tierTicker.trim() || !tierValue}
              onClick={() => tierSet.mutate({ ticker: tierTicker.trim(), tier: tierValue })}
            >
              {tierSet.isPending ? "بيضبط…" : "اضبط التصنيف"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* e) استيعاب شموع السنة */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Database className="h-4 w-4 text-primary" />
            استيعاب شموع السنة (365 جلسة)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            يجلب آخر سنة شموع OHLCV من Yahoo لكل سهم ويخزنها — التحليل الفني بيشتغل على البيانات دي.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => candleIngest.mutate()} disabled={candleIngest.isPending} className="h-9 text-xs">
              {candleIngest.isPending ? "شغال…" : "ابدأ الاستيعاب"}
            </Button>
            {candleProgress && <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">{candleProgress}</span>}
          </div>
          {candleStats && (candleStats.with200 !== undefined || candleStats.oldest) && (
            <p className="text-[11px] text-muted-foreground">
              الشركات اللي عندها 200+ جلسة: {candleStats.with200 ?? "—"}
              {candleStats.total !== undefined ? ` من ${candleStats.total}` : ""}
              {candleStats.oldest ? ` — أقدم جلسة: ${candleStats.oldest}` : ""}
            </p>
          )}
        </CardContent>
      </Card>

      {/* f) التنويه */}
      <p className="pb-2 text-[10px] leading-relaxed text-muted-foreground">
        الإجراءات مسؤليتك كمسؤول البيانات — اتأكد من التاريخ الرسمي من البورصة قبل التسجيل.
      </p>
    </div>
  )
}
