import { describe, expect, it } from "vitest";

import { matchedExpectedStudentIndexes, namesAreCompatible } from "@/lib/student-identity";

describe("student identity matching", () => {
  it("recognizes an attending guest by an exact name when they do not have an email", () => {
    const matched = matchedExpectedStudentIndexes(
      [{ name: "Laura Belzunce", email: "laura@escuela.edu" }],
      [{ name: "Laura Belzunce", email: null }],
    );
    expect([...matched]).toEqual([0]);
  });

  it("recognizes a unique abbreviated name, including accents", () => {
    const matched = matchedExpectedStudentIndexes(
      [{ name: "María Laura", email: null }, { name: "Juan Pérez", email: null }],
      [{ name: "Laura", email: null }, { name: "Juan Pérez", email: null }],
    );
    expect([...matched].sort()).toEqual([0, 1]);
    expect(namesAreCompatible("María Laura", "Laura")).toBe(true);
  });

  it("does not consider partial names present when there is more than one possible student", () => {
    const matched = matchedExpectedStudentIndexes(
      [{ name: "Laura Gómez", email: null }, { name: "Laura Pérez", email: null }],
      [{ name: "Laura", email: null }],
    );
    expect([...matched]).toEqual([]);
  });

  it("does not reuse a single participant for two expected students", () => {
    const matched = matchedExpectedStudentIndexes(
      [{ name: "Laura Gómez", email: null }, { name: "Laura", email: null }],
      [{ name: "Laura", email: null }],
    );
    expect([...matched]).toEqual([1]);
  });
});
