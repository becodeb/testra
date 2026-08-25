import { describe, expect, it } from "vitest";

import { groupCorrectionsByQuestion } from "@/server/correction-groups";

describe("correction grouped by question", () => {
  it("groups every student answer and reports progress without replacing the student flow", () => {
    const groups = groupCorrectionsByQuestion([
      { participantId: "p2", studentName: "Zoe", questionId: "q1", prompt: "Explicá", pointsAwarded: null },
      { participantId: "p1", studentName: "Ana", questionId: "q1", prompt: "Explicá", pointsAwarded: 2 },
      { participantId: "p1", studentName: "Ana", questionId: "q2", prompt: "Justificá", pointsAwarded: null },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ questionId: "q1", completed: 1, total: 2 });
    expect(groups[0].items.map((item) => item.studentName)).toEqual(["Ana", "Zoe"]);
    expect(groups[1]).toMatchObject({ questionId: "q2", completed: 0, total: 1 });
  });
});
