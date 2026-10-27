import { describe, expect, it } from "vitest";

import {
  attemptMinutes,
  formatPoints,
  gradedByLabel,
  hasFinished,
  printAllSubject,
  printBlockedReason,
  printoutUrl,
  scoreTone,
  submitReasonLabel,
} from "@/lib/exam-printout";

describe("printoutUrl", () => {
  it("arma la hoja de un alumno sin avisos", () => {
    expect(printoutUrl({ runId: "run-1", participantId: "p-1", includeIncidents: false })).toBe(
      "/resultados/imprimir?run=run-1&alumno=p-1",
    );
  });

  it("pide los avisos y la impresión automática solo cuando se eligen", () => {
    const url = new URL(printoutUrl({ runId: "run 1", includeIncidents: true, autoPrint: true }), "http://x");
    expect(url.searchParams.get("run")).toBe("run 1");
    expect(url.searchParams.has("alumno")).toBe(false);
    expect(url.searchParams.get("incidentes")).toBe("si");
    expect(url.searchParams.get("imprimir")).toBe("1");
  });
});

describe("scoreTone", () => {
  it("distingue completo, parcial, cero y sin corregir", () => {
    expect(scoreTone(2, 2)).toBe("full");
    expect(scoreTone(0.5, 2)).toBe("partial");
    expect(scoreTone(0, 2)).toBe("none");
    expect(scoreTone(null, 2)).toBe("pending");
  });
});

describe("rótulos", () => {
  it("escribe los medios puntos con coma", () => {
    expect(formatPoints(1.5)).toBe("1,5");
    expect(formatPoints(10)).toBe("10");
  });

  it("solo considera terminados a quienes entregaron o vencieron", () => {
    expect(hasFinished("submitted")).toBe(true);
    expect(hasFinished("expired")).toBe(true);
    expect(hasFinished("active")).toBe(false);
    expect(hasFinished("waiting")).toBe(false);
  });

  it("habilita la hoja de un alumno solo cuando entregó y está corregido", () => {
    expect(printBlockedReason("active", 0)).toBe("Se habilita cuando el alumno entregue");
    expect(printBlockedReason("submitted", 2)).toBe("Se habilita cuando termines de corregir este examen");
    expect(printBlockedReason("submitted", 0)).toBeNull();
    expect(printBlockedReason("expired", 0)).toBeNull();
  });

  it("nombra a quiénes se imprime sin decir \"los 1 alumno\"", () => {
    expect(printAllSubject(1)).toBe("todos los que entregaron (1 alumno)");
    expect(printAllSubject(24)).toBe("los 24 alumnos que entregaron, uno por hoja");
  });

  it("explica cómo se cerró la entrega", () => {
    expect(submitReasonLabel("manual", "submitted")).toBe("La entregó el alumno");
    expect(submitReasonLabel("timer", "submitted")).toBe("Se terminó el tiempo");
    expect(submitReasonLabel("teacher", "submitted")).toBe("La cerró el docente");
    expect(submitReasonLabel(null, "expired")).toBe("Venció el plazo");
  });

  it("no da por corregida una respuesta pendiente aunque tenga sugerencia de IA", () => {
    expect(gradedByLabel("ai", "ai_suggested")).toBe("Sin corregir");
    expect(gradedByLabel("teacher", "graded")).toBe("Corregida por el docente");
    expect(gradedByLabel("auto", "auto_graded")).toBe("Corrección automática");
  });

  it("redondea la duración en minutos", () => {
    expect(attemptMinutes(0, 1000)).toBe("—");
    expect(attemptMinutes(1_000, 1_000 + 29 * 60_000 + 40_000)).toBe("30 min");
  });
});
