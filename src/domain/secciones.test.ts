import { describe, expect, it } from "vitest";

import type { FullQuestion } from "./exam";
import { contarPorSeccion, elegirPorSecciones, personalizeQuestions } from "./pool";

function pregunta(id: string, section: string, type: FullQuestion["type"] = "sa"): FullQuestion {
  const base = { id, position: 0, prompt: `consigna ${id}`, points: 1, section };
  if (type === "long") return { ...base, type, config: {} } as FullQuestion;
  return { ...base, type: "sa", config: { accepted: ["x"] } } as FullQuestion;
}

/** Tres secciones con 15 preguntas cada una, como el caso que motivó la función. */
function pozo() {
  const questions: FullQuestion[] = [];
  for (const section of ["X", "Y", "Z"]) {
    for (let n = 1; n <= 15; n += 1) questions.push(pregunta(`${section}${n}`, section));
  }
  return questions;
}

const CUOTAS = { X: 2, Y: 4, Z: 4 };

function seccionesDe(questions: FullQuestion[]) {
  const total: Record<string, number> = {};
  for (const question of questions) {
    const section = question.section ?? "";
    total[section] = (total[section] ?? 0) + 1;
  }
  return total;
}

describe("sorteo por secciones", () => {
  it("sirve exactamente la cuota de cada sección", () => {
    const elegidas = elegirPorSecciones(pozo(), "run:alumno", CUOTAS);
    expect(elegidas).toHaveLength(10);
    expect(seccionesDe(elegidas)).toEqual({ X: 2, Y: 4, Z: 4 });
  });

  it("le da preguntas distintas a cada alumno", () => {
    const primero = elegirPorSecciones(pozo(), "run:alumno-1", CUOTAS).map((q) => q.id);
    const segundo = elegirPorSecciones(pozo(), "run:alumno-2", CUOTAS).map((q) => q.id);
    expect(primero).not.toEqual(segundo);
    // Aun siendo distintas, los dos reciben la misma composición.
    expect(seccionesDe(elegirPorSecciones(pozo(), "run:alumno-2", CUOTAS))).toEqual({ X: 2, Y: 4, Z: 4 });
  });

  it("le da siempre lo mismo al mismo alumno", () => {
    const una = elegirPorSecciones(pozo(), "run:alumno", CUOTAS).map((q) => q.id);
    const otra = elegirPorSecciones(pozo(), "run:alumno", CUOTAS).map((q) => q.id);
    expect(una).toEqual(otra);
  });

  it("no depende del orden en que el docente creó las secciones", () => {
    const enUnOrden = elegirPorSecciones(pozo(), "run:alumno", { X: 2, Y: 4, Z: 4 }).map((q) => q.id).sort();
    const enOtro = elegirPorSecciones(pozo(), "run:alumno", { Z: 4, X: 2, Y: 4 }).map((q) => q.id).sort();
    expect(enUnOrden).toEqual(enOtro);
  });

  it("si una sección tiene menos preguntas que las pedidas, sirve las que hay", () => {
    const escaso = [pregunta("X1", "X"), pregunta("Y1", "Y"), pregunta("Y2", "Y")];
    const elegidas = elegirPorSecciones(escaso, "run:alumno", { X: 5, Y: 1 });
    expect(seccionesDe(elegidas)).toEqual({ X: 1, Y: 1 });
  });

  it("deja afuera las preguntas sin sección y las de secciones sin cuota", () => {
    const mezcla = [...pozo(), pregunta("suelta", ""), pregunta("W1", "W")];
    const elegidas = elegirPorSecciones(mezcla, "run:alumno", CUOTAS);
    expect(elegidas.map((q) => q.id)).not.toContain("suelta");
    expect(elegidas.map((q) => q.id)).not.toContain("W1");
  });

  it("una cuota en cero no aporta preguntas", () => {
    const elegidas = elegirPorSecciones(pozo(), "run:alumno", { X: 2, Y: 0, Z: 1 });
    expect(seccionesDe(elegidas)).toEqual({ X: 2, Z: 1 });
  });
});

describe("personalizeQuestions con secciones", () => {
  it("las cuotas mandan sobre questionsToServe y longToServe", () => {
    // Se piden 99 preguntas y 7 de desarrollo, pero hay cuotas: ganan las cuotas.
    const servidas = personalizeQuestions(pozo(), "run:alumno", false, false, 99, 7, CUOTAS);
    expect(servidas).toHaveLength(10);
    expect(seccionesDe(servidas)).toEqual({ X: 2, Y: 4, Z: 4 });
  });

  it("sin cuotas mantiene el comportamiento de siempre", () => {
    const sinCuotas = personalizeQuestions(pozo(), "run:alumno", false, false, 6, 0, {});
    expect(sinCuotas).toHaveLength(6);
  });

  it("renumera las posiciones de 0 en adelante", () => {
    const servidas = personalizeQuestions(pozo(), "run:alumno", true, false, null, 2, CUOTAS);
    expect(servidas.map((q) => q.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("contarPorSeccion", () => {
  it("cuenta las preguntas cargadas en cada sección e ignora las sueltas", () => {
    const conteo = contarPorSeccion([...pozo(), pregunta("suelta", "")]);
    expect(Object.fromEntries(conteo)).toEqual({ X: 15, Y: 15, Z: 15 });
  });
});
