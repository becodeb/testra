import { describe, expect, it } from "vitest";

import { clipboardCharacterCount, isDuplicateClipboardIncident } from "@/hooks/use-exam-monitoring";

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
