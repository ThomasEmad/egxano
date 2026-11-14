"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Bell, BellOff, BellRing, Loader2, TrendingDown, TrendingUp, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { EmptyState } from "@/components/brand/empty-state"
import { authHeaders, getUserToken } from "@/lib/client/api"
import { useI18n } from "@/lib/i18n"

// /alerts — price alerts for the signed-in user.
//
// Honest model: targets are compared with the latest RECORDED price (the same
// 15-minute-delayed snapshot the rest of the site shows) by the server on
// every snapshot write / poll. With browser push enabled (PushToggle below)
// the alert also arrives as an OS notification even when the site is closed;
// without it, alerts appear here only when the page is opened.

interface AlertRow {
  id: string
  companyId: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
  direction: "ABOVE" | "BELOW"
  targetPrice: number
  active: boolean
  triggeredAt: string | null
  currentPrice: number | null
  priceAsOf: string | null
  hitNow: boolean
}

interface SearchRow {
  id: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  return n.toLocaleString("en-EG", { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export default function AlertsPage() {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const qc = useQueryClient()

  // Resolve sign-in state after mount so server and client first render agree.
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), [])
  const signedIn = mounted && !!getUserToken()

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["alerts"],
    queryFn: async () => {
      const res = await fetch("/api/v1/alerts", { headers: authHeaders() })
      if (!res.ok) throw new Error(res.status === 401 ? "AUTH" : "FAILED")
      return (await res.json()) as { alerts: AlertRow[] }
    },
    enabled: signedIn,
    retry: false,
    refetchInterval: 60_000,
  })

  const alerts: AlertRow[] = data?.alerts ?? []
  const active = alerts.filter((a) => a.active)
  const fired = alerts.filter((a) => !a.active && a.triggeredAt)

  return (
    <LayoutShell>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {!signedIn ? (
          <div className="mx-auto max-w-md py-10 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Bell className="h-6 w-6" aria-hidden />
            </span>
            <h1 className="mt-4 text-lg font-semibold">
              {ar ? "الأسعار المستهدفة تحتاج حساباً" : "Price targets need an account"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {ar
                ? "أنشئ حساباً مجانياً لحفظ أسعارك المستهدفة. بنقارنها بآخر سعر مسجّل (متأخر 15 دقيقة) وبنعرض أي تنبيه هنا داخل المنصة."
                : "Create a free account to save target prices. We compare them with the latest recorded price (15-minute delayed) and show any hit here, in the app."}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
              {ar
                ? "ولما تفعّل إشعارات المتصفح، التنبيه بيوصلك إشعار حتى لو التطبيق مقفول."
                : "And with browser notifications enabled, an alert reaches you even when the app is closed."}
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Link href="/login?next=/alerts">
                <Button variant="outline">{ar ? "تسجيل الدخول" : "Sign in"}</Button>
              </Link>
              <Link href="/register?next=/alerts">
                <Button>{ar ? "إنشاء حساب مجاني" : "Create a free account"}</Button>
              </Link>
            </div>
            <p className="mt-4 text-xs">
              <Link href="/companies" className="text-primary underline-offset-2 hover:underline">
                {ar ? "أو تابع البحث عن الشركات بدون حساب" : "Or research companies without an account"}
              </Link>
            </p>
          </div>
        ) : (
          <>
            <header className="flex items-start justify-between gap-3">
              <div>
                <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                  <BellRing className="h-5 w-5 text-primary" aria-hidden />
                  {ar ? "الأسعار المستهدفة" : "Price targets"}
                </h1>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {ar
                    ? "طريقة العمل: بنقارن سعرك المستهدف بآخر سعر مسجّل (متأخر 15 دقيقة). التنبيهات بتظهر هنا داخل المنصة — وفعّل إشعارات المتصفح تحتها علشان توصلك حتى لو التطبيق مقفول."
                    : "How it works: we check your target against the latest recorded price (15-minute delayed). Alerts appear here, in the app — and enable browser notifications below to get them even when the app is closed."}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
                aria-label={ar ? "تحديث القائمة" : "Refresh alerts"}
              >
                {isFetching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
              </Button>
            </header>

            <div className="mt-5">
              <NewAlertForm onCreated={() => qc.invalidateQueries({ queryKey: ["alerts"] })} />
            </div>

            <div className="mt-4">
              <PushToggle />
            </div>

            {isLoading ? (
              <div className="mt-6 space-y-2" aria-busy="true" aria-live="polite">
                <span className="sr-only">{ar ? "جارٍ تحميل التنبيهات" : "Loading alerts"}</span>
                <div className="h-16 animate-pulse rounded-xl bg-muted" />
                <div className="h-16 animate-pulse rounded-xl bg-muted" />
              </div>
            ) : isError ? (
              <Card className="mt-6 border-destructive/30 bg-destructive/5">
                <div className="flex flex-col items-start gap-2 p-5">
                  <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <AlertTriangle className="h-4 w-4" aria-hidden />
                    {ar ? "تعذّر تحميل التنبيهات" : "Couldn't load your alerts"}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {ar
                      ? "مفيش أي تغيير اتجرى على تنبيهاتك. جرّب تاني بعد شوية."
                      : "Nothing was changed on your alerts. Please try again in a moment."}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => refetch()}>
                    {ar ? "إعادة المحاولة" : "Try again"}
                  </Button>
                </div>
              </Card>
            ) : (
              <div className="mt-6 space-y-6">
                {fired.length > 0 ? (
                  <section className="space-y-2" aria-label={ar ? "تنبيهات مُطلقة" : "Triggered alerts"}>
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-warning">
                      <AlertTriangle className="h-4 w-4" aria-hidden />
                      {ar ? "تنبيهات مُطلقة" : "Triggered"}
                    </h2>
                    {fired.map((a) => (
                      <AlertCard key={a.id} alert={a} fired onChanged={() => qc.invalidateQueries({ queryKey: ["alerts"] })} />
                    ))}
                  </section>
                ) : null}

                <section className="space-y-2" aria-label={ar ? "تنبيهات نشطة" : "Active alerts"}>
                  <h2 className="text-sm font-semibold text-muted-foreground">
                    {ar ? "نشِطة" : "Active"} ({active.length})
                  </h2>
                  {active.length === 0 ? (
                    <EmptyState
                      icon={Bell}
                      title={ar ? "مفيش تنبيهات نشطة" : "No active alerts"}
                      description={
                        ar
                          ? "أضف سعراً مستهدفاً من النموذج أعلاه. هنقارنه بآخر سعر مسجّل ونعرض أي تنبيه هنا لما تفتح الصفحة."
                          : "Add a target price above. We compare it with the latest recorded price and show any hit here when you open the page."
                      }
                    />
                  ) : (
                    active.map((a) => (
                      <AlertCard key={a.id} alert={a} onChanged={() => qc.invalidateQueries({ queryKey: ["alerts"] })} />
                    ))
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </LayoutShell>
  )
}

function AlertCard({ alert: a, fired, onChanged }: { alert: AlertRow; fired?: boolean; onChanged: () => void }) {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const [busy, setBusy] = useState(false)

  const remove = useCallback(async () => {
    setBusy(true)
    await fetch(`/api/v1/alerts?id=${a.id}`, { method: "DELETE", headers: authHeaders() }).catch(() => {})
    setBusy(false)
    onChanged()
  }, [a.id, onChanged])

  const distance =
    a.currentPrice !== null && a.active && a.currentPrice > 0
      ? ((a.targetPrice - a.currentPrice) / a.currentPrice) * 100
      : null

  const priceAsOf = a.priceAsOf
    ? new Date(a.priceAsOf).toLocaleDateString(ar ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short" })
    : null

  return (
    <Card className={`p-3 ${fired ? "border-warning/40 bg-warning/5" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/company/${a.ticker}`} className="font-mono text-sm font-bold text-primary hover:underline">
              {a.ticker}
            </Link>
            <span dir="auto" className="truncate text-xs text-muted-foreground">
              {ar ? a.nameAr || a.nameEn : a.nameEn}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
            <span className="inline-flex items-center gap-1 font-semibold">
              {a.direction === "ABOVE" ? (
                <TrendingUp className="h-3.5 w-3.5 text-positive" aria-hidden />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-negative" aria-hidden />
              )}
              {a.direction === "ABOVE" ? (ar ? "عند الصعود فوق" : "above") : ar ? "عند الهبوط تحت" : "below"}{" "}
              <span className="tabular font-bold">{fmt(a.targetPrice)}</span>
            </span>
            {a.currentPrice !== null ? (
              <span className="text-muted-foreground">
                {ar ? "آخر سعر مسجّل" : "last recorded"}: <span className="tabular">{fmt(a.currentPrice)}</span>
                {priceAsOf ? <span className="ms-1 text-muted-foreground/70">({priceAsOf})</span> : null}
                {distance !== null && a.active ? (
                  <>
                    {" · "}
                    <span className={Math.abs(distance) < 2 ? "font-bold text-primary" : ""}>
                      {distance >= 0 ? "+" : ""}
                      {fmt(distance, 1)}%
                    </span>
                  </>
                ) : null}
              </span>
            ) : (
              <span className="text-muted-foreground/70">{ar ? "مفيش سعر مسجّل حديث" : "no recent recorded price"}</span>
            )}
            {fired && a.triggeredAt ? (
              <span className="text-warning">
                {ar ? "اتحقق في" : "hit on"}{" "}
                {new Date(a.triggeredAt).toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "short", timeStyle: "short" })}
              </span>
            ) : null}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={remove} disabled={busy} aria-label={ar ? "حذف التنبيه" : "Delete alert"}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" aria-hidden />}
        </Button>
      </div>
    </Card>
  )
}

// VAPID application server key: base64url → the Uint8Array pushManager.subscribe()
// requires. Standard Web Push client-side conversion. (`<ArrayBuffer>` — the
// BufferSource DOM type requires a plain-ArrayBuffer view, not SharedArrayBuffer.)
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

// Browser push for price alerts — the toggle that makes alerts reach the user
// EVEN WHEN the site is closed. Enable flow: ask permission → resolve the
// server's VAPID public key (inline NEXT_PUBLIC at build time, else the
// /api/v1/push/public-key route) → register /sw.js → subscribe → store the
// subscription server-side. The server then evaluates alerts on every price
// snapshot write and pushes through the service worker.
function PushToggle() {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const [supported, setSupported] = useState(true)
  const [permission, setPermission] = useState<NotificationPermission>("default")
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Resolve the CURRENT push state after mount (registration is async and
    // may live in another tab) — server render can't know it.
    ;(async () => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) {
          setSupported(false)
          setSubscribed(false)
        }
        return
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration()
        const sub = reg ? await reg.pushManager.getSubscription() : null
        if (!cancelled) {
          setPermission(Notification.permission)
          setSubscribed(Boolean(sub))
        }
      } catch {
        if (!cancelled) setSubscribed(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Server env WEB_PUSH_VAPID_PUBLIC_KEY is the source of truth; the build-time
  // NEXT_PUBLIC var (if exposed) just saves the round-trip.
  const fetchPublicKey = async (): Promise<string | null> => {
    const inline = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY
    if (inline) return inline
    const res = await fetch("/api/v1/push/public-key").catch(() => null)
    if (!res || !res.ok) return null
    const data = (await res.json().catch(() => null)) as { publicKey?: string | null } | null
    return typeof data?.publicKey === "string" && data.publicKey ? data.publicKey : null
  }

  const enable = async () => {
    setError(null)
    setBusy(true)
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== "granted") {
        setError(ar ? "اترفض إذن الإشعارات — سمحليه من إعدادات المتصفح وبعدين جرّب تاني." : "Notification permission was denied — allow it in browser settings, then try again.")
        return
      }
      const publicKey = await fetchPublicKey()
      if (!publicKey) {
        setError(ar ? "الإشعارات مش مفعّلة على السيرفر حالياً — جرّب بعدين." : "Push isn't configured on the server yet — please try again later.")
        return
      }
      const reg = await navigator.serviceWorker.register("/sw.js")
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("incomplete subscription")
      const res = await fetch("/api/v1/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }),
      })
      if (!res.ok) throw new Error("subscribe failed")
      setSubscribed(true)
    } catch {
      setError(ar ? "تعذّر تشغيل الإشعارات. جرّب تاني." : "Couldn't enable notifications. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setError(null)
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = reg ? await reg.pushManager.getSubscription() : null
      if (sub) await sub.unsubscribe().catch(() => {})
      if (sub?.endpoint) {
        await fetch("/api/v1/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {})
      }
      setSubscribed(false)
    } finally {
      setBusy(false)
    }
  }

  const stateLabel = subscribed ? (ar ? "مشغّل" : "On") : ar ? "متوقف" : "Off"

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <BellRing className="h-4 w-4 text-primary" aria-hidden />
            {ar ? "إشعارات المتصفح" : "Browser notifications"}
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                subscribed ? "bg-positive/10 text-positive" : "bg-muted text-muted-foreground"
              }`}
            >
              {stateLabel}
            </span>
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {ar
              ? "فعّلها علشان توصلك تنبيهات الأسعار كإشعار على المتصفح حتى وأنت قافل التطبيق."
              : "Receive price alerts as browser notifications even when the app is closed."}
          </p>
          {!supported ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {ar ? "المتصفح ده مش بيدعم إشعارات الويب." : "This browser doesn't support web push."}
            </p>
          ) : permission === "denied" ? (
            <p className="mt-2 text-xs text-warning">
              {ar ? "الإشعارات متمنعة من إعدادات المتصفح — لازم تسمحليها الأول." : "Notifications are blocked in browser settings — allow them first."}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <Button
          size="sm"
          variant={subscribed ? "outline" : "default"}
          onClick={subscribed ? disable : enable}
          disabled={busy || !supported}
          aria-label={subscribed ? (ar ? "إيقاف إشعارات المتصفح" : "Turn off browser notifications") : ar ? "تشغيل إشعارات المتصفح" : "Turn on browser notifications"}
        >
          {busy ? (
            <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
          ) : subscribed ? (
            <BellOff className="me-1.5 h-4 w-4" aria-hidden />
          ) : (
            <BellRing className="me-1.5 h-4 w-4" aria-hidden />
          )}
          {subscribed ? (ar ? "إيقاف الإشعارات" : "Turn off") : ar ? "تشغيل الإشعارات" : "Turn on"}
        </Button>
      </div>
    </Card>
  )
}

function NewAlertForm({ onCreated }: { onCreated: () => void }) {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<SearchRow | null>(null)
  const [direction, setDirection] = useState<"ABOVE" | "BELOW">("ABOVE")
  const [target, setTarget] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [results, setResults] = useState<SearchRow[]>([])
  useEffect(() => {
    if (picked || q.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([])
      return
    }
    const id = setTimeout(() => {
      fetch(`/api/v1/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => {
          setResults(d.results ?? [])
          setOpen(true)
        })
        .catch(() => setResults([]))
    }, 220)
    return () => clearTimeout(id)
  }, [q, picked])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const targetPrice = Number(target)
    if (!picked) {
      setError(ar ? "اختر شركة من البحث." : "Pick a company from the search.")
      return
    }
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      setError(ar ? "أدخل سعراً مستهدفاً صحيحاً." : "Enter a valid target price.")
      return
    }
    setBusy(true)
    const res = await fetch("/api/v1/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ companyId: picked.id, direction, targetPrice }),
    }).catch(() => null)
    setBusy(false)
    if (!res || !res.ok) {
      const data = await res?.json().catch(() => ({}))
      const code = typeof data?.error === "string" ? data.error : ""
      setError(
        code === "RATE_LIMITED"
          ? ar
            ? "تغييرات كتير — استنى شوية وجرّب تاني."
            : "Too many changes — slow down a little."
          : code === "QUOTA"
            ? ar
              ? "وصلت للحد الأقصى (20 تنبيهاً نشطاً)."
              : "You've reached the limit of 20 active alerts."
            : ar
              ? "تعذّر إنشاء التنبيه. جرّب تاني."
              : "Could not create the alert. Please try again.",
      )
      return
    }
    setPicked(null)
    setQ("")
    setTarget("")
    onCreated()
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="relative space-y-1.5">
            <Label className="text-xs font-medium" htmlFor="alert-company">
              {ar ? "الشركة" : "Company"}
            </Label>
            {picked ? (
              <div className="flex h-9 items-center justify-between rounded-md border border-border bg-muted/40 px-3 text-sm">
                <span className="font-mono font-bold">{picked.ticker}</span>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setPicked(null)
                    setQ("")
                  }}
                >
                  {ar ? "تغيير" : "change"}
                </button>
              </div>
            ) : (
              <Input
                id="alert-company"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setPicked(null)
                }}
                placeholder={ar ? "ابحث بالاسم أو الرمز…" : "search by name or ticker…"}
                autoComplete="off"
              />
            )}
            {!picked && open && results.length > 0 ? (
              <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-card shadow-lg">
                {results.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-xs hover:bg-accent"
                    onClick={() => {
                      setPicked(c)
                      setOpen(false)
                    }}
                  >
                    <span className="font-mono font-bold">{c.ticker}</span>
                    <span dir="auto" className="truncate text-muted-foreground">
                      {ar ? c.nameAr || c.nameEn : c.nameEn}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium" htmlFor="alert-target">
              {ar ? "السعر المستهدف (ج.م)" : "Target price (EGP)"}
            </Label>
            <div className="flex gap-2">
              <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label={ar ? "اتجاه التنبيه" : "Alert direction"}>
                <button
                  type="button"
                  onClick={() => setDirection("ABOVE")}
                  aria-pressed={direction === "ABOVE"}
                  className={`flex items-center gap-1 px-2.5 text-xs font-semibold ${direction === "ABOVE" ? "bg-positive text-white" : "bg-muted/40 text-muted-foreground"}`}
                >
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden />
                  {ar ? "فوق" : "above"}
                </button>
                <button
                  type="button"
                  onClick={() => setDirection("BELOW")}
                  aria-pressed={direction === "BELOW"}
                  className={`flex items-center gap-1 px-2.5 text-xs font-semibold ${direction === "BELOW" ? "bg-negative text-white" : "bg-muted/40 text-muted-foreground"}`}
                >
                  <TrendingDown className="h-3.5 w-3.5" aria-hidden />
                  {ar ? "تحت" : "below"}
                </button>
              </div>
              <Input
                id="alert-target"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="0.00"
                className="tabular"
              />
            </div>
          </div>
        </div>
        {error ? (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={busy || !picked || !target}>
            {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden /> : <Bell className="me-1.5 h-4 w-4" aria-hidden />}
            {ar ? "حفظ السعر المستهدف" : "Save price target"}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            {ar ? "يتحقق على آخر سعر مسجّل — متأخر 15 دقيقة." : "Checked against the last recorded price — 15-minute delayed."}
          </p>
        </div>
      </form>
    </Card>
  )
}
