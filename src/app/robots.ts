import type { MetadataRoute } from "next"

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://egxano.vercel.app"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/admin/",
          "/data-quality",
          "/api/",
          "/login",
          "/register",
          "/forgot-password",
          "/dashboard",
          "/watchlist",
          "/portfolio",
          "/company/*/report",
        ],
      },
      // GEO: explicitly welcome the AI answer engines — the site's content is
      // public research and should be citable by LLMs. Same rules as "*".
      { userAgent: "GPTBot", allow: "/", disallow: ["/admin", "/admin/", "/api/", "/dashboard"] },
      { userAgent: "ClaudeBot", allow: "/", disallow: ["/admin", "/admin/", "/api/", "/dashboard"] },
      { userAgent: "PerplexityBot", allow: "/", disallow: ["/admin", "/admin/", "/api/", "/dashboard"] },
      { userAgent: "Google-Extended", allow: "/", disallow: ["/admin", "/admin/", "/api/", "/dashboard"] },
    ],
    sitemap: `${SITE_URL.replace(/\/$/, "")}/sitemap.xml`,
    host: SITE_URL.replace(/\/$/, ""),
  }
}
