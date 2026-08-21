import { describe, expect, it } from "vitest";

import { createRunCode, RUN_CODE_ALPHABET } from "@/server/run-code";

describe("createRunCode", () => {
  it("creates six-character codes from the unambiguous alphabet", () => {
    const code = createRunCode(6, (bytes) => bytes.fill(7));
    expect(code).toHaveLength(6);
    expect([...code].every((character) => RUN_CODE_ALPHABET.includes(character))).toBe(true);
    expect(code).not.toMatch(/[IO01]/);
  });
});
