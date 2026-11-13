"use client"

// =============================================================================
// BriefingCard — "البريفينج المسموع — تحليل صوتي لكل سهم"
//
// Per-stock Arabic audio briefing player, mounted on the technical tab of the
// company page. Server-driven gating (GET .../briefing returns the access
// decision from the user's real plan + trial row); this component never makes
// its own plan verdict — usePlan() is used only for the AdSense slot decision
// (ad shown for FREE logged-in users only; anonymous visitors get a clean
// layout with no ad placeholder).
//
// States: loading (skeleton) → ready → generating (rotating status lines) →
// playing (waveform animation) / login-required / trial-expired / failed
// (browser speechSynthesis fallback with ar-EG + the narration script).
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, AudioLines, ChevronDown, Lock, LogIn, Pause, Play, Volume2 } from "lucide-react"
import { AdSlot } from "@/components/egx/ad-slot"
import { usePlan } from "@/lib/client/subscription"
import {
  getCompanyBriefing,
  getUserToken,
  postCompanyBriefingPlay,
  type BriefingPlayErrorBody,
} from "@/lib/client/api"

type Phase = "loading" | "ready" | "generating" | "playing" | "login" | "expired" | "failed"

/** Rotating status lines shown while the narration is being prepared. */
const GENERATING_LINES = ["بنجهّز القراءة الصوتية…", "بنحلل الاتجاه والزخم…", "بسجّل الصوت…"]

function formatDuration(sec: number | null): string | null {
  if (sec === null || !Number.isFinite(sec) || sec <= 0) return null
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m > 0 ? `${m}:${String(s).padStart(2, "0")} د` : `${s} ث`
}

function formatExpiry(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  try {
    return d.toLocaleString("ar-EG", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
  } catch {
    return iso.slice(0, 16).replace("T", " ")
  }
}

export function BriefingCard({ companyId, ticker, nameAr }: { companyId: string; ticker: string; nameAr: string | null }) {
  const displayName = (nameAr ?? "").trim() || ticker

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["company-briefing", companyId],
    queryFn: () => getCompanyBriefing(companyId),
    staleTime: 60_000,
  })

  // Plan hook — used ONLY for the ad decision (server GET owns the gating).
  // While the plan is being verified we assume FREE but never hard-lock: a
  // muted "جارٍ التحقق من باقتك" line stands in for the ad slot.
  const { plan, isLoading: planLoading } = usePlan()
  const loggedIn = !!getUserToken()

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  const [generating, setGenerating] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [hasServedAudio, setHasServedAudio] = useState(false)
  const [override, setOverride] = useState<null | "login" | "expired" | "failed">(null)
  const [playError, setPlayError] = useState<string | null>(null)
  const [browserSpeaking, setBrowserSpeaking] = useState(false)
  const [lineIdx, setLineIdx] = useState(0)

  // Rotate the "generating" status lines.
  useEffect(() => {
    if (!generating) return
    const t = setInterval(() => setLineIdx((i) => (i + 1) % GENERATING_LINES.length), 2_500)
    return () => clearInterval(t)
  }, [generating])

  // Cleanup: release the blob URL and stop any browser speech on unmount.
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel()
    }
  }, [])

  // NOTE: transient player state (override/generating/playing/object URL) is
  // intentionally NOT reset when `companyId` changes — the mount point passes
  // key={companyId}, so a company switch remounts this card with fresh state
  // (the lint-clean "reset via key" pattern; unmount cleanup below revokes the
  // blob URL and stops any browser speech).

  // ---- derived phase -------------------------------------------------------

  const gated: Phase | null = useMemo(() => {
    if (!data) return null
    if (data.status === "FAILED") return "failed"
    if (!data.access.allowed) {
      if (data.access.reason === "LOGIN_REQUIRED") return "login"
      if (data.access.reason === "TRIAL_EXPIRED") return "expired"
      if (data.access.reason === "FAILED") return "failed"
    }
    return null
  }, [data])

  const phase: Phase = useMemo(() => {
    if (isLoading && !data) return "loading"
    if (isError && !data) return "failed"
    if (override) return override
    if (generating) return "generating"
    if (playing) return "playing"
    if (gated) return gated
    return "ready"
  }, [isLoading, data, isError, override, generating, playing, gated])

  const scriptAr = data?.scriptAr ?? ""
  const animate = phase === "playing" || phase === "generating" || browserSpeaking

  // ---- actions -------------------------------------------------------------

  const releaseObjectUrl = useCallback(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
  }, [])

  const onPlay = useCallback(async () => {
    setPlayError(null)
    const audio = audioRef.current
    if (!audio) return
    // Resume the already-served take instead of re-requesting.
    if (hasServedAudio && audio.src && audio.paused) {
      try {
        await audio.play()
        return
      } catch {
        // fell through to a fresh request
      }
    }
    setGenerating(true)
    let blob: Blob
    try {
      blob = await postCompanyBriefingPlay(companyId)
    } catch (e) {
      setGenerating(false)
      const err = e as Error & { status?: number; body?: BriefingPlayErrorBody }
      const reason = err.body?.reason
      if (err.status === 401 || reason === "LOGIN_REQUIRED") setOverride("login")
      else if (err.status === 403 || reason === "TRIAL_EXPIRED") setOverride("expired")
      else {
        setOverride("failed")
        setPlayError(err.body?.message ?? err.message ?? "الصوت مش متاح دلوقتي — القراءة النصية متاحة.")
      }
      return
    }
    setGenerating(false)
    const url = URL.createObjectURL(blob)
    releaseObjectUrl()
    objectUrlRef.current = url
    audio.src = url
    setHasServedAudio(true)
    // Playback start may legitimately race (double-click) — the element's own
    // play/pause/ended events drive the UI, so a rejected start is non-fatal.
    try {
      await audio.play()
    } catch {
      /* ignored — element events govern the visible state */
    }
  }, [companyId, hasServedAudio, releaseObjectUrl])

  const onPause = useCallback(() => {
    audioRef.current?.pause()
  }, [])

  /** Fallback narration when TTS is unavailable: the browser reads the script. */
  const speakBrowser = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !scriptAr) return
    const synth = window.speechSynthesis
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(scriptAr)
    utterance.lang = "ar-EG"
    utterance.rate = 1
    utterance.onend = () => setBrowserSpeaking(false)
    utterance.onerror = () => setBrowserSpeaking(false)
    setBrowserSpeaking(true)
    synth.speak(utterance)
  }, [scriptAr])

  const stopBrowserSpeech = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel()
    setBrowserSpeaking(false)
  }, [])

  // ---- rendering pieces ----------------------------------------------------

  const bars = useMemo(() => Array.from({ length: 26 }, (_, i) => ({ h: 22 + ((i * 41) % 61), d: 0.9 + ((i * 13) % 7) / 10, delay: (i % 6) * 0.12 })), [])
  const durationLabel = formatDuration(data?.durationSec ?? null)
  const expiryLabel = formatExpiry(data?.access.trialExpiresAt ?? null)
  const isFreeLoggedIn = loggedIn && !planLoading && plan === "FREE"

  const wave = (
    <div className="flex h-10 items-center gap-[3px] overflow-hidden rounded-lg bg-muted/40 px-3" aria-hidden>
      {bars.map((b, i) => (
        <span
          key={i}
          className="block w-[3px] rounded-full bg-primary"
          style={{
            height: `${b.h}%`,
            transformOrigin: "center",
            animation: `briefing-wave ${b.d}s ease-in-out ${b.delay}s infinite`,
            animationPlayState: animate ? "running" : "paused",
            opacity: animate ? 1 : 0.3,
          }}
        />
      ))}
    </div>
  )

  const playButton = (
    <button
      type="button"
      onClick={phase === "playing" ? onPause : onPlay}
      disabled={phase === "generating"}
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-primary to-emerald-500 text-primary-foreground shadow-lg shadow-primary/25 transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
      aria-label={phase === "playing" ? "إيقاف مؤقت" : "تشغيل البريفينج"}
    >
      {phase === "playing" ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 rtl:-scale-x-100" />}
    </button>
  )

  return (
    <section className="rounded-xl border border-border/60 bg-card" data-testid="briefing-card">
      {/* keyframes for the waveform (scoped by the unique animation name) */}
      <style>{`@keyframes briefing-wave { 0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }`}</style>

      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <div className="flex items-center gap-2">
          <AudioLines className="h-4 w-4 text-primary" aria-hidden />
          <h3 className="text-sm font-semibold">البريفينج المسموع — تحليل صوتي لكل سهم</h3>
        </div>
        {durationLabel && (phase === "ready" || phase === "playing") ? (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground" dir="ltr">
            {durationLabel}
          </span>
        ) : null}
      </div>
      <p className="px-4 pt-1 text-[11px] text-muted-foreground">
        قراءة فنية مسموعة بالعامية المصرية لسهم {displayName} — بنجمعها من نفس بيانات التحليل الفني.
      </p>

      <div className="px-4 pb-4 pt-3">
        {/* hidden audio element drives the WAV playback */}
        <audio
          ref={audioRef}
          className="hidden"
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />

        {/* ---------------- loading skeleton ---------------- */}
        {phase === "loading" ? (
          <div className="animate-pulse space-y-3">
            <div className="h-10 w-full rounded-lg bg-muted/60" />
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-muted/60" />
              <div className="h-3 w-40 rounded bg-muted/60" />
            </div>
          </div>
        ) : null}

        {/* ---------------- generating ---------------- */}
        {phase === "generating" ? (
          <div className="space-y-3">
            {wave}
            <div className="flex items-center gap-3">
              {playButton}
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {GENERATING_LINES[lineIdx]}
              </p>
            </div>
          </div>
        ) : null}

        {/* ---------------- playing / ready ---------------- */}
        {phase === "playing" || phase === "ready" ? (
          <div className="space-y-3">
            {wave}
            <div className="flex flex-wrap items-center gap-3">
              {playButton}
              <p className="text-xs text-muted-foreground">
                {phase === "playing"
                  ? browserSpeaking
                    ? "قراءة المتصفح شغالة…"
                    : "شغّال… اضغط إيقاف مؤقت في أي وقت"
                  : data?.access.plan === "FREE" && data.access.allowed
                    ? data.access.trialExpiresAt
                      ? `التجربة شغالة على السهم ده لحد ${expiryLabel ?? "نهاية اليوم"}`
                      : "أول تشغيل بيفتحلك يوم كامل للسهم ده مجانًا"
                    : "اضغط تشغيل لتسمع القراءة الفنية"}
              </p>
            </div>
          </div>
        ) : null}

        {/* ---------------- login required ---------------- */}
        {phase === "login" ? (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border/70 bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <LogIn className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
              <p className="text-xs leading-relaxed text-muted-foreground">
                سجّل دخول عشان تجرب البريفينج مجانًا ليوم كامل لكل سهم — التجربة بتتسجل على حسابك.
              </p>
            </div>
            <Link
              href="/login"
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
                تسجيل الدخول
            </Link>
          </div>
        ) : null}

        {/* ---------------- trial expired ---------------- */}
        {phase === "expired" ? (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border/70 bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <Lock className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <p className="text-xs leading-relaxed text-muted-foreground">
                تجربة اليوم لسهم دي خلصت — البريفينج المسموع بلا حدود مع باقة برو.
              </p>
            </div>
            <Link
              href="/premium"
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              ترقية لبرو
            </Link>
          </div>
        ) : null}

        {/* ---------------- failed (browser-speech fallback) ---------------- */}
        {phase === "failed" ? (
          <div className="space-y-3 rounded-lg border border-dashed border-border/70 bg-muted/20 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" aria-hidden />
              <div className="space-y-1">
                <p className="text-xs font-medium">{playError ?? "الصوت الأساسي تحت الصيانة — القراءة النصية متاحة."}</p>
                <p className="text-[11px] text-muted-foreground">
                  {scriptAr ? "الصوت الأساسي تحت الصيانة — تقدر تسمع القراءة بصوت المتصفح أو تقرأ النص تحت." : "مشكلة في تحميل البريفينج — جرّب تاني."}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {scriptAr ? (
                browserSpeaking ? (
                  <button
                    type="button"
                    onClick={stopBrowserSpeech}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted/60"
                  >
                    <Pause className="h-3.5 w-3.5" aria-hidden /> إيقاف قراءة المتصفح
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={speakBrowser}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-primary/60 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                  >
                    <Volume2 className="h-3.5 w-3.5" aria-hidden /> شغّل قراءة المتصفح
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted/60"
                >
                  إعادة المحاولة
                </button>
              )}
            </div>
          </div>
        ) : null}

        {/* ---------------- script (collapsible) ---------------- */}
        {scriptAr && phase !== "loading" ? (
          <details className="mt-3 group">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
              نص القراءة
            </summary>
            <p dir="rtl" className="mt-2 whitespace-pre-line rounded-lg bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              {scriptAr}
            </p>
          </details>
        ) : null}

        {/* ---------------- ad zone (FREE logged-in only) ---------------- */}
        {loggedIn && planLoading ? (
          <p className="mt-3 text-center text-[11px] text-muted-foreground/70">جارٍ التحقق من باقتك…</p>
        ) : isFreeLoggedIn && (phase === "ready" || phase === "playing" || phase === "generating") ? (
          <div className="mt-4">
            <AdSlot slot="briefing-player" format="in-article" className="max-w-full" />
          </div>
        ) : null}
      </div>
    </section>
  )
}
