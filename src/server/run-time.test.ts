import { describe, expect, it } from "vitest";
import { allDeadlinesComplete, asyncAttemptDeadline, asyncAvailabilityState, normalizeExtraTime, participantDeadline, shiftDeadline } from "@/server/run-time";

describe("individual exam deadlines", () => {
  it("adds individual time to the server-controlled base", () => { expect(participantDeadline(10_000, 300)).toBe(310_000); });
  it("clamps invalid values and never moves a deadline into the past", () => { expect(normalizeExtraTime(-3)).toBe(0); expect(normalizeExtraTime(999_999)).toBe(86_400); expect(shiftDeadline(5_000, -30, 4_000)).toBe(4_000); });
  it("keeps the run open past base time while one extended participant remains", () => { expect(allDeadlinesComplete(1_000, 2_000, ["submitted", "active"])).toBe(false); expect(allDeadlinesComplete(1_000, 2_000, ["submitted", "submitted"])).toBe(true); });
  it("keeps an individual full duration even when the availability window closes", () => {
    expect(asyncAttemptDeadline(9_900, 600)).toBe(609_900);
    expect(asyncAvailabilityState(1_000, 10_000, 9_900)).toBe("available");
    expect(asyncAvailabilityState(1_000, 10_000, 10_000)).toBe("closed");
  });
  it("distinguishes before, during and after an async window", () => {
    expect(asyncAvailabilityState(1_000, 2_000, 999)).toBe("upcoming");
    expect(asyncAvailabilityState(1_000, 2_000, 1_000)).toBe("available");
    expect(asyncAvailabilityState(1_000, 2_000, 2_000)).toBe("closed");
  });
  it("treats expired non-starters as complete after the window", () => {
    expect(allDeadlinesComplete(2_000, 2_000, ["submitted", "expired"])).toBe(true);
  });
});
