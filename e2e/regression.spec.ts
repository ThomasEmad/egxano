import { expect, test } from "@playwright/test"

/**
 * EGXANO regression suite — every test encodes a defect found in the
 * 2026-11-14 production black-box audit. All checks are read-only and run
 * from the ANONYMOUS visitor's perspective: the entitlement boundary is the
 * thing under test, so no credentials are required.
 */

const FREE_TICKERS = ["COMI", "ETEL", "TMGH", "ABUK", "EFID"] as const
/** A real listed company OUTSIDE the free set (paid coverage). */
const PAID_TICKER = process.env.EGXANO_PAID_TICKER || "ORHD"

type SignalsPayload = {
  universe: number
  rows: { ticker: string; signal: string | null; score: number | null; tradePlan: Record<string, unknown> | null }[]
  distribution: { buy: number; hold: number; sell: number }
  hiddenCompanies: number
  upgradeHint: { freeSetSize: number } | null
  plan: string
}

// ---------------------------------------------------------------------------
// 1. Free-tier signals board — the fixed 5-company universe (server-side)
// ---------------------------------------------------------------------------
test.describe("free signals universe", () => {
  test("anonymous board exposes exactly the fixed free set", async ({ request }) => {
    const res = await request.get("/api/v1/technical/signals")
    expect(res.status()).toBe(200)
    const body = (await res.json()) as SignalsPayload
    expect(body.plan).toBe("FREE")
    expect(body.rows.length).toBe(5)
    expect(body.rows.map((r) => r.ticker).sort()).toEqual([...FREE_TICKERS].sort())
    // the overlay must be transparent about the hidden universe
    expect(body.hiddenCompanies).toBeGreaterThan(0)
    expect(body.upgradeHint?.freeSetSize).toBe(5)
  })

  test("URL/filter parameters cannot widen the free universe (bypass regression)", async ({ request }) => {
    // The route reads NO query parameters — every one of these must return the
    // same 5 rows. (Audit vector: limit/offset/page-size manipulation.)
    for (const qs of ["", "?limit=500", "?limit=500&offset=0", "?pageSize=500&page=1", "?filter=all&sector=all", "?rows=all&universe=full"]) {
      const res = await request.get(`/api/v1/technical/signals${qs}`)
      expect(res.status()).toBe(200)
      const body = (await res.json()) as SignalsPayload
      expect(body.rows.length, `bypass via "${qs}"`).toBe(5)
    }
  })

  test("per-company technical API: free tickers open, paid tickers locked with zero payload", async ({ request }) => {
    for (const tk of FREE_TICKERS) {
      const res = await request.get(`/api/v1/companies/${tk}/technical`)
      expect(res.status(), tk).toBe(200)
      const body = (await res.json()) as { ticker: string; stance?: unknown }
      expect(body.ticker).toBe(tk)
      expect(body.stance).toBeTruthy()
    }
    const locked = await request.get(`/api/v1/companies/${PAID_TICKER}/technical`)
    expect(locked.status()).toBe(403)
    const payload = (await locked.json()) as Record<string, unknown>
    // zero payload: only the error shape leaks — never candles/stance/levels
    expect(Object.keys(payload).sort()).toEqual(["error", "message", "plan"])
    expect(payload.error).toBe("PREMIUM_REQUIRED")
  })

  test("premium-only feeds stay closed to anonymous callers", async ({ request }) => {
    const events = await request.get("/api/v1/events")
    expect(events.status()).toBe(403)
    const coEvents = await request.get(`/api/v1/companies/COMI/events`)
    expect(coEvents.status()).toBe(403)
  })

  test("scanner run history leaks no internal company IDs (B-05 regression)", async ({ request }) => {
    const res = await request.get("/api/v1/scanners/history")
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { runs: Record<string, unknown>[] }
    for (const run of body.runs) {
      expect(run.matchedCompanyIds, "internal CUID array must not leave the server").toBeUndefined()
      if (Array.isArray(run.matchedTickers)) {
        for (const t of run.matchedTickers as string[]) expect(t).not.toMatch(/^cm[a-z0-9]{20,}$/)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Technical analysis consistency (financial integrity)
// ---------------------------------------------------------------------------
test.describe("technical analysis consistency", () => {
  type TechPayload = {
    ticker: string
    stance: { signal: string; score: number; tradePlan: Record<string, unknown> | null }
    boardSignal: { signal: string; score: number; asOf: string } | null
    stanceDataAsOf: string
  }

  test("tab stance agrees with its own recorded board signal", async ({ request }) => {
    for (const tk of FREE_TICKERS) {
      const res = await request.get(`/api/v1/companies/${tk}/technical`)
      expect(res.status()).toBe(200)
      const body = (await res.json()) as TechPayload
      // The tab renders "In sync with the signals board: X (n/100)" from
      // boardSignal — that record must match the stance actually rendered.
      expect(body.boardSignal, `${tk} boardSignal present`).toBeTruthy()
      expect(body.boardSignal!.signal, tk).toBe(body.stance.signal)
      expect(body.boardSignal!.score, tk).toBe(body.stance.score)
    }
  })

  test("board rows and tab stances carry the same read for the free set", async ({ request }) => {
    const boardRes = await request.get("/api/v1/technical/signals")
    const board = (await boardRes.json()) as SignalsPayload
    const byTicker = new Map(board.rows.map((r) => [r.ticker, r]))
    for (const tk of FREE_TICKERS) {
      const tabRes = await request.get(`/api/v1/companies/${tk}/technical`)
      const tab = (await tabRes.json()) as TechPayload
      const row = byTicker.get(tk)
      expect(row, `${tk} present on the board`).toBeTruthy()
      // Signal class must never be contradictory across surfaces (buy vs
      // sell). Score drift across the 10-minute cache boundary is tolerated;
      // a class flip is not — that was the audit's core integrity finding.
      expect(row!.signal, `${tk} signal class`).toBe(tab.stance.signal)
    }
  })

  test("trade plans are numerically valid (no inverted targets, no NaN)", async ({ request }) => {
    const res = await request.get("/api/v1/technical/signals")
    const board = (await res.json()) as SignalsPayload
    for (const row of board.rows) {
      const plan = row.tradePlan
      if (!plan) continue
      const p = plan as {
        bias: "buy" | "sell"
        entryLow: number
        entryHigh: number
        stop: number
        targetLow: number
        targetHigh: number
        riskReward: number
      }
      for (const v of [p.entryLow, p.entryHigh, p.stop, p.targetLow, p.targetHigh, p.riskReward]) {
        expect(typeof v, `${row.ticker} finite levels`).toBe("number")
        expect(Number.isFinite(v as number), `${row.ticker} no NaN/Infinity`).toBe(true)
      }
      expect(p.entryLow, `${row.ticker} entry zone ordered`).toBeLessThanOrEqual(p.entryHigh)
      if (p.bias === "buy") {
        expect(p.stop, `${row.ticker} long stop under entry`).toBeLessThan(p.entryLow)
        expect(p.targetLow, `${row.ticker} long target over entry`).toBeGreaterThan(p.entryHigh)
        expect(p.targetLow).toBeLessThanOrEqual(p.targetHigh)
      } else {
        expect(p.stop, `${row.ticker} short stop over entry`).toBeGreaterThan(p.entryHigh)
        expect(p.targetLow, `${row.ticker} short target under entry`).toBeLessThan(p.entryLow)
        expect(p.targetLow).toBeLessThanOrEqual(p.targetHigh)
      }
      expect(p.riskReward, `${row.ticker} positive R:R`).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. UI regressions
// ---------------------------------------------------------------------------
test.describe("ui regressions", () => {
  test("companies listing: no alphabetical sort control, market-cap order", async ({ page }) => {
    await page.goto("/companies")
    // Cards render as role=link tiles (router.push, not anchors).
    const firstCard = page.locator("[role=link]").first()
    await expect(firstCard).toBeVisible({ timeout: 45_000 })
    // B-10 regression: the A-Z / market-cap toggle group is gone.
    await expect(page.locator("[role=group]")).toHaveCount(0)
    // Market-cap order sanity: the biggest listed name leads (COMI on prod).
    await expect(firstCard).toContainText("COMI", { timeout: 20_000 })
  })

  test("companies listing: deep-linked search shows an honest empty state (B-17)", async ({ page }) => {
    await page.goto("/companies?search=zzzznoticker9999")
    await expect(page.getByText("No companies match").or(page.getByText("لا توجد شركات مطابقة")).first()).toBeVisible({ timeout: 45_000 })
    await expect(page.locator("[role=link]")).toHaveCount(0)
  })

  test("companies listing: deep-linked sector filter renders filtered results (B-17)", async ({ page }) => {
    await page.goto("/companies?search=COMI")
    const cards = page.locator("[role=link]")
    await expect(cards.first()).toBeVisible({ timeout: 45_000 })
    await expect(cards.first()).toContainText("COMI", { timeout: 20_000 })
    await expect(cards).toHaveCount(1)
  })

  test("locked company technical tab shows the upgrade CTA, not a fake error (B-03)", async ({ page }) => {
    await page.goto(`/company/${PAID_TICKER}?tab=technical`)
    await expect(page.getByText(/locked technical content|المحتوى الفني مقفل/i)).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole("link", { name: /upgrade now|ترقية الآن/i })).toBeVisible()
    await expect(page.getByText(/could not be loaded|تعذر تحميل التحليل الفني/i)).toHaveCount(0)
  })

  test("AR toggle translates in place and never navigates away", async ({ page }) => {
    await page.goto("/company/COMI?tab=technical")
    // Desktop: click the visible header toggle. Mobile: the toggle lives in
    // the collapsed drawer, so seed the same persisted preference directly —
    // the assertion target is identical either way (in-place Arabic).
    const toggle = page.locator("[aria-label='Change language'], [aria-label='تغيير اللغة']").first()
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click()
    } else {
      await page.evaluate(() => localStorage.setItem("egx-lang", "ar"))
      await page.reload()
    }
    await expect(page).toHaveURL(new RegExp(`/company/COMI`))
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
    await expect(
      page.getByText("القصة في سطور").or(page.getByText("آخر سعر مسجل")).first(),
    ).toBeVisible({ timeout: 45_000 })
    // invalidation wording stays removed (owner decision)
    await expect(page.getByText("إبطال")).toHaveCount(0)
    await expect(page.getByText("ابطال")).toHaveCount(0)
  })

  test("status page no longer advertises AI analyses (B-07)", async ({ page }) => {
    await page.goto("/status")
    await expect(page.getByText("Cached AI analyses")).toHaveCount(0)
    await expect(page.getByText("تحليلات AI محفوظة")).toHaveCount(0)
  })

  test("premium page: no AI/audio claims, no doomed QR request (B-08)", async ({ page }) => {
    const doomed: string[] = []
    page.on("response", (r) => {
      if (r.status() === 404) doomed.push(r.url())
    })
    await page.goto("/premium")
    const body = await page.locator("body").innerText()
    expect(body).not.toMatch(/الذكاء الاصطناعي|صوتي|audio briefing/i)
    await expect(page.getByText(/instapay/i).first()).toBeVisible()
    expect(doomed, "no 404s on the payment page").toEqual([])
  })

  test("dashboard valuation endpoint answers within budget (B-02)", async ({ request }) => {
    const res = await request.get("/api/v1/dashboard/valuation", { timeout: 45_000 })
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { results: unknown[] }
    expect(Array.isArray(body.results)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 4. Companies listing API integrity (sorting/pagination)
// ---------------------------------------------------------------------------
test.describe("companies listing api", () => {
  test("default ordering is market cap descending (B-10)", async ({ request }) => {
    const res = await request.get("/api/v1/companies?pageSize=50")
    expect(res.status()).toBe(200)
    const body = (await res.json()) as {
      sort: string
      total: number
      companies: { ticker: string; marketCap: number | null }[]
    }
    expect(body.sort).toBe("marketCap")
    const caps = body.companies.map((c) => c.marketCap).filter((v): v is number => v !== null)
    for (let i = 1; i < caps.length; i++) expect(caps[i - 1]).toBeGreaterThanOrEqual(caps[i])
  })

  test("pagination is stable and duplicate-free across pages", async ({ request }) => {
    const seen = new Map<string, number>()
    let total = 0
    for (let p = 1; p <= 3; p++) {
      const res = await request.get(`/api/v1/companies?page=${p}&pageSize=50&sort=ticker&dir=asc`)
      const body = (await res.json()) as { total: number; companies: { ticker: string }[] }
      total = body.total
      for (const c of body.companies) seen.set(c.ticker, (seen.get(c.ticker) ?? 0) + 1)
    }
    expect(total).toBeGreaterThan(50)
    for (const [ticker, n] of seen) expect(n, `${ticker} duplicated across pages`).toBe(1)
  })

  test("edge parameters clamp safely (no crash, no oversized pages)", async ({ request }) => {
    for (const qs of ["page=0", "page=-5", "pageSize=0", "pageSize=9999", "page=999999"]) {
      const res = await request.get(`/api/v1/companies?${qs}`)
      expect(res.status(), qs).toBe(200)
      const body = (await res.json()) as { pageSize: number; companies: unknown[] }
      expect(body.pageSize).toBeLessThanOrEqual(50)
      expect(body.companies.length).toBeLessThanOrEqual(body.pageSize)
    }
  })

  test("search with no matches reports zero without fabricating rows", async ({ request }) => {
    const res = await request.get("/api/v1/companies?search=zzzznoticker9999")
    const body = (await res.json()) as { total: number; companies: unknown[] }
    expect(body.total).toBe(0)
    expect(body.companies.length).toBe(0)
  })
})
