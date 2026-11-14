import { describe, expect, it } from "vitest"
import { resolvePlanIdFromRow } from "../subscription"

/**
 * Plan resolution matrix (2026-11-14 remediation) — ONE resolver now feeds
 * both the UI-facing summary and the API gates. These are the DB row shapes
 * that previously produced "premium user sees only the free five":
 *   • legacy "PREMIUM" row (retired 3-plan migration) → must stay paid
 *   • unknown paid rows → PRO by price
 *   • case/whitespace/hyphen variants of the canonical names
 *   • a literal FREE plan row must NEVER be premium
 */
describe("resolvePlanIdFromRow", () => {
  it("resolves the three canonical plan names", () => {
    expect(resolvePlanIdFromRow({ name: "FREE", price: 0 })).toBe("FREE")
    expect(resolvePlanIdFromRow({ name: "PRO", price: 150 })).toBe("PRO")
    expect(resolvePlanIdFromRow({ name: "PRO_PLUS", price: 300 })).toBe("PRO_PLUS")
  })

  it("normalizes case, whitespace and hyphens before matching", () => {
    expect(resolvePlanIdFromRow({ name: "  pro  ", price: 150 })).toBe("PRO")
    expect(resolvePlanIdFromRow({ name: "pro-plus", price: 300 })).toBe("PRO_PLUS")
    expect(resolvePlanIdFromRow({ name: "Pro Plus", price: 300 })).toBe("PRO_PLUS")
    expect(resolvePlanIdFromRow({ name: "free", price: 0 })).toBe("FREE")
  })

  it("maps legacy and alias plan names to the canonical paid tiers", () => {
    expect(resolvePlanIdFromRow({ name: "PREMIUM", price: 99 })).toBe("PRO")
    expect(resolvePlanIdFromRow({ name: "premium", price: 99 })).toBe("PRO")
    expect(resolvePlanIdFromRow({ name: "PROPLUS", price: 300 })).toBe("PRO_PLUS")
    expect(resolvePlanIdFromRow({ name: "PLUS", price: 300 })).toBe("PRO_PLUS")
    expect(resolvePlanIdFromRow({ name: "PREMIUM_PLUS", price: 300 })).toBe("PRO_PLUS")
  })

  it("any unknown name with a positive price still means a paying user", () => {
    expect(resolvePlanIdFromRow({ name: "GOLD_2025", price: 250 })).toBe("PRO")
  })

  it("unknown free rows resolve to FREE (never premium)", () => {
    expect(resolvePlanIdFromRow({ name: "TRIAL", price: 0 })).toBe("FREE")
    expect(resolvePlanIdFromRow({ name: "GIFT", price: null })).toBe("FREE")
  })

  it("a plan literally named FREE is never premium even with a weird price", () => {
    // Defensive: an admin error that set price>0 on the FREE row must not
    // unlock premium — the name wins.
    expect(resolvePlanIdFromRow({ name: "FREE", price: 150 })).toBe("FREE")
  })

  it("degrades safely on missing rows", () => {
    expect(resolvePlanIdFromRow(null)).toBe("FREE")
    expect(resolvePlanIdFromRow(undefined)).toBe("FREE")
    expect(resolvePlanIdFromRow({ name: "", price: 100 })).toBe("PRO")
  })
})
