"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "next-themes"
import { useState } from "react"
import { I18nProvider } from "@/lib/i18n"

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      {/* DARK is the brand's default identity (owner mandate 2026-11-20):
          premium graphite + acid lime. A returning user's explicit light
          choice still wins via next-themes' localStorage persistence. */}
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
        <I18nProvider>{children}</I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
