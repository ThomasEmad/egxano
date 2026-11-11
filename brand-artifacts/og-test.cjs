const sharp = require("sharp");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200">
<rect width="600" height="200" fill="#0B0F0D"/>
<text x="40" y="80" font-family="Segoe UI, Tahoma, Arial, sans-serif" font-size="42" font-weight="700" fill="#F5F8F3">Meza — Egyptian research</text>
<text x="40" y="150" font-family="Segoe UI, Tahoma, Arial, sans-serif" font-size="34" font-weight="600" fill="#A3E635">افهم السهم قبل ما تقرر.</text>
</svg>`;
sharp(Buffer.from(svg)).png().toFile("brand-artifacts/og-font-test.png").then(()=>console.log("ok")).catch(e=>{console.error(e.message);process.exit(1)});
