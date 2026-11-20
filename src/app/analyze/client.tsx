"use client"

// /analyze — «حلل سهمي»: the owner's flagship differentiator. The user enters
// their average buy price; the engine answers hold/wait/exit with every
// reason spelled out, every support/resistance on the table, and the full
// technical reading — in the voice of a market-savvy friend, never a broker's
// sales pitch. The output is analysis, not investment advice; the wording
// keeps that line visible.
//
// Owner fixes (2026-11-18):
//  - AUTH: every call sends the session token via authHeaders() — bare fetch
//    401'd for LOGGED-IN users too, which both showed the sign-in CTA and
//    made the report never appear.
//  - the search input is PERMANENT: clicking elsewhere closes only the
//    results dropdown, never the input itself (the old code hid the whole
//    container via classList — the avg field then jumped into its place).

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BrainCircuit, CircleHelp, LineChart, Loader2,
  Lock, RotateCcw, Scale, Search, ShieldAlert, TrendingDown, TrendingUp, Wallet,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { authHeaders } from "@/lib/client/api"
import type { PositionDecision, PositionReviewResult } from "@/lib/position/types"

interface CompanyHit {
  id: string
  ticker: string
  nameEn: string
  nameAr: string | null
}

const DECISION_STYLE: Record<PositionDecision, { ring: string; bg: string; text: string; chip: string; icon: React.ReactNode }> = {
  hold: {
    ring: "ring-emerald-500/40", bg: "bg-gradient-to-br from-emerald-500/15 to-emerald-500/[0.04]",
    text: "text-emerald-600 dark:text-emerald-400", chip: "bg-emerald-500/10 border-emerald-500/30",
    icon: <TrendingUp className="h-7 w-7" aria-hidden />,
  },
  wait: {
    ring: "ring-amber-500/40", bg: "bg-gradient-to-br from-amber-500/15 to-amber-500/[0.04]",
    text: "text-amber-600 dark:text-amber-400", chip: "bg-amber-500/10 border-amber-500/30",
    icon: <Scale className="h-7 w-7" aria-hidden />,
  },
  exit: {
    ring: "ring-red-500/40", bg: "bg-gradient-to-br from-red-500/15 to-red-500/[0.04]",
    text: "text-red-600 dark:text-red-400", chip: "bg-red-500/10 border-red-500/30",
    icon: <TrendingDown className="h-7 w-7" aria-hidden />,
  },
  take_profit: {
    // the green partial-exit verdict (2026-11-17 owner rule): a profitable
    // position breaking down secures part of the gain — positive tint like
    // "hold", with the Wallet marking the cash being taken off the table
    ring: "ring-emerald-500/40", bg: "bg-gradient-to-br from-emerald-500/15 to-emerald-500/[0.04]",
    text: "text-emerald-600 dark:text-emerald-400", chip: "bg-emerald-500/10 border-emerald-500/30",
    icon: <Wallet className="h-7 w-7" aria-hidden />,
  },
}

export default function AnalyzeClient() {
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<CompanyHit | null>(null)
  const [avgBuy, setAvgBuy] = useState("")
  const [result, setResult] = useState<PositionReviewResult | null>(null)
  const [authNeeded, setAuthNeeded] = useState(false)
  const [limitInfo, setLimitInfo] = useState<{ errorAr: string; upgradeUrl: string } | null>(null)
  /** the user's answer to the deep-loss question (null = not answered yet) */
  const [answeredYes, setAnsweredYes] = useState<boolean | null>(null)
  /** only the RESULTS dropdown opens/closes — the search input is permanent */
  const [showDd, setShowDd] = useState(false)
  const searchWrapRef = useRef<HTMLDivElement>(null)

  // daily quota chip — read-only snapshot, never consumes
  const quota = useQuery({
    queryKey: ["analyze-quota"],
    queryFn: async () => {
      const r = await fetch("/api/v1/position-review", { headers: authHeaders() })
      if (r.status === 401) return { quota: null as null, auth: true }
      if (!r.ok) throw new Error("quota failed")
      return (await r.json()) as { quota: { used: number; limit: number; remaining: number; unlimited: boolean } | null; auth?: boolean }
    },
    refetchOnWindowFocus: false,
  })

  // debounced company search
  const [debounced, setDebounced] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])
  const search = useQuery({
    queryKey: ["analyze-search", debounced],
    enabled: debounced.length >= 2,
    queryFn: async () => {
      const r = await fetch(`/api/v1/companies?search=${encodeURIComponent(debounced)}&pageSize=8&status=active`)
      if (!r.ok) throw new Error("search failed")
      return (await r.json()) as { companies: CompanyHit[] }
    },
  })

  // outside click closes ONLY the dropdown — the input never disappears
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) setShowDd(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  /** «حلل سهم آخر» — clear the pick and the report, keep the avg-buy value */
  const resetForNextStock = () => {
    setSelected(null)
    setResult(null)
    setQuery("")
    setDebounced("")
    setAnsweredYes(null)
    setLimitInfo(null)
    setShowDd(false)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const review = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/v1/position-review", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ companyId: selected!.id, avgBuyPrice: Number(avgBuy) }),
      })
      if (r.status === 401) throw new Error("AUTH")
      if (r.status === 404) throw new Error("NOT_FOUND")
      if (r.status === 400) throw new Error("BAD_INPUT")
      if (r.status === 429) {
        const j = (await r.json()) as { errorAr?: string; upgradeUrl?: string }
        throw Object.assign(new Error("LIMIT"), { limitAr: j.errorAr ?? "", upgradeUrl: j.upgradeUrl ?? "/premium" })
      }
      if (!r.ok) throw new Error("SERVER")
      return (await r.json()) as PositionReviewResult
    },
    onSuccess: (data) => {
      setResult(data)
      setAuthNeeded(false)
      setLimitInfo(null)
      setAnsweredYes(null) // a fresh report starts with the question unanswered
      quota.refetch()
      if (data.notReviewableAr) toast.warning("التحليل غير متاح لهذا السهم الآن")
    },
    onError: (e) => {
      const err = e as Error & { limitAr?: string; upgradeUrl?: string }
      if (err.message === "AUTH") setAuthNeeded(true)
      else if (err.message === "LIMIT") setLimitInfo({ errorAr: err.limitAr ?? "", upgradeUrl: err.upgradeUrl ?? "/premium" })
      else if (err.message === "NOT_FOUND") toast.error("لم نجد هذا السهم — جرّب البحث برمز التداول")
      else if (err.message === "BAD_INPUT") toast.error("متوسط الشراء لازم يكون رقم أكبر من صفر")
      else toast.error("تعذر التحليل الآن — جرّب بعد قليل")
    },
  })

  const hits = useMemo(() => search.data?.companies ?? [], [search.data])
  const avgNum = Number(avgBuy)
  const canSubmit = !!selected && Number.isFinite(avgNum) && avgNum > 0 && !review.isPending
  const qd = quota.data?.quota ?? null

  const submit = () => {
    if (!selected) {
      toast.error("اختر السهم أولًا من البحث")
      return
    }
    if (!(Number.isFinite(avgNum) && avgNum > 0)) {
      toast.error("اكتب متوسط الشراء — رقم أكبر من صفر")
      return
    }
    review.mutate()
  }

  const r = result?.review

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8" dir="rtl">
      {/* header — title tile + quota pill */}
      <header className="flex flex-wrap items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/25 to-primary/5 ring-1 ring-primary/30">
          <BrainCircuit className="h-6 w-6 text-primary" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">حلل سهمي — هل أحتفظ أم أنتظر أم أخرج؟</h1>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            اكتب متوسط سعر شراءك واختر السهم، والمحرك يقرأ الوضع معك كواحد صاحبك فاهم في البورصة: القرار، كل سبب وراه،
            كل الدعوم والمقاومات، والقراءة الفنية كاملة. التحليل مبني على بيانات تداول حقيقية — وهو ليس توصية استثمارية.
          </p>
        </div>
        {qd && (
          <a
            href={qd.unlimited || qd.remaining > 0 ? "#" : "/premium"}
            onClick={(e) => { if (qd.unlimited || qd.remaining > 0) e.preventDefault() }}
            className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold ${qd.unlimited || qd.remaining > 0 ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"}`}
          >
            <span className={`h-2 w-2 rounded-full ${qd.unlimited || qd.remaining > 0 ? "bg-emerald-500" : "bg-red-500"}`} aria-hidden />
            {qd.unlimited
              ? "بريميوم — بلا حدود"
              : qd.remaining === 0
                ? "خلصت حصة اليوم — ترقية ←"
                : `متبقي ${qd.remaining} من ${qd.limit} سهمين النهاردة`}
          </a>
        )}
      </header>

      {(authNeeded || quota.data?.auth) && !result && (
        <Card className="border-primary/40 bg-gradient-to-br from-primary/10 to-primary/[0.03]">
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <Lock className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="flex-1">حلل سهمي متاح للمستخدمين المسجلين — سجّل دخولك (مجانًا) لحساب مركزك، والحصة المجانية سهمان مختلفان يوميًا.</span>
            <a href="/login" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">تسجيل الدخول ←</a>
          </CardContent>
        </Card>
      )}

      {limitInfo && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <Lock className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
            <span className="flex-1">{limitInfo.errorAr}</span>
            <a href={limitInfo.upgradeUrl} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              ترقية لبريميوم — بلا حدود ←
            </a>
          </CardContent>
        </Card>
      )}

      {/* inputs — the search field is PERMANENT, side by side with the avg field */}
      <Card className="shadow-sm">
        <CardContent className="space-y-3 p-4 md:p-5">
          <div className="grid gap-4 md:grid-cols-[1fr_190px_auto] md:items-end">
            <div className="relative space-y-1.5" ref={searchWrapRef}>
              <label htmlFor="ticker-search" className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Search className="h-3.5 w-3.5" aria-hidden /> السهم
              </label>
              <div className="relative">
                <Search className="absolute right-2.5 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input
                  id="ticker-search"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setShowDd(true) }}
                  onFocus={() => setShowDd(true)}
                  placeholder="ابحث برمز التداول أو الاسم…"
                  className="h-11 pr-8"
                  autoComplete="off"
                />
              </div>
              {showDd && debounced.length >= 2 && (
                <div className="absolute z-20 mt-1 w-full divide-y divide-border rounded-lg border bg-background shadow-xl">
                  {search.isLoading ? (
                    <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> جارِ البحث…</div>
                  ) : hits.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">لا نتائج — جرّب رمز التداول (مثل COMI)</div>
                  ) : (
                    hits.map((h) => (
                      <button
                        key={h.id}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-right text-sm transition-colors hover:bg-accent"
                        onClick={() => { setSelected(h); setDebounced(""); setQuery(h.ticker); setShowDd(false) }}
                      >
                        <Badge variant="secondary" className="font-mono">{h.ticker}</Badge>
                        <span className="truncate">{h.nameAr ?? h.nameEn}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="avg-buy" className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Wallet className="h-3.5 w-3.5" aria-hidden /> متوسط الشراء (جنيه)
              </label>
              <Input
                id="avg-buy"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={avgBuy}
                onChange={(e) => setAvgBuy(e.target.value)}
                placeholder="مثال: 42.75"
                className="h-11"
              />
            </div>
            <Button onClick={submit} disabled={!canSubmit} className="h-11 px-6 text-base font-bold shadow-sm">
              {review.isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <BrainCircuit className="h-5 w-5" aria-hidden />}
              حلّل مركزي
            </Button>
          </div>
          {selected && (
            <div className="flex items-center gap-2 rounded-lg border bg-primary/5 px-3 py-2 text-sm">
              <LineChart className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <Badge variant="secondary" className="font-mono">{selected.ticker}</Badge>
              <span className="min-w-0 flex-1 truncate font-medium">{selected.nameAr ?? selected.nameEn}</span>
              <button
                className="shrink-0 text-xs font-semibold text-muted-foreground underline hover:text-foreground"
                onClick={() => { setSelected(null); setQuery(""); setResult(null); setShowDd(false) }}
              >
                تغيير
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {result?.notReviewableAr && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-center gap-2 p-4 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
            <span className="flex-1">{result.notReviewableAr}</span>
            <Button variant="outline" size="sm" onClick={resetForNextStock} className="shrink-0">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> حلل سهم آخر
            </Button>
          </CardContent>
        </Card>
      )}

      {r && (
        <div className="space-y-5">
          {/* verdict banner */}
          <Card className={`ring-1 ${DECISION_STYLE[r.decision].ring} ${DECISION_STYLE[r.decision].bg} shadow-sm`}>
            <CardContent className="space-y-4 p-5 md:p-6">
              <div className="flex flex-wrap items-center gap-4">
                <span className={`flex h-14 w-14 items-center justify-center rounded-full border ${DECISION_STYLE[r.decision].chip}`}>
                  {DECISION_STYLE[r.decision].icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-3xl font-black ${DECISION_STYLE[r.decision].text}`}>{r.decisionAr}</div>
                  <div className="mt-1 text-sm font-medium leading-relaxed text-foreground/80">{r.headlineAr}</div>
                </div>
                <div className="text-left" dir="rtl">
                  {/* 2026-11-19: a −0.03٪ position used to print «+0.0٪» (the
                      rounded −0 lost both its sign AND its value) — tiny P/L
                      keeps 2 decimals so the sign survives. */}
                  <div className={`text-3xl font-black tabular-nums ${r.pnlPct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {fmtSignedPct(r.pnlPct)}
                  </div>
                  <div className="text-xs text-muted-foreground">{r.pnlPerShare >= 0 ? "+" : ""}{r.pnlPerShare.toFixed(2)} جنيه/سهم</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className={`rounded-full border px-3 py-1 font-semibold ${DECISION_STYLE[r.decision].chip}`}>{result?.ticker} — {result?.nameAr ?? ""}</span>
                <span className="rounded-full border bg-background/70 px-3 py-1">متوسط شراءك: <b className="tabular-nums">{r.avgBuyPrice.toFixed(2)}</b></span>
                <span className="rounded-full border bg-background/70 px-3 py-1">آخر سعر: <b className="tabular-nums">{r.lastClose.toFixed(2)}</b>{r.snapshot.asOf ? ` (${r.snapshot.asOf})` : ""}</span>
                {r.lastCloseProvisional && (
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 font-semibold text-amber-700 dark:text-amber-400">
                    الجلسة لسه شغالة — الحكم بالإغلاق النهائي
                  </span>
                )}
                {r.recoveryPct !== null && (
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 font-bold text-amber-700 dark:text-amber-400">
                    لو بعت دلوقتي: تحتاج {fmtSignedPct(r.recoveryPct)} في أي سهم تاني عشان تعوّض
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* reasons — the friend's full argument */}
          <Card className="shadow-sm">
            <CardContent className="p-5 md:p-6">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
                <BrainCircuit className="h-5 w-5 text-primary" aria-hidden />
                ليه القرار ده؟ — الأسباب كاملة
              </h2>
              <ol className="divide-y divide-border">
                {r.reasonsAr.map((reason, i) => (
                  <li key={i} className="flex gap-3 py-3 text-sm leading-relaxed first:pt-0 last:pb-0">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 border-t pt-3 text-xs italic text-muted-foreground">{r.closingAr}</p>
            </CardContent>
          </Card>

          {/* the concrete follow-up plan */}
          {r.planAr && (
            <Card className="border-primary/40 bg-gradient-to-br from-primary/10 to-primary/[0.03] shadow-sm">
              <CardContent className="flex items-start gap-3 p-4 text-sm">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                  <BrainCircuit className="h-4 w-4 text-primary" aria-hidden />
                </span>
                <div className="leading-relaxed"><b>الخطة:</b> {r.planAr}</div>
              </CardContent>
            </Card>
          )}

          {/* invalidation — the line in the sand */}
          <Card className="border-destructive/40 bg-red-500/[0.04] shadow-sm">
            <CardContent className="flex items-start gap-3 p-4 text-sm">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <div className="leading-relaxed"><b>خط الإلغاء:</b> {r.invalidationAr}</div>
            </CardContent>
          </Card>

          {/* the deep-loss follow-up question — answered in-place, no extra call */}
          {r.question && (
            <Card className="border-sky-500/40 bg-sky-500/[0.05] shadow-sm">
              <CardContent className="space-y-3 p-4 text-sm">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/15">
                    <CircleHelp className="h-4 w-4 text-sky-500" aria-hidden />
                  </span>
                  <div className="pt-1.5 font-semibold leading-relaxed">{answeredYes === null ? r.question.promptAr : "إجابتك محسوبة في الخطة:"}</div>
                </div>
                {answeredYes === null ? (
                  <div className="flex flex-wrap gap-2 ps-12">
                    <Button size="sm" className="h-9 px-4 font-bold" onClick={() => setAnsweredYes(true)}>{r.question.yesLabelAr}</Button>
                    <Button size="sm" variant="outline" className="h-9 px-4" onClick={() => setAnsweredYes(false)}>{r.question.noLabelAr}</Button>
                  </div>
                ) : (
                  <div className="ps-12 text-sm leading-relaxed text-foreground/90">
                    {answeredYes ? r.question.yesOutcomeAr : r.question.noOutcomeAr}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* levels — every support & resistance, color-coded (green floor / red ceiling) */}
          <div className="grid gap-5 md:grid-cols-2">
            <LevelsTable title="الدعوم" rows={r.supports} emptyAr="لا توجد دعوم مسجلة تحت السعر" icon={<ArrowDownRight className="h-4 w-4" aria-hidden />} tone="support" />
            <LevelsTable title="المقاومات" rows={r.resistances} emptyAr="لا توجد مقاومات مسجلة فوق السعر" icon={<ArrowUpRight className="h-4 w-4" aria-hidden />} tone="resistance" />
          </div>

          {/* technical snapshot */}
          <Card className="shadow-sm">
            <CardContent className="p-5 md:p-6">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
                <LineChart className="h-5 w-5 text-primary" aria-hidden />
                القراءة الفنية الكاملة
              </h2>
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <Snap label="الاتجاه" value={r.snapshot.trendAr} wide />
                <Snap label="قوة الحركة RSI (14)" value={r.snapshot.rsi14?.toFixed(1) ?? "—"} />
                <Snap label="متوسط سعر 20 يوم EMA" value={r.snapshot.ema20?.toFixed(2) ?? "—"} />
                <Snap label="متوسط سعر 50 يوم EMA" value={r.snapshot.ema50?.toFixed(2) ?? "—"} />
                <Snap label="الحجم النسبي" value={r.snapshot.relVol ? `${r.snapshot.relVol.toFixed(2)}×` : "—"} />
                <Snap label="موقع السعر في نطاق 60 جلسة (0 قاع / 100 قمة)" value={r.snapshot.rangePos60 !== null ? `${Math.round(r.snapshot.rangePos60)}٪` : "—"} />
                <Snap label="مدى التقلب ATR (14)" value={r.snapshot.atr14?.toFixed(2) ?? "—"} />
                {/* owner alignment: the engine-state cell shows THE SAME verdict
                    as the decision banner (with the engine score), never a
                    contradicting label */}
                <Snap label="قرار المحرك النهائي" value={`${r.decisionAr} · ${r.snapshot.signalScore ?? "—"}/100`} />
              </div>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{r.levelsBasisAr}</p>
              {r.warningsAr.length > 0 && (
                <ul className="mt-3 space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
                  {r.warningsAr.map((w, i) => <li key={i}>• {w}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* «حلل سهم آخر» — the next-stock loop, right under the report */}
          <div className="flex justify-center pt-1">
            <Button variant="outline" onClick={resetForNextStock} className="h-11 px-6 font-bold">
              <RotateCcw className="h-4 w-4" aria-hidden /> حلل سهم آخر
            </Button>
          </div>
        </div>
      )}

      <p className="border-t pt-4 text-center text-xs leading-relaxed text-muted-foreground">
        قراءة تعليمية مبينة على بيانات تداول حقيقية — ليست توصية بيع أو شراء، والقرار النهائي قرارك.
      </p>
    </div>
  )
}

function LevelsTable({ title, rows, emptyAr, icon, tone }: { title: string; rows: import("@/lib/position/types").LevelLine[]; emptyAr: string; icon: React.ReactNode; tone: "support" | "resistance" }) {
  const tint = tone === "support"
    ? { card: "border-emerald-500/30 bg-emerald-500/[0.04]", chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" }
    : { card: "border-red-500/30 bg-red-500/[0.04]", chip: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400" }
  return (
    <Card className={`shadow-sm ring-1 ${tone === "support" ? "ring-emerald-500/25" : "ring-red-500/25"}`}>
      <CardContent className="p-5">
        <h3 className="mb-3 flex items-center gap-2 text-base font-bold">
          {icon}{title}
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">({rows.length})</span>
        </h3>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyAr}</p>
        ) : (
          <div className="space-y-2">
            {rows.map((l, i) => (
              <div key={i} className={`rounded-lg border p-3 text-sm transition-colors ${tint.card} hover:shadow-sm`}>
                <div className="flex flex-wrap items-center gap-2">
                  {/* 2026-11-19: a single-price pivot cluster printed «112.85–112.85» —
                      coinciding edges collapse to one value */}
                  <span className={`rounded-md border px-1.5 py-0.5 font-mono text-sm font-bold tabular ${tint.chip}`}>{Math.abs(l.high - l.low) < 1e-9 ? l.low.toFixed(2) : `${l.low.toFixed(2)}–${l.high.toFixed(2)}`}</span>
                  <Badge variant="outline" className="text-[10px]">{l.touches}× لمسة</Badge>
                  {l.broken && <Badge variant="secondary" className="text-[10px]">مكسورة</Badge>}
                  <span className="ms-auto rounded-full bg-muted px-2 py-0.5 tabular-nums text-xs text-muted-foreground">
                    من السعر {fmtSignedPct(l.distFromPricePct)} · من متوسطك {fmtSignedPct(l.distFromAvgPct)}
                  </span>
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground">{l.noteAr}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function fmtSignedPct(x: number): string {
  // 2026-11-19: values under 0.05٪ keep 2 decimals so a tiny loss prints
  // «-0.03٪» — the old «±0.0٪» both hid the magnitude and could flip its sign.
  const neg = x < 0 || Object.is(x, -0)
  if (Math.abs(x) < 0.05) return `${neg ? "-" : "+"}${Math.abs(x).toFixed(2)}٪`
  return `${neg ? "-" : "+"}${Math.abs(x).toFixed(1)}٪`
}

function Snap({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-lg border bg-muted/40 p-3 ${wide ? "col-span-2 md:col-span-4" : ""}`}>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 font-bold leading-relaxed tabular-nums">{value}</div>
    </div>
  )
}
