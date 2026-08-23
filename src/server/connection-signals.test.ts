import { describe, expect, it } from "vitest";

import { shouldCompareConnectionValue } from "@/server/connection-signals";

describe("connection incident guards", () => {
  it.each([undefined, "pending-socket", "restored", "unknown"])("ignores transient first-connection value %s", (value) => {
    expect(shouldCompareConnectionValue(value)).toBe(false);
  });

  it("compares a real prior connection value", () => {
    expect(shouldCompareConnectionValue("Mozilla/5.0 Chrome")).toBe(true);
    expect(shouldCompareConnectionValue("203.0.113.20")).toBe(true);
  });
});
