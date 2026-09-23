import {
  computeClosedSignals,
  pairKey,
  summarizeClosedPattern,
  type ClosedResponse,
  type ParticipantEntry,
  type SimilarityClassInput,
  type SimilarityQuestion,
} from "@/server/similarity-signals";

import { hashStringToInt, mean, mulberry32, nextGaussian, percentile } from "./metrics";

// Simulación de clases cerradas (sin IA) para calibrar los umbrales `CLOSED_*`
// de `similarity-signals.ts`. No hay red ni dataset acá: alumnos con
// habilidad propia, preguntas con dificultad propia (modelo logístico
// 1-parámetro, estilo Rasch: P(acierta) = sigmoid(habilidad - dificultad)),
// distractores con popularidad desigual entre las opciones incorrectas, y un
// puñado de pares que "coluden" copiando la respuesta del otro con cierta
// probabilidad por pregunta.

export interface ClosedSimConfig {
  studentCount: number;
  questionCount: number;
  questionType: "mc" | "tf";
  /** Pesos relativos de los distractores (se ignora en tf: ahí solo hay una opción incorrecta). */
  distractorWeights: number[];
  colludingPairs: number;
  /** Probabilidad, por pregunta, de que el "copión" adopte la respuesta que ya tenía el "fuente". */
  collusionRate: number;
}

export interface SeedOutcome {
  colludingLevels: Array<"strong" | "review" | null>;
  /** Entre los pares NO colusores, cuántos quedaron marcados (review o strong): el falso positivo de esta clase. */
  otherFlaggedCount: number;
  totalOtherPairs: number;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function pickWeighted(options: string[], weights: number[], rng: () => number): string {
  const w = weights.length === options.length ? weights : options.map(() => 1);
  const total = w.reduce((sum, v) => sum + v, 0);
  let r = rng() * total;
  for (let i = 0; i < options.length; i += 1) {
    r -= w[i];
    if (r <= 0) return options[i];
  }
  return options[options.length - 1];
}

/** Una clase simulada, con una semilla numérica ya derivada (determinístico). */
export function simulateOneClass(config: ClosedSimConfig, seed: number): SeedOutcome {
  const rng = mulberry32(seed);
  const students = Array.from({ length: config.studentCount }, (_, i) => `s${i + 1}`);
  const abilities = new Map(students.map((s) => [s, nextGaussian(rng)]));
  const difficulties = Array.from({ length: config.questionCount }, () => nextGaussian(rng));

  const everyPair: Array<[string, string]> = [];
  for (let i = 0; i < students.length; i += 1) {
    for (let j = i + 1; j < students.length; j += 1) everyPair.push([students[i], students[j]]);
  }
  const shuffled = [...everyPair];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const colludingPairs = shuffled.slice(0, config.colludingPairs);
  const colludingKeys = new Set(colludingPairs.map(([a, b]) => pairKey(a, b)));
  const roleByPairKey = new Map(colludingPairs.map(([a, b]) => [pairKey(a, b), { source: a, copier: b }]));

  // Opciones: "a"/"b"/"c"/"d" para mc (la correcta es siempre "a": arbitrario
  // y sin efecto, porque el algoritmo compara por igualdad de valor, nunca
  // por posición), "true"/"false" para tf.
  const optionIds = config.questionType === "tf" ? ["true", "false"] : ["a", "b", "c", "d"];
  const correctId = optionIds[0];
  const wrongOptions = optionIds.slice(1);

  const answersByStudent = new Map<string, string[]>();
  for (const student of students) answersByStudent.set(student, new Array(config.questionCount).fill(correctId));

  for (let q = 0; q < config.questionCount; q += 1) {
    const difficulty = difficulties[q];
    for (const student of students) {
      const pCorrect = sigmoid(abilities.get(student)! - difficulty);
      const correct = rng() < pCorrect;
      const chosen = correct ? correctId : pickWeighted(wrongOptions, config.distractorWeights, rng);
      answersByStudent.get(student)![q] = chosen;
    }
  }

  // La colusión se aplica DESPUÉS de simular las respuestas independientes:
  // en cada pregunta, con probabilidad `collusionRate`, el copión adopta lo
  // que el source ya tenía (sea correcto o no) en vez de su propia respuesta.
  for (const { source, copier } of roleByPairKey.values()) {
    for (let q = 0; q < config.questionCount; q += 1) {
      if (rng() < config.collusionRate) answersByStudent.get(copier)![q] = answersByStudent.get(source)![q];
    }
  }

  const questions: SimilarityQuestion[] = Array.from({ length: config.questionCount }, (_, q) => ({
    id: `q${q + 1}`,
    label: `Pregunta ${q + 1}`,
    type: config.questionType,
    prompt: `Pregunta ${q + 1}`,
    expectedText: "",
  }));
  const participants: ParticipantEntry[] = students.map((student) => {
    const responses = new Map<string, ClosedResponse>();
    const chosenByQuestion = answersByStudent.get(student)!;
    for (let q = 0; q < config.questionCount; q += 1) {
      const chosen = chosenByQuestion[q];
      responses.set(`q${q + 1}`, { kind: "closed", key: chosen, label: chosen, correct: chosen === correctId });
    }
    return { participantId: student, name: student, responses };
  });
  const input: SimilarityClassInput = { questions, participants };

  const closedFindings = computeClosedSignals(input);
  const colludingLevels = colludingPairs.map(([a, b]) => summarizeClosedPattern(closedFindings.get(pairKey(a, b)) ?? []).level);

  let otherFlaggedCount = 0;
  let totalOtherPairs = 0;
  for (const [a, b] of everyPair) {
    const key = pairKey(a, b);
    if (colludingKeys.has(key)) continue;
    totalOtherPairs += 1;
    const level = summarizeClosedPattern(closedFindings.get(key) ?? []).level;
    if (level) otherFlaggedCount += 1;
  }

  return { colludingLevels, otherFlaggedCount, totalOtherPairs };
}

export interface ClosedSimSummary {
  seeds: number;
  colludingInstances: number;
  strongRate: number;
  reviewOrStrongRate: number;
  otherFalseFlagsMean: number | null;
  otherFalseFlagsP95: number | null;
  totalOtherPairsPerClass: number;
}

export function runClosedSimulation(config: ClosedSimConfig, seeds: number, seedLabel: string): ClosedSimSummary {
  let strongCount = 0;
  let reviewOrStrongCount = 0;
  let colludingInstances = 0;
  const falseFlagsPerSeed: number[] = [];
  let totalOtherPairsPerClass = 0;

  for (let s = 0; s < seeds; s += 1) {
    // Semilla determinística derivada del label + índice: reproducible sin
    // depender de `Date.now()` ni de ningún estado externo.
    const outcome = simulateOneClass(config, hashStringToInt(`${seedLabel}:${s}`));
    for (const level of outcome.colludingLevels) {
      colludingInstances += 1;
      if (level === "strong") strongCount += 1;
      if (level === "strong" || level === "review") reviewOrStrongCount += 1;
    }
    falseFlagsPerSeed.push(outcome.otherFlaggedCount);
    totalOtherPairsPerClass = outcome.totalOtherPairs;
  }

  return {
    seeds,
    colludingInstances,
    strongRate: colludingInstances ? strongCount / colludingInstances : 0,
    reviewOrStrongRate: colludingInstances ? reviewOrStrongCount / colludingInstances : 0,
    otherFalseFlagsMean: mean(falseFlagsPerSeed),
    otherFalseFlagsP95: percentile(falseFlagsPerSeed, 95),
    totalOtherPairsPerClass,
  };
}
