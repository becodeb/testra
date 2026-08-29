import { describe, expect, it } from "vitest";

import { clipboardCharacterCount, clockGap, isDuplicateClipboardIncident, isWindowPresenceEvent, nextPresence, supervisionTampering, type Absence, type PresenceSignal } from "@/hooks/use-exam-monitoring";

/** Reproduce una secuencia de eventos y devuelve las ausencias cerradas. */
function replay(signals: ReadonlyArray<[PresenceSignal, number]>) {
  let absence: Absence | null = null;
  const returned: Absence[] = [];
  for (const [signal, at] of signals) {
    const step = nextPresence(absence, signal, at);
    absence = step.absence;
    if (step.returned) returned.push(step.returned);
  }
  return { absence, returned };
}

describe("presence monitoring", () => {
  it("opens the absence on blur alone, without consulting the DOM", () => {
    // El caso de macOS: Cmd+Tab dispara `blur` y nada mas, porque la ventana
    // ocluida ni marca `hidden` ni actualiza `hasFocus()` a tiempo.
    const { returned } = replay([["blur", 1_000], ["focus", 4_000]]);
    expect(returned).toHaveLength(1);
    expect(returned[0].startedAt).toBe(1_000);
    expect(returned[0].sawHidden).toBe(false);
  });

  it("classifies a real tab switch as hidden even though blur arrives first", () => {
    const { returned } = replay([["blur", 1_000], ["hidden", 1_010], ["visible", 5_000], ["focus", 5_010]]);
    expect(returned).toHaveLength(1);
    expect(returned[0].sawHidden).toBe(true);
    expect(returned[0].startedAt).toBe(1_000);
  });

  it("does not reopen or double-report while the student is already away", () => {
    const { returned, absence } = replay([["blur", 1_000], ["hidden", 1_010], ["blur", 1_020]]);
    expect(returned).toHaveLength(0);
    expect(absence).toEqual({ startedAt: 1_000, sawHidden: true });
  });

  it("ignores a return that was never preceded by an absence", () => {
    expect(replay([["focus", 1_000], ["visible", 1_000]]).returned).toHaveLength(0);
  });
});

describe("clipboard monitoring", () => {
  it("uses the page selection for copy without retaining its contents", () => {
    expect(clipboardCharacterCount({ type: "copy" }, "texto elegido")).toBe(13);
  });

  it("uses clipboard data for paste and reports inaccessible lengths as unknown", () => {
    expect(clipboardCharacterCount({ type: "paste", clipboardData: { getData: () => "abc" } })).toBe(3);
    expect(clipboardCharacterCount({ type: "paste", clipboardData: { getData: () => "" } })).toBeNull();
    expect(clipboardCharacterCount({ type: "copy" }, "")).toBeNull();
  });

  it("deduplicates the same real clipboard event burst", () => {
    const previous = { action: "copy", characters: 4, questionId: "q1", at: 1_000 };
    expect(isDuplicateClipboardIncident(previous, { ...previous, at: 1_300 })).toBe(true);
    expect(isDuplicateClipboardIncident(previous, { ...previous, action: "paste", at: 1_300 })).toBe(false);
    expect(isDuplicateClipboardIncident(previous, { ...previous, questionId: "q2", at: 1_300 })).toBe(false);
    expect(isDuplicateClipboardIncident(previous, { ...previous, at: 2_000 })).toBe(false);
  });
});

// El getter de `Map.prototype.size` y `Math.max` sirven de funciones nativas de
// verdad: lo unico que mira el detector es si `toString` dice `[native code]`.
const getterNativo = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;

function navegadorLimpio() {
  const docProto: Record<string, unknown> = { hasFocus: Math.max, addEventListener: Math.max, onvisibilitychange: null };
  Object.defineProperty(docProto, "visibilityState", { get: getterNativo, configurable: true });
  Object.defineProperty(docProto, "hidden", { get: getterNativo, configurable: true });
  const winProto: Record<string, unknown> = { onblur: null };
  return { doc: Object.create(docProto) as object, win: Object.create(winProto) as object };
}

describe("supervisionTampering", () => {
  it("no marca nada en un navegador sin tocar", () => {
    const { doc, win } = navegadorLimpio();
    expect(supervisionTampering(doc, win)).toEqual([]);
  });

  // Este es, literalmente, el script que circula para saltarse la supervision.
  it("marca el script de consola que anula la deteccion de foco", () => {
    const { doc, win } = navegadorLimpio();
    Object.defineProperty(doc, "visibilityState", { get: () => "visible", configurable: true });
    Object.defineProperty(doc, "hidden", { get: () => false, configurable: true });
    (doc as { hasFocus: unknown }).hasFocus = () => true;
    Object.defineProperty(win, "onblur", { set: () => {}, get: () => null, configurable: true });
    expect(supervisionTampering(doc, win)).toEqual(["hasFocus", "visibilityState", "hidden", "onblur"]);
  });

  it("marca que pisaron addEventListener, que es el ataque de fondo", () => {
    const { doc, win } = navegadorLimpio();
    (doc as { addEventListener: unknown }).addEventListener = () => {};
    expect(supervisionTampering(doc, win)).toEqual(["addEventListener"]);
  });
});

describe("clockGap", () => {
  it("ignora la deriva normal de un temporizador", () => {
    expect(clockGap(2_100, 2_000)).toBeNull();
  });

  it("descubre la pestana tapada aunque ningun evento haya avisado", () => {
    expect(clockGap(30_000, 2_000)).toBe(28_000);
  });
});

describe("isWindowPresenceEvent", () => {
  const win = { name: "window" };

  it("acepta el foco de la ventana entera, que es la unica presencia real", () => {
    expect(isWindowPresenceEvent({ target: win }, win)).toBe(true);
  });

  it("descarta el foco de un campo de la evaluacion", () => {
    // Los oyentes estan en fase de captura sobre `window`, asi que los eventos
    // de cada input llegan igual aunque `focus` y `blur` no burbujeen.
    expect(isWindowPresenceEvent({ target: { tag: "TEXTAREA" } }, win)).toBe(false);
  });
});

describe("presencia con el filtro de ventana puesto", () => {
  /** Replica el cableado real: capture sobre `window` + filtro + nextPresence. */
  function replayWithTargets(events: ReadonlyArray<[PresenceSignal, number, unknown]>, win: unknown) {
    let absence: Absence | null = null;
    const emitted: Array<{ durationMs: number; sawHidden: boolean }> = [];
    for (const [signal, at, target] of events) {
      if ((signal === "blur" || signal === "focus") && !isWindowPresenceEvent({ target }, win)) continue;
      const step = nextPresence(absence, signal, at);
      absence = step.absence;
      if (step.returned) emitted.push({ durationMs: at - step.returned.startedAt, sawHidden: step.returned.sawHidden });
    }
    return emitted;
  }

  const win = { name: "window" };
  const campo = { tag: "TEXTAREA" };
  const otroCampo = { tag: "INPUT" };

  it("pasar de una pregunta a otra ya no inventa un incidente de 0 segundos", () => {
    // Era el sintoma que se veia en Windows: cada clic entre campos abria y
    // cerraba una ausencia en el mismo gesto.
    expect(replayWithTargets([
      ["blur", 1_000, campo],
      ["focus", 1_010, otroCampo],
    ], win)).toEqual([]);
  });

  it("escribir mientras se esta afuera no acorta la ausencia real", () => {
    // macOS: Cmd+Tab deja la ventana sin foco; al volver el navegador le
    // devuelve el foco al campo, y ese evento no debe cerrar nada por su cuenta.
    expect(replayWithTargets([
      ["blur", 0, win],
      ["focus", 5_000, campo],
      ["focus", 5_001, win],
    ], win)).toEqual([{ durationMs: 5_001, sawHidden: false }]);
  });

  it("el cambio de pestana sigue registrandose con su duracion", () => {
    expect(replayWithTargets([
      ["blur", 0, win],
      ["hidden", 5, win],
      ["visible", 8_000, win],
    ], win)).toEqual([{ durationMs: 8_000, sawHidden: true }]);
  });
});
