import { describe, expect, it } from "vitest";

import { clipboardDetail } from "@/lib/incident-copy";

describe("clipboardDetail", () => {
  it("dice qué hizo y cuánto, que es lo único que Testra guarda", () => {
    expect(clipboardDetail({ action: "copy", characters: 240 })).toBe("Copió 240 caracteres.");
    expect(clipboardDetail({ action: "paste", characters: 12 })).toBe("Pegó 12 caracteres.");
  });

  it("distingue el atajo detectado por teclado, donde no hay cantidad", () => {
    // El navegador no dispara el evento de portapapeles si no había nada
    // seleccionado: se registra el gesto, no un tamaño inventado.
    expect(clipboardDetail({ action: "copiar", deteccion: "atajo", characters: null }))
      .toBe("Copió con el teclado; el navegador no informó cuánto.");
  });

  it("no inventa nada cuando no hay datos", () => {
    expect(clipboardDetail(undefined)).toBe("");
    expect(clipboardDetail({})).toBe("");
    expect(clipboardDetail({ action: "copy" })).toBe("Copió, sin cantidad disponible.");
  });
});
