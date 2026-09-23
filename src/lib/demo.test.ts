import { describe, expect, it } from "vitest";

import type { ClientIncident } from "@/hooks/use-exam-monitoring";
import {
  DEMO_QUESTIONS,
  demoResult,
  formatClock,
  formatCountdown,
  isAnswered,
  remainingSeconds,
  reportIncidentRows,
  teacherIncidentLabel,
  toDemoIncident,
} from "@/lib/demo";
import { gradeQuestion } from "@/server/grading";

const [pestana, portapapeles, ingreso] = DEMO_QUESTIONS;

function incident(type: string, meta: Record<string, unknown> = {}, durationMs = 0, at = 1_000): ClientIncident {
  return { type: type as ClientIncident["type"], at, durationMs, meta };
}

function option(index: number, text: string): string {
  const question = DEMO_QUESTIONS[index];
  if (question.type !== "mc") throw new Error("se esperaba opción única");
  const found = question.config.options.find((item) => item.text === text);
  if (!found) throw new Error(`no existe la opción ${text}`);
  return found.id;
}

describe("DEMO_QUESTIONS", () => {
  it("son tres, dos de opción única y una de respuesta corta, de un punto cada una", () => {
    expect(DEMO_QUESTIONS.map((question) => question.type)).toEqual(["mc", "mc", "sa"]);
    expect(DEMO_QUESTIONS.map((question) => question.points)).toEqual([1, 1, 1]);
    expect(new Set(DEMO_QUESTIONS.map((question) => question.id)).size).toBe(3);
  });

  it("tiene la clave donde corresponde", () => {
    expect(gradeQuestion(pestana, option(0, "Un aviso con cuánto tiempo estuviste afuera")).auto).toBe(true);
    expect(gradeQuestion(pestana, option(0, "Nada, no se entera")).auto).toBe(false);
    expect(gradeQuestion(portapapeles, option(1, "La acción y la cantidad de caracteres")).auto).toBe(true);
    expect(gradeQuestion(portapapeles, option(1, "El texto completo")).auto).toBe(false);
  });

  it("acepta código con o sin tilde, mayúsculas, espacios y artículo", () => {
    for (const value of ["código", "codigo", "Código", "CODIGO", "  código  ", "el código", "El Codigo", "un código", "UN   CÓDIGO"]) {
      expect(gradeQuestion(ingreso, value).auto, value).toBe(true);
    }
  });

  it("no acepta otra cosa, ni la respuesta vacía", () => {
    // El corrector no saca la puntuación: "código." no entra, como en el producto.
    for (const value of ["", "   ", "clave", "código de la sala", "los códigos", "código."]) {
      expect(gradeQuestion(ingreso, value).auto, value).toBe(false);
    }
    expect(gradeQuestion(ingreso, null).auto).toBe(false);
  });
});

describe("demoResult", () => {
  it("corrige con gradeExam y dice qué respondió y qué era lo correcto", () => {
    const result = demoResult(DEMO_QUESTIONS, {
      [pestana.id]: option(0, "Un aviso con cuánto tiempo estuviste afuera"),
      [portapapeles.id]: option(1, "Nada"),
      [ingreso.id]: "Código",
    });
    expect(result.percent).toBe(67);
    expect(result.correctCount).toBe(2);
    expect(result.rows).toEqual([
      { number: 1, correct: true, answered: true, answer: "Un aviso con cuánto tiempo estuviste afuera", correctAnswer: "Un aviso con cuánto tiempo estuviste afuera" },
      { number: 2, correct: false, answered: true, answer: "Nada", correctAnswer: "La acción y la cantidad de caracteres" },
      { number: 3, correct: true, answered: true, answer: "Código", correctAnswer: "código" },
    ]);
  });

  it("deja entregar sin responder: vale cero y se marca como sin responder", () => {
    const result = demoResult(DEMO_QUESTIONS, { [ingreso.id]: "   " });
    expect(result.percent).toBe(0);
    expect(result.correctCount).toBe(0);
    expect(result.rows.map((row) => row.answered)).toEqual([false, false, false]);
    expect(result.rows[2].answer).toBe("");
  });

  it("da 100 con todo bien", () => {
    const result = demoResult(DEMO_QUESTIONS, {
      [pestana.id]: option(0, "Un aviso con cuánto tiempo estuviste afuera"),
      [portapapeles.id]: option(1, "La acción y la cantidad de caracteres"),
      [ingreso.id]: "el codigo",
    });
    expect(result).toMatchObject({ percent: 100, correctCount: 3 });
  });
});

describe("isAnswered", () => {
  it("cuenta solo lo que tiene algo escrito", () => {
    expect(isAnswered(undefined)).toBe(false);
    expect(isAnswered("  ")).toBe(false);
    expect(isAnswered("código")).toBe(true);
  });
});

describe("avisos del informe", () => {
  it("toma la pregunta activa que el hook deja en meta", () => {
    expect(toDemoIncident(incident("atajo-f12", { questionId: "demo-ingreso" }), "a").questionId).toBe("demo-ingreso");
    expect(toDemoIncident(incident("atajo-f12"), "b").questionId).toBeNull();
  });

  it("los ordena como pasaron y les pone el número de pregunta", () => {
    const rows = reportIncidentRows([
      toDemoIncident(incident("atajo-copiar-pegar", { action: "paste", characters: 6, questionId: ingreso.id }, 0, 9_000), "pegar"),
      toDemoIncident(incident("ventana-sin-foco", { questionId: pestana.id }, 1_200, 2_000), "foco"),
      toDemoIncident(incident("atajo-f12", { questionId: "otra" }, 0, 5_000), "f12"),
    ], DEMO_QUESTIONS);
    expect(rows.map((row) => [row.id, row.questionNumber])).toEqual([["foco", 1], ["f12", null], ["pegar", 3]]);
    expect(rows[0].label).toBe("Otra ventana tomó el control (1,2 s)");
    expect(rows[2].label).toBe("Pegó 6 caracteres");
  });

  it("usa las palabras del panel del docente", () => {
    expect(teacherIncidentLabel(incident("cambio-de-pestana", {}, 3_250))).toBe("La evaluación dejó de estar visible (3,3 s)");
    expect(teacherIncidentLabel(incident("atajo-copiar-pegar", { action: "copiar", characters: null, deteccion: "atajo" })))
      .toBe("Copió con el teclado; el navegador no informó cuánto");
    expect(teacherIncidentLabel(incident("atajo-f12"))).toBe("Se presionó la tecla F12");
  });
});

describe("formatos", () => {
  it("muestra el reloj de la evaluación como el producto", () => {
    expect(formatCountdown(300)).toBe("05:00");
    expect(formatCountdown(59)).toBe("00:59");
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(-4)).toBe("00:00");
    expect(formatCountdown(3_661)).toBe("01:01:01");
  });

  it("calcula los segundos que quedan sin bajar de cero", () => {
    expect(remainingSeconds(301_000, 1_000)).toBe(300);
    expect(remainingSeconds(10_500, 10_000)).toBe(1);
    expect(remainingSeconds(10_000, 12_000)).toBe(0);
  });

  it("da la hora del aviso en 24 horas, sin p. m.", () => {
    expect(formatClock(new Date(2026, 8, 22, 23, 4, 5).getTime())).toBe("23:04:05");
    expect(formatClock(new Date(2026, 8, 22, 9, 0, 7).getTime())).toBe("09:00:07");
  });
});
