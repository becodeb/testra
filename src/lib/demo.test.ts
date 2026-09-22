import { describe, expect, it } from "vitest";

import type { FullQuestion } from "@/domain/exam";
import { parsePastedExam } from "@/domain/exam-import";
import type { ClientIncident } from "@/hooks/use-exam-monitoring";
import {
  answeredCount,
  challengeProgress,
  DEMO_CODE,
  DEMO_IMPORT_TEXT,
  demoGrade,
  examReadiness,
  formatClock,
  formatCountdown,
  formatElapsed,
  formatPoints,
  remainingSeconds,
  supervisionSettings,
  teacherIncidentLabel,
  toDemoIncident,
  toReportIncidents,
  type DemoIncident,
} from "@/lib/demo";
import { createRunCode, RUN_CODE_ALPHABET } from "@/server/run-code";

/** La evaluación de la demo con las claves que marca el visitante: 1B, 2C, 3A. */
function demoExam(): FullQuestion[] {
  const keys = [1, 2, 0];
  return parsePastedExam(DEMO_IMPORT_TEXT).map((question, index) =>
    question.type === "mc" ? { ...question, config: { ...question.config, correctOptionId: question.config.options[keys[index]].id } } : question,
  );
}

function option(questions: FullQuestion[], index: number, optionIndex: number): string {
  const question = questions[index];
  if (question.type !== "mc") throw new Error("se esperaba opción única");
  return question.config.options[optionIndex].id;
}

function incident(type: string, meta: Record<string, unknown> = {}, durationMs = 0, at = 1_000): ClientIncident {
  return { type: type as ClientIncident["type"], at, durationMs, meta };
}

describe("DEMO_IMPORT_TEXT", () => {
  it("se convierte con el parser real en tres de opción única y una de desarrollo", () => {
    const questions = parsePastedExam(DEMO_IMPORT_TEXT);
    expect(questions.map((question) => question.type)).toEqual(["mc", "mc", "mc", "long"]);
    const [first] = questions;
    if (first.type !== "mc") throw new Error("se esperaba opción única");
    expect(first.prompt).toBe("Si cambiás de pestaña durante la evaluación, ¿qué ve tu docente?");
    expect(first.config.options.map((item) => item.text)).toEqual([
      "Nada, no se entera",
      "Un aviso con cuánto tiempo estuviste afuera",
      "Una captura de la otra pestaña",
    ]);
  });
});

describe("DEMO_CODE", () => {
  it("nunca puede coincidir con una sala real", () => {
    expect(DEMO_CODE).toHaveLength(6);
    // O, 0 y 1 quedan afuera del alfabeto de los códigos reales.
    const outside = [...DEMO_CODE].filter((character) => !RUN_CODE_ALPHABET.includes(character));
    expect(outside).toEqual(["O", "0", "1"]);
    for (let seed = 0; seed < 256; seed += 1) {
      expect(createRunCode(6, (bytes) => bytes.fill(seed))).not.toBe(DEMO_CODE);
    }
  });
});

describe("supervisionSettings", () => {
  it("repite los presets del editor", () => {
    expect(supervisionSettings("normal")).toEqual({ detectFocusLoss: true, requireFullscreen: false, blockClipboard: false, violationAction: "warn_and_record" });
    expect(supervisionSettings("strict")).toEqual({ detectFocusLoss: true, requireFullscreen: true, blockClipboard: true, violationAction: "warn_and_record" });
  });
});

describe("examReadiness", () => {
  it("no deja abrir la sala mientras falte alguna clave", () => {
    const readiness = examReadiness("Qué ve tu docente", parsePastedExam(DEMO_IMPORT_TEXT));
    expect(readiness).toEqual({ titleOk: true, incomplete: 0, missingKeys: 3, valid: false });
  });

  it("queda lista con todas las claves y un título", () => {
    expect(examReadiness("Qué ve tu docente", demoExam()).valid).toBe(true);
  });

  it("pide un título de al menos tres caracteres, como el editor", () => {
    expect(examReadiness("  ab ", demoExam())).toMatchObject({ titleOk: false, valid: false });
  });

  it("no da por lista una evaluación sin preguntas", () => {
    expect(examReadiness("Qué ve tu docente", []).valid).toBe(false);
  });

  it("cuenta como incompleta la pregunta que quedó sin enunciado", () => {
    // "2)" solo en la primera línea deja el enunciado vacío.
    const readiness = examReadiness("Qué ve tu docente", parsePastedExam("2)\nA) Sí\nB) No"));
    expect(readiness.incomplete).toBe(1);
    expect(readiness.valid).toBe(false);
  });
});

describe("toDemoIncident", () => {
  it("toma la pregunta activa que el hook deja en meta", () => {
    const demo = toDemoIncident(incident("atajo-f12", { questionId: "q-2" }), "i-1", 5_000);
    expect(demo).toMatchObject({ id: "i-1", questionId: "q-2", receivedAt: 5_000, type: "atajo-f12" });
    expect(toDemoIncident(incident("atajo-f12"), "i-2", 5_000).questionId).toBeNull();
  });
});

describe("challengeProgress", () => {
  const normal = { strict: false, coarsePointer: false, fullscreenAvailable: true };

  it("muestra cuatro pruebas en supervisión normal y ninguna hecha al empezar", () => {
    const { items, allDone } = challengeProgress([], normal);
    expect(items.map((item) => item.label)).toEqual(["Cambiá de pestaña y volvé", "Copiá un texto", "Pegá en una respuesta", "Apretá F12"]);
    expect(items.every((item) => !item.done)).toBe(true);
    expect(allDone).toBe(false);
  });

  it("suma la salida de pantalla completa solo en la estricta, y solo si existe", () => {
    expect(challengeProgress([], { ...normal, strict: true }).items.map((item) => item.id)).toContain("pantalla-completa");
    expect(challengeProgress([], { ...normal, strict: true, fullscreenAvailable: false }).items.map((item) => item.id)).not.toContain("pantalla-completa");
  });

  it("esconde F12 en pantallas táctiles", () => {
    expect(challengeProgress([], { ...normal, coarsePointer: true }).items.map((item) => item.id)).toEqual(["salir", "copiar", "pegar"]);
  });

  it("marca cada prueba con el incidente real que le corresponde", () => {
    const done = (incidents: ClientIncident[]) =>
      challengeProgress(incidents, normal).items.filter((item) => item.done).map((item) => item.id);
    expect(done([incident("ventana-sin-foco", {}, 1_200)])).toEqual(["salir"]);
    expect(done([incident("cambio-de-pestana", {}, 3_000)])).toEqual(["salir"]);
    expect(done([incident("atajo-copiar-pegar", { action: "copy", characters: 12 })])).toEqual(["copiar"]);
    expect(done([incident("atajo-copiar-pegar", { action: "cortar", characters: null, deteccion: "atajo" })])).toEqual(["copiar"]);
    expect(done([incident("atajo-copiar-pegar", { action: "pegar", characters: null, deteccion: "atajo" })])).toEqual(["pegar"]);
    expect(done([incident("atajo-copiar-pegar", { action: "paste", characters: 5 })])).toEqual(["pegar"]);
    expect(done([incident("atajo-f12")])).toEqual(["f12"]);
    // Manipular la supervisión es real, pero no es ninguna de las pruebas.
    expect(done([incident("manipulacion-de-supervision", { signals: ["hasFocus"] })])).toEqual([]);
  });

  it("da todo por hecho cuando cada prueba visible tiene su incidente", () => {
    const incidents = [
      incident("ventana-sin-foco", {}, 900),
      incident("atajo-copiar-pegar", { action: "copy", characters: 40 }),
      incident("atajo-copiar-pegar", { action: "paste", characters: 12 }),
    ];
    expect(challengeProgress(incidents, normal).allDone).toBe(false);
    expect(challengeProgress([...incidents, incident("atajo-f12")], normal).allDone).toBe(true);
    expect(challengeProgress(incidents, { ...normal, coarsePointer: true }).allDone).toBe(true);
  });
});

describe("toReportIncidents", () => {
  const questions = demoExam();

  it("resuelve número y enunciado de la pregunta, y ordena por hora", () => {
    const demo: DemoIncident[] = [
      toDemoIncident(incident("atajo-copiar-pegar", { action: "paste", characters: 12, questionId: questions[3].id }, 0, 9_000), "b", 9_000),
      toDemoIncident(incident("ventana-sin-foco", { questionId: questions[0].id }, 1_200, 2_000), "a", 3_200),
    ];
    const report = toReportIncidents(demo, questions);
    expect(report.map((item) => item.id)).toEqual(["a", "b"]);
    expect(report[0]).toMatchObject({ questionNumber: 1, questionPrompt: questions[0].prompt, duration_ms: 1_200, source: "client", type: "ventana-sin-foco" });
    expect(report[1]).toMatchObject({ questionNumber: 4, questionPrompt: questions[3].prompt });
    expect(report[1].meta).toMatchObject({ action: "paste", characters: 12 });
  });

  it("deja sin pregunta lo que no se puede ubicar", () => {
    const [item] = toReportIncidents([toDemoIncident(incident("atajo-f12", { questionId: "otra" }), "c", 1)], questions);
    expect(item.questionNumber).toBeNull();
    expect(item.questionPrompt).toBeNull();
  });
});

describe("teacherIncidentLabel", () => {
  it("arma la misma línea que el panel de la sala en vivo", () => {
    expect(teacherIncidentLabel(incident("ventana-sin-foco", {}, 1_250))).toBe("Otra ventana tomó el control (1,3 s)");
    expect(teacherIncidentLabel(incident("atajo-copiar-pegar", { action: "copy", characters: 64 })))
      .toBe("Se usó copiar, cortar o pegar · Copió 64 caracteres.");
    expect(teacherIncidentLabel(incident("atajo-f12"))).toBe("Se presionó la tecla F12");
  });
});

describe("answeredCount", () => {
  it("cuenta solo las respuestas con algo escrito", () => {
    const questions = demoExam();
    expect(answeredCount(questions, {})).toBe(0);
    expect(answeredCount(questions, { [questions[0].id]: option(questions, 0, 1), [questions[3].id]: "   " })).toBe(1);
    expect(answeredCount(questions, { [questions[3].id]: "Hablaría con el alumno." })).toBe(1);
  });
});

describe("demoGrade", () => {
  const questions = demoExam();
  const perfect = {
    [questions[0].id]: option(questions, 0, 1),
    [questions[1].id]: option(questions, 1, 2),
    [questions[2].id]: option(questions, 2, 0),
    [questions[3].id]: "Primero miraría el contexto y hablaría con el alumno.",
  };

  it("corrige solas las cerradas y deja pendiente el desarrollo", () => {
    const grade = demoGrade(questions, perfect, {});
    expect(grade).toMatchObject({ awardedPoints: 3, maxPoints: 4, pendingManualPoints: 1, percent: 75 });
    expect(grade.questions[3]).toMatchObject({ auto: null, pointsAwarded: null });
  });

  it("suma el puntaje manual y cierra la nota", () => {
    expect(demoGrade(questions, perfect, { [questions[3].id]: 1 })).toMatchObject({ awardedPoints: 4, pendingManualPoints: 0, percent: 100 });
    expect(demoGrade(questions, perfect, { [questions[3].id]: 0 })).toMatchObject({ awardedPoints: 3, pendingManualPoints: 0, percent: 75 });
  });

  it("no deja que el puntaje manual se pase del máximo ni baje de cero", () => {
    expect(demoGrade(questions, perfect, { [questions[3].id]: 5 }).awardedPoints).toBe(4);
    expect(demoGrade(questions, perfect, { [questions[3].id]: -2 }).awardedPoints).toBe(3);
  });

  it("no le da puntos a una cerrada ni a una respuesta equivocada", () => {
    const grade = demoGrade(questions, { [questions[0].id]: option(questions, 0, 0) }, {});
    expect(grade.awardedPoints).toBe(0);
    expect(grade.questions.slice(0, 3).map((item) => item.auto)).toEqual([false, false, false]);
    expect(grade.percent).toBe(0);
  });

  it("ignora un puntaje manual sobre una pregunta que se corrige sola", () => {
    expect(demoGrade(questions, {}, { [questions[0].id]: 1 }).awardedPoints).toBe(0);
  });
});

describe("formatos", () => {
  it("muestra el reloj de la evaluación como el producto", () => {
    expect(formatCountdown(300)).toBe("05:00");
    expect(formatCountdown(59)).toBe("00:59");
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(-4)).toBe("00:00");
    expect(formatCountdown(3_661)).toBe("01:01:01");
  });

  it("muestra el tiempo transcurrido como m:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(59_999)).toBe("0:59");
    expect(formatElapsed(61_000)).toBe("1:01");
    expect(formatElapsed(165_000)).toBe("2:45");
    expect(formatElapsed(600_000)).toBe("10:00");
    expect(formatElapsed(-1)).toBe("0:00");
  });

  it("calcula los segundos que quedan sin bajar de cero", () => {
    expect(remainingSeconds(301_000, 1_000)).toBe(300);
    expect(remainingSeconds(10_500, 10_000)).toBe(1);
    expect(remainingSeconds(10_000, 12_000)).toBe(0);
  });

  it("da la hora con segundos y los puntos sin decimales de más", () => {
    // Según los datos de ICU del entorno, es-AR puede agregar "p. m.": lo que
    // importa es que tenga los segundos, como la "Última señal" del producto.
    expect(formatClock(Date.UTC(2026, 8, 22, 15, 4, 5))).toMatch(/^\d{2}:04:05/);
    expect(formatPoints(3)).toBe("3");
    expect(formatPoints(2.5)).toBe("2,5");
  });
});
