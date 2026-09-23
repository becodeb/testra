import {
  closedLevelFor,
  computeClosedSignals,
  pairKey,
  type ClosedResponse,
  type ParticipantEntry,
  type SimilarityClassInput,
  type SimilarityQuestion,
} from "@/server/similarity-signals";

import { hashStringToInt, mean, mulberry32, nextGaussian, percentile } from "./metrics";

// Simulación de clases cerradas (sin IA) para calibrar el modelo estadístico
// de `computeClosedSignals` en `similarity-signals.ts`. Alumnos con habilidad
// propia, preguntas con dificultad propia (modelo logístico 1-parámetro,
// estilo Rasch: P(acierta) = sigmoid(habilidad - dificultad)), distractores
// con popularidad desigual (mc) o una larga cola de errores únicos (sa), y un
// puñado de pares que "coluden" copiando la respuesta del otro con cierta
// probabilidad por pregunta.
//
// Simula UNA vez por semilla y guarda S/P crudos por par: probar distintos α
// (la calibración que pide T4) es después una cuenta barata sobre esos
// mismos datos, sin resimular ni tocar las constantes de producción.

export interface ClosedSimQuestionGroup {
  type: "mc" | "tf" | "sa";
  count: number;
  /** Pesos relativos de los distractores incorrectos (solo mc; en tf/sa no aplica). */
  distractorWeights?: number[];
}

export interface ClosedSimConfig {
  studentCount: number;
  questionGroups: ClosedSimQuestionGroup[];
  colludingPairs: number;
  /** Probabilidad, por pregunta, de que el "copión" adopte la respuesta que ya tenía el "fuente". */
  collusionRate: number;
}

export interface RawPairOutcome {
  sharedWrong: number;
  pValue: number;
}

export interface SeedOutcome {
  nPairs: number;
  colluding: RawPairOutcome[];
  /** Solo los NO colusores con sharedWrong >= 2 (el piso fijo): los únicos que podrían marcarse con cualquier α. */
  others: RawPairOutcome[];
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

// Cola larga de errores en respuesta corta: la mayoría de quienes fallan
// escriben algo propio y único (su typo, su confusión puntual); una minoría
// cae en un par de errores comunes (una confusión que sí comparte medio curso).
const SA_COMMON_WRONGS = ["error-comun-1", "error-comun-2"];
const SA_COMMON_RATE = 0.3;

function sampleWrongAnswer(
  type: "mc" | "tf" | "sa",
  wrongOptions: string[],
  weights: number[] | undefined,
  rng: () => number,
  uniqueTag: string,
): string {
  if (type === "tf") return "false";
  if (type === "mc") return pickWeighted(wrongOptions, weights ?? [], rng);
  if (rng() < SA_COMMON_RATE) return SA_COMMON_WRONGS[Math.floor(rng() * SA_COMMON_WRONGS.length)];
  return `unico-${uniqueTag}`;
}

interface QuestionPlan {
  id: string;
  type: "mc" | "tf" | "sa";
  distractorWeights?: number[];
  difficulty: number;
}

/** Una clase simulada, con una semilla numérica ya derivada (determinístico). */
export function simulateOneClass(config: ClosedSimConfig, seed: number): SeedOutcome {
  const rng = mulberry32(seed);
  const students = Array.from({ length: config.studentCount }, (_, i) => `s${i + 1}`);
  const abilities = new Map(students.map((s) => [s, nextGaussian(rng)]));

  const plans: QuestionPlan[] = [];
  for (const group of config.questionGroups) {
    for (let i = 0; i < group.count; i += 1) {
      plans.push({ id: `q${plans.length + 1}`, type: group.type, distractorWeights: group.distractorWeights, difficulty: nextGaussian(rng) });
    }
  }

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

  // "true" (o el equivalente correcto de cada tipo) es el valor por defecto
  // que después cada pregunta pisa; ningún alumno queda sin respuesta.
  const answersByStudent = new Map<string, string[]>();
  for (const student of students) answersByStudent.set(student, new Array(plans.length).fill(""));

  plans.forEach((plan, q) => {
    const correctId = plan.type === "sa" ? "correcta" : plan.type === "tf" ? "true" : "a";
    const wrongOptions = plan.type === "mc" ? ["b", "c", "d"] : [];
    students.forEach((student, studentIndex) => {
      const pCorrect = sigmoid(abilities.get(student)! - plan.difficulty);
      const correct = rng() < pCorrect;
      const chosen = correct
        ? correctId
        : sampleWrongAnswer(plan.type, wrongOptions, plan.distractorWeights, rng, `${q}-${studentIndex}-${Math.floor(rng() * 1e9)}`);
      answersByStudent.get(student)![q] = chosen;
    });
  });

  // La colusión se aplica DESPUÉS de simular las respuestas independientes:
  // en cada pregunta, con probabilidad `collusionRate`, el copión adopta lo
  // que el source ya tenía (sea correcto o no) en vez de su propia respuesta.
  for (const { source, copier } of roleByPairKey.values()) {
    plans.forEach((_, q) => {
      if (rng() < config.collusionRate) answersByStudent.get(copier)![q] = answersByStudent.get(source)![q];
    });
  }

  const questions: SimilarityQuestion[] = plans.map((plan) => ({
    id: plan.id,
    label: plan.id,
    type: plan.type,
    prompt: plan.id,
    expectedText: "",
    // mc real: 4 opciones, 3 incorrectas. Igual que un adaptador real le
    // pasaría `options.length - 1` a `similarity-analysis.ts`.
    wrongOptionCount: plan.type === "mc" ? 3 : undefined,
  }));
  const participants: ParticipantEntry[] = students.map((student) => {
    const responses = new Map<string, ClosedResponse>();
    const chosenByQuestion = answersByStudent.get(student)!;
    plans.forEach((plan, q) => {
      const chosen = chosenByQuestion[q];
      const correctId = plan.type === "sa" ? "correcta" : plan.type === "tf" ? "true" : "a";
      responses.set(plan.id, { kind: "closed", key: chosen, label: chosen, correct: chosen === correctId });
    });
    return { participantId: student, name: student, responses };
  });
  const input: SimilarityClassInput = { questions, participants };

  const { patterns } = computeClosedSignals(input);
  const nPairs = (students.length * (students.length - 1)) / 2;

  const colluding: RawPairOutcome[] = colludingPairs.map(([a, b]) => {
    const pattern = patterns.get(pairKey(a, b));
    return { sharedWrong: pattern?.sharedWrong ?? 0, pValue: pattern?.pValue ?? 1 };
  });

  const others: RawPairOutcome[] = [];
  for (const [a, b] of everyPair) {
    const key = pairKey(a, b);
    if (colludingKeys.has(key)) continue;
    const pattern = patterns.get(key);
    if (pattern && pattern.sharedWrong >= 2) others.push({ sharedWrong: pattern.sharedWrong, pValue: pattern.pValue });
  }

  return { nPairs, colluding, others };
}

export interface AlphaCombination {
  alphaReview: number;
  alphaStrong: number;
}

export interface ClosedSimSummary extends AlphaCombination {
  seeds: number;
  colludingInstances: number;
  strongRate: number;
  reviewOrStrongRate: number;
  otherFalseFlagsMean: number | null;
  otherFalseFlagsP95: number | null;
}

/**
 * Simula `seeds` clases UNA vez y, para cada combinación de α pedida,
 * recalcula el nivel de cada par (con `closedLevelFor`, sin resimular) para
 * medir detección y falsos positivos bajo ese α.
 */
export function runClosedSimulation(
  config: ClosedSimConfig,
  seeds: number,
  seedLabel: string,
  alphaCombinations: AlphaCombination[],
): ClosedSimSummary[] {
  const seedOutcomes: SeedOutcome[] = [];
  for (let s = 0; s < seeds; s += 1) {
    seedOutcomes.push(simulateOneClass(config, hashStringToInt(`${seedLabel}:${s}`)));
  }

  return alphaCombinations.map(({ alphaReview, alphaStrong }) => {
    let strongCount = 0;
    let reviewOrStrongCount = 0;
    let colludingInstances = 0;
    const falseFlagsPerSeed: number[] = [];

    for (const outcome of seedOutcomes) {
      for (const { sharedWrong, pValue } of outcome.colluding) {
        colludingInstances += 1;
        const level = closedLevelFor(sharedWrong, pValue, outcome.nPairs, alphaReview, alphaStrong);
        if (level === "strong") strongCount += 1;
        if (level === "strong" || level === "review") reviewOrStrongCount += 1;
      }
      let flagged = 0;
      for (const { sharedWrong, pValue } of outcome.others) {
        if (closedLevelFor(sharedWrong, pValue, outcome.nPairs, alphaReview, alphaStrong)) flagged += 1;
      }
      falseFlagsPerSeed.push(flagged);
    }

    return {
      alphaReview,
      alphaStrong,
      seeds,
      colludingInstances,
      strongRate: colludingInstances ? strongCount / colludingInstances : 0,
      reviewOrStrongRate: colludingInstances ? reviewOrStrongCount / colludingInstances : 0,
      otherFalseFlagsMean: mean(falseFlagsPerSeed),
      otherFalseFlagsP95: percentile(falseFlagsPerSeed, 95),
    };
  });
}
