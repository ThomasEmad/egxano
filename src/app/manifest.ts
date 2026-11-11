import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EGXANO — Egyptian stock market research",
    short_name: "EGXANO",
    description:
      "EGXANO — Egyptian stock market research: published financial statements, calculated ratios, technical context and company comparisons for EGX-listed companies — in Arabic and English. Understand the market before you decide.",
    start_url: "/",
    display: "standalone",
    background_color: "#F7F8F6",
    theme_color: "#060906",
    // Arabic-first product: the install UI and standalone window should
    // reflect the primary RTL locale (pages flip dir client-side).
    lang: "ar-EG",
    dir: "rtl",
    id: "/",
    scope: "/",
    categories: ["finance", "business", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}