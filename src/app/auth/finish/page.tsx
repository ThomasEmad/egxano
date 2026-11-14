"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { setUserToken } from "@/lib/client/api"
import { useWatchlist } from "@/lib/client/watchlist"

// /auth/finish — landing target of every OAuth callback.
//
// The session token arrives in the URL FRAGMENT (#token=…) so it never
// touches server logs. This page takes the fragment, stores it the same way
// password login does (x-session-token in localStorage), verifies it with
// /auth/me, then bounces to ?next. Errors arrive as ?error=<code> and are
// shown bilingually.
//
// Watchlist merge: a guest who starred companies before signing in keeps
// them — the localStorage watchlist is preserved as-is; DB sync (when
// signed in) happens on the watchlist APIs.

const ERRORS: Record<string, { ar: string; en: string }> = {
  consent_denied: { ar: "لم يتم إتمام الإذن من المزوّد.", en: "Consent was not granted on the provider page." },
  invalid_state: { ar: "انتهت صلاحية طلب الدخول — ابدأ من جديد.", en: "The sign-in request expired — please start again." },
  exchange_failed: { ar: "تعذّر التحقق من الحساب لدى المزوّد.", en: "Could not verify the account with the provider." },
  account_error: { ar: "حدث خطأ أثناء تجهيز الحساب.", en: "Something went wrong preparing the account." },
  account_disabled: { ar: "هذا الحساب موقوف.", en: "This account is disabled." },
  email_not_verified: {
    ar: "البريد الإلكتروني لدى المزوّد غير موثّق — استخدم الدخول بكلمة المرور.",
    en: "The provider email is not verified — use password sign-in instead.",
  },
  provider_unavailable: { ar: "مزوّد الدخول غير مُهيّأ حالياً.", en: "This sign-in provider is not configured." },
  rate_limited: { ar: "محاولات كثيرة — انتظر قليلاً ثم أعد المحاولة.", en: "Too many attempts — wait a moment and retry." },
  session_error: { ar: "تعذّر إنشاء الجلسة.", en: "Failed to create a session." },
  missing_token: { ar: "رابط غير مكتمل — ابدأ من جديد.", en: "Incomplete link — please start again." },
  invalid_token: { ar: "الجلسة غير صالحة — ابدأ من جديد.", en: "The session is invalid — please start again." },
}

function FinishInner() {
  const router = useRouter()
  const search = useSearchParams()
  const [msg, setMsg] = useState<{ ar: string; en: string } | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    const error = search.get("error")
    const next = search.get("next") || "/"

    // 2026-11-14 audit fix: the two synchronous setMsg calls here fired inside
    // the effect body (set-state-in-effect → cascading render on a page that
    // renders once). Both outcomes are fully derivable from values already in
    // hand, so the error path now renders directly (see `urlError` below) and
    // only genuinely async outcomes keep touching state.
    if (error) return

    // token lives in the fragment — never sent to the server
    const hash = window.location.hash.replace(/^#/, "")
    const params = new URLSearchParams(hash)
    const token = params.get("token")
    if (!token) return

    // verify before storing
    fetch("/api/v1/auth/me", { headers: { "x-session-token": token } })
      .then((r) => {
        if (!r.ok) throw new Error("invalid")
        setUserToken(token, true)
        // server sets the HttpOnly session cookie (server components depend on it)
        void fetch("/api/v1/auth/session", { method: "POST", headers: { "x-session-token": token } }).catch(() => {})
        void useWatchlist.getState().syncFromServer()
        // strip the fragment from history/history.state
        window.history.replaceState(null, "", window.location.pathname + `?next=${encodeURIComponent(next)}`)
        router.replace(next)
        router.refresh()
      })
      .catch(() => setMsg(ERRORS.invalid_token))
  }, [router, search])

  // URL-level sign-in errors (?error=<code>) are fully derivable during
  // render — no effect or state needed (2026-11-14 audit fix).
  const urlError = search.get("error")
  const derivedMsg = urlError
    ? (ERRORS[urlError] ?? { ar: "تعذّر تسجيل الدخول.", en: "Sign-in failed." })
    : null
  const shown = msg ?? derivedMsg

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-4 text-center">
      {shown ? (
        <>
          <p className="max-w-sm rounded-lg border border-red-500/40 bg-red-500/8 px-4 py-3 text-sm text-red-600 dark:text-red-400" role="alert">
            <span dir="auto">{shown.ar}</span>
            <br />
            {shown.en}
          </p>
          <Link href="/login" className="text-sm font-semibold text-primary hover:underline">
            <span dir="auto">العودة لتسجيل الدخول</span>
            <span className="mx-1" aria-hidden>·</span>
            Back to sign in
          </Link>
        </>
      ) : (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
          <p className="text-sm text-muted-foreground">
            <span dir="auto">جارٍ إكمال تسجيل الدخول…</span>
            <span className="mx-1" aria-hidden>·</span>
            Completing sign-in…
          </p>
        </>
      )}
    </div>
  )
}

export default function AuthFinishPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[70vh] items-center justify-center" />}>
      <FinishInner />
    </Suspense>
  )
}
