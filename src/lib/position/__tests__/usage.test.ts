// =============================================================================
// Position-review usage — the 2026-11-19 lost-update fix. The company-id
// merge and the usage bump now persist in ONE guarded atomic update (the
// usageCount equality in the where-clause is the optimistic lock); a
// concurrent consume that wrote between our read and our write makes the
// guard miss and the loop retries against the fresh row — no id (and no
// charge) is lost.
//
// HONEST LIMIT: the db is mocked with an in-memory row + resolution gates so
// the interleaving is DETERMINISTIC; a REAL-db concurrency test is impractical
// in this suite (needs a live Postgres and true parallel connections), so the
// atomicity contract is pinned at the mock-prisma level — the mock faithfully
// models Prisma's conditional-update semantics (guard miss → count 0).
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest"
import { effectiveEgxSessionDate } from "@/lib/market/egx-session"
import { consumePositionReviewUsage } from "../usage"

type UsageRow = { userId: string; day: string; usageCount: number; companyIds: string }

const h = vi.hoisted(() => {
  const state = {
    row: null as UsageRow | null,
    writeGates: [] as Array<{ promise: Promise<void>; resolve: () => void }>,
  }
  const gate = () => {
    let resolve: () => void = () => {}
    const promise = new Promise<void>((res) => {
      resolve = res
    })
    return { promise, resolve }
  }
  const db = {
    positionReviewUsage: {
      findUnique: async (args: { where: { userId_day: { userId: string; day: string } } }) => {
        const { userId, day } = args.where.userId_day
        const r = state.row
        return r && r.userId === userId && r.day === day ? { ...r } : null
      },
      updateMany: async (args: {
        where: { userId: string; day: string; usageCount?: number | { lt: number } }
        data: { usageCount?: { increment: number }; companyIds?: string }
      }) => {
        // a pending gate parks this write — the test resolves the gates in
        // order to stage the interleaving deterministically
        if (state.writeGates.length) await state.writeGates.shift()!.promise
        const r = state.row
        if (!r || r.userId !== args.where.userId || r.day !== args.where.day) return { count: 0 }
        const want = args.where.usageCount
        if (typeof want === "number" && r.usageCount !== want) return { count: 0 }
        if (want && typeof want === "object" && "lt" in want && r.usageCount >= want.lt) return { count: 0 }
        r.usageCount += args.data.usageCount?.increment ?? 0
        if (args.data.companyIds !== undefined) r.companyIds = args.data.companyIds
        return { count: 1 }
      },
      create: async (args: { data: UsageRow }) => {
        const r = state.row
        if (r && r.userId === args.data.userId && r.day === args.data.day) throw new Error("P2002 unique violation")
        state.row = { ...args.data }
        return { ...state.row }
      },
      update: async (args: { where: { userId_day: { userId: string; day: string } }; data: { companyIds: string } }) => {
        const r = state.row
        const w = args.where.userId_day
        if (!r || r.userId !== w.userId || r.day !== w.day) throw new Error("P2025 not found")
        r.companyIds = args.data.companyIds
        return { ...r }
      },
    },
  }
  return { state, gate, db }
})

vi.mock("@/lib/db", () => ({ db: h.db }))

function idsOf(): string[] {
  return JSON.parse(h.state.row!.companyIds) as string[]
}

/** Drain every pending microtask (the consumers' async chains) before the
 *  test resolves the next gate. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

beforeEach(() => {
  h.state.row = null
  h.state.writeGates = []
})

describe("consumePositionReviewUsage — the atomic guarded consume", () => {
  it("first consume creates the row with the company id (used 1, remaining 1)", async () => {
    const q = await consumePositionReviewUsage("u1", false, "A")
    expect(h.state.row).toEqual({
      userId: "u1",
      day: effectiveEgxSessionDate(new Date()),
      usageCount: 1,
      companyIds: JSON.stringify(["A"]),
    })
    expect(q!.used).toBe(1)
    expect(q!.remaining).toBe(1)
  })

  it("same-stock re-analysis is free (dedup fast path, no second charge)", async () => {
    const day = effectiveEgxSessionDate(new Date())
    h.state.row = { userId: "u1", day, usageCount: 2, companyIds: JSON.stringify(["A"]) }
    const q = await consumePositionReviewUsage("u1", false, "A")
    expect(q!.used).toBe(2)
    expect(q!.remaining).toBe(0)
    expect(h.state.row!.usageCount).toBe(2)
    expect(idsOf()).toEqual(["A"])
  })

  it("limit exhausted + a NEW stock → null, nothing written", async () => {
    const day = effectiveEgxSessionDate(new Date())
    h.state.row = { userId: "u1", day, usageCount: 2, companyIds: JSON.stringify(["A", "B"]) }
    const q = await consumePositionReviewUsage("u1", false, "C")
    expect(q).toBeNull()
    expect(h.state.row!.usageCount).toBe(2)
    expect(idsOf()).toEqual(["A", "B"])
  })

  it("CONCURRENT consumes (both read the same stale row) keep BOTH ids — the lost-update fix", async () => {
    const day = effectiveEgxSessionDate(new Date())
    h.state.row = { userId: "u1", day, usageCount: 0, companyIds: JSON.stringify([]) }
    const pB = consumePositionReviewUsage("u1", false, "B")
    const pC = consumePositionReviewUsage("u1", false, "C")
    // both consumers read the same committed row ({0, []}) and park at their
    // gated writes — the stale-read race the old appendId lost
    const wg1 = h.gate()
    const wg2 = h.gate()
    h.state.writeGates = [wg1, wg2]
    await flush()
    wg1.resolve() // B's guarded write lands: {1, [B]}
    await flush()
    wg2.resolve() // C's guarded write MISSES (row changed) → retry on the fresh row
    const [qb, qc] = await Promise.all([pB, pC])
    expect(h.state.row!.usageCount).toBe(2)
    expect(idsOf()).toEqual(["B", "C"]) // NO lost id — the old code could drop one
    expect(qb!.used).toBe(1)
    expect(qc!.used).toBe(2)
    expect(qb!.remaining).toBe(1)
    expect(qc!.remaining).toBe(0)
  })

  it("premium skips the store entirely (unlimited, no writes)", async () => {
    const q = await consumePositionReviewUsage("u1", true, "A")
    expect(q!.unlimited).toBe(true)
    expect(h.state.row).toBeNull()
  })
})
