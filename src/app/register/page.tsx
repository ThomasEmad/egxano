"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Check, Eye, EyeOff, Loader2, UserPlus } from "lucide-react"
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

const PASSWORD_MIN = 8
const PASSWORD_MAX = 72
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Only same-site absolute paths survive; anything else falls back to home. */
function sanitizeNext(raw: string | null): string {
  if (!raw) return "/"
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/"
  return raw
}

/** Map API error codes to plain, bilingual messages — never render a raw code. */
function registerError(code: string | undefined, ar: boolean): string {
  switch (code) {
    case "EMAIL_ALREADY_EXISTS":
      return ar
        ? "البريد الإلكتروني ده عنده حساب بالفعل — سجّل الدخول بدلاً من كده."
        : "This email already has an account — sign in instead."
    case "VALIDATION":
      return ar ? "راجع البيانات المدخلة — كلمة المرور من 8 لـ 72 حرفاً." : "Please check your details — password must be 8–72 characters."
    case "RATE_LIMITED":
      return ar ? "محاولات كتير — جرّب تاني بعد كام دقيقة." : "Too many attempts — try again in a few minutes."
    case "EMAIL_AND_PASSWORD_REQUIRED":
      return ar ? "البريد الإلكتروني وكلمة المرور مطلوبين." : "Email and password are required."
    case "INTERNAL_ERROR":
      return ar ? "تعذّر إنشاء الحساب دلوقتي — جرّب تاني بعد شوية." : "Couldn't create the account right now — please try again shortly."
    default:
      return ar ? "تعذّر إنشاء الحساب. جرّب تاني." : "Couldn't create the account. Please try again."
  }
}

interface FieldErrors {
  name?: string
  email?: string
  password?: string
  terms?: string
}

function RegisterForm() {
  const router = useRouter()
  const search = useSearchParams()
  const { lang } = useI18n()
  const ar = lang === "ar"
  const next = sanitizeNext(search.get("next"))

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [terms, setTerms] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [showPassword, setShowPassword] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const token = getUserToken()
    if (!token) return
    let cancelled = false
    // Never bounce away from this page — only drop a dead token (401). A live
    // session simply leaves the form open (registering another account is
    // legitimate) instead of yanking the visitor back to home instantly.
    fetch("/api/v1/auth/me", { headers: { "x-session-token": token } })
      .then((r) => {
        if (!cancelled && r.status === 401) clearUserToken()
      })
      .catch(() => {
        // network failure — keep the token, just show the form
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Optional name: only validate once touched and non-empty.
  const errors: FieldErrors = {}
  if (touched.name && name.trim().length > 0 && name.trim().length < 2) {
    errors.name = ar ? "الاسم قصير جداً — اكتب حرفين على الأقل أو سيبه فاضي." : "Name is too short — use at least 2 characters, or leave it blank."
  }
  if (touched.email && !EMAIL_RE.test(email)) {
    errors.email = ar ? "بريد إلكتروني غير صالح." : "Invalid email address."
  }
  if (touched.password) {
    if (password.length < PASSWORD_MIN) errors.password = ar ? "كلمة المرور لازم تكون 8 أحرف على الأقل." : "Password must be at least 8 characters."
    else if (password.length > PASSWORD_MAX) errors.password = ar ? "كلمة المرور أطول من الحد (72 حرفاً)." : "Password is longer than the 72-character limit."
  }
  if (touched.terms && !terms) {
    errors.terms = ar ? "الموافقة على الشروط مطلوبة." : "Consent is required."
  }

  const valid =
    (name.trim().length === 0 || name.trim().length >= 2) &&
    EMAIL_RE.test(email) &&
    password.length >= PASSWORD_MIN &&
    password.length <= PASSWORD_MAX &&
    terms

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTouched({ name: true, email: true, password: true, terms: true })
    if (!valid) return
    setLoading(true)
    setServerError(null)
    try {
      const res = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, ...(name.trim() ? { name: name.trim() } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setServerError(registerError(data?.error, ar))
        return
      }
      // register → auto sign-in when the API returns a session
      if (data.token) {
        setUserToken(data.token, true)
        void useWatchlist.getState().syncFromServer()
        router.replace(next)
        router.refresh()
      } else {
        router.replace(`/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`)
      }
    } catch {
      setServerError(
        ar
          ? "تعذّر الوصول للسيرفر. اتأكد من الاتصال وجرّب تاني."
          : "We couldn't reach the server. Check your connection and try again.",
      )
    } finally {
      setLoading(false)
    }
  }

  const field = (key: "name" | "email" | "password" | "terms") => (touched[key] ? errors[key] : undefined)

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="flex justify-center">
            <EGXANOWordmark lang={lang} size={40} />
          </div>
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-foreground">
            {ar ? "إنشاء حساب مجاني" : "Create a free account"}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {ar
              ? "احفظ قائمة المتابعة والمحفظة والأسعار المستهدفة. مجاني — بدون بطاقة."
              : "Save your watchlist, portfolio and price targets. Free — no card required."}
          </p>
          <ul className="mx-auto mt-3 inline-flex flex-col gap-1 text-start text-[11px] leading-relaxed text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <Check className="h-3 w-3 shrink-0 text-positive" aria-hidden />
              {ar ? "مزامنة قائمة المتابعة على كل أجهزتك" : "Sync your watchlist across devices"}
            </li>
            <li className="flex items-center gap-1.5">
              <Check className="h-3 w-3 shrink-0 text-positive" aria-hidden />
              {ar ? "محفظة وأسعار مستهدفة تُحفظ مع حسابك" : "Portfolio and price targets saved to your account"}
            </li>
            <li className="flex items-center gap-1.5">
              <Check className="h-3 w-3 shrink-0 text-positive" aria-hidden />
              {ar ? "3 تحليلات ذكية شهرياً على الحساب المجاني" : "3 Smart Analyses a month on the free account"}
            </li>
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground/80">
            {ar ? "منصة أبحاث مستقلة — غير تابعة للبورصة المصرية." : "Independent research platform — not affiliated with the Egyptian Exchange."}
          </p>
        </div>

        <Card className="border-border/70 p-0 shadow-sm">
          <form onSubmit={submit} className="space-y-4 p-6" noValidate>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium" htmlFor="reg-name">
                {ar ? "الاسم (اختياري)" : "Name (optional)"}
              </Label>
              <Input
                id="reg-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                autoComplete="name"
                aria-invalid={!!field("name")}
                aria-describedby={field("name") ? "reg-name-error" : undefined}
                disabled={loading}
              />
              {field("name") ? (
                <p id="reg-name-error" className="text-[11px] text-destructive">
                  {field("name")}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium" htmlFor="reg-email">
                {ar ? "البريد الإلكتروني" : "Email"}
              </Label>
              <Input
                id="reg-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                autoComplete="email"
                aria-invalid={!!field("email")}
                aria-describedby={field("email") ? "reg-email-error" : undefined}
                disabled={loading}
              />
              {field("email") ? (
                <p id="reg-email-error" className="text-[11px] text-destructive">
                  {field("email")}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium" htmlFor="reg-password">
                {ar ? "كلمة المرور" : "Password"}
              </Label>
              <div className="relative">
                <Input
                  id="reg-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                  autoComplete="new-password"
                  aria-invalid={!!field("password")}
                  aria-describedby={field("password") ? "reg-password-error" : "reg-password-hint"}
                  disabled={loading}
                  className="pe-10"
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
              {field("password") ? (
                <p id="reg-password-error" className="text-[11px] text-destructive">
                  {field("password")}
                </p>
              ) : (
                <p id="reg-password-hint" className="text-[11px] text-muted-foreground">
                  {ar ? "من 8 لـ 72 حرفاً." : "8–72 characters."}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <input
                  type="checkbox"
                  checked={terms}
                  onChange={(e) => {
                    setTerms(e.target.checked)
                    setTouched((t) => ({ ...t, terms: true }))
                  }}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--primary)]"
                  aria-invalid={!!field("terms")}
                  aria-describedby={field("terms") ? "reg-terms-error" : undefined}
                />
                <span>
                  {ar ? (
                    <>
                      أوافق على{" "}
                      <Link href="/terms" target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-2">
                        شروط الاستخدام
                      </Link>{" "}
                      وأكدت إني قرأت{" "}
                      <Link href="/privacy" target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-2">
                        سياسة الخصوصية
                      </Link>
                      . Meza أداة بحث — مش توصية استثمارية.
                    </>
                  ) : (
                    <>
                      I agree to the{" "}
                      <Link href="/terms" target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-2">
                        Terms of Service
                      </Link>{" "}
                      and confirm I&apos;ve read the{" "}
                      <Link href="/privacy" target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-2">
                        Privacy Policy
                      </Link>
                      . Meza is a research tool — not investment advice.
                    </>
                  )}
                </span>
              </label>
              {field("terms") ? (
                <p id="reg-terms-error" className="text-[11px] text-destructive">
                  {field("terms")}
                </p>
              ) : null}
            </div>

            {serverError ? (
              <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive">
                {serverError}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={loading || !valid}>
              {loading ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden /> : <UserPlus className="me-2 h-4 w-4" aria-hidden />}
              {ar ? "إنشاء الحساب" : "Create account"}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              {ar ? "لديك حساب بالفعل؟" : "Already have an account?"}{" "}
              <Link href={`/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-primary underline-offset-2 hover:underline">
                {ar ? "تسجيل الدخول" : "Sign in"}
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

function RegisterSkeleton() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-md space-y-3 px-4" aria-busy="true" aria-live="polite">
        <span className="sr-only">{`جارٍ التحميل — Loading`}</span>
        <div className="mx-auto h-10 w-40 rounded-lg bg-muted" />
        <div className="mx-auto h-4 w-64 rounded bg-muted" />
        <div className="h-64 w-full rounded-xl bg-muted" />
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <LayoutShell chrome="marketing">
      <Suspense fallback={<RegisterSkeleton />}>
        <RegisterForm />
      </Suspense>
    </LayoutShell>
  )
}

