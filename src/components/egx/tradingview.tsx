"use client"

// TradingView embed widgets (public, free, key-less) for chart + indicator
// DISPLAY only. All numbers used by the AI engine still come from our own
// deterministic backend engines — TradingView here is presentation, not data.

import { useEffect, useRef } from "react"
import { useTheme } from "next-themes"
import { useI18n } from "@/lib/i18n"

const TV_BASE = "https://s3.tradingview.com/external-embedding"

type TvWidget = "advanced-chart" | "technical-analysis"

/** Injects a TradingView embed widget into a container; re-injects when the
 *  theme/locale/symbol change and cleans up on unmount (no duplicate iframes). */
function useTradingViewWidget(widget: TvWidget, config: Record<string, unknown>) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const json = JSON.stringify(config)

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

    return () => {
      host.innerHTML = ""
    }
  }, [widget, json])

  return containerRef
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
  const ref = useTradingViewWidget("advanced-chart", {
    autosize: true,
    symbol: `EGX:${ticker}`,
    interval: "D",
    timezone: "Africa/Cairo",
    theme: dark ? "dark" : "light",
    style: "1",
    locale: lang === "ar" ? "ar" : "en",
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
  return (
    <div ref={ref} style={{ height }} dir="ltr" className="w-full overflow-hidden rounded-lg" />
  )
}

export function TradingViewTechnicalGauge({ ticker }: { ticker: string }) {
  const { resolvedTheme } = useTheme()
  const { lang } = useI18n()
  const dark = resolvedTheme === "dark"
  const ref = useTradingViewWidget("technical-analysis", {
    interval: "1D",
    width: "100%",
    isTransparent: true,
    height: 420,
    symbol: `EGX:${ticker}`,
    showIntervalTabs: true,
    displayMode: "single",
    locale: lang === "ar" ? "ar" : "en",
    colorTheme: dark ? "dark" : "light",
  })
  return (
    <div ref={ref} style={{ height: 420 }} dir="ltr" className="w-full overflow-hidden rounded-lg" />
  )
}
