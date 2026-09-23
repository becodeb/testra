import { describe, expect, it } from "vitest";

import type { FullQuestion } from "@/domain/exam";
import {
  FRAGMENT_LONGEST_RUN_ALONE_REVIEW,
  FRAGMENT_LONGEST_RUN_REVIEW,
  closedLevelFor,
  computeClosedSignals,
  computeFragmentSignals,
  expectedTextFor,
  normalizeResponse,
  pairKey,
  poissonBinomialTailProbability,
  questionLabel,
  rankPairsByTfIdf,
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

// --- mc/ms/tf/sa: coincidencias cerradas frente al azar ---------------------

describe("poissonBinomialTailProbability", () => {
  it("coincide con un caso calculado a mano: dos monedas justas, P(X>=1)", () => {
    // P(X=0) = 0.5*0.5 = 0.25 -> P(X>=1) = 0.75.
    expect(poissonBinomialTailProbability([0.5, 0.5], 1)).toBeCloseTo(0.75, 10);
  });

  it("coincide con un caso calculado a mano: tres probabilidades distintas, P(X>=2)", () => {
    // P(X=2) + P(X=3) enumerando los 8 casos a mano con p=[0.1,0.2,0.3]:
    // P(X=2) = 0.1*0.2*0.7 + 0.1*0.8*0.3 + 0.9*0.2*0.3 = 0.092
    // P(X=3) = 0.1*0.2*0.3 = 0.006  ->  P(X>=2) = 0.098
    expect(poissonBinomialTailProbability([0.1, 0.2, 0.3], 2)).toBeCloseTo(0.098, 10);
  });

  it("da 1 si se pide 0 o menos éxitos, y 0 si se piden más que la cantidad de pruebas", () => {
    expect(poissonBinomialTailProbability([0.3, 0.4], 0)).toBe(1);
    expect(poissonBinomialTailProbability([0.3, 0.4], 3)).toBe(0);
  });
});

describe("computeClosedSignals", () => {
  function mcQuestion(id: string): FullQuestion {
    return {
      id,
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
  function tfQuestion(id: string): FullQuestion {
    return { id, position: 0, prompt: "¿Verdadero o falso?", points: 10, type: "tf", config: { correct: true } } as FullQuestion;
  }
  function saQuestion(id: string): FullQuestion {
    return { id, position: 0, prompt: "¿Respuesta corta?", points: 10, type: "sa", config: { accepted: ["correcta"] } } as FullQuestion;
  }

  function similarityQuestion(question: FullQuestion): SimilarityQuestion {
    return {
      id: question.id,
      label: questionLabel(question.prompt),
      type: question.type,
      prompt: question.prompt,
      expectedText: expectedTextFor(question),
      wrongOptionCount: question.type === "mc" ? question.config.options.length - 1 : undefined,
    };
  }

  function closedParticipant(id: string, questionValues: Array<[FullQuestion, string | boolean | null]>): ParticipantEntry {
    const responses = new Map();
    for (const [question, value] of questionValues) {
      const response = value === null ? null : normalizeResponse(question, value);
      if (response) responses.set(question.id, response);
    }
    return { participantId: id, name: `Alumno ${id}`, responses };
  }

  it("no marca una coincidencia sobre un distractor popular: coincidir con medio curso no es evidencia", () => {
    // 20 alumnos, 3 mc. Los mismos 14 fallan las tres con la opción "a" (muy
    // popular); el par evaluado (p13,p14) está entre esos 14. Coincidir con
    // una opción que casi todo el curso también eligió no dice nada: π por
    // pregunta queda alto y P(X>=3) no se acerca al umbral corregido.
    const q1 = mcQuestion("q1");
    const q2 = mcQuestion("q2");
    const q3 = mcQuestion("q3");
    const questions = [q1, q2, q3].map(similarityQuestion);
    const wrongFourteen = Array.from({ length: 14 }, (_, i) => `p${i + 1}`);
    const correctSix = Array.from({ length: 6 }, (_, i) => `p${15 + i}`);
    const participants: ParticipantEntry[] = [
      ...wrongFourteen.map((id) => closedParticipant(id, [[q1, "a"], [q2, "a"], [q3, "a"]])),
      ...correctSix.map((id) => closedParticipant(id, [[q1, "c"], [q2, "c"], [q3, "c"]])),
    ];
    const input: SimilarityClassInput = { questions, participants };

    const { patterns } = computeClosedSignals(input);
    const summary = patterns.get(pairKey("p1", "p2"));
    expect(summary?.sharedWrong).toBe(3);
    expect(summary?.level).toBeNull();
  });

  it("marca tres respuestas incorrectas idénticas cuando son raras frente al resto de la clase", () => {
    // 22 alumnos, 3 sa. 20 "otros" fallan cada pregunta con una respuesta
    // ÚNICA cada uno (espacio de respuestas abierto y disperso -> K grande,
    // π_q chico); el par comparte una respuesta que ninguno de los otros usó,
    // en las tres preguntas.
    const q1 = saQuestion("q1");
    const q2 = saQuestion("q2");
    const q3 = saQuestion("q3");
    const questions = [q1, q2, q3].map(similarityQuestion);
    const others = Array.from({ length: 20 }, (_, i) =>
      closedParticipant(`o${i + 1}`, [
        [q1, `error propio ${i} uno`],
        [q2, `error propio ${i} dos`],
        [q3, `error propio ${i} tres`],
      ]),
    );
    const pair = [
      closedParticipant("p1", [[q1, "mezcla rara compartida"], [q2, "mezcla rara compartida"], [q3, "mezcla rara compartida"]]),
      closedParticipant("p2", [[q1, "mezcla rara compartida"], [q2, "mezcla rara compartida"], [q3, "mezcla rara compartida"]]),
    ];
    const input: SimilarityClassInput = { questions, participants: [...others, ...pair] };

    const { patterns, findings } = computeClosedSignals(input);
    const summary = patterns.get(pairKey("p1", "p2"));
    expect(summary?.sharedWrong).toBe(3);
    expect(summary?.expectedByChance).toBeLessThan(1);
    expect(summary?.level).not.toBeNull();
    expect(findings.get(pairKey("p1", "p2"))).toHaveLength(3);
  });

  it("las coincidencias en verdadero/falso nunca marcan solas: con una sola opción incorrecta no hay evidencia", () => {
    // tf solo tiene una forma de estar mal: coincidir ahí no dice nada (π=1
    // por construcción). Ni multiplicando la cantidad de preguntas alcanza.
    const tfQuestions = Array.from({ length: 8 }, (_, i) => tfQuestion(`tf${i + 1}`));
    const questions = tfQuestions.map(similarityQuestion);
    const values = (wrong: boolean): Array<[FullQuestion, boolean]> => tfQuestions.map((q) => [q, wrong ? false : true]);
    const participants: ParticipantEntry[] = [
      closedParticipant("p1", values(true)),
      closedParticipant("p2", values(true)),
      ...Array.from({ length: 10 }, (_, i) => closedParticipant(`o${i + 1}`, values(i % 2 === 0))),
    ];
    const input: SimilarityClassInput = { questions, participants };

    const { patterns } = computeClosedSignals(input);
    const summary = patterns.get(pairKey("p1", "p2"));
    expect(summary?.sharedWrong).toBe(8);
    expect(summary?.pValue).toBeCloseTo(1, 10);
    expect(summary?.level).toBeNull();
  });

  it("se salta preguntas con menos de 5 respondentes", () => {
    const q1 = saQuestion("q1");
    const questions = [similarityQuestion(q1)];
    const pocos: ParticipantEntry[] = [
      closedParticipant("p1", [[q1, "rara"]]),
      closedParticipant("p2", [[q1, "rara"]]),
      closedParticipant("p3", [[q1, "correcta"]]),
      closedParticipant("p4", [[q1, "correcta"]]),
    ];
    const chico: SimilarityClassInput = { questions, participants: pocos };
    const { patterns } = computeClosedSignals(chico);
    expect(patterns.size).toBe(0);
  });

  it("closedLevelFor: permite recalibrar α sobre S/P ya calculados, sin tocar las constantes de producción", () => {
    // S=3 con P=0.0002: con α_review=0.05 sobre 100 pares (umbral 0.0005) da
    // "review"; con un α más estricto (0.001) sobre los mismos 100 pares
    // (umbral 0.00001) ya no alcanza.
    expect(closedLevelFor(3, 0.0002, 100, 0.05, 0.001)).toBe("review");
    expect(closedLevelFor(3, 0.0002, 100, 0.001, 0.0001)).toBeNull();
    expect(closedLevelFor(1, 0.0000001, 100)).toBeNull(); // S=1 nunca alcanza, aunque P sea diminuto
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

// Caso real que motivó este camino (T4, calibración): "Ley de Inercia Térmica
// de Torricelli" — un tramo raro y largo, verbatim en dos respuestas, con
// longestRun=8 (cumple) pero coverage=0.135 (no llega a 0.15) porque las
// respuestas son largas y diluyen la cobertura. Antes de este camino ese par
// quedaba sin marcar del todo.
describe("computeFragmentSignals: camino 'alone' por tramo raro largo, sin pedir cobertura", () => {
  const PROMPT = "Explicá por qué un barco de acero flota en el agua.";
  const EXPECTED = "El barco flota porque su forma hueca hace que el volumen total desplace más agua, bajando la densidad promedio.";
  // Diez tokens, inventada, verbatim en las dos, y rara (nadie más la escribe).
  const RARE_PHRASE = "gracias a la Ley de Inercia Térmica de Torricelli que explica esto";

  function longQuestion(): FullQuestion {
    return { id: "q-fis", position: 0, prompt: PROMPT, points: 20, type: "long", config: { referenceAnswer: EXPECTED } } as FullQuestion;
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

  // Relleno largo y distinto por alumno (palabras + índice + semilla, así cada
  // token es único) para que la respuesta total sea larga y la cobertura del
  // tramo compartido quede bien por debajo de FRAGMENT_COVERAGE_REVIEW aunque
  // el tramo en sí sea clarísimo.
  function padding(seed: string): string {
    const words = ["barco", "acero", "agua", "densidad", "volumen", "hueco", "flota", "hunde", "peso", "empuje", "fuerza", "objeto"];
    return Array.from({ length: 70 }, (_, i) => `${words[(i + seed.length) % words.length]}${seed}${i}`).join(" ");
  }

  const textA = `${padding("a")} ${RARE_PHRASE} ${padding("aa")}`;
  const textB = `${padding("b")} ${RARE_PHRASE} ${padding("bb")}`;
  const textOther = `${padding("c")} y no dice nada parecido a la frase distintiva ${padding("cc")}`;

  const participants: ParticipantEntry[] = [
    participant("p1", textA),
    participant("p2", textB),
    participant("p3", textOther),
    participant("p4", `${textOther} distinto`),
  ];
  const input: SimilarityClassInput = { questions: [similarityQuestion], participants };

  it("marca 'review' por un tramo raro largo, aunque la cobertura quede baja por lo larga que es la respuesta", () => {
    const finding = (computeFragmentSignals(input).get(pairKey("p1", "p2")) ?? []).find((f) => f.questionId === "q-fis");
    expect(finding).toBeDefined();
    expect(finding!.longestRun).toBeGreaterThanOrEqual(FRAGMENT_LONGEST_RUN_ALONE_REVIEW);
    expect(finding!.coverage).toBeLessThan(0.15);
    expect(finding!.level).toBe("review");
  });

  it("no marca a quienes no comparten el tramo raro", () => {
    expect(computeFragmentSignals(input).get(pairKey("p1", "p3"))).toBeUndefined();
  });
});
