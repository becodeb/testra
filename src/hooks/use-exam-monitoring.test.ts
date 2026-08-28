import { describe, expect, it } from "vitest";

import { clipboardCharacterCount, isDuplicateClipboardIncident, nextPresence, type Absence, type PresenceSignal } from "@/hooks/use-exam-monitoring";

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
