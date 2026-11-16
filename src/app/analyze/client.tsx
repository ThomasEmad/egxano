"use client"

// /analyze — «حلل سهمي»: the owner's flagship differentiator. The user enters
// their average buy price; the engine answers hold/wait/exit with every
// reason spelled out, every support/resistance on the table, and the full
// technical reading — in the voice of a market-savvy friend, never a broker's
// sales pitch. The output is analysis, not investment advice; the wording
// keeps that line visible.

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BrainCircuit, CircleHelp, Loader2, Lock, RotateCcw, Scale, Search, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { PositionDecision, PositionReviewResult } from "@/lib/position/types"

interface CompanyHit {
  id: string
  ticker: string
  nameEn: string
  nameAr: string | null
}

const DECISION_STYLE: Record<PositionDecision, { ring: string; bg: string; text: string; icon: React.ReactNode }> = {
  hold: { ring: "ring-emerald-500/30", bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", icon: <TrendingUp className="h-7 w-7" aria-hidden /> },
  wait: { ring: "ring-amber-500/30", bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", icon: <Scale className="h-7 w-7" aria-hidden /> },
  exit: { ring: "ring-red-500/30", bg: "bg-red-500/10", text: "text-red-600 dark:text-red-400", icon: <TrendingDown className="h-7 w-7" aria-hidden /> },
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
  const boxRef = useRef<HTMLDivElement>(null)

  // daily quota chip — read-only snapshot, never consumes
  const quota = useQuery({
    queryKey: ["analyze-quota"],
    queryFn: async () => {
      const r = await fetch("/api/v1/position-review")
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
    enabled: debounced.length >= 2 && !selected,
    queryFn: async () => {
      const r = await fetch(`/api/v1/companies?search=${encodeURIComponent(debounced)}&pageSize=8&status=active`)
      if (!r.ok) throw new Error("search failed")
      return (await r.json()) as { companies: CompanyHit[] }
    },
  })

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) boxRef.current.classList.add("hidden")
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
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const review = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/v1/position-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold md:text-3xl">
          <BrainCircuit className="h-7 w-7 text-primary" aria-hidden />
          حلل سهمي — هل أحتفظ أم أنتظر أم أخرج؟
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          اكتب متوسط سعر شراءك واختر السهم، والمحرك يقرأ الوضع معك كواحد صاحبك فاهم في البورصة: القرار، كل سبب وراه،
          كل الدعوم والمقاومات، والقراءة الفنية كاملة. التحليل مبني على بيانات تداول حقيقية — وهو ليس توصية استثمارية.
        </p>
        {quota.data?.quota && (
          <p className="text-xs font-medium text-primary">
            {quota.data.quota.unlimited
              ? "بريميوم — تحليل بلا حدود"
              : `الحصة المجانية: متاح لك ${quota.data.quota.remaining} من ${quota.data.quota.limit} سهمين النهاردة (إعادة تحليل نفس السهم لا تحرق الحصة)`}
            {!quota.data.quota.unlimited && quota.data.quota.remaining === 0 && (
              <a href="/premium" className="ms-2 underline">ترقية لبريميوم — بلا حدود ←</a>
            )}
          </p>
        )}
      </header>

      {(authNeeded || quota.data?.auth) && !result && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <Lock className="h-4 w-4 text-primary" aria-hidden />
            <span>حلل سهمي متاح للمستخدمين المسجلين — سجّل دخولك (مجانًا) لحساب مركزك، والحصة المجانية سهمان مختلفان يوميًا.</span>
            <a href="/login" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">تسجيل الدخول ←</a>
          </CardContent>
        </Card>
      )}

      {limitInfo && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <Lock className="h-4 w-4 text-amber-500" aria-hidden />
            <span>{limitInfo.errorAr}</span>
            <a href={limitInfo.upgradeUrl} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              ترقية لبريميوم — بلا حدود ←
            </a>
          </CardContent>
        </Card>
      )}

      {/* inputs */}
      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-[1fr_180px_auto] md:items-end">
          <div className="relative space-y-1.5" ref={boxRef}>
            <label htmlFor="ticker-search" className="text-xs font-medium text-muted-foreground">السهم</label>
            {selected ? (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="font-mono">{selected.ticker}</Badge>
                <span className="truncate text-sm">{selected.nameAr ?? selected.nameEn}</span>
                <button className="text-xs text-muted-foreground underline" onClick={() => { setSelected(null); setQuery(""); setResult(null) }}>
                  تغيير
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input
                    id="ticker-search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="ابحث برمز التداول أو الاسم…"
                    className="pr-8"
                    autoComplete="off"
                  />
                </div>
                {debounced.length >= 2 && (
                  <div className="absolute z-20 mt-1 w-full rounded-md border bg-background shadow-lg">
                    {search.isLoading ? (
                      <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> جارِ البحث…</div>
                    ) : hits.length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground">لا نتائج — جرّب رمز التداول (مثل COMI)</div>
                    ) : (
                      hits.map((h) => (
                        <button
                          key={h.id}
                          className="flex w-full items-center gap-2 px-3 py-2 text-right text-sm hover:bg-accent"
                          onClick={() => { setSelected(h); setDebounced(""); setQuery("") }}
                        >
                          <Badge variant="secondary" className="font-mono">{h.ticker}</Badge>
                          <span className="truncate">{h.nameAr ?? h.nameEn}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="avg-buy" className="text-xs font-medium text-muted-foreground">متوسط الشراء (جنيه)</label>
            <Input
              id="avg-buy"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={avgBuy}
              onChange={(e) => setAvgBuy(e.target.value)}
              placeholder="مثال: 42.75"
            />
          </div>
          <Button onClick={submit} disabled={!canSubmit} className="h-10">
            {review.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BrainCircuit className="h-4 w-4" aria-hidden />}
            حلّل مركزي
          </Button>
        </CardContent>
      </Card>

      {result?.notReviewableAr && (
        <Card className="border-amber-500/30 bg-amber-500/5">
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
          <Card className={`ring-1 ${DECISION_STYLE[r.decision].ring} ${DECISION_STYLE[r.decision].bg}`}>
            <CardContent className="space-y-3 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className={DECISION_STYLE[r.decision].text}>{DECISION_STYLE[r.decision].icon}</span>
                <div>
                  <div className={`text-2xl font-extrabold ${DECISION_STYLE[r.decision].text}`}>{r.decisionAr}</div>
                  <div className="text-sm font-medium text-foreground/80">{r.headlineAr}</div>
                </div>
                <div className="ms-auto text-left" dir="ltr">
                  <div className="text-2xl font-bold tabular-nums">{r.pnlPct >= 0 ? "+" : ""}{r.pnlPct.toFixed(1)}%</div>
                  <div className="text-xs text-muted-foreground">{r.pnlPerShare >= 0 ? "+" : ""}{r.pnlPerShare.toFixed(2)} EGP / share</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <span>{result?.ticker} — {result?.nameAr ?? ""}</span>
                <span>متوسط شراءك: <b className="tabular-nums">{r.avgBuyPrice.toFixed(2)}</b></span>
                <span>آخر سعر: <b className="tabular-nums">{r.lastClose.toFixed(2)}</b>{r.snapshot.asOf ? ` (${r.snapshot.asOf})` : ""}</span>
                {r.recoveryPct !== null && (
                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                    لو بعت دلوقتي: تحتاج {fmtSigned(r.recoveryPct)} في أي سهم تاني عشان تعوّض
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* reasons — the friend's full argument */}
          <Card>
            <CardContent className="p-5">
              <h2 className="mb-3 text-lg font-bold">ليه القرار ده؟ — الأسباب كاملة</h2>
              <ol className="space-y-3">
                {r.reasonsAr.map((reason, i) => (
                  <li key={i} className="flex gap-3 text-sm leading-relaxed">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{i + 1}</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 border-t pt-3 text-xs italic text-muted-foreground">{r.closingAr}</p>
            </CardContent>
          </Card>

          {/* the concrete follow-up plan */}
          {r.planAr && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="flex items-start gap-2 p-4 text-sm">
                <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <div><b>الخطة:</b> {r.planAr}</div>
              </CardContent>
            </Card>
          )}

          {/* invalidation — the line in the sand */}
          <Card className="border-destructive/30">
            <CardContent className="flex items-start gap-2 p-4 text-sm">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <div><b>خط الإلغاء:</b> {r.invalidationAr}</div>
            </CardContent>
          </Card>

          {/* the deep-loss follow-up question — answered in-place, no extra call */}
          {r.question && (
            <Card className="border-sky-500/30 bg-sky-500/5">
              <CardContent className="space-y-3 p-4 text-sm">
                <div className="flex items-start gap-2">
                  <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" aria-hidden />
                  <div className="font-semibold">{answeredYes === null ? r.question.promptAr : "إجابتك محسوبة في الخطة:"}</div>
                </div>
                {answeredYes === null ? (
                  <div className="flex flex-wrap gap-2 ps-6">
                    <Button size="sm" variant="outline" onClick={() => setAnsweredYes(true)}>{r.question.yesLabelAr}</Button>
                    <Button size="sm" variant="outline" onClick={() => setAnsweredYes(false)}>{r.question.noLabelAr}</Button>
                  </div>
                ) : (
                  <div className="ps-6 text-sm leading-relaxed text-foreground/90">
                    {answeredYes ? r.question.yesOutcomeAr : r.question.noOutcomeAr}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* levels — every support & resistance */}
          <div className="grid gap-5 md:grid-cols-2">
            <LevelsTable title="الدعوم" rows={r.supports} emptyAr="لا توجد دعوم مسجلة تحت السعر" icon={<ArrowDownRight className="h-4 w-4" aria-hidden />} />
            <LevelsTable title="المقاومات" rows={r.resistances} emptyAr="لا توجد مقاومات مسجلة فوق السعر" icon={<ArrowUpRight className="h-4 w-4" aria-hidden />} />
          </div>

          {/* technical snapshot */}
          <Card>
            <CardContent className="p-5">
              <h2 className="mb-3 text-lg font-bold">القراءة الفنية الكاملة</h2>
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <Snap label="الاتجاه" value={r.snapshot.trendAr} wide />
                <Snap label="RSI (14)" value={r.snapshot.rsi14?.toFixed(1) ?? "—"} />
                <Snap label="EMA20" value={r.snapshot.ema20?.toFixed(2) ?? "—"} />
                <Snap label="EMA50" value={r.snapshot.ema50?.toFixed(2) ?? "—"} />
                <Snap label="الحجم النسبي" value={r.snapshot.relVol ? `${r.snapshot.relVol.toFixed(2)}×` : "—"} />
                <Snap label="موقع النطاق 60 جلسة" value={r.snapshot.rangePos60 !== null ? `${Math.round(r.snapshot.rangePos60)}٪` : "—"} />
                <Snap label="ATR (14)" value={r.snapshot.atr14?.toFixed(2) ?? "—"} />
                {/* owner alignment: the engine-state cell shows THE SAME verdict
                    as the decision banner (with the engine score), never a
                    contradicting label */}
                <Snap label="قرار المحرك النهائي" value={`${r.decisionAr} · ${r.snapshot.signalScore ?? "—"}/100`} />
              </div>
              <p className="mt-4 text-xs text-muted-foreground leading-relaxed">{r.levelsBasisAr}</p>
              {r.warningsAr.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-amber-600 dark:text-amber-400">
                  {r.warningsAr.map((w, i) => <li key={i}>• {w}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* «حلل سهم آخر» — the next-stock loop, right under the report */}
          <div className="flex justify-center">
            <Button variant="outline" onClick={resetForNextStock} className="h-10">
              <RotateCcw className="h-4 w-4" aria-hidden /> حلل سهم آخر
            </Button>
          </div>
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        قراءة تعليمية مبينة على بيانات تداول حقيقية — ليست توصية بيع أو شراء، والقرار النهائي قرارك.
      </p>
    </div>
  )
}

function LevelsTable({ title, rows, emptyAr, icon }: { title: string; rows: import("@/lib/position/types").LevelLine[]; emptyAr: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="mb-3 flex items-center gap-2 text-base font-bold">{icon}{title} <span className="text-xs font-normal text-muted-foreground">({rows.length})</span></h3>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyAr}</p>
        ) : (
          <div className="space-y-2">
            {rows.map((l, i) => (
              <div key={i} className="rounded-md border p-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold tabular-nums">{l.low.toFixed(2)}–{l.high.toFixed(2)}</span>
                  <Badge variant="outline" className="text-[10px]">{l.touches}× لمسة</Badge>
                  {l.broken && <Badge variant="secondary" className="text-[10px]">مكسورة</Badge>}
                  <span className="ms-auto tabular-nums text-xs text-muted-foreground">
                    من السعر {fmtSigned(l.distFromPricePct)} · من متوسطك {fmtSigned(l.distFromAvgPct)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{l.noteAr}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function fmtSigned(x: number): string {
  return `${x >= 0 ? "+" : ""}${x.toFixed(1)}٪`
}

function Snap({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-md border p-2.5 ${wide ? "col-span-2 md:col-span-4" : ""}`}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums">{value}</div>
    </div>
  )
}
