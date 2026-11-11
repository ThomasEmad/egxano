<<<<<<< HEAD
// Generates the static brand assets referenced by SEO metadata:
//   public/logo.png      — 512×512 raster of logo.svg (schema.org logo / PWA)
//   public/og-image.png  — 1200×630 Open Graph / Twitter card image
=======
// EGXANO brand asset generator — the single canonical script for every
// static brand asset referenced by SEO metadata and the PWA manifest.
>>>>>>> b110dc6d46bae06b6754fc83151c5421ad4d72a3
//
//   public/logo.svg             horizontal lockup (light surfaces)
//   public/logo-light.svg       horizontal lockup (dark surfaces)
//   public/logo-mono.svg        monochrome lockup
//   public/mark.svg             standalone aperture mark
//   public/icon.svg             tile + mark (SVG favicon / PWA "any")
//   public/logo.png             512×512 tile (schema.org logo)
//   public/icon-192.png         PWA icon
//   public/icon-512.png         PWA icon
//   public/icon-maskable.png    PWA maskable (safe zone)
//   public/apple-touch-icon.png 180×180
//   public/favicon.ico          32×32 ICO (embedded PNG)
//   public/og-image.png         1200×630 Open Graph / Twitter card
//
// Brand: mark = "Aperture Index" — an open ring (raw market complexity)
// with a single ascending signal passing through its aperture (clear
// insight). Wordmark = IBM Plex Sans Bold caps (the same superfamily as the
// product's Arabic UI type), converted to paths so the SVGs are portable.
// Fonts are OFL-licensed, stored under scripts/fonts/.
// Run: node scripts/generate-brand-assets.mjs
import { writeFile, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import sharp from "sharp"
import opentype from "opentype.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const pub = path.join(root, "public")

// ---------------------------------------------------------------- colors
const C = {
  graphite: "#12180F", // deep graphite-green ink (light-surface brand ink)
  offWhite: "#EFF5E6", // ring on dark
  acid: "#A3E635", // acid lime — dark surfaces & fills
  deepLime: "#52731B", // WCAG 5.49:1 on white — light-surface lime
}

<<<<<<< HEAD
const logoPng = await sharp(logoSvg, { density: 384 }).resize(512, 512).png().toBuffer()
await writeFile(path.join(publicDir, "logo.png"), logoPng)

// A social card built from the same visual language as the product:
// graphite surface, acid-lime accent, the mark, and the brand's actual
// promise (no invented figures, no profit claims).
const ogSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0B0F0D"/>

  <!-- quiet data grid -->
  <g stroke="#A3E635" stroke-opacity="0.05" stroke-width="1">
    ${Array.from({ length: 14 }, (_, i) => `<line x1="${60 + i * 80}" y1="0" x2="${60 + i * 80}" y2="630"/>`).join("")}
    ${Array.from({ length: 7 }, (_, i) => `<line x1="0" y1="${60 + i * 80}" x2="1200" y2="${60 + i * 80}"/>`).join("")}
  </g>

  <!-- brand mark -->
  <rect x="72" y="64" width="88" height="88" rx="20" fill="#0B0F0D" stroke="#A3E635" stroke-opacity="0.35" stroke-width="2"/>
  <path d="M94 132V86L116 113L138 86V132" fill="none" stroke="#A3E635" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="142" cy="78" r="6" fill="#A3E635"/>

  <text x="184" y="104" font-family="Segoe UI, Tahoma, Arial, sans-serif" font-size="30" font-weight="700" fill="#F5F8F3">Meza</text>
  <text x="184" y="134" font-family="Segoe UI, Tahoma, Arial, sans-serif" font-size="15" font-weight="600" fill="#9AA79C" letter-spacing="3">EGYPTIAN STOCK MARKET RESEARCH</text>

  <!-- headline (Arabic first, as in the product) -->
  <text x="72" y="278" font-family="Segoe UI, Tahoma, Arial, sans-serif" font-size="66" font-weight="700" fill="#F5F8F3">افهم السهم قبل ما تقرر.</text>
  <text x="72" y="352" font-family="Segoe UI, Tahoma, Arial, sans-serif" font-size="34" font-weight="600" fill="#A3E635">Understand the stock before you decide.</text>

  <text x="72" y="430" font-family="Segoe UI, Tahoma, Arial, sans-serif" font-size="22" fill="#C9D3CB">القوائم المالية · النسب المحسوبة · المقارنة · السياق الفني</text>
  <text x="72" y="466" font-family="Segoe UI, Tahoma, Arial, sans-serif" font-size="20" fill="#9AA79C">Published filings · calculated ratios · fair comparison · technical context</text>

  <!-- trust rules -->
  <rect x="72" y="512" width="1056" height="1" fill="#F5F8F3" fill-opacity="0.14"/>
  <text x="72" y="552" font-family="Segoe UI, Tahoma, Arial, sans-serif" font-size="18" fill="#9AA79C">بيانات من الإفصاحات المنشورة · غير المتاح يظهر «—» · أسعار متأخرة 15 دقيقة</text>
  <text x="1128" y="552" font-family="Segoe UI, Tahoma, Arial, sans-serif" font-size="18" fill="#A3E635" text-anchor="end">meza-ashy.vercel.app</text>

  <!-- abstract brand bars (decorative, not data) -->
  <g fill="#A3E635">
    <rect x="1000" y="214" width="26" height="72" rx="4" fill-opacity="0.22"/>
    <rect x="1038" y="190" width="26" height="96" rx="4" fill-opacity="0.4"/>
    <rect x="1076" y="160" width="26" height="126" rx="4" fill-opacity="0.7"/>
    <rect x="1114" y="128" width="26" height="158" rx="4" fill-opacity="1"/>
  </g>
=======
// ---------------------------------------------------------------- mark
// Master geometry on a 512 grid; ring r=132 stroke 54 with a 66° aperture
// in the upper right; a 45° signal passes through the gap and exits the ring.
const f = (n) => Math.round(n * 100) / 100
function pt(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180
  return [f(cx + r * Math.cos(a)), f(cy + r * Math.sin(a))]
}
function markPaths(scale) {
  const s = scale
  const c = { x: 256 * s, y: 264 * s }
  const r = 132 * s
  const w = 54 * s
  const [x1, y1] = pt(c.x, c.y, r, -12)
  const [x2, y2] = pt(c.x, c.y, r, 282) // -78 + 360 → 294° sweep, 66° gap
  const ring = `M ${x1} ${y1} A ${f(r)} ${f(r)} 0 1 1 ${x2} ${y2}`
  const bar = `M ${f(204 * s)} ${f(316 * s)} L ${f(416 * s)} ${f(104 * s)}`
  return { ring, bar, w }
}
function markSvg(ringColor, barColor, scale = 1) {
  const { ring, bar, w } = markPaths(scale)
  return `<g fill="none" stroke-linecap="round">
  <path d="${ring}" stroke="${ringColor}" stroke-width="${f(w)}"/>
  <path d="${bar}" stroke="${barColor}" stroke-width="${f(w)}"/>
</g>`
}
function tileSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
<defs><linearGradient id="t" x1="0" y1="0" x2="0.35" y2="1">
<stop offset="0" stop-color="#161E16"/><stop offset="1" stop-color="#0A0F0B"/>
</linearGradient></defs>
<rect width="512" height="512" rx="112" fill="url(#t)"/>
${markSvg(C.offWhite, C.acid, 1)}
>>>>>>> b110dc6d46bae06b6754fc83151c5421ad4d72a3
</svg>`
}

// ---------------------------------------------------------------- wordmark
const fontBytes = await readFile(path.join(root, "scripts/fonts/IBMPlexSansArabic-Bold.ttf"))
const font = opentype.parse(
  fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength),
)
const TEXT = "EGXANO"
const FS = 132
const TRACK = 0.055 * FS // extra tracking between caps
function wordmarkPaths() {
  const parts = []
  let cx = 0
  for (const ch of TEXT) {
    parts.push(font.getPath(ch, cx, 0, FS, { kerning: true }).toPathData(2))
    cx += font.getAdvanceWidth(ch, FS, { kerning: true }) + TRACK
  }
  return { d: parts.join(" "), width: cx - TRACK }
}
const WM = wordmarkPaths() // baseline at y=0, caps extend upward (−0.72em)

// ---------------------------------------------------------------- lockups
// Mark drawn at 160 units, wordmark cap height 40, vertically centred on
// the mark's optical centre (82.5). Canvas height 160.
const LOCK_MARK = 160
const LOCK_W = f(LOCK_MARK + 42 + WM.width)
function lockup(ink, accent, mono) {
  const inkColor = mono ? "#101508" : ink
  const cap = 40
  const wmScale = cap / (0.72 * FS)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LOCK_W}" height="${LOCK_MARK}" viewBox="0 0 ${LOCK_W} ${LOCK_MARK}">
${markSvg(mono ? "#101508" : ink, mono ? "#101508" : accent, LOCK_MARK / 512)}
<path transform="translate(${f(LOCK_MARK + 42)} ${f(82.5 + cap / 2)}) scale(${f(wmScale)})" d="${WM.d}" fill="${inkColor}"/>
</svg>`
}

await writeFile(path.join(pub, "logo.svg"), lockup(C.graphite, C.deepLime, false))
await writeFile(path.join(pub, "logo-light.svg"), lockup(C.offWhite, C.acid, false))
await writeFile(path.join(pub, "logo-mono.svg"), lockup(null, null, true))
await writeFile(
  path.join(pub, "mark.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
${markSvg(C.graphite, C.deepLime, 160 / 512)}
</svg>`,
)
await writeFile(path.join(pub, "icon.svg"), tileSvg(512))

// ---------------------------------------------------------------- rasters
const tile = Buffer.from(tileSvg(512))
await writeFile(path.join(pub, "logo.png"), await sharp(tile).resize(512, 512).png().toBuffer())
await writeFile(path.join(pub, "icon-192.png"), await sharp(tile).resize(192, 192).png().toBuffer())
await writeFile(path.join(pub, "icon-512.png"), await sharp(tile).resize(512, 512).png().toBuffer())
// maskable: mark centred and shrunk to 72% so it sits inside the 80% safe zone
const maskSvg = tileSvg(512).replace(
  markSvg(C.offWhite, C.acid, 1),
  `<g transform="translate(256 264) scale(0.72) translate(-256 -264)">${markSvg(C.offWhite, C.acid, 1)}</g>`,
)
await writeFile(path.join(pub, "icon-maskable.png"), await sharp(Buffer.from(maskSvg)).resize(512, 512).png().toBuffer())
await writeFile(path.join(pub, "apple-touch-icon.png"), await sharp(tile).resize(180, 180).png().toBuffer())

// favicon.ico = ICO container with an embedded 32×32 PNG (Vista+ format)
const png32 = await sharp(tile).resize(32, 32).png().toBuffer()
const icoHeader = Buffer.alloc(6)
icoHeader.writeUInt16LE(0, 0)
icoHeader.writeUInt16LE(1, 2) // icon type
icoHeader.writeUInt16LE(1, 4) // 1 image
const dir = Buffer.alloc(16)
dir.writeUInt8(32, 0)
dir.writeUInt8(32, 1)
dir.writeUInt16LE(1, 4)
dir.writeUInt16LE(32, 6)
dir.writeUInt32LE(png32.length, 8)
dir.writeUInt32LE(22, 12) // data offset
await writeFile(path.join(pub, "favicon.ico"), Buffer.concat([icoHeader, dir, png32]))

// ---------------------------------------------------------------- OG image
const ogLockup = lockup(C.offWhite, C.acid, false).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")
const RIGHT = 1128
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
  <radialGradient id="glow" cx="0.82" cy="0.12" r="0.9">
    <stop offset="0" stop-color="#A3E635" stop-opacity="0.10"/>
    <stop offset="0.55" stop-color="#A3E635" stop-opacity="0.02"/>
    <stop offset="1" stop-color="#A3E635" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="ogbg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#10150F"/><stop offset="1" stop-color="#0B100C"/>
  </linearGradient>
</defs>
<rect width="1200" height="630" fill="url(#ogbg)"/>
${Array.from({ length: 11 }, (_, i) => `<line x1="${60 + i * 108}" y1="0" x2="${60 + i * 108}" y2="630" stroke="#FFFFFF" stroke-opacity="0.03"/>`).join("")}
<rect width="1200" height="630" fill="url(#glow)"/>
<rect x="0" y="622" width="1200" height="8" fill="#A3E635"/>
<g transform="translate(72 62) scale(0.5)">${ogLockup}</g>
<text x="${RIGHT}" y="336" text-anchor="end" font-family="IBM Plex Sans Arabic" font-weight="700" font-size="74" fill="#F4F8EE">افهم السهم قبل ما تقرر.</text>
<text x="${RIGHT}" y="396" text-anchor="end" font-family="IBM Plex Sans Arabic" font-weight="400" font-size="28" fill="#AEBDA6">حلّل الشركات، قارن أداءها، واكتشف الصورة المالية والفنية لأسهم البورصة.</text>
<text x="72" y="470" font-family="IBM Plex Sans Arabic" font-weight="600" font-size="30" fill="#A3E635">Understand the Egyptian Market.</text>
<text x="${RIGHT}" y="556" text-anchor="end" font-family="IBM Plex Sans Arabic" font-weight="400" font-size="20" fill="#7C8A74">منصة بحث مستقلة لأسهم البورصة المصرية — غير تابعة للبورصة المصرية أو أي جهة رسمية.</text>
</svg>`
await writeFile(path.join(pub, "og-image.png"), await sharp(Buffer.from(ogSvg)).png().toBuffer())

console.log("EGXANO brand assets generated. Lockup width:", LOCK_W)
