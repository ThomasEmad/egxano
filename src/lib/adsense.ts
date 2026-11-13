// AdSense identity — single source of truth.
//
// The publisher id ("ca-pub-…") is a PUBLIC identifier: it ships inside every
// page's HTML and ads.txt by design, so a checked-in default is safe and makes
// the site verification-ready (meta tag + script + ads.txt) without waiting
// for a deploy-time env var. NEXT_PUBLIC_ADSENSE_CLIENT still overrides it for
// portability (staging can point elsewhere or disable ads with an empty value).

export const ADSENSE_CLIENT_FALLBACK = "ca-pub-6825463212313887"

export function adsenseClient(): string {
  const env = process.env.NEXT_PUBLIC_ADSENSE_CLIENT
  if (env !== undefined && env.trim() === "") return "" // explicit opt-out
  return env && env.trim() !== "" ? env.trim() : ADSENSE_CLIENT_FALLBACK
}
