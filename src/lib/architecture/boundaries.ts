// =============================================================================
// boundaries.ts — the architecture dependency-rule checker (pure core).
//
// Encodes the rules documented in ARCHITECTURE.md:
//   R1 domain-purity : src/domain/** imports nothing layered outward (no
//                      @/lib, @/application, @/infrastructure, @/app,
//                      @/components). `import type` is allowed from anywhere —
//                      type-only imports are compile-time contracts, erased at
//                      runtime, so they couple compilation but never behavior.
//   R2 no-upward-deps: nothing outside src/app/** and src/components/** may
//                      import presentation code. Legacy src/lib violations are
//                      RATCHETED via scripts/architecture-baseline.json — the
//                      count may shrink, never grow, and no new file may join.
//
// The CLI wrapper (scripts/check-architecture.mts) walks src/, feeds the files
// here, and fails the build against the baseline. The vitest test feeds
// synthetic cases to THIS module so the rules themselves are covered.
// =============================================================================

/** A file under src/ and the import specifiers it references. */
export interface SourceFile {
  path: string // repo-relative, e.g. "src/domain/market/session.ts"
  imports: { specifier: string; typeOnly: boolean }[]
}

export interface Violation {
  rule: "domain-purity" | "no-upward-deps"
  file: string
  specifier: string
}

/** Map an import specifier to its repo-relative source path when it lives in src/. */
export function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) return `src/${specifier.slice(2)}`
  if (specifier.startsWith(".")) {
    const dir = fromFile.split("/").slice(0, -1)
    const parts = specifier.split("/")
    const out = [...dir]
    for (const p of parts) {
      if (p === ".") continue
      else if (p === "..") out.pop()
      else out.push(p)
    }
    const joined = out.join("/")
    // only track in-src targets
    return joined.startsWith("src/") ? joined : null
  }
  return null // node builtin / npm package
}

const LAYERED_OUTWARD = /^src\/(lib|application|infrastructure|app|components)\//
const PRESENTATION = /^src\/(app|components|hooks)\//
/** Tests exercise every layer by design (a session-live test imports the route
 *  it verifies) — R2 exempts them; R1 never does (domain tests import domain). */
const TEST_FILE = /(__tests__\/|\.test\.tsx?$)/

export function checkFile(file: SourceFile): Violation[] {
  const violations: Violation[] = []
  const inDomain = file.path.startsWith("src/domain/")
  const inPresentation = PRESENTATION.test(file.path)
  for (const imp of file.imports) {
    const target = resolveSpecifier(file.path, imp.specifier)
    if (!target) continue
    if (inDomain && !imp.typeOnly && LAYERED_OUTWARD.test(target)) {
      violations.push({ rule: "domain-purity", file: file.path, specifier: imp.specifier })
    }
    // R2: presentation is a leaf — nobody imports INTO it from outside.
    // type-only imports stay allowed (compile-time contract, same principle
    // as R1); tests are exempt — they exercise the presentation layer
    // deliberately.
    if (!inPresentation && !imp.typeOnly && !TEST_FILE.test(file.path) && PRESENTATION.test(target)) {
      violations.push({ rule: "no-upward-deps", file: file.path, specifier: imp.specifier })
    }
  }
  return violations
}

export function checkAll(files: SourceFile[]): Violation[] {
  return files.flatMap(checkFile)
}

export interface Baseline {
  /** per-rule total violation count at snapshot time */
  counts: Record<string, number>
  /** per-rule file set at snapshot time — new files must never join */
  files: Record<string, string[]>
}

/**
 * Ratchet: pass when (a) per-rule total ≤ baseline AND (b) no NEW file appears
 * in the violation set. Shrinking is always allowed — that is migration
 * progress; growing is architecture rot and fails the build.
 */
export function checkAgainstBaseline(violations: Violation[], baseline: Baseline): { ok: boolean; failures: string[] } {
  const failures: string[] = []
  for (const rule of ["domain-purity", "no-upward-deps"] as const) {
    const current = violations.filter((v) => v.rule === rule)
    const currentFiles = [...new Set(current.map((v) => v.file))].sort()
    const baseCount = baseline.counts[rule] ?? 0
    const baseFiles = baseline.files[rule] ?? []
    const newFiles = currentFiles.filter((f) => !baseFiles.includes(f))
    if (current.length > baseCount) {
      failures.push(`${rule}: ${current.length} violations > baseline ${baseCount} (+${current.length - baseCount})`)
    }
    for (const f of newFiles) {
      failures.push(`${rule}: NEW violating file ${f} (not in baseline)`)
    }
  }
  return { ok: failures.length === 0, failures }
}
