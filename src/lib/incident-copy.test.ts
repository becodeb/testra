import { describe, expect, it } from "vitest";

import { clipboardDetail, studentIncidentMessage } from "@/lib/incident-copy";

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

  it("no confunde una acción desconocida con una propiedad heredada", () => {
    expect(clipboardDetail({ action: "toString", characters: 3 })).toBe("3 caracteres.");
  });
});

describe("studentIncidentMessage", () => {
  const clipboard = (meta: Record<string, unknown>) => ({ type: "atajo-copiar-pegar", durationMs: 0, meta });

  it("nombra la acción con las dos formas en que llega", () => {
    expect(studentIncidentMessage(clipboard({ action: "copy", characters: 42 })))
      .toBe("Usaste copiar (42 caracteres). Testra no guarda el contenido.");
    expect(studentIncidentMessage(clipboard({ action: "cut", characters: 5 })))
      .toBe("Usaste cortar (5 caracteres). Testra no guarda el contenido.");
    expect(studentIncidentMessage(clipboard({ action: "paste", characters: 12 })))
      .toBe("Usaste pegar (12 caracteres). Testra no guarda el contenido.");
  });

  it("le da su verbo al atajo de teclado, que llega en castellano y sin cantidad", () => {
    // Antes caía en "Usaste el portapapeles": el docente leía "Copió con el
    // teclado" y el alumno, sobre el mismo registro, algo más vago.
    expect(studentIncidentMessage(clipboard({ action: "copiar", characters: null, deteccion: "atajo" })))
      .toBe("Usaste copiar (cantidad no disponible). Testra no guarda el contenido.");
    expect(studentIncidentMessage(clipboard({ action: "cortar", characters: null, deteccion: "atajo" })))
      .toBe("Usaste cortar (cantidad no disponible). Testra no guarda el contenido.");
    expect(studentIncidentMessage(clipboard({ action: "pegar", characters: null, deteccion: "atajo" })))
      .toBe("Usaste pegar (cantidad no disponible). Testra no guarda el contenido.");
  });

  it("conserva el genérico cuando la acción no se reconoce", () => {
    expect(studentIncidentMessage(clipboard({ characters: null })))
      .toBe("Usaste el portapapeles (cantidad no disponible). Testra no guarda el contenido.");
  });

  it("informa cuánto tiempo estuvo afuera, con un decimal", () => {
    expect(studentIncidentMessage({ type: "cambio-de-pestana", durationMs: 4_250, meta: {} }))
      .toBe("Estuviste fuera de la ventana 4,3 s.");
    expect(studentIncidentMessage({ type: "ventana-sin-foco", durationMs: 1_000, meta: {} }))
      .toBe("Estuviste fuera de la ventana 1 s.");
  });

  it("explica la salida de pantalla completa, F12 y la manipulación", () => {
    expect(studentIncidentMessage({ type: "salida-pantalla-completa", durationMs: 0, meta: {} }))
      .toBe("Saliste de pantalla completa.");
    expect(studentIncidentMessage({ type: "atajo-f12", durationMs: 0, meta: {} }))
      .toBe("Se detectó el uso de F12. Testra lo registra; no pretende bloquear las herramientas del navegador.");
    expect(studentIncidentMessage({ type: "manipulacion-de-supervision", durationMs: 0, meta: { signals: ["hasFocus"] } }))
      .toBe("Se detectó que se modificaron funciones del navegador que usa la supervisión. Quedó registrado.");
  });
});
