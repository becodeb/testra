import { describe, expect, it, vi } from "vitest";

import { JevError, type JevEvaluateRequest, type JevResult } from "@/server/jev-client";
import type { ParticipantEntry, ParticipantResponse, SimilarityClassInput, SimilarityQuestion } from "@/server/similarity-signals";
import { analyzeSimilarity, type JevEvaluator } from "@/server/similarity-analysis";

// --- Fixtures compartidas ----------------------------------------------------

function longText(tag: string): string {
  return `Este es un texto de práctica para el alumno ${tag} con más de doce palabras distintas para pasar el piso de elegibilidad exigido aquí mismo.`;
}

function longQuestion(id: string, prompt = "Explicá el tema con tus palabras."): SimilarityQuestion {
  return { id, label: prompt, type: "long", prompt, expectedText: "" };
}

function longParticipant(id: string, tag: string, questionId: string): ParticipantEntry {
  return { participantId: id, name: `Alumno ${id}`, responses: new Map([[questionId, { kind: "long", text: longText(tag) }]]) };
}

/** Extrae el "tag" de cada alumno del estado que le llegó a Jev, para poder controlar la respuesta fake por par. */
function tagsOf(request: JevEvaluateRequest): [string, string] {
  const state = request.state as Record<string, string>;
  const extract = (text: string) => text.match(/alumno (\S+)/)?.[1] ?? "";
  return [extract(state.respuesta_1 ?? ""), extract(state.respuesta_2 ?? "")];
}

function jevResult(sharedDistinctiveWording: number, sameMistake: number, rewordedCopy: number): JevResult {
  return {
    answers: {
      shared_distinctive_wording: { type: "boolean", probability: sharedDistinctiveWording },
      same_mistake: { type: "boolean", probability: sameMistake },
      reworded_copy: { type: "boolean", probability: rewordedCopy },
    },
    usage: null,
    costUsd: null,
  };
}

describe("analyzeSimilarity", () => {
  it("calcula niveles semánticos por par y ordena fuerte antes que revisar", async () => {
    const questionId = "q-long";
    const question = longQuestion(questionId);
    const participants = ["p1", "p2", "p3", "p4"].map((id) => longParticipant(id, id, questionId));
    const input: SimilarityClassInput = { questions: [question], participants };

    const responses: Record<string, JevResult> = {
      "p1,p2": jevResult(0.95, 0.1, 0.1), // strong
      "p1,p3": jevResult(0.75, 0.1, 0.1), // review
      "p1,p4": jevResult(0.1, 0.1, 0.1),
      "p2,p3": jevResult(0.1, 0.1, 0.1),
      "p2,p4": jevResult(0.1, 0.1, 0.1),
      "p3,p4": jevResult(0.1, 0.1, 0.1),
    };
    const evaluator: JevEvaluator = async (request) => {
      const [a, b] = tagsOf(request);
      const key = [a, b].sort().join(",");
      const result = responses[key];
      if (!result) throw new Error(`fixture incompleta para el par ${key}`);
      return result;
    };

    const report = await analyzeSimilarity(input, { evaluator });

    expect(report.semantic.status).toBe("ok");
    expect(report.semantic.evaluatedPairs).toBe(6);
    expect(report.semantic.failedPairs).toBe(0);
    expect(report.semantic.skippedPairs).toBe(0);
    expect(report.pairs.map((pair) => pair.level)).toEqual(["strong", "review"]);
    expect(new Set([report.pairs[0].a.participantId, report.pairs[0].b.participantId])).toEqual(new Set(["p1", "p2"]));
    expect(report.pairs[0].questions[0].semantic).toEqual({ shared_distinctive_wording: 0.95, same_mistake: 0.1, reworded_copy: 0.1 });
  });

  it("respeta maxCalls global y cuenta lo salteado", async () => {
    const questionId = "q-long";
    const question = longQuestion(questionId);
    const ids = ["p1", "p2", "p3", "p4", "p5", "p6"];
    const participants = ids.map((id) => longParticipant(id, id, questionId));
    const input: SimilarityClassInput = { questions: [question], participants };
    const evaluator: JevEvaluator = vi.fn(async () => jevResult(0.1, 0.1, 0.1));

    const report = await analyzeSimilarity(input, { evaluator, maxCalls: 5 });

    const totalPairs = (ids.length * (ids.length - 1)) / 2; // 15
    expect(evaluator).toHaveBeenCalledTimes(5);
    expect(report.semantic.evaluatedPairs).toBe(5);
    expect(report.semantic.skippedPairs).toBe(totalPairs - 5);
    expect(report.semantic.status).toBe("partial");
  });

  it("respeta el presupuesto por pregunta (max(20, 3×respondentes)) y cuenta lo salteado", async () => {
    const questionId = "q-long";
    const question = longQuestion(questionId);
    const ids = Array.from({ length: 9 }, (_, index) => `p${index + 1}`);
    const participants = ids.map((id) => longParticipant(id, id, questionId));
    const input: SimilarityClassInput = { questions: [question], participants };
    const evaluator: JevEvaluator = vi.fn(async () => jevResult(0.1, 0.1, 0.1));

    const report = await analyzeSimilarity(input, { evaluator });

    const totalPairs = (ids.length * (ids.length - 1)) / 2; // 36
    const budget = Math.max(20, 3 * ids.length); // 27
    expect(evaluator).toHaveBeenCalledTimes(budget);
    expect(report.semantic.evaluatedPairs).toBe(budget);
    expect(report.semantic.skippedPairs).toBe(totalPairs - budget);
    expect(report.semantic.status).toBe("partial");
  });

  it("billing_required en la primera llamada corta toda la tanda: unavailable + motivo, y la señal de código sigue", async () => {
    const questionId = "q-long";
    const question = longQuestion(questionId, "Contá qué es la fotosíntesis.");
    const distinctive =
      "Mi abuela cultiva geranios fucsias en macetas de barro cada primavera junto al portón azul y también riega las plantas todas las tardes.";
    const participants: ParticipantEntry[] = [
      { participantId: "p1", name: "Alumno p1", responses: new Map([[questionId, { kind: "long", text: distinctive }]]) },
      { participantId: "p2", name: "Alumno p2", responses: new Map([[questionId, { kind: "long", text: distinctive }]]) },
      longParticipant("p3", "p3", questionId),
      longParticipant("p4", "p4", questionId),
    ];
    const input: SimilarityClassInput = { questions: [question], participants };

    const evaluator: JevEvaluator = vi.fn(async () => {
      throw new JevError("billing_required", "AI Gateway requiere tarjeta de crédito", 403);
    });

    const report = await analyzeSimilarity(input, { evaluator, concurrency: 1 });

    expect(evaluator).toHaveBeenCalledTimes(1);
    expect(report.semantic.status).toBe("unavailable");
    expect(report.semantic.reason).toBe("billing_required");
    expect(report.semantic.evaluatedPairs).toBe(0);

    const flagged = report.pairs.find((pair) => {
      const ids = new Set([pair.a.participantId, pair.b.participantId]);
      return ids.has("p1") && ids.has("p2");
    });
    expect(flagged).toBeDefined();
    expect(flagged?.questions[0]?.fragments).toBeDefined();
    expect(flagged?.questions[0]?.semantic).toBeUndefined();
  });

  it("una falla transitoria no frena a las demás: el estado queda 'partial'", async () => {
    const questionId = "q-long";
    const question = longQuestion(questionId);
    const ids = ["p1", "p2", "p3"];
    const participants = ids.map((id) => longParticipant(id, id, questionId));
    const input: SimilarityClassInput = { questions: [question], participants };

    let call = 0;
    const evaluator: JevEvaluator = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new JevError("unavailable", "Jev no respondió tras reintentar", 503);
      return jevResult(0.1, 0.1, 0.1);
    });

    const report = await analyzeSimilarity(input, { evaluator, concurrency: 1 });

    expect(evaluator).toHaveBeenCalledTimes(3);
    expect(report.semantic.evaluatedPairs).toBe(2);
    expect(report.semantic.failedPairs).toBe(1);
    expect(report.semantic.status).toBe("partial");
  });

  it("nunca manda el nombre ni el id del alumno en el estado que recibe Jev", async () => {
    const questionId = "q-long";
    const question = longQuestion(questionId);
    const participants: ParticipantEntry[] = [
      { participantId: "secret-id-0001", name: "María Rodríguez", responses: new Map([[questionId, { kind: "long", text: longText("uno") }]]) },
      { participantId: "secret-id-0002", name: "Juan Pérez", responses: new Map([[questionId, { kind: "long", text: longText("dos") }]]) },
    ];
    const input: SimilarityClassInput = { questions: [question], participants };

    const captured: JevEvaluateRequest[] = [];
    const evaluator: JevEvaluator = vi.fn(async (request) => {
      captured.push(request);
      return jevResult(0.1, 0.1, 0.1);
    });

    await analyzeSimilarity(input, { evaluator });

    expect(captured).toHaveLength(1);
    const serialized = JSON.stringify(captured[0]);
    expect(serialized).not.toContain("secret-id-0001");
    expect(serialized).not.toContain("secret-id-0002");
    expect(serialized).not.toContain("María");
    expect(serialized).not.toContain("Rodríguez");
    expect(serialized).not.toContain("Juan Pérez");
  });

  it("evaluator null da 'not_configured', y las señales de código siguen presentes", async () => {
    const mc: SimilarityQuestion = { id: "q-mc", label: "MC", type: "mc", prompt: "¿?", expectedText: "" };
    const tf: SimilarityQuestion = { id: "q-tf", label: "TF", type: "tf", prompt: "¿?", expectedText: "" };
    const long = longQuestion("q-long");

    function participant(id: string, sharesRare: boolean): ParticipantEntry {
      const responses = new Map<string, ParticipantResponse>();
      responses.set(mc.id, sharesRare
        ? { kind: "closed", key: "rara", label: "Opción rara", correct: false }
        : { kind: "closed", key: "correcta", label: "Opción correcta", correct: true });
      responses.set(tf.id, sharesRare
        ? { kind: "closed", key: "false", label: "Falso", correct: false }
        : { kind: "closed", key: "true", label: "Verdadero", correct: true });
      responses.set(long.id, { kind: "long", text: longText(id) });
      return { participantId: id, name: `Alumno ${id}`, responses };
    }

    const participants = [
      participant("p1", true),
      participant("p2", true),
      participant("p3", false),
      participant("p4", false),
      participant("p5", false),
    ];
    const input: SimilarityClassInput = { questions: [mc, tf, long], participants };

    const report = await analyzeSimilarity(input, { evaluator: null });

    expect(report.semantic.status).toBe("not_configured");
    expect(report.semantic.evaluatedPairs).toBe(0);

    const flagged = report.pairs.find((pair) => {
      const ids = new Set([pair.a.participantId, pair.b.participantId]);
      return ids.has("p1") && ids.has("p2");
    });
    expect(flagged).toBeDefined();
    expect(flagged?.closedPattern).toEqual({ sharedWrong: 2, rareShared: 2 });
    expect(flagged?.level).toBe("review");
  });

  it("sin preguntas de desarrollo elegibles, el estado es 'not_needed' y no se llama a Jev", async () => {
    const mc: SimilarityQuestion = { id: "q-mc", label: "MC", type: "mc", prompt: "¿?", expectedText: "" };
    const participants: ParticipantEntry[] = ["p1", "p2"].map((id) => ({
      participantId: id,
      name: `Alumno ${id}`,
      responses: new Map<string, ParticipantResponse>([[mc.id, { kind: "closed", key: "a", label: "A", correct: true }]]),
    }));
    const input: SimilarityClassInput = { questions: [mc], participants };
    const evaluator: JevEvaluator = vi.fn(async () => jevResult(0.9, 0.9, 0.9));

    const report = await analyzeSimilarity(input, { evaluator });

    expect(report.semantic.status).toBe("not_needed");
    expect(evaluator).not.toHaveBeenCalled();
  });
});
