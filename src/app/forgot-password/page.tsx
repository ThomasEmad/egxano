"use client"

import { useState } from "react"
import Link from "next/link"
import { Loader2, MailQuestion } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LayoutShell } from "@/components/layout/LayoutShell"
import { EGXANOWordmark } from "@/components/brand/brand-mark"
import { useI18n } from "@/lib/i18n"

// Forgot-password request. This environment has no outbound email service, so
// the API records the request (audit log) and always answers generically — the
// page explains the team-completed step honestly instead of pretending an
// email was sent. Contact is limited to existing pages: no invented mailbox.
export default function ForgotPasswordPage() {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      if (res.status === 429) {
        setError(ar ? "طلبات كتير — جرّب تاني بعد شوية." : "Too many requests — please try again later.")
        return
      }
      // generic success regardless of account existence (no user enumeration)
      setSent(true)
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
    <LayoutShell chrome="marketing">
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <div className="flex justify-center">
              <EGXANOWordmark lang={lang} size={40} />
            </div>
            <h1 className="mt-5 text-xl font-semibold tracking-tight">
              {ar ? "نسيت كلمة المرور؟" : "Forgot your password?"}
            </h1>
          </div>

          <Card className="w-full border-border/70 p-0 shadow-sm">
            <div className="space-y-4 p-6">
              {sent ? (
                <div className="space-y-3 text-center">
                  <MailQuestion className="mx-auto h-8 w-8 text-primary" aria-hidden />
                  <h2 className="text-base font-semibold">{ar ? "تم استلام الطلب" : "Request received"}</h2>
                  <p className="text-start text-xs leading-relaxed text-muted-foreground">
                    {ar ? (
                      <>
                        لو البريد ده مسجّل عندنا، فريق Meza يقدر يصدر رمز استعادة لمرة واحدة صالح لمدة 30 دقيقة. إعادة
                        التعيين مش تلقائية في البيئة الحالية — مفيش إيميل بيتسرّح. لو الرمز انتهت صلاحيته، ابعت الطلب
                        تاني. حالتنا التقنية ظاهرة في{" "}
                        <Link href="/status" className="font-medium text-primary underline underline-offset-2">
                          صفحة الحالة
                        </Link>
                        {" "}وتفاصيل عن المنصة في{" "}
                        <Link href="/about" className="font-medium text-primary underline underline-offset-2">
                          من نحن
                        </Link>
                        .
                      </>
                    ) : (
                      <>
                        If that email is registered, the Meza team can issue a single-use reset code valid for 30
                        minutes. Reset isn&apos;t automatic in this environment — no email is sent. If a code expires,
                        submit the request again. Platform status is public on{" "}
                        <Link href="/status" className="font-medium text-primary underline underline-offset-2">
                          the status page
                        </Link>
                        , and platform details are on{" "}
                        <Link href="/about" className="font-medium text-primary underline underline-offset-2">
                          About
                        </Link>
                        .
                      </>
                    )}
                  </p>
                  <div className="flex flex-col items-center gap-2">
                    <Link href="/login" className="text-xs font-medium text-primary underline-offset-2 hover:underline">
                      {ar ? "العودة لتسجيل الدخول" : "Back to sign in"}
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setSent(false)
                        setError(null)
                      }}
                      className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                    >
                      {ar ? "إرسال طلب تاني" : "Submit another request"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-1 text-center">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {ar
                        ? "اكتب بريد حسابك وهنسجّل طلب إعادة تعيين كلمة المرور."
                        : "Enter your account email and we'll record a reset request."}
                    </p>
                  </div>
                  <form onSubmit={submit} className="space-y-3" noValidate>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium" htmlFor="fp-email">
                        {ar ? "البريد الإلكتروني" : "Email"}
                      </Label>
                      <Input
                        id="fp-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoFocus
                        autoComplete="email"
                        disabled={loading}
                      />
                    </div>
                    {error ? (
                      <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                        {error}
                      </p>
                    ) : null}
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                      {ar ? "إرسال الطلب" : "Send request"}
                    </Button>
                  </form>
                  <p className="text-center text-xs">
                    <Link href="/login" className="text-primary underline-offset-2 hover:underline">
                      {ar ? "العودة لتسجيل الدخول" : "Back to sign in"}
                    </Link>
                  </p>
                </>
              )}
            </div>
          </Card>
        </div>
      </div>
    </LayoutShell>
  )
}

