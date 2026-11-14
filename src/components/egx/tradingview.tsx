"use client"

// TradingView embed widgets (public, free, key-less) for chart + indicator
// DISPLAY only. All numbers used by the AI engine still come from our own
// deterministic backend engines — TradingView here is presentation, not data.
//
// Both widgets report a `failed` state when the iframe never mounts (CSP
// blocking, script blocked, no network). A failed widget must never leave a
// large blank card on the page: the caller renders an honest fallback with a
// link to TradingView and a note that EGXANO's calculated indicators do not
// depend on it.

import { useEffect, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { ExternalLink } from "lucide-react"
import { useI18n } from "@/lib/i18n"

const TV_BASE = "https://s3.tradingview.com/external-embedding"

type TvWidget = "advanced-chart" | "technical-analysis"

/** How long we wait for the embed to inject its iframe before declaring failure. */
const READY_TIMEOUT_MS = 9000

interface WidgetState {
  containerRef: React.RefObject<HTMLDivElement | null>
  failed: boolean
}

/** Injects a TradingView embed widget into a container; re-injects when the
 *  theme/locale/symbol change and cleans up on unmount (no duplicate iframes). */
function useTradingViewWidget(widget: TvWidget, config: Record<string, unknown>): WidgetState {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Failure is scoped to the exact config it was detected for: changing the
  // theme/locale/symbol resets the flag by derivation, so the injection effect
  // never needs a synchronous setState at its start (and no ref is read
  // during render — the state value itself carries the config key).
  const [failedJson, setFailedJson] = useState<string | null>(null)
  const json = JSON.stringify(config)
  const failed = failedJson === json

  useEffect(() => {
    const host = containerRef.current
    if (!host) return
    host.innerHTML = ""

    const wrapper = document.createElement("div")
    wrapper.className = "tradingview-widget-container"
    wrapper.style.height = "100%"
    wrapper.style.width = "100%"
    const inner = document.createElement("div")
    inner.className = "tradingview-widget-container__widget"
    inner.style.height = "100%"
    inner.style.width = "100%"
    wrapper.appendChild(inner)

    const script = document.createElement("script")
    script.src = `${TV_BASE}/embed-widget-${widget}.js`
    script.type = "text/javascript"
    script.async = true
    script.innerHTML = json
    wrapper.appendChild(script)
    host.appendChild(wrapper)

    const timer = window.setTimeout(() => {
      if (!host.querySelector("iframe")) setFailedJson(json)
    }, READY_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timer)
      host.innerHTML = ""
    }
  }, [widget, json])

  return { containerRef, failed }
}

function WidgetFallback({
  ticker,
  widget,
  height,
}: {
  ticker: string
  widget: TvWidget
  height: number
}) {
  const { lang } = useI18n()
  const ar = lang === "ar"
  const href =
    widget === "technical-analysis"
      ? `https://www.tradingview.com/symbols/EGX-${ticker}/technicals/`
      : `https://www.tradingview.com/chart/?symbol=EGX%3A${encodeURIComponent(ticker)}`
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center"
      style={{ height }}
    >
      <p className="text-xs font-medium text-muted-foreground">
        {ar ? "تعذر تحميل أداة TradingView في هذا المتصفح." : "The TradingView widget could not load in this browser."}
      </p>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline underline-offset-2"
      >
        <ExternalLink className="h-3 w-3" aria-hidden />
        {ar ? "افتحه على TradingView" : "Open on TradingView"}
      </a>
      <p className="max-w-xs text-[10px] leading-relaxed text-muted-foreground">
        {ar
          ? "المؤشرات المحسوبة في EGXANO لا تعتمد على هذه الأداة — هي مصدر خارجي للعرض فقط."
          : "EGXANO's calculated figures do not depend on this widget — it is an external display only."}
      </p>
    </div>
  )
}

export function TradingViewChart({
  ticker,
  height = 460,
}: {
  ticker: string
  height?: number
}) {
  const { resolvedTheme } = useTheme()
  const { lang } = useI18n()
  const dark = resolvedTheme === "dark"
  // The widget's own locale is kept to English: EGX symbols are not covered in
  // the Arabic widget locale (it renders an empty canvas), and the widget chrome
  // is third-party UI, not EGXANO copy.
  const { containerRef, failed } = useTradingViewWidget("advanced-chart", {
    autosize: true,
    symbol: `EGX:${ticker}`,
    interval: "D",
    timezone: "Africa/Cairo",
    theme: dark ? "dark" : "light",
    style: "1",
    locale: "en",
    enable_publishing: false,
    allow_symbol_change: false,
    hide_side_toolbar: true,
    hide_top_toolbar: false,
    withdateranges: true,
    details: false,
    studies: ["RSI@tv-basicstudies", "MACD@tv-basicstudies"],
    backgroundColor: dark ? "rgba(9, 9, 11, 0)" : "rgba(255, 255, 255, 0)",
    gridColor: dark ? "rgba(63, 63, 70, 0.4)" : "rgba(228, 228, 231, 0.5)",
    support_host: "https://www.tradingview.com",
  })
  if (failed) return <WidgetFallback ticker={ticker} widget="advanced-chart" height={height} />
  return (
    <div ref={containerRef} style={{ height }} dir="ltr" className="w-full max-w-full overflow-hidden rounded-lg" />
  )
}

export function TradingViewTechnicalGauge({
  ticker,
  height = 380,
}: {
  ticker: string
  height?: number
}) {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === "dark"
  const { containerRef, failed } = useTradingViewWidget("technical-analysis", {
    interval: "1D",
    width: "100%",
    isTransparent: true,
    height,
    symbol: `EGX:${ticker}`,
    showIntervalTabs: true,
    displayMode: "single",
    locale: "en",
    colorTheme: dark ? "dark" : "light",
  })
  if (failed) return <WidgetFallback ticker={ticker} widget="technical-analysis" height={height} />
  return (
    <div ref={containerRef} style={{ height }} dir="ltr" className="w-full max-w-full overflow-hidden rounded-lg" />
  )
}
