// Generates the static brand assets referenced by SEO metadata:
//   public/logo.png      — 512×512 raster of logo.svg (schema.org logo / PWA)
//   public/og-image.png  — 1200×630 Open Graph / Twitter card image
//
// Run: node scripts/generate-brand-assets.mjs
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import sharp from "sharp"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const publicDir = path.join(root, "public")

const logoSvg = await readFile(path.join(publicDir, "logo.svg"))

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
</svg>`

const ogPng = await sharp(Buffer.from(ogSvg)).png().toBuffer()
await writeFile(path.join(publicDir, "og-image.png"), ogPng)

console.log("Wrote public/logo.png and public/og-image.png")
