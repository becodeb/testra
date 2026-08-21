import { describe, expect, it } from "vitest";

import type { FullQuestion } from "@/domain/exam";
import { gradeExam, gradeQuestion, normalizeShortAnswer } from "@/server/grading";

const questions: FullQuestion[] = [
  {
    id: "mc-1",
    position: 0,
    type: "mc",
    prompt: "Capital de Argentina",
    points: 2,
    config: {
      options: [
        { id: "a", text: "Buenos Aires" },
        { id: "b", text: "Córdoba" },
      ],
      correctOptionId: "a",
    },
  },
  {
    id: "ms-1",
    position: 1,
    type: "ms",
    prompt: "Números pares",
    points: 3,
    config: {
      options: [
        { id: "2", text: "2" },
        { id: "3", text: "3" },
        { id: "4", text: "4" },
      ],
      correctOptionIds: ["2", "4"],
    },
  },
  {
    id: "sa-1",
    position: 2,
    type: "sa",
    prompt: "Orgánulo celular",
    points: 2,
    config: { accepted: ["mitocondría", "la mitocondria"] },
  },
  {
    id: "long-1",
    position: 3,
    type: "long",
    prompt: "Explicá el proceso",
    points: 5,
    config: {},
  },
];

describe("normalizeShortAnswer", () => {
  it("removes diacritics, case and repeated whitespace", () => {
    expect(normalizeShortAnswer("  MitocondRÍA  ")).toBe("mitocondria");
  });
});

describe("gradeQuestion", () => {
  it("requires exact equality for multi-select without depending on order", () => {
    expect(gradeQuestion(questions[1], ["4", "2"]).auto).toBe(true);
    expect(gradeQuestion(questions[1], ["2"]).auto).toBe(false);
    expect(gradeQuestion(questions[1], ["2", "3", "4"]).auto).toBe(false);
  });

  it("normalizes short answers before matching", () => {
    expect(gradeQuestion(questions[2], "MITOCONDRIA").auto).toBe(true);
  });

  it("leaves long answers for manual grading", () => {
    expect(gradeQuestion(questions[3], "Texto del alumno")).toMatchObject({
      auto: null,
      pointsAwarded: null,
    });
  });
});

describe("gradeExam", () => {
  it("separates awarded and pending manual points", () => {
    const result = gradeExam(questions, [
      { questionId: "mc-1", value: "a" },
      { questionId: "ms-1", value: ["2"] },
      { questionId: "sa-1", value: "mitocondria" },
      { questionId: "long-1", value: "Desarrollo" },
    ]);

    expect(result).toMatchObject({ awardedPoints: 4, pendingManualPoints: 5, maxPoints: 12 });
  });
});
