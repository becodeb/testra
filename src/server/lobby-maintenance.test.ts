import { describe, expect, it } from "vitest";

import { abandonedLobbyCutoff } from "@/server/exam-run-actor";

describe("abandoned lobby maintenance", () => {
  it("expires only after one persisted hour", () => {
    const now = Date.UTC(2026, 7, 24, 12, 0, 0);
    expect(abandonedLobbyCutoff(now)).toBe(Date.UTC(2026, 7, 24, 11, 0, 0));
  });
});
