// check-architecture.mts — CLI wrapper for the boundary checker
// (src/lib/architecture/boundaries.ts). Fails the build on any architecture
// rule violation beyond the committed ratchet baseline.
//
//   bun scripts/check-architecture.mts                  # check (CI mode)
//   bun scripts/check-architecture.mts --update-baseline  # snapshot current state
//
// The same rules run inside the vitest suite (boundaries.test.ts), so a
// violating change fails `npx vitest run` too — the architecture cannot rot
// silently.

import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { checkAll, checkAgainstBaseline, type SourceFile, type Baseline } from "@/lib/architecture/boundaries"

const SRC = join(process.cwd(), "src")
const BASELINE_PATH = join(process.cwd(), "scripts", "architecture-baseline.json")

const IMPORT_RE = /import\s+(type\s+)?[\s\S]*?from\s+["']([^"']+)["']/g
const DYNAMIC_RE = /import\(\s*["']([^"']+)["']\s*\)/g

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mts)$/.test(name) && !name.endsWith(".d.ts")) out.push(p)
  }
  return out
}

function extractImports(code: string): SourceFile["imports"] {
  const imports: SourceFile["imports"] = []
  for (const m of code.matchAll(IMPORT_RE)) {
    imports.push({ typeOnly: Boolean(m[1]), specifier: m[2]! })
  }
  for (const m of code.matchAll(DYNAMIC_RE)) {
    imports.push({ typeOnly: false, specifier: m[1]! })
  }
  return imports
}

const files: SourceFile[] = walk(SRC).map((p) => ({
  path: p.slice(process.cwd().length + 1),
  imports: extractImports(readFileSync(p, "utf8")),
}))

const violations = checkAll(files)

if (process.argv.includes("--update-baseline")) {
  const baseline: Baseline = {
    counts: {
      "domain-purity": violations.filter((v) => v.rule === "domain-purity").length,
      "no-upward-deps": violations.filter((v) => v.rule === "no-upward-deps").length,
    },
    files: {
      "domain-purity": [...new Set(violations.filter((v) => v.rule === "domain-purity").map((v) => v.file))].sort(),
      "no-upward-deps": [...new Set(violations.filter((v) => v.rule === "no-upward-deps").map((v) => v.file))].sort(),
    },
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`)
  console.log(`baseline updated: ${BASELINE_PATH}`)
  console.log(JSON.stringify(baseline.counts))
  process.exit(0)
}

if (!existsSync(BASELINE_PATH)) {
  console.error(`baseline missing: ${BASELINE_PATH} — run with --update-baseline once, commit it`)
  process.exit(1)
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline
const { ok, failures } = checkAgainstBaseline(violations, baseline)

const counts = {
  "domain-purity": violations.filter((v) => v.rule === "domain-purity").length,
  "no-upward-deps": violations.filter((v) => v.rule === "no-upward-deps").length,
}
console.log(`architecture check: ${files.length} files, violations ${JSON.stringify(counts)}, baseline ${JSON.stringify(baseline.counts)}`)
if (!ok) {
  console.error("\nARCHITECTURE VIOLATIONS (see ARCHITECTURE.md for the rules):")
  for (const f of failures) console.error(`  ✗ ${f}`)
  for (const v of violations.filter((x) => failures.some((f) => f.includes(x.file)))) {
    console.error(`    ${v.file} → ${v.specifier}`)
  }
  process.exit(1)
}
console.log("architecture check: OK")
