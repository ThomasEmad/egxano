"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { EGXANOWordmark } from "@/components/brand/brand-mark"
import { useI18n } from "@/lib/i18n"

const PASSWORD_MIN = 8
const PASSWORD_MAX = 72

/** Map API error codes to plain, bilingual messages — never render a raw code. */
function resetError(code: string | undefined, ar: boolean): string {
  switch (code) {
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
      return ar
        ? "رمز الاستعادة غير صالح أو انتهت صلاحيته — اطلب رمزاً جديداً."
        : "The reset code is invalid or has expired — request a new one."
    case "VALIDATION":
      return ar ? "كلمة المرور لازم تكون من 8 لـ 72 حرفاً." : "Password must be 8–72 characters."
    case "RATE_LIMITED":
      return ar ? "محاولات كتير — جرّب تاني بعد شوية." : "Too many attempts — try again later."
    default:
      return ar ? "تعذّر تعيين كلمة المرور. جرّب تاني." : "Couldn't set the password. Please try again."
  }
}

function ResetForm() {
  const router = useRouter()
  const search = useSearchParams()
  const { lang } = useI18n()
  const ar = lang === "ar"
  const [token, setToken] = useState(search.get("token") || "")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      setError(ar ? "كلمة المرور لازم تكون من 8 لـ 72 حرفاً." : "Password must be 8–72 characters.")
      return
    }
    if (password !== confirm) {
      setError(ar ? "كلمتا المرور غير متطابقتين." : "Passwords do not match.")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(resetError(data?.error, ar))
        return
      }
      setDone(true)
      setTimeout(() => router.replace("/login"), 2500)
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

  if (done) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md border-border/70 p-6 text-center shadow-sm">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-positive" aria-hidden />
          <h1 className="mb-2 text-base font-semibold">{ar ? "تم تغيير كلمة المرور" : "Password changed"}</h1>
          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
            {ar
              ? "تم إنهاء كل الجلسات النشطة على الأجهزة الأخرى — سجّل الدخول بكلمة المرور الجديدة."
              : "All other active sessions were signed out — sign in with your new password."}
          </p>
          <Link href="/login" className="text-sm font-semibold text-primary underline-offset-2 hover:underline">
            {ar ? "تسجيل الدخول" : "Sign in"}
          </Link>
        </Card>
      </div>
    )
  }

  const tokenMissing = !token.trim()

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="flex justify-center">
            <EGXANOWordmark lang={lang} size={40} />
          </div>
          <h1 className="mt-5 text-xl font-semibold tracking-tight">
            {ar ? "تعيين كلمة مرور جديدة" : "Set a new password"}
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {ar
              ? "الصق رمز الاستعادة اللي وصلك من فريق Meza بعد طلب إعادة التعيين، واختار كلمة مرور جديدة."
              : "Paste the reset code the Meza team gave you after your reset request, then choose a new password."}
          </p>
        </div>

        <Card className="border-border/70 p-0 shadow-sm">
          <form onSubmit={submit} className="space-y-4 p-6" noValidate>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium" htmlFor="reset-token">
                {ar ? "رمز الاستعادة" : "Reset code"}
              </Label>
              <Input
                id="reset-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                autoComplete="off"
                spellCheck={false}
                disabled={loading}
                className="font-mono text-xs"
              />
              {tokenMissing ? (
                <p className="text-[11px] text-muted-foreground">
                  {ar ? "مفيش رمز؟ " : "No code? "}
                  <Link href="/forgot-password" className="font-medium text-primary underline-offset-2 hover:underline">
                    {ar ? "اطلب رمز استعادة" : "Request a reset code"}
                  </Link>
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium" htmlFor="reset-password">
                {ar ? "كلمة المرور الجديدة" : "New password"}
              </Label>
              <div className="relative">
                <Input
                  id="reset-password"
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={PASSWORD_MIN}
                  maxLength={PASSWORD_MAX}
                  autoComplete="new-password"
                  disabled={loading}
                  className="pe-10"
                  aria-describedby="reset-password-hint"
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  aria-pressed={show}
                  aria-label={show ? (ar ? "إخفاء كلمات المرور" : "Hide passwords") : ar ? "إظهار كلمات المرور" : "Show passwords"}
                  className="absolute end-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </button>
              </div>
              <p id="reset-password-hint" className="text-[11px] text-muted-foreground">
                {ar ? "من 8 لـ 72 حرفاً." : "8–72 characters."}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium" htmlFor="reset-confirm">
                {ar ? "تأكيد كلمة المرور" : "Confirm password"}
              </Label>
              <Input
                id="reset-confirm"
                type={show ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                disabled={loading}
              />
            </div>

            {error ? (
              <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={loading || tokenMissing}>
              {loading ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="me-2 h-4 w-4" aria-hidden />}
              {ar ? "تعيين كلمة المرور" : "Set password"}
            </Button>

            <p className="text-center text-xs">
              <Link href="/login" className="font-medium text-primary underline-offset-2 hover:underline">
                {ar ? "العودة لتسجيل الدخول" : "Back to sign in"}
              </Link>
            </p>
          </form>
        </Card>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <LayoutShell chrome="marketing">
      <Suspense
        fallback={
          <div className="mx-auto flex min-h-[60vh] w-full max-w-md items-center justify-center px-4" aria-busy="true" aria-live="polite">
            <div className="h-64 w-full animate-pulse rounded-xl bg-muted" />
          </div>
        }
      >
        <ResetForm />
      </Suspense>
    </LayoutShell>
  )
}

