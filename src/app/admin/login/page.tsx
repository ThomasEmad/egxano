"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/lib/i18n"

export default function AdminLoginPage() {
  const router = useRouter()
  const { lang } = useI18n()
  const ar = lang === "ar"
  const [passcode, setPasscode] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      // two minted-equal login paths: the admin ACCOUNT (email + password,
      // owner mandate 2026-11-16) or the legacy passcode — either yields the
      // same admin session cookie accepted by every /admin/* surface.
      const viaAccount = email.trim() !== "" || password !== ""
      const body = viaAccount ? { email: email.trim(), password } : { passcode }
      if (viaAccount && (!email.trim() || !password)) {
        throw new Error(ar ? "اكتب الإيميل وكلمة المرور معًا، أو استخدم رمز المرور" : "Enter both email and password, or use the passcode")
      }
      const res = await fetch("/api/v1/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      })
      let data: { error?: string; message?: string } = {}
      try { data = await res.json() } catch {}
      if (!res.ok) throw new Error(data.message || data.error || "Failed")
      router.replace("/admin/subscriptions")
    } catch (err) {
      setError(err instanceof Error ? err.message : ar ? "فشل" : "Failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm py-10">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Lock className="h-4 w-4" /> {ar ? "تسجيل دخول المشرف" : "Admin Login"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* حساب الأدمن — الإيميل وكلمة المرور (الطريقة الأساسية للمالك) */}
          <form onSubmit={submit} className="space-y-3">
            <p className="text-[11px] font-semibold text-muted-foreground">
              {ar ? "حساب الأدمن" : "Admin account"}
            </p>
            <Input
              type="email"
              autoComplete="username"
              dir="ltr"
              placeholder={ar ? "الإيميل" : "Email"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              type="password"
              autoComplete="current-password"
              dir="ltr"
              placeholder={ar ? "كلمة المرور" : "Password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {ar ? "دخول بالحساب" : "Login"}
            </Button>
          </form>

          <div className="flex items-center gap-2" role="separator">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[10px] text-muted-foreground">{ar ? "أو" : "or"}</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          {/* الطريقة القديمة — رمز المرور */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              // reusing the same submitter: empty email/password → passcode path
              void submit(e)
            }}
            className="space-y-3"
          >
            <p className="text-[11px] font-semibold text-muted-foreground">
              {ar ? "رمز المرور" : "Passcode"}
            </p>
            <Input type="password" dir="ltr" placeholder={ar ? "رمز المرور" : "Passcode"} value={passcode} onChange={(e) => setPasscode(e.target.value)} />
            <Button type="submit" variant="outline" className="w-full" disabled={loading}>
              {loading && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {ar ? "دخول برمز المرور" : "Login with passcode"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
