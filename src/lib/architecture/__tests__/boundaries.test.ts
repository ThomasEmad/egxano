// Boundary-rule contract tests — the architecture rules themselves are covered
// (see ARCHITECTURE.md). The CLI (scripts/check-architecture.mts) runs the same
// core against the real tree against the committed ratchet baseline.

import { describe, expect, it } from "vitest"
import { checkFile, checkAgainstBaseline, resolveSpecifier, type SourceFile, type Baseline } from "@/lib/architecture/boundaries"

const file = (path: string, specs: [string, boolean?][]): SourceFile => ({
  path,
  imports: specs.map(([specifier, typeOnly]) => ({ specifier, typeOnly: Boolean(typeOnly) })),
})

describe("resolveSpecifier", () => {
  it("maps @/ aliases into src/", () => {
    expect(resolveSpecifier("src/x.ts", "@/lib/db")).toBe("src/lib/db")
    expect(resolveSpecifier("src/x.ts", "@/domain/market/session")).toBe("src/domain/market/session")
  })
  it("resolves relative targets inside src and ignores npm packages", () => {
    expect(resolveSpecifier("src/domain/market/a.ts", "./b")).toBe("src/domain/market/b")
    expect(resolveSpecifier("src/domain/market/a.ts", "../technical/b")).toBe("src/domain/technical/b")
    expect(resolveSpecifier("src/x.ts", "node:fs")).toBeNull()
    expect(resolveSpecifier("src/x.ts", "lodash")).toBeNull()
  })
})

describe("R1 — domain purity", () => {
  it("a domain file importing outward layered code is a violation", () => {
    const v = checkFile(file("src/domain/market/quality.ts", [["@/lib/db"], ["@/infrastructure/market/candle-source"], ["@/app/api/v1/x/route"]]))
    // the @/app import fires BOTH rules (outward for domain + upward for app)
    expect(v.map((x) => x.rule)).toEqual(["domain-purity", "domain-purity", "domain-purity", "no-upward-deps"])
  })
  it("type-only outward imports are compile-time contracts, not runtime deps", () => {
    const v = checkFile(file("src/domain/technical/signals.ts", [["@/lib/technical/analyze", true]]))
    expect(v).toEqual([])
  })
  it("domain may import domain, node builtins and npm packages", () => {
    const v = checkFile(file("src/domain/technical/indicators.ts", [["./structure"], ["@/domain/market/session"], ["node:crypto"], ["zod"]]))
    expect(v).toEqual([])
  })
})

describe("R2 — no upward deps", () => {
  it("anything outside presentation importing src/app|components is a violation", () => {
    const v = checkFile(file("src/lib/market/foo.ts", [["@/app/api/v1/x/route"], ["@/components/egx/x"], ["../../app/api/v1/y/route"]]))
    expect(v).toHaveLength(3)
    expect(new Set(v.map((x) => x.rule))).toEqual(new Set(["no-upward-deps"]))
  })
  it("presentation importing presentation is fine (components/pages compose)", () => {
    const v = checkFile(file("src/app/page.tsx", [["@/components/egx/dashboard-view"]]))
    expect(v).toEqual([])
  })
  it("UI glue (src/hooks) counts as presentation — it may import components", () => {
    const v = checkFile(file("src/hooks/use-toast.ts", [["@/components/ui/toast"]]))
    expect(v).toEqual([])
  })
  it("test files exercise every layer — exempt from R2, never from R1", () => {
    const r2 = checkFile(file("src/lib/market/__tests__/session-live.test.ts", [["../../../app/api/v1/x/route"]]))
    expect(r2).toEqual([])
    const r1 = checkFile(file("src/domain/x/__tests__/y.test.ts", [["@/lib/db"]]))
    expect(r1).toHaveLength(1)
  })
})

describe("ratchet", () => {
  const base: Baseline = { counts: { "domain-purity": 2, "no-upward-deps": 1 }, files: { "domain-purity": ["src/legacy/a.ts"], "no-upward-deps": ["src/legacy/b.ts"] } }
  const viol = (rule: "domain-purity" | "no-upward-deps", file: string) => ({ rule, file, specifier: "@/x" })
  it("shrinking always passes (migration progress)", () => {
    expect(checkAgainstBaseline([viol("domain-purity", "src/legacy/a.ts")], base).ok).toBe(true)
  })
  it("a count growth fails", () => {
    const r = checkAgainstBaseline(
      [viol("domain-purity", "src/legacy/a.ts"), viol("domain-purity", "src/legacy/a2.ts"), viol("domain-purity", "src/legacy/a3.ts"), viol("no-upward-deps", "src/legacy/b.ts")],
      base,
    )
    expect(r.ok).toBe(false)
    expect(r.failures[0]).toContain("violations > baseline")
  })
  it("a NEW violating file fails even under the count", () => {
    const r = checkAgainstBaseline([viol("domain-purity", "src/legacy/a.ts"), viol("domain-purity", "src/new/bad.ts"), viol("no-upward-deps", "src/legacy/b.ts")], base)
    expect(r.ok).toBe(false)
    expect(r.failures.some((f) => f.includes("NEW violating file"))).toBe(true)
  })
})
