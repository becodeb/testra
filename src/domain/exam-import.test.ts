import { describe, expect, it } from "vitest";

import { getQuestionCompletion } from "@/domain/exam";
import { makeQuestion, parsePastedExam, QUESTION_TYPE_LABELS } from "@/domain/exam-import";

describe("parsePastedExam", () => {
  it("arma opción única con las opciones A), B), C) y deja la clave sin marcar", () => {
    const [question] = parsePastedExam("¿Qué ve tu docente?\nA) Nada\nB) Un aviso\nC) Una captura");
    expect(question.type).toBe("mc");
    if (question.type !== "mc") throw new Error("se esperaba opción única");
    expect(question.prompt).toBe("¿Qué ve tu docente?");
    expect(question.config.options.map((option) => option.text)).toEqual(["Nada", "Un aviso", "Una captura"]);
    expect(new Set(question.config.options.map((option) => option.id)).size).toBe(3);
    // La clave la marca el docente: el parser nunca adivina cuál es la correcta.
    expect(question.config.correctOptionId).toBe("");
    expect(getQuestionCompletion(question)).toBe("missing-key");
  });

  it("convierte en desarrollo el bloque que no trae opciones", () => {
    const [question] = parsePastedExam("Explicá en una oración qué harías.");
    expect(question.type).toBe("long");
    expect(question.prompt).toBe("Explicá en una oración qué harías.");
    expect(getQuestionCompletion(question)).toBe("complete");
  });

  it("no toma como opciones una sola línea con letra", () => {
    const [question] = parsePastedExam("Consigna\nA) única línea");
    expect(question.type).toBe("long");
  });

  it("saca la numeración del principio del enunciado", () => {
    const questions = parsePastedExam("1) Primera\nA) Sí\nB) No\n\n2. Segunda\n\n3- Tercera");
    expect(questions.map((question) => question.prompt)).toEqual(["Primera", "Segunda", "Tercera"]);
    expect(questions.map((question) => question.position)).toEqual([0, 1, 2]);
  });

  it("ignora los bloques en blanco, también los que solo tienen espacios", () => {
    const questions = parsePastedExam("\n\nPrimera\n\n   \n\n\t\nSegunda\n\n\n");
    expect(questions.map((question) => question.prompt)).toEqual(["Primera", "Segunda"]);
  });

  it("devuelve una lista vacía si no hay texto", () => {
    expect(parsePastedExam("")).toEqual([]);
    expect(parsePastedExam("   \n\n  ")).toEqual([]);
  });
});

describe("makeQuestion", () => {
  it("arranca con un punto y sin clave", () => {
    const question = makeQuestion("mc", 3);
    expect(question.position).toBe(3);
    expect(question.points).toBe(1);
    expect(getQuestionCompletion(question)).toBe("empty");
  });
});

describe("QUESTION_TYPE_LABELS", () => {
  it("nombra los dos tipos que produce la importación", () => {
    expect(QUESTION_TYPE_LABELS.mc).toBe("Opción única");
    expect(QUESTION_TYPE_LABELS.long).toBe("Desarrollo");
  });
});
