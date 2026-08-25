import { describe, expect, it } from "vitest";
import { allDeadlinesComplete, normalizeExtraTime, participantDeadline, shiftDeadline } from "@/server/run-time";

describe("individual exam deadlines", () => {
  it("adds individual time to the server-controlled base", () => { expect(participantDeadline(10_000, 300)).toBe(310_000); });
  it("clamps invalid values and never moves a deadline into the past", () => { expect(normalizeExtraTime(-3)).toBe(0); expect(normalizeExtraTime(999_999)).toBe(86_400); expect(shiftDeadline(5_000, -30, 4_000)).toBe(4_000); });
  it("keeps the run open past base time while one extended participant remains", () => { expect(allDeadlinesComplete(1_000, 2_000, ["submitted", "active"])).toBe(false); expect(allDeadlinesComplete(1_000, 2_000, ["submitted", "submitted"])).toBe(true); });
});
