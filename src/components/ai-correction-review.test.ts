import { describe, expect, it } from "vitest";

import { confidenceLevel, rubricScoresFromSuggestion } from "@/components/ai-correction-review";

describe("confidenceLevel", () => {
  it("separa alta, media y baja en los cortes esperados", () => {
    expect(confidenceLevel(0.92)).toBe("alta");
    expect(confidenceLevel(0.85)).toBe("alta");
    expect(confidenceLevel(0.84)).toBe("media");
    expect(confidenceLevel(0.65)).toBe("media");
    // Debajo de 0.65 la sugerencia tiene que verse floja antes de que alguien
    // la acepte de apurado: es el unico nivel que cambia de color y avisa.
    expect(confidenceLevel(0.64)).toBe("baja");
    expect(confidenceLevel(0)).toBe("baja");
  });
});

describe("rubricScoresFromSuggestion", () => {
  const rubrica = [
    { id: "c1", label: "Explica el proceso", maxPoints: 2 },
    { id: "c2", label: "Da un ejemplo", maxPoints: 2 },
  ];

  it("sin rubrica no hay nada que mapear y aceptar queda habilitado", () => {
    expect(rubricScoresFromSuggestion([], undefined)).toEqual({});
  });

  it("arma el desglose cuando la IA puntuo cada criterio", () => {
    expect(rubricScoresFromSuggestion(rubrica, [{ id: "c1", score: 2 }, { id: "c2", score: 1 }]))
      .toEqual({ c1: 2, c2: 1 });
  });

  it("no acepta de una si falta el puntaje de algun criterio", () => {
    // Guardar la rubrica a medias le haria perder el desglose al docente sin
    // que se entere. Devolver null deja solo el camino de ajustar a mano.
    expect(rubricScoresFromSuggestion(rubrica, [{ id: "c1", score: 2 }])).toBeNull();
    expect(rubricScoresFromSuggestion(rubrica, [])).toBeNull();
    expect(rubricScoresFromSuggestion(rubrica, undefined)).toBeNull();
  });

  it("ignora entradas mal formadas en vez de romper la corrección", () => {
    expect(rubricScoresFromSuggestion(rubrica, [{ id: "c1", score: 2 }, "basura", null, { id: "c2", score: 1 }]))
      .toEqual({ c1: 2, c2: 1 });
  });

  it("recorta un puntaje que se pase del maximo del criterio", () => {
    expect(rubricScoresFromSuggestion(rubrica, [{ id: "c1", score: 9 }, { id: "c2", score: -3 }]))
      .toEqual({ c1: 2, c2: 0 });
  });
});
