import { describe, expect, it } from "vitest";

import { examDraftSchema, type FullQuestion } from "./exam";

// El sorteo vive en repository.ts, que importa cloudflare:workers y no se puede
// cargar acá. Se replica la misma función para fijar el contrato: si cambia una,
// este test falla y obliga a revisar la otra.
function seededShuffle<T>(source: T[], seed: string) {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  const next = [...source];
  for (let index = next.length - 1; index > 0; index -= 1) {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const random = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    const target = Math.floor(random * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}

function elegirSubconjunto(questions: FullQuestion[], seed: string, total: number, longToServe: number) {
  const desarrollo = questions.filter((question) => question.type === "long");
  const resto = questions.filter((question) => question.type !== "long");
  const cuota = Math.max(0, Math.min(longToServe, desarrollo.length, total));
  const elegidasDesarrollo = seededShuffle(desarrollo, `${seed}:pool:long`).slice(0, cuota);
  const elegidasResto = seededShuffle(resto, `${seed}:pool:resto`).slice(0, total - cuota);
  const faltan = total - elegidasDesarrollo.length - elegidasResto.length;
  const relleno = faltan > 0 ? desarrollo.filter((q) => !elegidasDesarrollo.includes(q)).slice(0, faltan) : [];
  return [...elegidasDesarrollo, ...elegidasResto, ...relleno];
}

const pozo = (mc: number, long: number): FullQuestion[] => [
  ...Array.from({ length: mc }, (_, i) => ({
    id: `mc-${i}`, position: i, type: "mc" as const, prompt: `P${i}`, points: 1,
    config: { options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctOptionId: "a" },
  })),
  ...Array.from({ length: long }, (_, i) => ({
    id: `long-${i}`, position: mc + i, type: "long" as const, prompt: `D${i}`, points: 1, config: {},
  })),
];

describe("sorteo estratificado del pozo", () => {
  it("sirve exactamente la cantidad pedida", () => {
    for (const total of [10, 12, 15]) {
      const elegidas = elegirSubconjunto(pozo(50, 12), "run:alumno", total, 2);
      expect(elegidas).toHaveLength(total);
    }
  });

  it("incluye siempre la cuota de desarrollo, sea quien sea el alumno", () => {
    for (let alumno = 0; alumno < 40; alumno += 1) {
      const elegidas = elegirSubconjunto(pozo(50, 12), `run:alumno-${alumno}`, 10, 2);
      const desarrollo = elegidas.filter((q) => q.type === "long");
      expect(desarrollo).toHaveLength(2);
    }
  });

  it("respeta una cuota distinta de dos", () => {
    const elegidas = elegirSubconjunto(pozo(50, 12), "run:alumno", 12, 4);
    expect(elegidas.filter((q) => q.type === "long")).toHaveLength(4);
    expect(elegidas).toHaveLength(12);
  });

  it("no repite preguntas dentro de un mismo alumno", () => {
    const elegidas = elegirSubconjunto(pozo(50, 12), "run:alumno", 12, 2);
    expect(new Set(elegidas.map((q) => q.id)).size).toBe(12);
  });

  it("da conjuntos distintos a alumnos distintos", () => {
    const combinaciones = new Set(
      Array.from({ length: 30 }, (_, i) =>
        elegirSubconjunto(pozo(50, 12), `run:alumno-${i}`, 10, 2).map((q) => q.id).sort().join("|")),
    );
    expect(combinaciones.size).toBeGreaterThan(25);
  });

  it("es estable para el mismo alumno", () => {
    const a = elegirSubconjunto(pozo(50, 12), "run:alumno-7", 10, 2).map((q) => q.id);
    const b = elegirSubconjunto(pozo(50, 12), "run:alumno-7", 10, 2).map((q) => q.id);
    expect(a).toEqual(b);
  });

  it("completa el cupo si el pozo tiene pocas preguntas que no sean de desarrollo", () => {
    const elegidas = elegirSubconjunto(pozo(3, 10), "run:alumno", 8, 2);
    expect(elegidas).toHaveLength(8);
    expect(new Set(elegidas.map((q) => q.id)).size).toBe(8);
  });

  it("rechaza pedir más desarrollo que preguntas servidas", () => {
    const resultado = examDraftSchema.safeParse({
      id: "e1", title: "Prueba", subject: "Materia", instructions: "", timeLimitS: 600,
      questionsToServe: 3, longToServe: 5, status: "ready",
      updatedAt: new Date().toISOString(), questions: pozo(4, 6),
    });
    expect(resultado.success).toBe(false);
  });
});
