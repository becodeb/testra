import { describe, expect, it } from "vitest";

import { fullQuestionSchema, toStudentQuestion, type FullQuestion } from "@/domain/exam";

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

describe("optional question metadata", () => {
  it("keeps legacy questions valid without difficulty, assets or rubric", () => {
    expect(fullQuestionSchema.parse({
      id: "legacy",
      position: 0,
      type: "long",
      prompt: "Desarrollá",
      points: 5,
      config: {},
    })).toMatchObject({ id: "legacy", type: "long" });
  });

  it("accepts an optional difficulty and a rubric that exactly matches the question points", () => {
    const parsed = fullQuestionSchema.parse({
      id: "rubric",
      position: 0,
      type: "long",
      prompt: "Desarrollá",
      points: 5,
      difficulty: "hard",
      config: { rubric: [
        { id: "concept", label: "Concepto", maxPoints: 2 },
        { id: "process", label: "Procedimiento", maxPoints: 3 },
      ] },
    });
    expect(parsed.difficulty).toBe("hard");
  });

  it("rejects a rubric whose sum differs from the question score", () => {
    const result = fullQuestionSchema.safeParse({
      id: "rubric",
      position: 0,
      type: "long",
      prompt: "Desarrollá",
      points: 5,
      config: { rubric: [{ id: "concept", label: "Concepto", maxPoints: 4 }] },
    });
    expect(result.success).toBe(false);
  });
});
