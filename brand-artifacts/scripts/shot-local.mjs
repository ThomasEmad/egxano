import { chromium } from "playwright";
import path from "node:path";

const BASE = process.env.BASE || "http://localhost:3100";
const PROD = "https://meza-ashy.vercel.app";
const OUT = process.env.OUT || path.resolve("brand-artifacts/local");
const pagePath = process.argv[2] || "/";
const name = process.argv[3] || "home";
const lang = process.argv[4] || "ar";
const theme = process.argv[5] || "light";
const width = Number(process.argv[6] || 1440);
const height = Number(process.argv[7] || 900);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width, height }, locale: lang === "ar" ? "ar-EG" : "en-GB" });

await context.route("**/api/v1/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const target = PROD + url.pathname + url.search;
  try {
    const response = await context.request.fetch(target, {
      method: request.method(),
      headers: { accept: "application/json" },
      data: request.method() === "GET" ? undefined : (request.postData() ?? undefined),
      timeout: 45000,
      failOnStatusCode: false,
    });
    const body = await response.body();
    await route.fulfill({ status: response.status(), headers: { "content-type": response.headers()["content-type"] || "application/json" }, body });
  } catch (error) {
    console.error("proxy failed", url.pathname, error.message);
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "proxy unavailable" }) });
  }
});

const page = await context.newPage();
const consoleErrors = [];
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

await page.goto(BASE + pagePath, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.evaluate(({ lang, theme }) => {
  localStorage.setItem("egx-lang", lang);
  localStorage.setItem("egx-theme", theme);
  localStorage.setItem("theme", theme);
}, { lang, theme });
await page.reload({ waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(2500);
const file = path.join(OUT, `${name}--${lang}--${theme}--${width}.png`);
await page.screenshot({ path: file, fullPage: true });
console.log("wrote", file);
console.log("consoleErrors:", consoleErrors.slice(0, 12));
await browser.close();
