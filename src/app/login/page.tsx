"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Eye, EyeOff, Loader2, LogIn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { EGXANOWordmark } from "@/components/brand/brand-mark"
import { BRAND } from "@/lib/brand"
import { useI18n } from "@/lib/i18n"
import { setUserToken, getUserToken, clearUserToken } from "@/lib/client/api"
import { OAuthButtons } from "@/components/auth/oauth-buttons"
import { useWatchlist } from "@/lib/client/watchlist"

/** Only same-site absolute paths survive; anything else falls back to home. */
function sanitizeNext(raw: string | null): string {
  if (!raw) return "/"
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/"
  return raw
}

/** Map API error codes to plain, bilingual messages — never render a raw code. */
function loginError(code: string | undefined, ar: boolean): string {
  switch (code) {
    case "INVALID_CREDENTIALS":
      return ar ? "البريد الإلكتروني أو كلمة المرور غير صحيحة." : "Email or password is incorrect."
    case "RATE_LIMITED":
      return ar ? "محاولات كتير — جرّب تاني بعد كام دقيقة." : "Too many attempts — try again in a few minutes."
    case "EMAIL_AND_PASSWORD_REQUIRED":
      return ar ? "أدخل البريد الإلكتروني وكلمة المرور." : "Enter your email and password."
    case "INTERNAL_ERROR":
      return ar ? "تعذّر تسجيل الدخول دلوقتي — جرّب تاني بعد شوية." : "Couldn't sign in right now — please try again shortly."
    default:
      return ar ? "تعذّر تسجيل الدخول. جرّب تاني." : "Couldn't sign in. Please try again."
  }
}

function LoginForm() {
  const router = useRouter()
  const search = useSearchParams()
  const { lang } = useI18n()
  const ar = lang === "ar"
  const next = sanitizeNext(search.get("next"))

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [alreadySignedIn, setAlreadySignedIn] = useState(false)

  // Session probe — NEVER auto-redirect away from this page: pressing "sign
  // in" must always leave the form open (a valid session used to bounce the
  // visitor straight back home — "page appears then disappears instantly").
  // A live session only flips an informational banner; a dead token (401) is
  // cleared from storage.
  useEffect(() => {
    const token = getUserToken()
    if (!token) return
    let cancelled = false
    fetch("/api/v1/auth/me", { headers: { "x-session-token": token } })
      .then((r) => {
        if (cancelled) return
        if (r.ok) setAlreadySignedIn(true)
        else if (r.status === 401) clearUserToken()
      })
      .catch(() => {
        // network failure — keep the token, just show the form
      })
    return () => {
      cancelled = true
    }
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!email.trim() || !password) {
      setError(ar ? "أدخل البريد الإلكتروني وكلمة المرور." : "Enter your email and password.")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(loginError(data?.error, ar))
        return
      }
      if (data.token) setUserToken(data.token, remember)
      void useWatchlist.getState().syncFromServer()
      router.replace(next)
      router.refresh()
    } catch {
      setError(
        ar
          ? "تعذّر الوصول للسيرفر. اتأكد من الاتصال وجرّب تاني."
          : "We couldn't reach the server. Check your connection and try again.",
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-7 text-center">
          <div className="flex justify-center">
            <EGXANOWordmark lang={lang} size={40} />
          </div>
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-foreground">
            {ar ? "تسجيل الدخول" : "Sign in"}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {ar
              ? "سجّل الدخول لمزامنة قائمة المتابعة والمحفظة والتنبيهات. التصفح مجاني وبدون حساب."
              : "Sign in to sync your watchlist, portfolio and alerts. Browsing stays free."}
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground/80">
            {ar ? "منصة أبحاث مستقلة — غير تابعة للبورصة المصرية." : "Independent research platform — not affiliated with the Egyptian Exchange."}
          </p>
        </div>

        {alreadySignedIn ? (
          <div
            role="status"
            className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
          >
            {ar
              ? "لديك جلسة نشطة بالفعل — النموذج تحت ما زال يعمل لتبديل الحساب."
              : "You already have an active session — the form below still works to switch accounts."}
            <span className="mx-1" aria-hidden>·</span>
            <Link href={next} className="font-semibold text-primary underline-offset-2 hover:underline">
              {ar ? "الانتقال للصفحة المطلوبة" : "Continue where you were headed"}
            </Link>
          </div>
        ) : null}

        <Card className="border-border/70 p-0 shadow-sm">
          <form onSubmit={submit} className="space-y-4 p-6" noValidate>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium" htmlFor="login-email">
                {ar ? "البريد الإلكتروني" : "Email"}
              </Label>
              <Input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
                disabled={loading}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-medium" htmlFor="login-password">
                  {ar ? "كلمة المرور" : "Password"}
                </Label>
                <Link
                  href="/forgot-password"
                  className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                >
                  {ar ? "نسيت كلمة المرور؟" : "Forgot password?"}
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={loading}
                  className="pe-10"
                  aria-describedby={error ? "login-error" : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? (ar ? "إخفاء كلمة المرور" : "Hide password") : ar ? "إظهار كلمة المرور" : "Show password"}
                  className="absolute end-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </button>
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--primary)]"
              />
              {ar ? "تذكرني على هذا الجهاز" : "Remember me on this device"}
            </label>

            {error ? (
              <p
                id="login-error"
                role="alert"
                className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive"
              >
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden /> : <LogIn className="me-2 h-4 w-4" aria-hidden />}
              {ar ? "تسجيل الدخول" : "Sign in"}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              {ar ? "ليس لديك حساب؟" : "No account yet?"}{" "}
              <Link href={`/register${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-primary underline-offset-2 hover:underline">
                {ar ? "إنشاء حساب مجاني" : "Create a free account"}
              </Link>
            </p>

            <OAuthButtons next={next} />
          </form>
        </Card>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground/80">
          {ar ? BRAND.trustLineAr : BRAND.trustLineEn}
        </p>
      </div>
    </div>
  )
}

function LoginSkeleton() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-md space-y-3 px-4" aria-busy="true" aria-live="polite">
        <span className="sr-only">{`جارٍ التحميل — Loading`}</span>
        <div className="mx-auto h-10 w-40 rounded-lg bg-muted" />
        <div className="mx-auto h-4 w-64 rounded bg-muted" />
        <div className="h-40 w-full rounded-xl bg-muted" />
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <LayoutShell chrome="marketing">
      <Suspense fallback={<LoginSkeleton />}>
        <LoginForm />
      </Suspense>
    </LayoutShell>
  )
}

