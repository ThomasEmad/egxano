import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EGXANO",
    short_name: "EGXANO",
    description:
      "Independent research for Egyptian Exchange companies — financials, technicals, comparisons and screening.",
    start_url: "/",
    display: "standalone",
    background_color: "#F7F8F4",
    theme_color: "#0B100C",
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
