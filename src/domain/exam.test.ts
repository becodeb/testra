import { describe, expect, it } from "vitest";

import { toStudentQuestion, type FullQuestion } from "@/domain/exam";

describe("toStudentQuestion", () => {
  it("never serializes answer keys for multiple choice", () => {
    const question: FullQuestion = {
      id: "q1",
      position: 0,
      type: "mc",
      prompt: "Pregunta",
      points: 1,
      config: {
        options: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
        ],
        correctOptionId: "b",
      },
    };

    const serialized = JSON.stringify(toStudentQuestion(question));
    expect(serialized).not.toContain("correct");
    expect(serialized).toContain("options");
  });

  it("never serializes accepted short answers", () => {
    const question: FullQuestion = {
      id: "q2",
      position: 1,
      type: "sa",
      prompt: "Pregunta",
      points: 1,
      config: { accepted: ["secreto"] },
    };

    const serialized = JSON.stringify(toStudentQuestion(question));
    expect(serialized).not.toContain("accepted");
    expect(serialized).not.toContain("secreto");
  });
});
