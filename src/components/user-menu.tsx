"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bell, Briefcase, ChevronDown, Crown, KeyRound, Loader2, LogOut, ShieldCheck, User } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authHeaders, clearUserToken, getUserToken } from "@/lib/client/api"
import { useI18n } from "@/lib/i18n"

// AccountMenu — the single account surface for the header.
//
// MOUNT NOTE (for Lead final integration):
//   import { AccountMenu } from "@/components/user-menu"
//   …and render it where TopHeader currently renders its profile button/dropdown
//   (src/components/layout/TopHeader.tsx, the `profileRef` block). This
//   component is self-contained: it owns the signed-out "Sign in" button, the
//   signed-in trigger, the dropdown, sign-out confirmation and the
//   change-password dialog. It does not depend on any TopHeader state.

interface MeResponse {
  user: { id: string; email: string; name: string | null; role: string; createdAt: string }
  subscription: {
    isPremium: boolean
    subscription: { status: string; planName: string; startDate: string | null; endDate: string | null } | null
  }
}

function changePasswordError(code: string, rawMessage: string, ar: boolean): string {
  const message = rawMessage.toLowerCase()
  if (code === "INVALID_CREDENTIALS") {
    return ar ? "كلمة المرور الحالية غير صحيحة." : "Current password is incorrect."
  }
  if (code === "RATE_LIMITED") {
    return ar ? "محاولات كتير — جرّب تاني بعد شوية." : "Too many attempts — try again later."
  }
  if (code === "UNAUTHENTICATED") {
    return ar ? "انتهت الجلسة — سجّل الدخول تاني." : "Your session expired — sign in again."
  }
  if (code === "VALIDATION") {
    if (message.includes("different")) {
      return ar ? "كلمة المرور الجديدة لازم تكون مختلفة عن الحالية." : "The new password must be different from the current one."
    }
    if (message.includes("between")) {
      return ar ? "كلمة المرور لازم تكون من 8 لـ 72 حرفاً." : "Password must be 8–72 characters."
    }
  }
  return ar ? "تعذّر تغيير كلمة المرور. راجع البيانات وجرّب تاني." : "Couldn't change the password. Check the details and try again."
}

export function AccountMenu({ className }: { className?: string }) {
  const router = useRouter()
  const qc = useQueryClient()
  const { lang } = useI18n()
  const ar = lang === "ar"

  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), [])

  const token = mounted ? getUserToken() : null

  const { data, isLoading } = useQuery({
    queryKey: ["account-me", token],
    queryFn: async (): Promise<MeResponse | null> => {
      if (!token) return null
      const res = await fetch("/api/v1/auth/me", { headers: { "x-session-token": token } })
      if (res.status === 401) {
        clearUserToken()
        return null
      }
      return res.ok ? ((await res.json()) as MeResponse) : null
    },
    enabled: mounted,
    staleTime: 60_000,
    retry: false,
  })

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setConfirmSignOut(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false)
        setConfirmSignOut(false)
      }
    }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const logout = useMutation({
    mutationFn: () =>
      fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
      }),
    onSettled: () => {
      clearUserToken()
      qc.clear()
      setOpen(false)
      router.push("/login")
      router.refresh()
    },
  })

  if (!mounted || isLoading) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={className}
        disabled
        aria-label={ar ? "جارٍ تحميل الحساب" : "Loading account"}
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      </Button>
    )
  }

  const signedIn = !!data?.user
  const isPremium = !!data?.subscription?.isPremium
  const plan = data?.subscription?.subscription ?? null
  const displayName = data?.user?.name || data?.user?.email || null
  const endDate = plan?.endDate
    ? new Date(plan.endDate).toLocaleDateString(ar ? "ar-EG-u-nu-latn" : "en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null

  if (!signedIn) {
    return (
      <Button asChild variant="outline" size="sm" className={className}>
        <Link href="/login">
          <User className="me-1.5 h-4 w-4" aria-hidden />
          {ar ? "تسجيل الدخول" : "Sign in"}
        </Link>
      </Button>
    )
  }

  return (
    <div className={`relative ${className ?? ""}`} ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o)
          setConfirmSignOut(false)
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ar ? "حسابي" : "My account"}
        className="flex items-center gap-2 rounded-xl border border-border/60 bg-card px-2.5 py-1.5 text-start transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <User className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="hidden min-w-0 flex-col leading-tight sm:flex">
          <span className="max-w-[130px] truncate text-xs font-semibold text-foreground">
            {displayName ?? (ar ? "حسابي" : "My account")}
          </span>
          <span className="text-[10px] text-muted-foreground">{isPremium ? (ar ? "بريميوم" : "Premium") : ar ? "مجاني" : "Free"}</span>
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={ar ? "حسابي" : "My account"}
          className="absolute end-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-border/70 bg-card shadow-xl shadow-black/10"
        >
          <div className="border-b border-border/60 px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-foreground">{data?.user?.name ?? (ar ? "حسابي" : "My account")}</p>
            <p className="truncate text-[11px] text-muted-foreground">{data?.user?.email}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Badge variant={isPremium ? "default" : "secondary"} className="text-[10px]">
                {isPremium ? (ar ? "بريميوم" : "Premium") : ar ? "مجاني" : "Free"}
              </Badge>
              {isPremium && endDate ? (
                <span className="text-[10px] text-muted-foreground">
                  {ar ? "ينتهي" : "ends"} {endDate}
                </span>
              ) : null}
            </div>
          </div>

          <div className="p-1.5">
            <MenuLink href="/watchlist" icon={<ShieldCheck className="h-4 w-4" aria-hidden />} label={ar ? "قائمة المتابعة" : "Watchlist"} />
            <MenuLink href="/portfolio" icon={<Briefcase className="h-4 w-4" aria-hidden />} label={ar ? "المحفظة" : "Portfolio"} />
            <MenuLink href="/alerts" icon={<Bell className="h-4 w-4" aria-hidden />} label={ar ? "الأسعار المستهدفة" : "Price targets"} />
            <MenuLink
              href="/premium"
              icon={<Crown className="h-4 w-4" aria-hidden />}
              label={isPremium ? (ar ? "الاشتراك" : "Subscription") : ar ? "طلب Premium" : "Request Premium"}
            />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setPasswordOpen(true)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm text-foreground transition-colors hover:bg-muted/60"
            >
              <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
              {ar ? "تغيير كلمة المرور" : "Change password"}
            </button>
            <div className="my-1 border-t border-border/60" />
            {confirmSignOut ? (
              <div className="rounded-lg bg-muted/40 p-2.5">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {ar ? "تسجيل الخروج من هذا الجهاز؟" : "Sign out of this device?"}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 flex-1 text-[11px]"
                    onClick={() => setConfirmSignOut(false)}
                    disabled={logout.isPending}
                  >
                    {ar ? "إلغاء" : "Cancel"}
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 flex-1 text-[11px]"
                    onClick={() => logout.mutate()}
                    disabled={logout.isPending}
                  >
                    {logout.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : ar ? "خروج" : "Sign out"}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                role="menuitem"
                onClick={() => setConfirmSignOut(true)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm text-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                {ar ? "تسجيل الخروج" : "Sign out"}
              </button>
            )}
          </div>
        </div>
      ) : null}

      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} ar={ar} />
    </div>
  )
}

function MenuLink({
  href,
  icon,
  label,
}: {
  href: string
  icon: React.ReactNode
  label: string
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm text-foreground transition-colors hover:bg-muted/60"
    >
      <span className="text-muted-foreground">{icon}</span>
      {label}
    </Link>
  )
}

function ChangePasswordDialog({ open, onOpenChange, ar }: { open: boolean; onOpenChange: (v: boolean) => void; ar: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const reset = () => {
    setCurrentPassword("")
    setNewPassword("")
    setConfirm("")
    setError(null)
    setDone(false)
  }

  const change = useMutation({
    mutationFn: async () => {
      if (newPassword.length < 8 || newPassword.length > 72) {
        throw new Error("VALIDATION: between")
      }
      if (newPassword !== confirm) {
        throw new Error("VALIDATION: match")
      }
      const res = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(`${body?.error ?? "FAILED"}: ${body?.message ?? ""}`)
      return body
    },
    onSuccess: () => {
      setDone(true)
      setCurrentPassword("")
      setNewPassword("")
      setConfirm("")
      setError(null)
    },
    onError: (err: Error) => {
      const [code, message] = err.message.split(": ")
      if (code === "VALIDATION" && message === "match") {
        setError(ar ? "كلمتا المرور غير متطابقتين." : "Passwords do not match.")
        return
      }
      if (code === "VALIDATION" && message === "between") {
        setError(ar ? "كلمة المرور الجديدة لازم تكون من 8 لـ 72 حرفاً." : "The new password must be 8–72 characters.")
        return
      }
      setError(changePasswordError(code, message ?? "", ar))
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) reset()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{ar ? "تغيير كلمة المرور" : "Change password"}</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {ar
              ? "هيتم تسجيل الخروج من الأجهزة الأخرى، والجهاز الحالي هيفضل داخل."
              : "Other devices will be signed out; this device stays signed in."}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-3">
            <p role="status" className="rounded-lg border border-positive/30 bg-positive/5 px-3 py-2 text-xs text-foreground">
              {ar ? "تم تغيير كلمة المرور بنجاح." : "Password changed successfully."}
            </p>
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              {ar ? "إغلاق" : "Close"}
            </Button>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              change.mutate()
            }}
            noValidate
          >
            <div className="space-y-1.5">
              <Label className="text-xs font-medium" htmlFor="acct-current-password">
                {ar ? "كلمة المرور الحالية" : "Current password"}
              </Label>
              <Input
                id="acct-current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                disabled={change.isPending}
                required
              />
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {ar
                  ? "لو بتسجّل عبر Google/Facebook ومفيش كلمة مرور محلية، اكتب أي نص هنا — هنعيّن الكلمة الجديدة."
                  : "If you sign in with Google/Facebook and have no local password yet, type any placeholder here — we'll set the new one."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium" htmlFor="acct-new-password">
                {ar ? "كلمة المرور الجديدة" : "New password"}
              </Label>
              <Input
                id="acct-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                disabled={change.isPending}
                required
              />
              <p className="text-[10px] text-muted-foreground">{ar ? "من 8 لـ 72 حرفاً." : "8–72 characters."}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium" htmlFor="acct-confirm-password">
                {ar ? "تأكيد كلمة المرور" : "Confirm password"}
              </Label>
              <Input
                id="acct-confirm-password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                disabled={change.isPending}
                required
              />
            </div>
            {error ? (
              <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={change.isPending || !currentPassword || newPassword.length < 8}>
              {change.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              {ar ? "تغيير كلمة المرور" : "Change password"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Backwards-compatible alias for the old header's `UserMenu` import. */
export { AccountMenu as UserMenu }
