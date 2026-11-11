import { chromium } from "playwright";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar-EG" });
await context.route("**/api/v1/**", async (route) => {
  const r = route.request(); const u = new URL(r.url());
  const resp = await context.request.fetch("https://meza-ashy.vercel.app" + u.pathname + u.search, { method: r.method(), timeout: 45000, failOnStatusCode: false });
  await route.fulfill({ status: resp.status(), headers: { "content-type": resp.headers()["content-type"] || "application/json" }, body: await resp.body() });
});
const page = await context.newPage();
await page.goto("http://localhost:3100/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.evaluate(() => localStorage.setItem("egx-lang", "ar"));
await page.reload({ waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(3000);
const text = await page.evaluate(() => document.body.innerText);
const idx = text.indexOf("كل شركة ظاهرة");
console.log(text.slice(idx, idx + 700));
await browser.close();
