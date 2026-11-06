import { describe, expect, it } from "vitest";

import { resultsVisibility, withoutGrading, type ResultsDisplay, type ResultsWhen } from "@/lib/student-results";

function visibility(display: ResultsDisplay, when: ResultsWhen, overrides: Partial<Parameters<typeof resultsVisibility>[0]> = {}) {
  return resultsVisibility({ display, when, runStatus: "running", publishedAt: null, participantStatus: "submitted", ...overrides });
}

describe("resultsVisibility", () => {
  it("con 'No mostrar' no libera nada, tampoco al cerrar", () => {
    expect(visibility("hidden", "after_submit", { runStatus: "ended", publishedAt: 1 })).toEqual({ level: "none", waitingFor: null });
  });

  it("no muestra nada a quien todavía no entregó", () => {
    expect(visibility("score_and_answers", "after_submit", { participantStatus: "active" }).level).toBe("none");
    expect(visibility("score_and_answers", "after_submit", { participantStatus: "expired", runStatus: "ended" }).level).toBe("none");
  });

  it("espera la publicación del docente aunque la sesión haya cerrado", () => {
    expect(visibility("score_and_answers", "teacher_publishes", { runStatus: "ended" })).toEqual({ level: "none", waitingFor: "teacher" });
    expect(visibility("score_and_answers", "teacher_publishes", { runStatus: "ended", publishedAt: 1 })).toEqual({ level: "detail", waitingFor: null });
  });

  it("'Al terminar la sesión' espera el cierre", () => {
    expect(visibility("score_only", "after_run")).toEqual({ level: "none", waitingFor: "run-end" });
    expect(visibility("score_only", "after_run", { runStatus: "ended" })).toEqual({ level: "score", waitingFor: null });
  });

  it("'Al entregar' da la nota y las respuestas, y el detalle recién al cierre", () => {
    expect(visibility("score_and_answers", "after_submit")).toEqual({ level: "answers", waitingFor: "run-end" });
    expect(visibility("score_and_answers", "after_submit", { runStatus: "ended" })).toEqual({ level: "detail", waitingFor: null });
  });

  it("'Solo puntaje' nunca llega a mostrar respuestas", () => {
    expect(visibility("score_only", "after_submit").level).toBe("score");
    expect(visibility("score_only", "after_submit", { runStatus: "ended" }).level).toBe("score");
  });
});

describe("withoutGrading", () => {
  it("no deja viajar qué era lo correcto", () => {
    const serialized = JSON.stringify([
      withoutGrading({ kind: "choice", multiple: false, options: [{ id: "a", text: "A", selected: true, correct: true }] }),
      withoutGrading({ kind: "tf", value: true, correct: true }),
      withoutGrading({ kind: "text", value: "hola", accepted: ["clave-secreta"] }),
    ]);
    expect(serialized).not.toContain("correct");
    expect(serialized).not.toContain("clave-secreta");
    expect(serialized).toContain("hola");
  });
});
