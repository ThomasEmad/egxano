// GET /ads.txt — AdSense authorization record (IAB ads.txt spec).
// Google crawls this at the domain root to verify the publisher account is
// allowed to sell this site's inventory. Emitted from the same identity that
// drives the AdSlot components (env override or the checked-in default), so
// the site is crawler-ready without deploy-time configuration.
import { adsenseClient } from "@/lib/adsense"

export function GET() {
  const pub = adsenseClient().replace(/^ca-/, "")
  const body = pub
    ? `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`
    : "# ads.txt — ads disabled (NEXT_PUBLIC_ADSENSE_CLIENT set to empty).\n"
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600, s-maxage=86400" },
  })
}
