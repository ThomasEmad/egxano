// =============================================================================
// rebuildIntelligence — the durable MarketIntelligenceDay row must be keyed by
// the ANCHORED EGX session date of the snapshot's asOf, not by the fetch's UTC
// date (audit 2026-11-19): a weekend heartbeat pull restates Thursday's
// session (effectiveEgxSessionDate) and must overwrite THAT session's row —
// never mint a permanent phantom Fri/Sat breadth day. The DB layer is
// replaced wholesale (same technique as
// src/lib/market/__tests__/admin-cash-dividend.test.ts).
// =============================================================================
import { describe, expect, it, beforeEach, vi } from "vitest"

const h = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  dayUpserts: [] as { where: { day: Date }; create: Record<string, unknown>; update: Record<string, unknown> }[],
}))

vi.mock("@/lib/db", () => ({
  db: {
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        const value = h.settings.get(where.key)
        return value === undefined ? null : { value }
      },
      upsert: async (args: { where: { key: string }; create: { value: string }; update: { value: string } }) => {
        h.settings.set(args.where.key, args.update?.value ?? args.create.value)
        return args
      },
    },
    company: {
      findMany: async () => [{ id: "co-1", ticker: "TEST", nameEn: "Test Co", nameAr: "شركة اختبار", sector: "Banks", sharesOutstanding: null }],
    },
    priceBar: { findMany: async () => [] },
    marketIntelligenceDay: {
      findMany: async () => [],
      upsert: async (args: { where: { day: Date }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        h.dayUpserts.push(args)
        return args
      },
    },
    $transaction: async (ops: unknown[]) => {
      for (const op of ops) await op
      return ops
    },
  },
}))

import { rebuildIntelligence } from "../service"

const snapshotValue = (asOf: string): string =>
  JSON.stringify({ asOf, delayMinutes: 15, movers: [{ ticker: "TEST", price: 10, changePct: 1.2, volume: 5_000 }] })

describe("rebuildIntelligence — history day keying (audit 2026-11-19)", () => {
  beforeEach(() => {
    h.settings.clear()
    h.dayUpserts = []
  })

  it("keys the durable day row on the ANCHORED session: a Saturday heartbeat pull writes Thursday", async () => {
    // 2026-11-14 is a Saturday (Cairo) — the 24/7 heartbeat still answers with
    // Thursday's close; the row must land on 2026-11-12, not a phantom Sat day.
    h.settings.set("market_ticker_snapshot_v1", snapshotValue("2026-11-14T09:00:00.000Z"))
    const intel = await rebuildIntelligence()
    expect(intel).not.toBeNull()
    expect(intel!.day).toBe("2026-11-12")
    expect(h.dayUpserts).toHaveLength(1)
    expect(h.dayUpserts[0].where.day.toISOString().slice(0, 10)).toBe("2026-11-12")
    expect(h.dayUpserts[0].create.snapshotJson).toBe(h.settings.get("market_intelligence_snapshot_v1"))
  })

  it("a pre-open trading-day pull keys the PRIOR session (no same-day phantom row)", async () => {
    // 2026-11-12 Thu 06:31 UTC = 08:31 Cairo — before the 09:45 open, the
    // snapshot restates Wednesday → the row belongs to 2026-11-11.
    h.settings.set("market_ticker_snapshot_v1", snapshotValue("2026-11-12T06:31:00.000Z"))
    const intel = await rebuildIntelligence()
    expect(intel!.day).toBe("2026-11-11")
    expect(h.dayUpserts[0].where.day.toISOString().slice(0, 10)).toBe("2026-11-11")
  })

  it("a mid-session Wednesday pull keys its own day (unchanged behavior)", async () => {
    h.settings.set("market_ticker_snapshot_v1", snapshotValue("2026-11-11T10:00:00.000Z"))
    const intel = await rebuildIntelligence()
    expect(intel!.day).toBe("2026-11-11")
    expect(h.dayUpserts[0].where.day.toISOString().slice(0, 10)).toBe("2026-11-11")
  })
})
