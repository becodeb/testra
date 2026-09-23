import { describe, expect, it } from "vitest";

import type { FullQuestion } from "@/domain/exam";
import {
  FRAGMENT_LONGEST_RUN_REVIEW,
  computeClosedSignals,
  computeFragmentSignals,
  expectedTextFor,
  normalizeResponse,
  pairKey,
  questionLabel,
  rankPairsByTfIdf,
  summarizeClosedPattern,
  tokenize,
  type ParticipantEntry,
  type SimilarityClassInput,
  type SimilarityQuestion,
} from "@/server/similarity-signals";

describe("tokenize", () => {
  it("mantiene los offsets del texto original: acentos y puntuación quedan afuera del token pero el span los conserva", () => {
    const text = "¿Qué es la fotosíntesis?";
    const tokens = tokenize(text);
    expect(tokens.map((token) => text.slice(token.start, token.end))).toEqual(["Qué", "es", "la", "fotosíntesis"]);
    expect(tokens.map((token) => token.text)).toEqual(["que", "es", "la", "fotosintesis"]);
  });
});

describe("questionLabel", () => {
  it("trunca prompts largos y colapsa espacios", () => {
    expect(questionLabel("a".repeat(100), 10)).toBe(`${"a".repeat(9)}…`);
    expect(questionLabel("  hola   mundo  ")).toBe("hola mundo");
  });
});

describe("normalizeResponse", () => {
  function mcQuestion(optionOrder: string[]): FullQuestion {
    const texts: Record<string, string> = { a: "Opción A", b: "Opción B", c: "Opción C (correcta)", d: "Opción D" };
    return {
      id: "q-mc",
      position: 0,
      prompt: "¿Cuál es la opción correcta?",
      points: 10,
      type: "mc",
      config: { options: optionOrder.map((id) => ({ id, text: texts[id] })), correctOptionId: "c" },
    } as FullQuestion;
  }

  it("compara mc por id de la opción, nunca por su posición en el arreglo", () => {
    const shuffled = mcQuestion(["d", "c", "b", "a"]);
    const normal = mcQuestion(["a", "b", "c", "d"]);
    expect(normalizeResponse(shuffled, "c")).toEqual(normalizeResponse(normal, "c"));
    expect(normalizeResponse(shuffled, "c")).toMatchObject({ kind: "closed", key: "c", correct: true });
  });

  it("ms: junta y ordena los ids elegidos sin importar el orden en que llegan ni el de las opciones", () => {
    const question = {
      id: "q-ms",
      position: 0,
      prompt: "Elegí las correctas",
      points: 10,
      type: "ms",
      config: { options: [{ id: "x", text: "X" }, { id: "y", text: "Y" }, { id: "z", text: "Z" }], correctOptionIds: ["x", "z"] },
    } as FullQuestion;
    expect(normalizeResponse(question, ["z", "x"])).toMatchObject({ kind: "closed", key: "x,z", correct: true });
    expect(normalizeResponse(question, ["x", "y"])).toMatchObject({ kind: "closed", key: "x,y", correct: false });
  });

  it("sa: normaliza con la misma lógica de corrección antes de comparar", () => {
    const question = { id: "q-sa", position: 0, prompt: "¿Capital de Francia?", points: 10, type: "sa", config: { accepted: ["parís"] } } as FullQuestion;
    expect(normalizeResponse(question, "  PARÍS  ")).toMatchObject({ kind: "sa", normalized: "paris", correct: true });
    expect(normalizeResponse(question, "Marsella")).toMatchObject({ kind: "sa", normalized: "marsella", correct: false });
  });

  it("una respuesta vacía o del tipo equivocado no genera señal", () => {
    const question = { id: "q-sa2", position: 0, prompt: "x", points: 10, type: "sa", config: { accepted: ["a"] } } as FullQuestion;
    expect(normalizeResponse(question, "")).toBeNull();
    expect(normalizeResponse(question, null)).toBeNull();
    expect(normalizeResponse(question, true)).toBeNull();
  });
});

// --- mc/ms/tf/sa: coincidencias raras vs. distractor popular -----------------

describe("computeClosedSignals + summarizeClosedPattern", () => {
  function mcQuestion(): FullQuestion {
    return {
      id: "q-mc",
      position: 0,
      prompt: "¿Cuál es la opción correcta?",
      points: 10,
      type: "mc",
      config: {
        options: [{ id: "a", text: "Opción A" }, { id: "b", text: "Opción B" }, { id: "c", text: "Opción C" }, { id: "d", text: "Opción D" }],
        correctOptionId: "c",
      },
    } as FullQuestion;
  }
  function tfQuestion(): FullQuestion {
    return { id: "q-tf", position: 1, prompt: "¿El agua hierve a 100°C al nivel del mar?", points: 10, type: "tf", config: { correct: true } } as FullQuestion;
  }
  function saQuestion(): FullQuestion {
    return { id: "q-sa", position: 2, prompt: "¿Capital de Francia?", points: 10, type: "sa", config: { accepted: ["parís", "paris"] } } as FullQuestion;
  }

  // 10 alumnos: p1-p3 responden bien las tres; p4-p8 fallan solo la mc con un
  // distractor que eligió medio curso (NO debería marcarse como raro); p9-p10
  // fallan las tres con la misma respuesta, que nadie más escribió (SÍ rara).
  const mc = mcQuestion();
  const tf = tfQuestion();
  const sa = saQuestion();
  const questions: SimilarityQuestion[] = [mc, tf, sa].map((question) => ({
    id: question.id,
    label: questionLabel(question.prompt),
    type: question.type,
    prompt: question.prompt,
    expectedText: expectedTextFor(question),
  }));

  function participant(id: string, mcValue: string, tfValue: boolean, saValue: string): ParticipantEntry {
    const responses = new Map();
    const mcResponse = normalizeResponse(mc, mcValue);
    const tfResponse = normalizeResponse(tf, tfValue);
    const saResponse = normalizeResponse(sa, saValue);
    if (mcResponse) responses.set(mc.id, mcResponse);
    if (tfResponse) responses.set(tf.id, tfResponse);
    if (saResponse) responses.set(sa.id, saResponse);
    return { participantId: id, name: `Alumno ${id}`, responses };
  }

  const participants: ParticipantEntry[] = [
    participant("p1", "c", true, "parís"),
    participant("p2", "c", true, "parís"),
    participant("p3", "c", true, "parís"),
    participant("p4", "a", true, "parís"),
    participant("p5", "a", true, "parís"),
    participant("p6", "a", true, "parís"),
    participant("p7", "a", true, "parís"),
    participant("p8", "a", true, "parís"),
    participant("p9", "b", false, "marsella"),
    participant("p10", "b", false, "marsella"),
  ];

  const input: SimilarityClassInput = { questions, participants };
  const findings = computeClosedSignals(input);

  it("no marca como rara la opción incorrecta que eligió medio curso", () => {
    const finding = (findings.get(pairKey("p4", "p5")) ?? []).find((f) => f.questionId === "q-mc");
    expect(finding).toBeDefined();
    expect(finding?.rare).toBe(false);
    // Sin ninguna coincidencia rara, el par ni siquiera llega a "review".
    expect(summarizeClosedPattern(findings.get(pairKey("p4", "p5")) ?? []).level).toBeNull();
  });

  it("marca como rara la respuesta incorrecta que solo compartió el par, en las tres preguntas", () => {
    const pairFindings = findings.get(pairKey("p9", "p10")) ?? [];
    expect(pairFindings).toHaveLength(3);
    for (const finding of pairFindings) {
      expect(finding.rare).toBe(true);
      expect(finding.othersWithSame).toBe(0);
    }
  });

  it("el patrón cerrado del par da 'strong' con tres coincidencias raras", () => {
    const summary = summarizeClosedPattern(findings.get(pairKey("p9", "p10")) ?? []);
    expect(summary).toEqual({ sharedWrong: 3, rareShared: 3, level: "strong" });
  });

  it("se salta preguntas con menos de 5 respondentes, aunque compartan una respuesta rara", () => {
    const pocos: ParticipantEntry[] = [
      participant("q1", "b", false, "marsella"),
      participant("q2", "b", false, "marsella"),
      participant("q3", "c", true, "parís"),
      participant("q4", "c", true, "parís"),
    ];
    const chico: SimilarityClassInput = { questions, participants: pocos };
    expect(computeClosedSignals(chico).size).toBe(0);
  });
});

// --- Desarrollo: fragmentos compartidos y raros -----------------------------

describe("computeFragmentSignals + rankPairsByTfIdf", () => {
  const PROMPT = "Explicá con tus palabras qué es la fotosíntesis.";
  const EXPECTED = "La fotosíntesis es el proceso por el cual las plantas convierten la luz solar en energía química.";
  // Repetida por los ocho, y además está en la respuesta de referencia: no debe
  // contarse como coincidencia aunque todos la escriban.
  const COMMON_A = EXPECTED;
  // Repetida por seis de los ocho, pero NO está en la referencia: se filtra
  // solo por tener document frequency alta en la clase.
  const COMMON_B = "Las hojas verdes captan la energía del sol todos los días.";
  // Frase inusual que SOLO comparten p1 y p2, palabra por palabra: el fragmento
  // que sí tiene que quedar marcado.
  const DISTINCTIVE = "Mi abuela cultiva geranios fucsias en macetas de barro, cada primavera, junto al portón azul.";

  const filler3 = "Prefiero pensar en los animales del bosque cuando escribo mis respuestas de biología.";
  const filler4 = "Anoche soñé con un viaje larguísimo por las montañas nevadas del sur.";
  const filler5 = "Mi hermano menor colecciona figuritas de autos antiguos desde hace varios años.";
  const filler6 = "El profesor de música nos enseñó una canción nueva la semana pasada.";
  const filler7a = "Los fines de semana suelo andar en bicicleta por el parque cercano a casa.";
  const filler7b = "También me gusta cocinar tortas los domingos junto a mi mamá.";
  const filler8a = "El equipo de fútbol del barrio perdió el partido por un gol en el último minuto.";
  const filler8b = "Después del partido fuimos todos a comer una pizza para consolarnos.";

  function longQuestion(): FullQuestion {
    return { id: "q-long", position: 0, prompt: PROMPT, points: 20, type: "long", config: { referenceAnswer: EXPECTED } } as FullQuestion;
  }

  const question = longQuestion();
  const similarityQuestion: SimilarityQuestion = {
    id: question.id,
    label: questionLabel(PROMPT),
    type: "long",
    prompt: PROMPT,
    expectedText: expectedTextFor(question),
  };

  function participant(id: string, text: string): ParticipantEntry {
    const response = normalizeResponse(question, text);
    return { participantId: id, name: `Alumno ${id}`, responses: new Map(response ? [[question.id, response]] : []) };
  }

  const texts: Record<string, string> = {
    p1: `${COMMON_A} ${COMMON_B} ${DISTINCTIVE} Ayer llovió mucho en mi barrio y no pude salir a jugar con mis amigos.`,
    p2: `${COMMON_A} ${COMMON_B} ${DISTINCTIVE} El fin de semana pasado fui a visitar a mis primos que viven en Rosario.`,
    p3: `${COMMON_A} ${COMMON_B} ${filler3}`,
    p4: `${COMMON_A} ${COMMON_B} ${filler4}`,
    p5: `${COMMON_A} ${COMMON_B} ${filler5}`,
    p6: `${COMMON_A} ${COMMON_B} ${filler6}`,
    p7: `${COMMON_A} ${filler7a} ${filler7b}`,
    p8: `${COMMON_A} ${filler8a} ${filler8b}`,
  };

  const participants: ParticipantEntry[] = Object.entries(texts).map(([id, text]) => participant(id, text));
  const input: SimilarityClassInput = { questions: [similarityQuestion], participants };

  it("no marca la definición que reproduce toda la clase (está en la referencia)", () => {
    const findings = computeFragmentSignals(input);
    // p3/p4 comparten COMMON_A (excluida) y COMMON_B (frecuente: 6 de 8), pero
    // nada raro: no deberían tener ningún hallazgo para esta pregunta.
    expect(findings.get(pairKey("p3", "p4"))).toBeUndefined();
  });

  it("no marca una coincidencia frecuente aunque no esté en la referencia (alta document frequency)", () => {
    const findings = computeFragmentSignals(input);
    expect(findings.get(pairKey("p5", "p6"))).toBeUndefined();
  });

  it("no marca a alumnos que solo comparten la parte excluida", () => {
    const findings = computeFragmentSignals(input);
    expect(findings.get(pairKey("p1", "p7"))).toBeUndefined();
  });

  it("marca el pasaje copiado, con spans que recortan el texto original con acentos y puntuación intactos", () => {
    const findings = computeFragmentSignals(input);
    const pairFindings = findings.get(pairKey("p1", "p2")) ?? [];
    const finding = pairFindings.find((f) => f.questionId === "q-long");
    expect(finding).toBeDefined();
    expect(finding?.level).toMatch(/^(strong|review)$/);
    expect(finding!.longestRun).toBeGreaterThanOrEqual(FRAGMENT_LONGEST_RUN_REVIEW);

    // Los spans de A recortan el texto de p1 tal cual (con "portón" acentuado).
    const sliceA = finding!.spansA.map((span) => texts.p1.slice(span.start, span.end)).join(" | ");
    expect(sliceA).toContain("portón");
    expect(sliceA).toContain("geranios fucsias");
    const sliceB = finding!.spansB.map((span) => texts.p2.slice(span.start, span.end)).join(" | ");
    expect(sliceB).toContain("portón");
  });

  it("el ranking TF-IDF pone primero al par que copió", () => {
    const ranked = rankPairsByTfIdf(input, "q-long");
    expect(ranked.length).toBeGreaterThan(0);
    const top = ranked[0];
    expect(new Set([top.a, top.b])).toEqual(new Set(["p1", "p2"]));
  });
});
