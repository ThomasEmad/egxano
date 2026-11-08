import { describe, expect, it } from "vitest"
import { buildSnapshotFromScanner, startOfUtcDay, type ScanRow } from "../refresh"
import { isEgxRefreshWindow, newerSnapshot, parseSnapshot, type MarketSnapshot } from "../snapshot"

const stock = (ticker: string, close: unknown, change: unknown, volume: unknown = 1000): ScanRow => ({
  d: [ticker, `${ticker} descr`, close, change, volume, "delayed_streaming_900"],
})

describe("buildSnapshotFromScanner", () => {
  const t = "2026-11-09T10:00:00.000Z"

  it("builds a validated snapshot from scanner rows", () => {
    const { snapshot, movers } = buildSnapshotFromScanner(
      [stock("ABUK", 80.98, 1.5, 42_000), stock("COMI", 100, -0.4)],
      [{ s: "EGX:EGX30", d: ["EGX30", "EGX 30", 35_000, 0.75] }],
      t,
    )
    expect(movers).toHaveLength(2)
    expect(movers[0]).toEqual({ ticker: "ABUK", price: 80.98, changePct: 1.5, volume: 42_000 })
    expect(snapshot.asOf).toBe(t)
    expect(snapshot.pricesAsOf).toBe(t)
    expect(snapshot.delayMinutes).toBe(15)
    expect(snapshot.indices).toEqual([{ name: "EGX30", level: 35_000, changePct: 0.75 }])
  })

  it("drops invalid rows: non-positive price, |change|>50, missing ticker, non-finite", () => {
    const rows = [
      stock("ZERO", 0, 1),
      stock("NEG", -5, 1),
      stock("JUMP", 10, 51),
      stock("JUMP2", 10, -51),
      stock("", 10, 1),
      stock("NOTNUM", "x", "y"),
      { d: [] },
      { s: "EGX:XXX" } as ScanRow,
    ]
    const { movers } = buildSnapshotFromScanner(rows, [], t)
    expect(movers).toHaveLength(0)
  })

  it("keeps boundary |change|=50 and drops zero/negative volume", () => {
    const { movers } = buildSnapshotFromScanner([stock("A", 10, 50), stock("B", 10, -50, 0)], [], t)
    expect(movers).toHaveLength(2)
    expect(movers[0].volume).toBe(1000) // A keeps its positive volume
    expect(movers[1].volume).toBeUndefined() // B's zero volume is omitted
  })

  it("empty scanner answer yields empty snapshot (caller refuses to persist)", () => {
    const { snapshot, movers } = buildSnapshotFromScanner([], [], t)
    expect(movers).toHaveLength(0)
    expect(snapshot.indices).toHaveLength(0)
  })
})

describe("startOfUtcDay", () => {
  it("floors to UTC midnight", () => {
    expect(startOfUtcDay("2026-11-09T10:35:12.481Z")).toBe("2026-11-09T00:00:00.000Z")
  })
})

describe("parseSnapshot", () => {
  it("accepts the exact shape the cron route stores", () => {
    const snap: MarketSnapshot = {
      asOf: "2026-11-09T10:00:00.000Z",
      indicesAsOf: "2026-11-09T10:00:00.000Z",
      pricesAsOf: "2026-11-09T10:00:00.000Z",
      delayMinutes: 15,
      indices: [{ name: "EGX30", level: 1, changePct: 0.1 }],
      movers: [{ ticker: "ABUK", price: 80.98, changePct: 1.5 }],
    }
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(snap)))
    expect(parsed).toEqual(snap)
  })

  it("rejects garbage and empty blobs", () => {
    expect(parseSnapshot(null)).toBeNull()
    expect(parseSnapshot({})).toBeNull()
    expect(parseSnapshot({ asOf: "nope" })).toBeNull()
  })

  it("drops movers with |change|>50", () => {
    const parsed = parseSnapshot({
      asOf: "2026-11-09T10:00:00.000Z",
      movers: [
        { ticker: "OK", price: 5, changePct: 2 },
        { ticker: "BAD", price: 5, changePct: 90 },
      ],
    })
    expect(parsed?.movers).toHaveLength(1)
    expect(parsed?.movers[0].ticker).toBe("OK")
  })
})

describe("newerSnapshot", () => {
  const mk = (asOf: string): MarketSnapshot => ({ asOf, indicesAsOf: asOf, pricesAsOf: asOf, delayMinutes: 15, indices: [], movers: [] })
  it("picks the newer asOf and handles nulls", () => {
    const old = mk("2026-11-06T02:06:41.382Z")
    const fresh = mk("2026-11-09T10:00:00.000Z")
    expect(newerSnapshot(old, fresh)).toBe(fresh)
    expect(newerSnapshot(fresh, old)).toBe(fresh)
    expect(newerSnapshot(null, old)).toBe(old)
    expect(newerSnapshot(old, null)).toBe(old)
    expect(newerSnapshot(null, null)).toBeNull()
  })
})

describe("isEgxRefreshWindow", () => {
  it("Sunday 12:00 Cairo is inside the window", () => {
    // 2026-11-08 is a Sunday; 10:00 UTC = 12:00 Cairo (UTC+2 in November)
    expect(isEgxRefreshWindow(new Date("2026-11-08T10:00:00Z"))).toBe(true)
  })
  it("Friday 12:00 Cairo is outside (weekend)", () => {
    // 2026-11-06 is a Friday
    expect(isEgxRefreshWindow(new Date("2026-11-06T10:00:00Z"))).toBe(false)
  })
  it("Tuesday 03:00 Cairo is outside (night)", () => {
    // 01:00 UTC = 03:00 Cairo
    expect(isEgxRefreshWindow(new Date("2026-11-10T01:00:00Z"))).toBe(false)
  })
})
