import { describe, expect, it } from "vitest";

import { canonicalizeSimilarityInput, hashSimilarityInput } from "@/server/similarity-reports";
import type { ParticipantEntry, SimilarityClassInput, SimilarityQuestion } from "@/server/similarity-signals";

// --- Fixtures ----------------------------------------------------------------

function question(id: string, prompt = `Consigna ${id}`): SimilarityQuestion {
  return { id, label: prompt, type: "long", prompt, expectedText: "Respuesta esperada" };
}

function participant(id: string, name: string, questionId: string, text: string): ParticipantEntry {
  return { participantId: id, name, responses: new Map([[questionId, { kind: "long", text }]]) };
}

function baseInput(): SimilarityClassInput {
  return {
    questions: [question("q1"), question("q2")],
    participants: [
      participant("p1", "Ana López", "q1", "Una respuesta cualquiera de Ana."),
      participant("p2", "Beto Ruiz", "q1", "Una respuesta cualquiera de Beto."),
    ],
  };
}

describe("canonicalizeSimilarityInput", () => {
  it("ordena preguntas y participantes por id, sin importar el orden de entrada", () => {
    const input = baseInput();
    const reversed: SimilarityClassInput = { questions: [...input.questions].reverse(), participants: [...input.participants].reverse() };

    expect(canonicalizeSimilarityInput(input)).toEqual(canonicalizeSimilarityInput(reversed));
  });

  it("no incluye el nombre del participante", () => {
    const input = baseInput();
    const canonical = canonicalizeSimilarityInput(input);

    expect(JSON.stringify(canonical)).not.toContain("Ana López");
    expect(JSON.stringify(canonical)).not.toContain("Beto Ruiz");
    expect(canonical.participants.map((p) => p.participantId).sort()).toEqual(["p1", "p2"]);
  });
});

describe("hashSimilarityInput", () => {
  it("es independiente del orden de preguntas y participantes", async () => {
    const input = baseInput();
    const reversed: SimilarityClassInput = { questions: [...input.questions].reverse(), participants: [...input.participants].reverse() };

    expect(await hashSimilarityInput(input)).toBe(await hashSimilarityInput(reversed));
  });

  it("no cambia si solo cambia el nombre de un participante", async () => {
    const input = baseInput();
    const renamed: SimilarityClassInput = {
      questions: input.questions,
      participants: [participant("p1", "Otro Nombre", "q1", "Una respuesta cualquiera de Ana."), input.participants[1]],
    };

    expect(await hashSimilarityInput(input)).toBe(await hashSimilarityInput(renamed));
  });

  it("cambia si cambia una respuesta", async () => {
    const input = baseInput();
    const edited: SimilarityClassInput = {
      questions: input.questions,
      participants: [participant("p1", "Ana López", "q1", "Una respuesta DISTINTA de Ana."), input.participants[1]],
    };

    expect(await hashSimilarityInput(input)).not.toBe(await hashSimilarityInput(edited));
  });

  it("cambia si cambia la consigna o la respuesta esperada de una pregunta", async () => {
    const input = baseInput();
    const editedPrompt: SimilarityClassInput = { questions: [question("q1", "Consigna nueva"), input.questions[1]], participants: input.participants };

    expect(await hashSimilarityInput(input)).not.toBe(await hashSimilarityInput(editedPrompt));
  });
});
