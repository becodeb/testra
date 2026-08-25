import { describe, expect, it } from "vitest";

import type { FullQuestion } from "@/domain/exam";
import { materializeQuestionVariants } from "@/server/ai-variants";

const original: FullQuestion = {
  id: "original",
  position: 2,
  type: "mc",
  prompt: "¿Cuánto es 2 + 2?",
  points: 1,
  section: "Cálculo",
  difficulty: "easy",
  config: { options: [{ id: "a", text: "3" }, { id: "b", text: "4" }], correctOptionId: "b" },
};

describe("AI question variants", () => {
  it("materializes validated proposals without mutating or inserting the original", () => {
    const before = structuredClone(original);
    const variants = materializeQuestionVariants(original, {
      variants: [3, 4, 5].map((value) => ({
        prompt: `¿Cuánto es ${value} + ${value}?`,
        config: { options: [{ id: "a", text: String(value * 2 - 1) }, { id: "b", text: String(value * 2) }], correctOptionId: "b" },
      })),
    });

    expect(original).toEqual(before);
    expect(variants).toHaveLength(3);
    expect(variants.every((variant) => variant.id !== original.id)).toBe(true);
    expect(variants.every((variant) => variant.section === "Cálculo" && variant.difficulty === "easy")).toBe(true);
  });

  it("rejects malformed or type-incompatible model output", () => {
    expect(() => materializeQuestionVariants(original, { variants: [{ prompt: "Una", config: {} }] })).toThrow();
    expect(() => materializeQuestionVariants(original, {
      variants: [1, 2, 3].map((index) => ({ prompt: `Variante ${index}`, config: { options: [], correctOptionId: "missing" } })),
    })).toThrow();
  });
});
