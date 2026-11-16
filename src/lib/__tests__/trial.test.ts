// Trial window math (owner mandate 2026-11-16): EVERY account gets a full
// 30-day full-feature trial — new accounts from their own signup date,
// pre-existing accounts from the feature's deploy epoch (never a remainder).

import { describe, expect, it } from "vitest"
import { trialEndsAt } from "@/lib/subscription"
import { TRIAL_DURATION_DAYS, TRIAL_EPOCH_ISO } from "@/lib/plans/entitlements"

const DAY = 86_400_000

describe("trialEndsAt — the full-month trial window", () => {
  it("gives a NEW account 30 days from its own signup", () => {
    const signup = new Date(Date.parse(TRIAL_EPOCH_ISO) + 10 * DAY) // after the epoch
    const end = trialEndsAt(signup)
    expect(end.getTime() - signup.getTime()).toBe(TRIAL_DURATION_DAYS * DAY)
  })

  it("gives a PRE-EXISTING account a full month from the deploy epoch (not a remainder)", () => {
    const old = new Date(Date.parse(TRIAL_EPOCH_ISO) - 200 * DAY) // created long before
    const end = trialEndsAt(old)
    expect(end.getTime() - Date.parse(TRIAL_EPOCH_ISO)).toBe(TRIAL_DURATION_DAYS * DAY)
  })

  it("never returns an end before the epoch month (even for day-zero signups)", () => {
    const epoch = new Date(TRIAL_EPOCH_ISO)
    expect(trialEndsAt(epoch).getTime()).toBe(Date.parse(TRIAL_EPOCH_ISO) + TRIAL_DURATION_DAYS * DAY)
  })
})
