import { describe, expect, it } from "vitest";

// Réplica exacta de la regla que aplica ExamRunActor en /answer-saved. Vive acá
// porque importar el actor abre el pool de Postgres, y esta regla decidió mal
// sobre 13 de 21 alumnos reales: merece quedar fijada en un test.
//
// El detector busca "respondió muchas preguntas DISTINTAS en pocos segundos".
// Antes contaba guardados, y como el runtime autoguarda 450 ms después de que
// el alumno deja de teclear, escribir un solo desarrollo con pausas alcanzaba
// para dispararlo.

const CADENCE_WINDOW_MS = 11_000;
const CADENCE_MIN_QUESTIONS = 5;

interface Guardado {
  questionId: string;
  at: number;
  questionType: string;
}

/** Devuelve true si el guardado dispara el aviso de cadencia. */
function simular(guardados: Guardado[]): boolean {
  let ventana: Array<{ questionId: string; at: number }> = [];
  let disparo = false;

  for (const guardado of guardados) {
    ventana = [
      ...ventana.filter(
        (entrada) => guardado.at - entrada.at <= CADENCE_WINDOW_MS && entrada.questionId !== guardado.questionId,
      ),
      { questionId: guardado.questionId, at: guardado.at },
    ].slice(-CADENCE_MIN_QUESTIONS);

    if (guardado.questionType === "long" && ventana.length >= CADENCE_MIN_QUESTIONS) disparo = true;
  }
  return disparo;
}

describe("aviso de cadencia de respuestas", () => {
  it("NO salta cuando el alumno escribe un solo desarrollo con pausas", () => {
    // Es el caso real que rompia: cinco autoguardados de la misma respuesta en
    // 3,5 segundos. En produccion esto le salto a los 7 alumnos de la ultima toma.
    const guardados = [0, 700, 1500, 2400, 3552].map((at) => ({
      questionId: "q-desarrollo-1",
      at,
      questionType: "long",
    }));
    expect(simular(guardados)).toBe(false);
  });

  it("NO salta escribiendo dos desarrollos alternando", () => {
    const guardados = [
      { questionId: "q1", at: 0, questionType: "long" },
      { questionId: "q1", at: 800, questionType: "long" },
      { questionId: "q2", at: 1600, questionType: "long" },
      { questionId: "q2", at: 2400, questionType: "long" },
      { questionId: "q1", at: 3200, questionType: "long" },
    ];
    expect(simular(guardados)).toBe(false);
  });

  it("salta con cinco preguntas distintas en pocos segundos", () => {
    // Nadie escribe cinco desarrollos en once segundos sin pegarlos.
    const guardados = ["q1", "q2", "q3", "q4", "q5"].map((questionId, index) => ({
      questionId,
      at: index * 1500,
      questionType: "long",
    }));
    expect(simular(guardados)).toBe(true);
  });

  it("NO salta si esas cinco preguntas están repartidas en el tiempo", () => {
    const guardados = ["q1", "q2", "q3", "q4", "q5"].map((questionId, index) => ({
      questionId,
      at: index * 60_000,
      questionType: "long",
    }));
    expect(simular(guardados)).toBe(false);
  });

  it("no cuenta dos veces la misma pregunta guardada varias veces", () => {
    // Cuatro preguntas distintas mas un reguardado no llegan al umbral de cinco.
    const guardados = [
      { questionId: "q1", at: 0, questionType: "long" },
      { questionId: "q2", at: 500, questionType: "long" },
      { questionId: "q3", at: 1000, questionType: "long" },
      { questionId: "q4", at: 1500, questionType: "long" },
      { questionId: "q1", at: 2000, questionType: "long" },
      { questionId: "q2", at: 2500, questionType: "long" },
    ];
    expect(simular(guardados)).toBe(false);
  });
});
