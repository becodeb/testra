import { describe, expect, it } from "vitest";

import { MISSING_QUESTION_ERROR, jobClosure } from "@/server/grading-jobs";

describe("cierre de un lote de corrección con IA", () => {
  it("cierra completo cuando no quedó nada pendiente ni fallado", () => {
    expect(jobClosure(0, 0)).toEqual({ status: "completed", error: null });
  });

  it("NO cierra como completo si quedaron respuestas sin analizar", () => {
    // Este era el bug: el lote decía "Análisis completo" con la mitad sin
    // procesar, y el docente publicaba notas creyendo que estaban todas.
    const cierre = jobClosure(7, 0);
    expect(cierre.status).toBe("failed");
    expect(cierre.error).toContain("7 respuestas sin analizar");
  });

  it("dice el motivo en singular cuando queda una sola", () => {
    expect(jobClosure(1, 0).error).toContain("1 respuesta sin analizar");
  });

  it("cierra completo pero avisa cuando algunas fallaron", () => {
    // Fallaron pero se procesaron: el lote termino, y aun asi hay que decir
    // cuantas quedaron a mano.
    const cierre = jobClosure(0, 3);
    expect(cierre.status).toBe("completed");
    expect(cierre.error).toContain("3 respuestas no se pudieron analizar");
  });

  it("las que quedaron sin procesar pesan más que las falladas", () => {
    // Con las dos cosas a la vez, lo que hay que decir es que quedó trabajo sin
    // empezar: es lo que puede dejar notas sin poner.
    expect(jobClosure(2, 5).status).toBe("failed");
  });

  it("explica en castellano por qué una respuesta quedó sin analizar", () => {
    expect(MISSING_QUESTION_ERROR).toContain("Corregila a mano");
  });
});
