import { describe, expect, it } from "vitest";

import type { FullQuestion } from "@/domain/exam";
import { gradeExam, gradeQuestion, normalizeShortAnswer, partialMultiSelectScore } from "@/server/grading";

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

  it("keeps exact grading as the default for backwards compatibility", () => {
    expect(gradeQuestion(questions[1], ["2"])).toMatchObject({ auto: false, pointsAwarded: 0 });
  });

  it("awards proportional credit and penalizes wrong selections when enabled", () => {
    const partial = {
      ...questions[1],
      config: { ...questions[1].config, gradingMode: "partial" as const },
    } as FullQuestion;
    expect(gradeQuestion(partial, ["2"]).pointsAwarded).toBe(1.5);
    expect(gradeQuestion(partial, ["2", "3"]).pointsAwarded).toBe(0);
    expect(gradeQuestion(partial, ["2", "4"]).pointsAwarded).toBe(3);
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

describe("partialMultiSelectScore", () => {
  const correct = ["a", "b"];
  const options = ["a", "b", "c", "d"];

  it.each([
    [[], 0],
    [["a"], 2],
    [["a", "b"], 4],
    [["a", "c"], 0],
    [["a", "b", "c"], 2],
    [["c", "d"], 0],
  ])("scores %j as %s", (selected, expected) => {
    expect(partialMultiSelectScore(selected, correct, options, 4)).toBe(expected);
  });

  it("ignores duplicate and unknown option identifiers", () => {
    expect(partialMultiSelectScore(["a", "a", "unknown"], correct, options, 4)).toBe(2);
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
