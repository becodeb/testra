import type { Actor } from "@/server/actors";
import { db } from "@/server/db/client";
import type { AnswerValue } from "@/server/grading";
import {
  JevError,
  evaluateWithJev,
  jevConfigured,
  type JevAnswer,
  type JevErrorCode,
  type JevEvaluateRequest,
  type JevQuestionSpec,
  type JevResult,
} from "@/server/jev-client";
import { questionsForParticipant } from "@/server/participant-paper";
import { getRunForTeacher } from "@/server/repository";
import {
  computeClosedSignals,
  computeFragmentSignals,
  expectedTextFor,
  isLongEligible,
  normalizeResponse,
  pairKey,
  questionLabel,
  rankPairsByTfIdf,
  tokenize,
  type ClosedPatternSummary,
  type FragmentFinding,
  type FragmentSpan,
  type ParticipantEntry,
  type ParticipantResponse,
  type SharedWrongAnswerFinding,
  type SignalLevel,
  type SimilarityClassInput,
  type SimilarityQuestion,
  type SimilarityQuestionType,
} from "@/server/similarity-signals";

// Orquesta la comparación entre alumnos: junta las señales de código (siempre
// disponibles) con el juicio semántico de Jev (uno por par y pregunta de
// desarrollo, bajo presupuesto), y arma el reporte que ve el docente. Ver
// `odd/tasks/jev-copy-detection.md` para el diseño y las fuentes.

// --- Forma del reporte -------------------------------------------------------

export interface SimilarityPairSide {
  participantId: string;
  name: string;
}

/** Una pregunta cerrada donde el par coincidió, con la opción que eligieron los dos. Ver `SimilarityPair.closedPattern`. */
export interface ClosedPatternQuestion {
  questionId: string;
  label: string;
  answerLabel: string;
  othersWithSame: number;
}

export interface FragmentReport {
  coverage: number;
  longestRun: number;
  spansA: FragmentSpan[];
  spansB: FragmentSpan[];
}

// Nombres calcados de las preguntas que se le mandan a Jev (ver
// `SIMILARITY_QUESTIONS` más abajo), a propósito: son las mismas claves de
// `answers` en la respuesta de la API.
export interface SemanticFindingReport {
  shared_distinctive_wording: number;
  same_mistake: number;
  reworded_copy: number;
}

// Una fila por pregunta de DESARROLLO donde el par coincidió (fragmentos y/o
// Jev). Las preguntas cerradas ya no pasan por acá: van aparte en
// `SimilarityPair.closedPattern.questions`, sin nivel propio, porque esa
// evidencia se muestra independientemente de si por sí sola alcanza a marcar
// al par (ver `ClosedPatternQuestion`).
export interface PairQuestionFinding {
  questionId: string;
  label: string;
  type: SimilarityQuestionType;
  level: SignalLevel;
  fragments?: FragmentReport;
  semantic?: SemanticFindingReport;
  answerA: string;
  answerB: string;
}

export interface SimilarityPair {
  a: SimilarityPairSide;
  b: SimilarityPairSide;
  level: SignalLevel;
  closedPattern?: { sharedWrong: number; expectedByChance: number; pValue: number; questions: ClosedPatternQuestion[] };
  questions: PairQuestionFinding[];
}

export type SemanticStatus = "ok" | "not_configured" | "not_needed" | "unavailable" | "partial";

export interface SimilarityReport {
  version: 1;
  generatedAt: number;
  participantsCompared: number;
  questionsCompared: Array<{ id: string; label: string; type: SimilarityQuestionType }>;
  semantic: {
    status: SemanticStatus;
    reason?: string;
    model: "typesafe-ai/jev";
    evaluatedPairs: number;
    failedPairs: number;
    /** Pares que el prefiltro por pregunta dejó afuera a propósito (funcionando como se espera; nunca mueve el status a "partial"). */
    notSelectedPairs: number;
    /** Pares que SÍ se eligieron pero no se evaluaron: tope global (maxCalls), se acabó el tiempo, o se abortó. */
    skippedPairs: number;
    inputTokens: number | null;
    costUsd: number | null;
  };
  pairs: SimilarityPair[];
}

// --- Lo que se manda a Jev: nunca nombres ni ids -----------------------------

export const SIMILARITY_CONTEXT =
  "Evaluación escolar. Todos los alumnos estudiaron el mismo material y respondieron la misma consigna, cada uno por su cuenta. Es esperable que las respuestas correctas se parezcan entre sí y a la respuesta de referencia, que usen el vocabulario propio del tema y que repitan definiciones vistas en clase. No es esperable que dos alumnos compartan frases poco comunes, los mismos ejemplos propios, el mismo orden de ideas punto por punto o el mismo error.";

export const NO_REFERENCE_ANSWER_TEXT = "(el docente no cargó una respuesta de referencia)";

// Instrucciones y criterios en inglés a propósito: es el texto que evalúa T4 y
// se mantiene calcado de la especificación, sin traducir.
export const SIMILARITY_QUESTIONS: Record<string, JevQuestionSpec> = {
  shared_distinctive_wording: {
    type: "boolean",
    instructions: "Do respuesta_1 and respuesta_2 share distinctive wording that is not in the consigna or in the respuesta_de_referencia?",
    criteria: {
      true: "They repeat the same uncommon phrases or sentences, the same personal examples, or the same unusual way of saying something.",
      false: "What they share is the vocabulary of the topic, the reference answer, or a definition every student learned in class.",
    },
  },
  same_mistake: {
    type: "boolean",
    instructions: "Do respuesta_1 and respuesta_2 contain the same specific mistake?",
    criteria: {
      true: "Both state the same wrong fact, the same misconception, the same invented term, or the same distinctive misspelling.",
      false: "Neither has a mistake, or their mistakes are different.",
    },
  },
  reworded_copy: {
    type: "boolean",
    instructions: "Is one answer a reworded version of the other?",
    criteria: {
      true: "It follows the other point by point, with the same order and the same examples, changing some words.",
      false: "Each answer develops the ideas in its own way, even if both cover the key points of the reference answer.",
    },
  },
};

export const SEMANTIC_STRONG_PROBABILITY = 0.9;
export const SEMANTIC_REVIEW_PROBABILITY = 0.7;

/** Exportado para que el harness de evaluación (`scripts/copy-eval`) arme el mismo pedido que producción, en vez de duplicar el armado. */
export function buildJevRequest(question: SimilarityQuestion, textA: string, textB: string): JevEvaluateRequest {
  return {
    state: {
      contexto: SIMILARITY_CONTEXT,
      consigna: question.prompt,
      respuesta_de_referencia: question.expectedText.trim() ? question.expectedText : NO_REFERENCE_ANSWER_TEXT,
      respuesta_1: textA,
      respuesta_2: textB,
    },
    questions: SIMILARITY_QUESTIONS,
  };
}

// --- analyzeSimilarity --------------------------------------------------------

export type JevEvaluator = (request: JevEvaluateRequest, signal: AbortSignal) => Promise<JevResult>;

export interface AnalyzeSimilarityOptions {
  /** `null` fuerza "no configurado"; si se omite, usa `evaluateWithJev` (reenviándole la señal de corte) cuando `jevConfigured()`. */
  evaluator?: JevEvaluator | null;
  concurrency?: number;
  timeBudgetMs?: number;
  maxCalls?: number;
  signal?: AbortSignal;
  now?: () => number;
}

const DEFAULT_CONCURRENCY = 4;
// Por debajo de los ~100 s del proxy de Cloudflare con margen de sobra: el
// POST que corre esto tiene que volver bien antes de ese límite.
const DEFAULT_TIME_BUDGET_MS = 45_000;
const DEFAULT_MAX_CALLS = 300;

// Un error con alguno de estos códigos no se soluciona reintentando otro par:
// corta toda la tanda de una.
const FATAL_JEV_CODES = new Set<JevErrorCode>(["not_configured", "billing_required", "unauthorized", "bad_request"]);

interface PairCandidate {
  pairKey: string;
  a: string;
  b: string;
  questionId: string;
  request: JevEvaluateRequest;
}

/**
 * Pares elegibles por pregunta de desarrollo: primero los que ya tienen una
 * señal de fragmento (código), después el ranking TF-IDF, hasta el
 * presupuesto `max(20, 3×respondentes)` de esa pregunta. Lo que sobra de ese
 * presupuesto se cuenta aparte como "no seleccionado": es el prefiltro
 * funcionando como se espera (una clase de 30 alumnos tiene 435 pares por
 * pregunta), no una falla, y nunca mueve el status a "partial".
 *
 * Devuelve una lista POR PREGUNTA, cada una ya en orden de prioridad, para que
 * quien arme la tanda final pueda repartir el presupuesto global entre
 * preguntas en vez de dejar que la primera pregunta se lo coma entero.
 */
/** Alumnos con una respuesta elegible (≥12 tokens normalizados) a esta pregunta de desarrollo. Exportado para que el harness de evaluación (T4) reproduzca el mismo filtro que producción. */
export function eligibleParticipantIds(input: SimilarityClassInput, questionId: string): Set<string> {
  return new Set(
    input.participants
      .filter((participant) => {
        const response = participant.responses.get(questionId);
        return response?.kind === "long" && isLongEligible(tokenize(response.text));
      })
      .map((participant) => participant.participantId),
  );
}

/**
 * Orden de prioridad para UNA pregunta, sin aplicar todavía el presupuesto:
 * primero los pares con una señal de fragmento (código), después el ranking
 * TF-IDF, sin duplicados. Exportado para que el harness de evaluación (T4)
 * mida el prefiltro con este mismo código en vez de reimplementarlo aparte.
 */
export function orderPairsForQuestion(
  input: SimilarityClassInput,
  questionId: string,
  fragmentFindings: Map<string, FragmentFinding[]>,
  eligibleIds: Set<string>,
): Array<[string, string]> {
  const seen = new Set<string>();
  const ordered: Array<[string, string]> = [];

  for (const [key, findings] of fragmentFindings) {
    if (!findings.some((finding) => finding.questionId === questionId)) continue;
    const [a, b] = key.split("|");
    if (!eligibleIds.has(a) || !eligibleIds.has(b)) continue;
    seen.add(key);
    ordered.push([a, b]);
  }

  for (const { a, b } of rankPairsByTfIdf(input, questionId)) {
    const key = pairKey(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push([a, b]);
  }

  return ordered;
}

function selectCandidates(
  input: SimilarityClassInput,
  fragmentFindings: Map<string, FragmentFinding[]>,
): { perQuestionCandidates: PairCandidate[][]; notSelectedPairs: number } {
  const byId = new Map(input.participants.map((participant) => [participant.participantId, participant]));
  const perQuestionCandidates: PairCandidate[][] = [];
  let notSelectedPairs = 0;

  for (const question of input.questions) {
    if (question.type !== "long") continue;

    const eligibleIds = eligibleParticipantIds(input, question.id);
    if (eligibleIds.size < 2) continue;

    const budget = Math.max(20, 3 * eligibleIds.size);
    const ordered = orderPairsForQuestion(input, question.id, fragmentFindings, eligibleIds);
    notSelectedPairs += Math.max(0, ordered.length - budget);

    const questionCandidates: PairCandidate[] = [];
    for (const [a, b] of ordered.slice(0, budget)) {
      const responseA = byId.get(a)?.responses.get(question.id);
      const responseB = byId.get(b)?.responses.get(question.id);
      if (responseA?.kind !== "long" || responseB?.kind !== "long") continue;
      questionCandidates.push({
        pairKey: pairKey(a, b),
        a,
        b,
        questionId: question.id,
        request: buildJevRequest(question, responseA.text, responseB.text),
      });
    }
    if (questionCandidates.length) perQuestionCandidates.push(questionCandidates);
  }

  return { perQuestionCandidates, notSelectedPairs };
}

/**
 * Intercala las listas (cada una ya ordenada por prioridad) en round-robin:
 * primero el mejor candidato de cada pregunta, después el segundo mejor de
 * cada una, etc. Así, cuando `maxCalls` corta la lista final, lo que se
 * pierde es parejo entre preguntas y son los pares peor rankeados de cada una
 * los que quedan afuera — nunca una pregunta entera solo por venir después en
 * el orden de iteración.
 */
function interleaveRoundRobin<T>(lists: T[][]): T[] {
  const result: T[] = [];
  const maxLength = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < maxLength; index += 1) {
    for (const list of lists) {
      if (index < list.length) result.push(list[index]);
    }
  }
  return result;
}

interface CallOutcome {
  candidate: PairCandidate;
  status: "ok" | "failed" | "fatal";
  result?: JevResult;
  error?: JevError;
}

/**
 * Pool acotado por `concurrency`. `signal` ya combina el presupuesto de
 * tiempo con el corte del llamador (armado en `analyzeSimilarity`) y se le
 * pasa a CADA llamada, para que un corte aborte también las que están en
 * curso y no solo frene las que faltan arrancar.
 *
 * Corta apenas hay un error permanente. Una llamada que termina porque
 * `signal` se activó —haya estado en curso o a punto de arrancar— cuenta como
 * salteada por tiempo, nunca como una falla: no fue Jev el que no contestó
 * bien, fue el presupuesto el que se acabó.
 */
async function runJevCalls(
  candidates: PairCandidate[],
  evaluator: JevEvaluator,
  concurrency: number,
  signal: AbortSignal,
): Promise<{ outcomes: CallOutcome[]; fatalCode: JevErrorCode | null; skippedByRuntime: number }> {
  const outcomes: CallOutcome[] = [];
  let fatalCode: JevErrorCode | null = null;
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      if (fatalCode || signal.aborted) return;
      const index = cursor;
      if (index >= candidates.length) return;
      cursor += 1;
      const candidate = candidates[index];
      try {
        const result = await evaluator(candidate.request, signal);
        outcomes.push({ candidate, status: "ok", result });
      } catch (error) {
        if (signal.aborted) return; // salteada por tiempo/corte, no fallida
        if (error instanceof JevError) {
          if (FATAL_JEV_CODES.has(error.code)) {
            fatalCode = error.code;
            outcomes.push({ candidate, status: "fatal", error });
            return;
          }
          outcomes.push({ candidate, status: "failed", error });
        } else {
          outcomes.push({ candidate, status: "failed", error: new JevError("unavailable", String(error)) });
        }
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, candidates.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { outcomes, fatalCode, skippedByRuntime: candidates.length - outcomes.length };
}

function readProbability(answer: JevAnswer | undefined): number {
  if (!answer || answer.type !== "boolean") return 0;
  return answer.probability;
}

export async function analyzeSimilarity(input: SimilarityClassInput, options: AnalyzeSimilarityOptions = {}): Promise<SimilarityReport> {
  const now = options.now ?? Date.now;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const maxCalls = options.maxCalls ?? DEFAULT_MAX_CALLS;

  // Señales de código: siempre se calculan, corra o no Jev.
  const { patterns: closedPatterns, findings: closedFindings } = computeClosedSignals(input);
  const fragmentFindings = computeFragmentSignals(input);

  const { perQuestionCandidates, notSelectedPairs } = selectCandidates(input, fragmentFindings);
  // Round-robin ANTES de aplicar maxCalls: así el tope global recorta parejo
  // entre preguntas en vez de dejar que la primera se lo coma entero.
  const allCandidates = interleaveRoundRobin(perQuestionCandidates);
  const candidates = allCandidates.slice(0, maxCalls);
  const skippedByMaxCalls = allCandidates.length - candidates.length;

  const evaluator: JevEvaluator | null =
    options.evaluator !== undefined
      ? options.evaluator
      : jevConfigured()
        ? (request, signal) => evaluateWithJev(request, { signal })
        : null;

  let status: SemanticStatus;
  let reason: string | undefined;
  let evaluatedPairs = 0;
  let failedPairs = 0;
  let skippedByRuntime = 0;
  const semanticOutcomes = new Map<string, { semantic: SemanticFindingReport; level: SignalLevel | null }>();
  let inputTokensSum: number | null = null;
  let costUsdSum: number | null = null;

  if (allCandidates.length === 0) {
    // Nada de qué comparar: no hay preguntas de desarrollo con al menos dos
    // respondentes elegibles. Es honesto decir "no hacía falta" y no
    // "no está configurado", aunque la clave falte.
    status = "not_needed";
  } else if (!evaluator) {
    status = "not_configured";
    // Ninguno de los candidatos que sí se seleccionaron llegó a evaluarse.
    skippedByRuntime = candidates.length;
  } else {
    // Una sola señal para todo: el presupuesto de tiempo Y el corte del
    // llamador, combinados. Se la pasamos a cada llamada para que un corte
    // aborte también las que están en curso, no solo las que faltan arrancar.
    const timeoutSignal = AbortSignal.timeout(timeBudgetMs);
    const signal = options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal;
    const { outcomes, fatalCode, skippedByRuntime: runtimeSkipped } = await runJevCalls(candidates, evaluator, concurrency, signal);
    skippedByRuntime = runtimeSkipped;

    for (const outcome of outcomes) {
      if (outcome.status === "ok" && outcome.result) {
        evaluatedPairs += 1;
        const answers = outcome.result.answers;
        const sharedDistinctiveWording = readProbability(answers.shared_distinctive_wording);
        const sameMistake = readProbability(answers.same_mistake);
        const rewordedCopy = readProbability(answers.reworded_copy);
        const maxProbability = Math.max(sharedDistinctiveWording, sameMistake, rewordedCopy);
        const level: SignalLevel | null =
          maxProbability >= SEMANTIC_STRONG_PROBABILITY ? "strong" : maxProbability >= SEMANTIC_REVIEW_PROBABILITY ? "review" : null;
        semanticOutcomes.set(`${outcome.candidate.pairKey}::${outcome.candidate.questionId}`, {
          semantic: { shared_distinctive_wording: sharedDistinctiveWording, same_mistake: sameMistake, reworded_copy: rewordedCopy },
          level,
        });
        if (outcome.result.usage) inputTokensSum = (inputTokensSum ?? 0) + outcome.result.usage.inputTokens;
        if (outcome.result.costUsd !== null) costUsdSum = (costUsdSum ?? 0) + outcome.result.costUsd;
      } else if (outcome.status === "failed" || outcome.status === "fatal") {
        failedPairs += 1;
      }
    }

    // `notSelectedPairs` (el prefiltro por pregunta) nunca entra acá: es
    // presupuesto gastado a propósito, no una falla ni una carrera contra el
    // reloj. Solo lo que SÍ se eligió y no se llegó a evaluar mueve a "partial".
    const skippedPairs = skippedByMaxCalls + skippedByRuntime;
    if (fatalCode) {
      status = "unavailable";
      reason = fatalCode;
    } else if (skippedPairs > 0) {
      status = "partial";
    } else if (failedPairs > 0 && evaluatedPairs === 0) {
      status = "unavailable";
      reason = outcomes.find((outcome) => outcome.status === "failed")?.error?.code;
    } else if (failedPairs > 0) {
      status = "partial";
    } else {
      status = "ok";
    }
  }

  const pairs = combinePairs(input, closedPatterns, closedFindings, fragmentFindings, semanticOutcomes);

  return {
    version: 1,
    generatedAt: now(),
    participantsCompared: input.participants.length,
    questionsCompared: input.questions.map((question) => ({ id: question.id, label: question.label, type: question.type })),
    semantic: {
      status,
      reason,
      model: "typesafe-ai/jev",
      evaluatedPairs,
      failedPairs,
      notSelectedPairs,
      skippedPairs: skippedByMaxCalls + skippedByRuntime,
      inputTokens: inputTokensSum,
      costUsd: costUsdSum,
    },
    pairs,
  };
}

// --- Combinar señales por par -------------------------------------------------

function strongerLevel(a: SignalLevel | null | undefined, b: SignalLevel | null | undefined): SignalLevel | null {
  const rank = (level: SignalLevel | null | undefined) => (level === "strong" ? 2 : level === "review" ? 1 : 0);
  if (rank(a) === 0 && rank(b) === 0) return null;
  return rank(a) >= rank(b) ? (a ?? null) : (b ?? null);
}

function responseDisplay(participant: ParticipantEntry | undefined, questionId: string): string {
  const response = participant?.responses.get(questionId);
  if (!response) return "";
  return response.kind === "long" ? response.text : response.label;
}

interface PairDraft {
  a: string;
  b: string;
  questions: Map<string, PairQuestionFinding>;
}

function combinePairs(
  input: SimilarityClassInput,
  closedPatterns: Map<string, ClosedPatternSummary>,
  closedFindings: Map<string, SharedWrongAnswerFinding[]>,
  fragmentFindings: Map<string, FragmentFinding[]>,
  semanticOutcomes: Map<string, { semantic: SemanticFindingReport; level: SignalLevel | null }>,
): SimilarityPair[] {
  const byId = new Map(input.participants.map((participant) => [participant.participantId, participant]));
  const questionById = new Map(input.questions.map((question) => [question.id, question]));
  const drafts = new Map<string, PairDraft>();

  function ensure(a: string, b: string): PairDraft {
    const key = pairKey(a, b);
    let draft = drafts.get(key);
    if (!draft) {
      const [x, y] = a < b ? [a, b] : [b, a];
      draft = { a: x, b: y, questions: new Map() };
      drafts.set(key, draft);
    }
    return draft;
  }

  // `closedFindings` ya trae, para todo par con `sharedWrong ≥ 1`, el detalle
  // de qué preguntas cerradas coincidieron (ver `computeClosedSignals`),
  // independiente de si esa coincidencia por sí sola alcanza a marcar al par
  // — esa decisión sigue siendo trabajo exclusivo del agregado `closedPattern`
  // (P(X≥S) bajo el α correspondiente), nunca de una pregunta individual. Acá
  // solo hace falta abrir el draft: el detalle en sí se arma más abajo, al
  // construir `closedPattern.questions`, para que un par que termina SIN
  // marcar (por esta ni por ninguna otra señal) no quede de todos modos en el
  // reporte.
  for (const key of closedFindings.keys()) {
    const [a, b] = key.split("|");
    ensure(a, b);
  }

  for (const [key, findings] of fragmentFindings) {
    const [a, b] = key.split("|");
    const draft = ensure(a, b);
    for (const finding of findings) {
      const question = questionById.get(finding.questionId);
      if (!question) continue;
      const existing = draft.questions.get(finding.questionId);
      draft.questions.set(finding.questionId, {
        questionId: finding.questionId,
        label: question.label,
        type: question.type,
        level: strongerLevel(finding.level, existing?.level) ?? finding.level,
        fragments: { coverage: finding.coverage, longestRun: finding.longestRun, spansA: finding.spansA, spansB: finding.spansB },
        semantic: existing?.semantic,
        answerA: existing?.answerA ?? responseDisplay(byId.get(a), finding.questionId),
        answerB: existing?.answerB ?? responseDisplay(byId.get(b), finding.questionId),
      });
    }
  }

  for (const [key, outcome] of semanticOutcomes) {
    const [pairPart, questionId] = key.split("::");
    const [a, b] = pairPart.split("|");
    const question = questionById.get(questionId);
    if (!question) continue;
    const draft = ensure(a, b);
    const existing = draft.questions.get(questionId);
    if (!existing && outcome.level === null) continue;
    const level = existing ? (strongerLevel(existing.level, outcome.level) ?? existing.level) : (outcome.level as SignalLevel);
    draft.questions.set(questionId, {
      questionId,
      label: question.label,
      type: question.type,
      level,
      fragments: existing?.fragments,
      semantic: outcome.semantic,
      answerA: existing?.answerA ?? responseDisplay(byId.get(a), questionId),
      answerB: existing?.answerB ?? responseDisplay(byId.get(b), questionId),
    });
  }

  const pairs: SimilarityPair[] = [];
  for (const [key, draft] of drafts) {
    const closedSummary = closedPatterns.get(key) ?? null;
    const questions = [...draft.questions.values()];
    // El "strong"/"review" genérico por cantidad de preguntas es de desarrollo
    // (fragmentos/semántica): lo cerrado escala solo por `closedPattern`, para
    // no duplicar su propio P(X≥S) ya corregido por comparaciones múltiples.
    const longQuestions = questions.filter((question) => question.type === "long");
    const strongQuestion = longQuestions.some((question) => question.level === "strong");
    const reviewCount = longQuestions.filter((question) => question.level === "review").length;

    let level: SignalLevel | null = null;
    if (strongQuestion || closedSummary?.level === "strong" || reviewCount >= 2) level = "strong";
    else if (reviewCount >= 1 || closedSummary?.level === "review") level = "review";
    if (!level) continue;

    const participantA = byId.get(draft.a);
    const participantB = byId.get(draft.b);
    if (!participantA || !participantB) continue;

    pairs.push({
      a: { participantId: participantA.participantId, name: participantA.name },
      b: { participantId: participantB.participantId, name: participantB.name },
      level,
      closedPattern:
        closedSummary && closedSummary.sharedWrong > 0
          ? {
              sharedWrong: closedSummary.sharedWrong,
              expectedByChance: closedSummary.expectedByChance,
              pValue: closedSummary.pValue,
              questions: (closedFindings.get(key) ?? []).flatMap((finding) => {
                const question = questionById.get(finding.questionId);
                return question ? [{ questionId: finding.questionId, label: question.label, answerLabel: finding.label, othersWithSame: finding.othersWithSame }] : [];
              }),
            }
          : undefined,
      questions,
    });
  }

  return sortPairs(pairs);
}

function questionScore(finding: PairQuestionFinding): number {
  if (finding.semantic) return Math.max(finding.semantic.shared_distinctive_wording, finding.semantic.same_mistake, finding.semantic.reworded_copy);
  if (finding.fragments) return finding.fragments.coverage;
  return 0;
}

function sortPairs(pairs: SimilarityPair[]): SimilarityPair[] {
  return [...pairs].sort((x, y) => {
    if (x.level !== y.level) return x.level === "strong" ? -1 : 1;
    if (x.questions.length !== y.questions.length) return y.questions.length - x.questions.length;
    const scoreX = Math.max(0, ...x.questions.map(questionScore));
    const scoreY = Math.max(0, ...y.questions.map(questionScore));
    return scoreY - scoreX;
  });
}

// --- Adaptador: de la corrida real a la entrada pura de similarity-signals ---
//
// Arma la entrada desde el paquete de preguntas de CADA alumno
// (`questionsForParticipant`), no desde el pozo entero de la toma: así, si dos
// alumnos recibieron variantes distintas de una pregunta (`ai-variants.ts`) o
// un subconjunto distinto del pozo, cada una queda con su propio id y nunca se
// comparan entre sí. Sin tests de unidad a propósito: toca la base, y las
// pruebas de este repo son sobre funciones puras.

export async function buildSimilarityClassInput(runId: string, actor: Actor): Promise<SimilarityClassInput | null> {
  const run = await getRunForTeacher(runId, actor);
  if (!run) return null;

  const participantsResult = await db
    .prepare("SELECT id, display_name, assigned_questions_snapshot FROM participants WHERE run_id = ? AND status = 'submitted' ORDER BY display_name")
    .bind(runId)
    .all<{ id: string; display_name: string; assigned_questions_snapshot: string | null }>();

  const questionMap = new Map<string, SimilarityQuestion>();
  const participants = await Promise.all(
    participantsResult.results.map(async (row): Promise<ParticipantEntry> => {
      const assigned = questionsForParticipant(run, { id: row.id, assigned_questions_snapshot: row.assigned_questions_snapshot });
      const answerResult = await db
        .prepare("SELECT question_id, value FROM answers WHERE participant_id = ?")
        .bind(row.id)
        .all<{ question_id: string; value: string }>();
      const answerByQuestion = new Map(answerResult.results.map((answer) => [answer.question_id, JSON.parse(answer.value) as AnswerValue]));

      const responses = new Map<string, ParticipantResponse>();
      for (const question of assigned) {
        if (!questionMap.has(question.id)) {
          questionMap.set(question.id, {
            id: question.id,
            label: questionLabel(question.prompt),
            type: question.type,
            prompt: question.prompt,
            expectedText: expectedTextFor(question),
            wrongOptionCount: question.type === "mc" ? question.config.options.length - 1 : undefined,
          });
        }
        const normalized = normalizeResponse(question, answerByQuestion.get(question.id) ?? null);
        if (normalized) responses.set(question.id, normalized);
      }
      return { participantId: row.id, name: row.display_name, responses };
    }),
  );

  return { questions: [...questionMap.values()], participants };
}
