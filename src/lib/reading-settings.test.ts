import { describe, expect, it } from "vitest";

import {
  WCAG_MINIMO,
  defaultReadingSettings,
  isAdjusted,
  optionFor,
  parseReadingSettings,
  readingScales,
  readingStyle,
} from "@/lib/reading-settings";

describe("ajustes de lectura", () => {
  it("arranca sin cambiar nada de cómo se veía la evaluación", () => {
    const style = readingStyle(defaultReadingSettings);
    expect(style["--lectura-escala"]).toBe("1");
    expect(style["--lectura-letras"]).toBe("0em");
    expect(style["--lectura-palabras"]).toBe("0em");
    expect(isAdjusted(defaultReadingSettings)).toBe(false);
  });

  it("nunca deja el interlineado por debajo del piso de WCAG 1.4.12", () => {
    // Ninguna opción actual baja de ahí; el tope existe para que agregar una
    // opción nueva no pueda romper el criterio sin que nadie se entere.
    for (const option of readingScales.interlineado) {
      const style = readingStyle({ ...defaultReadingSettings, interlineado: option.id });
      expect(Number(style["--lectura-interlineado"])).toBeGreaterThanOrEqual(WCAG_MINIMO.interlineado);
    }
  });

  it("la separación entre letras ofrece el mínimo de WCAG y el valor con respaldo experimental", () => {
    // 0.12em es el piso del criterio; 0.18em es del orden de los 2,5 pt que
    // midió Zorzi (PNAS, 2012), donde los chicos leyeron 20% más rápido.
    const valores = readingScales.letras.map((option) => option.value);
    expect(valores).toContain(WCAG_MINIMO.letras);
    expect(Math.max(...valores)).toBeGreaterThan(WCAG_MINIMO.letras);
  });

  it("no ofrece ninguna fuente especial para dislexia", () => {
    // Un metaanálisis de 15 estudios (N = 688) no encontró efecto, y una fuente
    // que no ayuda ocupando el lugar del espaciado, que sí ayuda, es peor que
    // no ofrecer nada.
    expect(Object.keys(readingScales)).not.toContain("fuente");
  });

  it("recupera lo guardado y descarta lo que ya no existe", () => {
    expect(parseReadingSettings('{"texto":"grande","letras":"separadas"}')).toEqual({
      ...defaultReadingSettings,
      texto: "grande",
      letras: "separadas",
    });
    expect(parseReadingSettings('{"texto":"gigante"}')).toEqual(defaultReadingSettings);
  });

  it("aguanta lo que venga del almacenamiento sin romper la evaluación", () => {
    for (const entrada of ["", "no es json", "null", "[]", "42", null, undefined, { texto: 7 }]) {
      expect(parseReadingSettings(entrada)).toEqual(defaultReadingSettings);
    }
  });

  it("un id desconocido cae en la primera opción, que es la neutra", () => {
    expect(optionFor("texto", "inventado")).toBe(readingScales.texto[0]);
  });

  it("marca que hay ajustes puestos para poder avisarlo en el botón", () => {
    expect(isAdjusted({ ...defaultReadingSettings, fondo: "crema" })).toBe(true);
  });
});
