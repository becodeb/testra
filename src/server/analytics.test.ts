import { describe, expect, it } from "vitest";
import type { FullQuestion } from "@/domain/exam";
import { buildExamAnalytics, type AnalyticsAttempt } from "@/server/analytics";

const question: FullQuestion = { id: "q1", position: 0, type: "mc", prompt: "Uno", points: 2, section: "A", difficulty: "easy", config: { options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctOptionId: "a" } };
function attempt(id: string, answer: unknown, correct: boolean): AnalyticsAttempt { return { runId: "r", participantId: id, status: "submitted", startedAt: 100, joinedAt: 90, submittedAt: 1100, assigned: [question], answers: new Map([["q1", answer]]), grades: new Map([["q1", { auto: correct, points: correct ? 2 : 0 }]]), incidentTypes: [] }; }

describe("exam analytics", () => {
  it("uses the questions actually assigned and configured pass threshold", () => {
    const result = buildExamAnalytics([attempt("1", "a", true), attempt("2", "b", false)], 3, 70);
    expect(result.summary).toMatchObject({ participants: 2, submissions: 2, absences: 1, average: 50, median: 50, passPercentage: 50 });
    expect(result.questions[0]).toMatchObject({ assigned: 2, answered: 2, correct: 1, accuracy: 50 });
  });
  it("does not invent an approval threshold", () => { expect(buildExamAnalytics([attempt("1", "a", true)], 1, null).summary.passPercentage).toBeNull(); });
  it("uses each student's real assigned section and hides unused difficulty analytics", () => {
    const second: FullQuestion = { ...question, id: "q2", section: "B", difficulty: null, prompt: "Dos" };
    const firstAttempt = attempt("1", "a", true);
    const secondAttempt: AnalyticsAttempt = {
      ...attempt("2", "a", true),
      assigned: [second],
      answers: new Map([["q2", "a"]]),
      grades: new Map([["q2", { auto: true, points: 2 }]]),
    };
    const result = buildExamAnalytics([firstAttempt, secondAttempt], 2, null);
    expect(result.sections.map((section) => section.name).sort()).toEqual(["A", "B"]);
    expect(result.sections.every((section) => section.assigned === 1)).toBe(true);
    expect(result.difficulty).toEqual([{ name: "easy", assigned: 1, accuracy: 100 }]);
  });

  it("keeps integrity signals separate from academic performance", () => {
    const signaled = { ...attempt("1", "b", false), incidentTypes: ["focus-loss", "disconnect", "focus-loss"] };
    const result = buildExamAnalytics([signaled], 1, null);
    expect(result.integrity.byType).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "focus-loss", count: 2, participants: 1 }),
      expect.objectContaining({ type: "disconnect", count: 1, participants: 1 }),
    ]));
    expect(result.summary.average).toBe(0);
  });

  it("does not turn resolution pace into an integrity signal", () => {
    const result = buildExamAnalytics([{ ...attempt("1", "a", true), incidentTypes: ["cadencia-respuestas", "ritmo-desarrollo"] }], 1, null);
    expect(result.integrity).toMatchObject({ totalSignals: 0, affectedParticipants: 0, byType: [] });
  });

  it("never exposes development answer text in general analytics", () => {
    const development: FullQuestion = { id: "long", position: 0, type: "long", prompt: "Explicá", points: 5, config: {} };
    const result = buildExamAnalytics([{
      runId: "r",
      participantId: "p",
      status: "submitted",
      startedAt: 100,
      joinedAt: 90,
      submittedAt: 1100,
      assigned: [development],
      answers: new Map([["long", "respuesta individual sensible"]]),
      grades: new Map([["long", { auto: null, points: 3 }]]),
      incidentTypes: [],
    }], 1, null);
    expect(JSON.stringify(result)).not.toContain("respuesta individual sensible");
    expect(result.questions[0].distribution).toEqual([{ answer: "3 pts", count: 1 }]);
  });
});
