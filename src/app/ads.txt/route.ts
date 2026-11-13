// GET /ads.txt — AdSense authorization record (IAB ads.txt spec).
// Google crawls this at the domain root to verify the publisher account is
// allowed to sell this site's inventory. Emitted from the same env var that
// drives the AdSlot components, so the site is crawler-ready the moment
// NEXT_PUBLIC_ADSENSE_CLIENT is set (e.g. "ca-pub-1234567890123456") —
// before that, a short comment-only body is served (valid per spec).
const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT || ""

export function GET() {
  const pub = client.replace(/^ca-/, "")
  const body = pub
    ? `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`
    : "# ads.txt — set NEXT_PUBLIC_ADSENSE_CLIENT to publish the AdSense authorization line.\n"
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600, s-maxage=86400" },
  })
}
