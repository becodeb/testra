import { describe, expect, it } from "vitest";

import { nextWritingCadence } from "@/server/writing-cadence";

interface SavedAnswer { questionId: string; at: number; questionType: string; answerLength?: number; }

function simular(answers: SavedAnswer[]) {
  let recent: Array<{ questionId: string; at: number }> = [];
  for (const answer of answers) {
    const result = nextWritingCadence(recent, { ...answer, answerLength: answer.answerLength ?? 160 });
    recent = result.recent;
    if (result.unusual) return true;
  }
  return false;
}

describe("ritmo de desarrollos", () => {
  it("NO salta cuando el alumno autoguarda un solo desarrollo con pausas", () => {
    expect(simular([0, 700, 1500, 2400, 3552].map((at) => ({ questionId: "q-desarrollo-1", at, questionType: "long" })))).toBe(false);
  });

  it("NO salta por responder opciones o textos muy cortos rápidamente", () => {
    const options = ["q1", "q2", "q3", "q4", "q5", "q6"].map((questionId, index) => ({ questionId, at: index * 500, questionType: "mc", answerLength: 0 }));
    const shortAnswers = ["d1", "d2", "d3", "d4"].map((questionId, index) => ({ questionId, at: index * 500, questionType: "long", answerLength: 12 }));
    expect(simular(options)).toBe(false);
    expect(simular(shortAnswers)).toBe(false);
  });

  it("NO cuenta dos veces el mismo desarrollo aunque se guarde varias veces", () => {
    expect(simular([
      { questionId: "q1", at: 0, questionType: "long" },
      { questionId: "q2", at: 500, questionType: "long" },
      { questionId: "q3", at: 1000, questionType: "long" },
      { questionId: "q1", at: 1500, questionType: "long" },
      { questionId: "q2", at: 2000, questionType: "long" },
    ])).toBe(false);
  });

  it("registra solamente cuatro desarrollos sustantivos distintos en un lapso inusual", () => {
    expect(simular(["q1", "q2", "q3", "q4"].map((questionId, index) => ({ questionId, at: index * 4000, questionType: "long", answerLength: 160 })))).toBe(true);
  });

  it("NO salta si esos desarrollos están repartidos en el tiempo", () => {
    expect(simular(["q1", "q2", "q3", "q4"].map((questionId, index) => ({ questionId, at: index * 60_000, questionType: "long" })))).toBe(false);
  });
});
