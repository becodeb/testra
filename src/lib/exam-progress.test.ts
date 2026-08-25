import { describe, expect, it } from "vitest";

import { personalizeQuestions } from "@/domain/pool";
import type { FullQuestion } from "@/domain/exam";
import { formatAssignedProgress } from "@/lib/exam-progress";

describe("assigned question progress", () => {
  it("uses the three questions assigned from a five-question pool", () => {
    const pool = Array.from({ length: 5 }, (_, index) => ({ id: `q${index}`, position: index, type: "sa", prompt: "?", points: 1, config: { accepted: ["x"] } })) as FullQuestion[];
    const assigned = personalizeQuestions(pool, "run:student", true, false, 3, 0, {});
    expect(assigned).toHaveLength(3);
    expect(formatAssignedProgress(3, assigned.length)).toBe("3/3");
  });

  it("uses the actual section result when a quota cannot be filled", () => {
    const pool = [
      { id: "a", position: 0, type: "sa", prompt: "?", points: 1, section: "A", config: { accepted: ["x"] } },
      { id: "b", position: 1, type: "sa", prompt: "?", points: 1, section: "B", config: { accepted: ["x"] } },
    ] as FullQuestion[];
    const assigned = personalizeQuestions(pool, "run:student", false, false, 99, 0, { A: 3, B: 1 });
    expect(formatAssignedProgress(2, assigned.length)).toBe("2/2");
  });
});
