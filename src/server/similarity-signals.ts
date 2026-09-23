import type { AnswerValue } from "@/server/grading";
import { normalizeShortAnswer, sameStringSet } from "@/server/grading";
import type { FullQuestion } from "@/domain/exam";

// Señales de copia entre alumnos que puede calcular el código: contar y medir
// rareza es aritmética, que es justo la debilidad documentada de Jev. Este
// módulo es puro (sin `db`, sin `fetch`) para poder probarlo con clases
// armadas a mano; el adaptador que lee la corrida real vive en
// `similarity-analysis.ts`. Ver `odd/tasks/jev-copy-detection.md`.

export type SignalLevel = "strong" | "review";

// --- Entrada, independiente de la base --------------------------------------

export type SimilarityQuestionType = "mc" | "ms" | "tf" | "sa" | "long";

export interface SimilarityQuestion {
  id: string;
  /** Corto y legible; no usa `position` porque el sorteo por alumno lo reasigna. */
  label: string;
  type: SimilarityQuestionType;
  prompt: string;
  /** Lo que se espera: la clave correcta, o para "long" la referencia + rúbrica. */
  expectedText: string;
  /**
   * Solo mc: cantidad de opciones incorrectas (`options.length - 1`). Alimenta
   * el modelo de azar de coincidencias cerradas (ver `computeClosedSignals`);
   * si falta, se estima empíricamente a partir de lo observado.
   */
  wrongOptionCount?: number;
}

export interface ClosedResponse {
  kind: "closed";
  /** Clave canónica: el id de la opción, o los ids elegidos en "ms" ordenados y unidos. */
  key: string;
  label: string;
  correct: boolean;
}

export interface ShortAnswerResponse {
  kind: "sa";
  normalized: string;
  label: string;
  correct: boolean;
}

export interface LongResponse {
  kind: "long";
  text: string;
}

export type ParticipantResponse = ClosedResponse | ShortAnswerResponse | LongResponse;

export interface ParticipantEntry {
  participantId: string;
  name: string;
  /** Solo las preguntas que este alumno respondió: así una variante distinta nunca se compara con otra. */
  responses: Map<string, ParticipantResponse>;
}

export interface SimilarityClassInput {
  questions: SimilarityQuestion[];
  participants: ParticipantEntry[];
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function questionLabel(prompt: string, max = 80): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

// --- Adaptadores puros desde el dominio del examen --------------------------
//
// Convierten una `FullQuestion` + el valor crudo guardado en `answers` en la
// forma normalizada de arriba. No tocan la base: reciben lo que ya se leyó.

export function normalizeResponse(question: FullQuestion, value: AnswerValue): ParticipantResponse | null {
  switch (question.type) {
    case "mc": {
      if (typeof value !== "string" || !value) return null;
      const option = question.config.options.find((candidate) => candidate.id === value);
      if (!option) return null;
      return { kind: "closed", key: option.id, label: option.text, correct: option.id === question.config.correctOptionId };
    }
    case "ms": {
      const raw = Array.isArray(value) ? value : [];
      const validIds = new Set(question.config.options.map((option) => option.id));
      const selected = [...new Set(raw.filter((id) => validIds.has(id)))];
      if (!selected.length) return null;
      const key = [...selected].sort().join(",");
      const label = question.config.options
        .filter((option) => selected.includes(option.id))
        .map((option) => option.text)
        .join(", ");
      return { kind: "closed", key, label, correct: sameStringSet(selected, question.config.correctOptionIds) };
    }
    case "tf": {
      if (typeof value !== "boolean") return null;
      return { kind: "closed", key: value ? "true" : "false", label: value ? "Verdadero" : "Falso", correct: value === question.config.correct };
    }
    case "sa": {
      if (typeof value !== "string" || !value.trim()) return null;
      const normalized = normalizeShortAnswer(value);
      if (!normalized) return null;
      const correct = question.config.accepted.some((accepted) => normalizeShortAnswer(accepted) === normalized);
      return { kind: "sa", normalized, label: value.trim(), correct };
    }
    case "long": {
      if (typeof value !== "string" || !value.trim()) return null;
      return { kind: "long", text: value };
    }
  }
}

/** Lo que se espera para esta pregunta: la clave correcta, o para "long" la referencia + rúbrica. */
export function expectedTextFor(question: FullQuestion): string {
  switch (question.type) {
    case "mc":
      return question.config.options.find((option) => option.id === question.config.correctOptionId)?.text ?? "";
    case "ms":
      return question.config.options
        .filter((option) => question.config.correctOptionIds.includes(option.id))
        .map((option) => option.text)
        .join(", ");
    case "tf":
      return question.config.correct ? "Verdadero" : "Falso";
    case "sa":
      return question.config.accepted.join(" / ");
    case "long": {
      const rubricLabels = (question.config.rubric ?? []).map((criterion) => criterion.label);
      const parts = [question.config.referenceAnswer, ...rubricLabels, question.config.gradingCriteria].filter(
        (part): part is string => Boolean(part && part.trim()),
      );
      return parts.join("\n");
    }
  }
}

// --- Normalización con offsets -----------------------------------------------
//
// Tokeniza directamente sobre el texto ORIGINAL (nunca sobre una copia ya
// normalizada), así el offset de cada token queda expresado en las
// coordenadas del texto real y sirve para recortarlo tal cual —con acentos y
// puntuación— al resaltar un fragmento compartido.

export interface Token {
  /** Normalizado: minúscula, sin diacríticos. Solo para comparar. */
  text: string;
  /** Offset en el texto ORIGINAL (inclusive). */
  start: number;
  /** Offset en el texto ORIGINAL (exclusivo). */
  end: number;
}

const DIACRITICS_RE = /[̀-ͯ]/g;
// \p{M} además de \p{L}\p{N}: si el texto llegara ya descompuesto (NFD), la
// marca combinante no es \p{L} por sí sola y un token como "é" se cortaría mal.
const WORD_RE = /[\p{L}\p{N}\p{M}]+/gu;

export function normalizeToken(raw: string): string {
  return raw.normalize("NFD").replace(DIACRITICS_RE, "").toLocaleLowerCase("es");
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(WORD_RE)) {
    const start = match.index ?? 0;
    tokens.push({ text: normalizeToken(match[0]), start, end: start + match[0].length });
  }
  return tokens;
}

export const LONG_MIN_TOKENS = 12;

export function isLongEligible(tokens: Token[]): boolean {
  return tokens.length >= LONG_MIN_TOKENS;
}

// --- mc/ms/tf/sa: coincidencias cerradas frente al azar ---------------------
//
// En vez de "¿esto es raro?" con un umbral fijo, se estima cuán probable era
// PURO AZAR que dos alumnos que fallaron la misma pregunta hayan elegido la
// MISMA respuesta mala, a partir de lo que el resto de la clase realmente
// eligió (sin el par). Sumando esa probabilidad pregunta por pregunta se arma
// una binomial de Poisson: la evidencia real es P(coincidir tantas veces o
// más por azar), no un conteo contra un umbral arbitrario. Así el docente
// puede leer "coinciden en 4 respuestas incorrectas; por azar lo esperable
// era 1,2" en vez de un semáforo sin explicación.

export const CLOSED_MIN_RESPONDENTS = 5;
/**
 * Calibrados en T4 contra tres simulaciones de 200 semillas (15 mc, 10 tf, y
 * un examen mixto de 25 con sa de cola larga), probando α_review ∈ {0.05,
 * 0.2, 1} y α_strong ∈ {0.001, 0.01}. El criterio: a lo sumo 0,2 pares
 * inocentes marcados por clase en promedio, con la mejor detección posible.
 * α_review = 1 (P ≤ 1/nPares) lo cumple con 0,045 (15 mc) y 0,12 (mixto) y
 * duplica la detección del mixto (50,5 % contra 27 % con 0,05); α_strong =
 * 0,01 sube la detección "fuerte" del mixto de 8 % a 17,3 % sin sumar falsos.
 * Los falsos que quedan son siempre "para revisar", nunca "fuerte". Solo-tf
 * no detecta nada con ningún α (π = 1: coincidir en un falso no dice nada) y
 * solo-mc detecta poco (12 %): con tres opciones incorrectas, Σp² ≥ 1/3 y
 * hacen falta muchas coincidencias para salir del azar. Ver
 * `scripts/copy-eval/results/` para la tabla completa.
 */
export const CLOSED_ALPHA_REVIEW = 1;
export const CLOSED_ALPHA_STRONG = 0.01;
export const CLOSED_MIN_SHARED_REVIEW = 2;
export const CLOSED_MIN_SHARED_STRONG = 3;

export interface SharedWrongAnswerFinding {
  questionId: string;
  label: string;
  /** Cuántos otros alumnos (sin contar al par) escribieron exactamente lo mismo. */
  othersWithSame: number;
}

export interface ClosedPatternSummary {
  /** S: preguntas donde el par falló exactamente igual. */
  sharedWrong: number;
  /** E: cuántas coincidencias así se esperaban por puro azar (redondeado a 1 decimal, para mostrarlo). */
  expectedByChance: number;
  /** P(X ≥ S) bajo el modelo de azar (binomial de Poisson sobre las preguntas donde ambos fallaron). */
  pValue: number;
  level: SignalLevel | null;
}

export interface ClosedAnalysis {
  /** Un resumen por cada par con al menos una pregunta donde ambos fallaron, esté o no marcado. */
  patterns: Map<string, ClosedPatternSummary>;
  /**
   * Para todo par con al menos una coincidencia (`sharedWrong ≥ 1`), esté o no
   * marcado por el modelo de azar: el detalle de qué preguntas coincidieron y
   * con qué respuesta. Independiente de `level` a propósito, para que el
   * docente pueda ver la evidencia cruda aunque, por sí sola, no alcance la
   * significancia estadística que exige `closedLevelFor` (el par puede estar
   * igual marcado por otra señal).
   */
  findings: Map<string, SharedWrongAnswerFinding[]>;
}

/**
 * P(X ≥ s) para X = suma de variables Bernoulli independientes (no
 * necesariamente idénticas) con las probabilidades dadas: la cola de una
 * binomial de Poisson, exacta, vía programación dinámica O(n²) con n =
 * cantidad de preguntas. `dp[k]` es la probabilidad de exactamente k éxitos
 * tras procesar las probabilidades ya vistas.
 */
export function poissonBinomialTailProbability(probabilities: number[], s: number): number {
  if (s <= 0) return 1;
  if (s > probabilities.length) return 0;
  let dp = [1];
  for (const p of probabilities) {
    const next = new Array(dp.length + 1).fill(0);
    for (let k = 0; k < dp.length; k += 1) {
      next[k] += dp[k] * (1 - p);
      next[k + 1] += dp[k] * p;
    }
    dp = next;
  }
  let tail = 0;
  for (let k = s; k < dp.length; k += 1) tail += dp[k];
  return tail;
}

/**
 * Decide el nivel a partir de S y P ya calculados, con corrección por
 * comparaciones múltiples sobre los pares de la clase (`nPairs`). Separado de
 * `computeClosedSignals` para que quien calibre (el harness de evaluación)
 * pueda probar otros α sobre los mismos S/P ya calculados sin recalcular nada
 * ni tocar las constantes de producción.
 */
export function closedLevelFor(
  sharedWrong: number,
  pValue: number,
  nPairs: number,
  alphaReview = CLOSED_ALPHA_REVIEW,
  alphaStrong = CLOSED_ALPHA_STRONG,
): SignalLevel | null {
  if (nPairs <= 0) return null;
  if (sharedWrong >= CLOSED_MIN_SHARED_STRONG && pValue <= alphaStrong / nPairs) return "strong";
  if (sharedWrong >= CLOSED_MIN_SHARED_REVIEW && pValue <= alphaReview / nPairs) return "review";
  return null;
}

interface WrongEntry {
  participantId: string;
  key: string;
  label: string;
}

/**
 * π_q = P(dos alumnos que fallaron esta pregunta, elegidos al azar de la
 * distribución observada en el RESTO de la clase, eligen la misma opción
 * mala), con suavizado de Laplace: `p_o = (count_o + 0.5) / (total + 0.5·K)`.
 * K es la cantidad de opciones incorrectas posibles: fija para mc (si se
 * conoce) y para tf (siempre 1, lo que da π = 1: con una sola forma posible
 * de estar mal, coincidir no es evidencia de nada); empírica con +1
 * (Good-Turing) para ms/sa y para mc sin metadata, porque su espacio de
 * respuestas incorrectas no está acotado de antemano.
 */
function estimateCollisionProbability(
  type: SimilarityQuestionType,
  wrongOptionCount: number | undefined,
  countByOption: Map<string, number>,
  totalOthers: number,
): number {
  const k = type === "tf" ? 1 : type === "mc" && wrongOptionCount !== undefined ? wrongOptionCount : countByOption.size + 1;
  const denom = totalOthers + 0.5 * k;
  let sumSquares = 0;
  for (const count of countByOption.values()) {
    const p = (count + 0.5) / denom;
    sumSquares += p * p;
  }
  const unseen = Math.max(0, k - countByOption.size);
  if (unseen > 0) {
    const pUnseen = 0.5 / denom;
    sumSquares += unseen * pUnseen * pUnseen;
  }
  return sumSquares;
}

/**
 * Por cada par, junta las preguntas cerradas o de respuesta corta donde AMBOS
 * fallaron, estima qué tan probable era por azar que coincidieran tantas
 * veces como coincidieron, y decide el nivel con corrección por comparaciones
 * múltiples. Se salta preguntas con menos de `CLOSED_MIN_RESPONDENTS`
 * respondentes: con una clase chica cualquier estimación es inestable.
 */
export function computeClosedSignals(input: SimilarityClassInput): ClosedAnalysis {
  const patterns = new Map<string, ClosedPatternSummary>();
  const findings = new Map<string, SharedWrongAnswerFinding[]>();

  const participantCount = input.participants.length;
  const nPairs = (participantCount * (participantCount - 1)) / 2;
  if (nPairs === 0) return { patterns, findings };

  interface QuestionWrongData {
    type: SimilarityQuestionType;
    wrongOptionCount: number | undefined;
    entries: WrongEntry[];
    byParticipant: Map<string, WrongEntry>;
  }
  const wrongByQuestion = new Map<string, QuestionWrongData>();

  for (const question of input.questions) {
    if (question.type === "long") continue;
    let respondents = 0;
    const entries: WrongEntry[] = [];
    for (const participant of input.participants) {
      const response = participant.responses.get(question.id);
      if (!response || response.kind === "long") continue;
      respondents += 1;
      if (response.correct) continue;
      const key = response.kind === "closed" ? response.key : `sa:${response.normalized}`;
      entries.push({ participantId: participant.participantId, key, label: response.label });
    }
    if (respondents < CLOSED_MIN_RESPONDENTS) continue;
    wrongByQuestion.set(question.id, {
      type: question.type,
      wrongOptionCount: question.wrongOptionCount,
      entries,
      byParticipant: new Map(entries.map((entry) => [entry.participantId, entry])),
    });
  }

  const ids = input.participants.map((participant) => participant.participantId);
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i];
      const b = ids[j];
      const probabilities: number[] = [];
      const matches: SharedWrongAnswerFinding[] = [];

      for (const [questionId, data] of wrongByQuestion) {
        const wrongA = data.byParticipant.get(a);
        const wrongB = data.byParticipant.get(b);
        if (!wrongA || !wrongB) continue;

        const countByOption = new Map<string, number>();
        let totalOthers = 0;
        for (const entry of data.entries) {
          if (entry.participantId === a || entry.participantId === b) continue;
          countByOption.set(entry.key, (countByOption.get(entry.key) ?? 0) + 1);
          totalOthers += 1;
        }

        probabilities.push(estimateCollisionProbability(data.type, data.wrongOptionCount, countByOption, totalOthers));

        if (wrongA.key === wrongB.key) {
          matches.push({ questionId, label: wrongA.label, othersWithSame: countByOption.get(wrongA.key) ?? 0 });
        }
      }

      if (!probabilities.length) continue;

      const sharedWrong = matches.length;
      const expected = probabilities.reduce((sum, p) => sum + p, 0);
      const pValue = poissonBinomialTailProbability(probabilities, sharedWrong);
      const level = closedLevelFor(sharedWrong, pValue, nPairs);

      const key = pairKey(a, b);
      patterns.set(key, { sharedWrong, expectedByChance: Math.round(expected * 10) / 10, pValue, level });
      // Independiente de `level`: un par que termina marcado por OTRA señal
      // (fragmentos, semántica) igual quiere mostrar sus coincidencias
      // cerradas como evidencia, aunque por sí solas no alcancen a marcarlo.
      if (matches.length) findings.set(key, matches);
    }
  }

  return { patterns, findings };
}

// --- Desarrollo: fragmentos compartidos y raros ------------------------------

export const SHINGLE_SIZE = 5;
export const FRAGMENT_DF_RARITY_FLOOR = 2;
export const FRAGMENT_DF_RARITY_RATIO = 0.1;
export const FRAGMENT_COVERAGE_STRONG = 0.4;
export const FRAGMENT_LONGEST_RUN_STRONG = 12;
export const FRAGMENT_COVERAGE_REVIEW = 0.15;
export const FRAGMENT_LONGEST_RUN_REVIEW = 8;
/**
 * Segundo camino a "review", independiente de la cobertura: una respuesta
 * larga diluye la cobertura de un tramo compartido aunque ese tramo sea
 * clarísimo. Motivado por el caso real "Ley de Inercia Térmica de
 * Torricelli" (T4): longestRun 8, coverage 0.135 (por debajo de 0.15).
 *
 * Calibrado contra el dataset de T4 empezando en 8: en 8-10 agrega falsos
 * positivos nuevos (memorizers que reprodujeron la misma definición de
 * clase palabra por palabra — `expectedText` solo excluye la respuesta de
 * referencia, no esa definición, a propósito: un docente real rara vez la
 * carga). 11 es el valor más chico que no agrega ninguno; en ese punto,
 * sobre este dataset, el camino queda como red de seguridad sin aportar
 * recall extra (el propio caso Torricelli tiene longestRun=8 y no llega).
 * Documentado así para que se pueda recalibrar con más datos, no porque el
 * número sea definitivo.
 */
export const FRAGMENT_LONGEST_RUN_ALONE_REVIEW = 11;

export interface Shingle {
  /** Los `SHINGLE_SIZE` tokens normalizados, unidos por un espacio. */
  text: string;
  start: number;
  end: number;
  /** Índice del primer token del shingle en la lista de tokens del texto. */
  tokenIndex: number;
}

export function shingles(tokens: Token[], size = SHINGLE_SIZE): Shingle[] {
  if (tokens.length < size) return [];
  const result: Shingle[] = [];
  for (let index = 0; index <= tokens.length - size; index += 1) {
    const window = tokens.slice(index, index + size);
    result.push({
      text: window.map((token) => token.text).join(" "),
      start: window[0].start,
      end: window[window.length - 1].end,
      tokenIndex: index,
    });
  }
  return result;
}

export interface FragmentSpan {
  start: number;
  end: number;
}

export interface FragmentFinding {
  questionId: string;
  coverage: number;
  /** Tokens del tramo compartido más largo, del lado que lo tenga más largo. */
  longestRun: number;
  spansA: FragmentSpan[];
  spansB: FragmentSpan[];
  level: SignalLevel;
}

function mergeSharedRuns(tokens: Token[], shingleList: Shingle[], sharedRareTexts: Set<string>): { spans: FragmentSpan[]; longestRun: number } {
  const covered = new Array<boolean>(tokens.length).fill(false);
  for (const shingle of shingleList) {
    if (!sharedRareTexts.has(shingle.text)) continue;
    for (let index = shingle.tokenIndex; index < shingle.tokenIndex + SHINGLE_SIZE; index += 1) covered[index] = true;
  }

  const spans: FragmentSpan[] = [];
  let longestRun = 0;
  let runStart = -1;
  for (let index = 0; index <= tokens.length; index += 1) {
    const isCovered = index < tokens.length && covered[index];
    if (isCovered && runStart === -1) runStart = index;
    if (!isCovered && runStart !== -1) {
      longestRun = Math.max(longestRun, index - runStart);
      spans.push({ start: tokens[runStart].start, end: tokens[index - 1].end });
      runStart = -1;
    }
  }
  return { spans, longestRun };
}

/**
 * Fragmentos de texto que dos alumnos comparten y que casi nadie más de la
 * clase escribió, excluyendo lo que ya está en la consigna o en lo esperado
 * (una definición que todos repiten no es una coincidencia).
 */
export function computeFragmentSignals(input: SimilarityClassInput): Map<string, FragmentFinding[]> {
  const result = new Map<string, FragmentFinding[]>();

  for (const question of input.questions) {
    if (question.type !== "long") continue;

    const excluded = new Set<string>();
    for (const text of [question.prompt, question.expectedText]) {
      if (!text) continue;
      for (const shingle of shingles(tokenize(text))) excluded.add(shingle.text);
    }

    interface Eligible {
      participantId: string;
      tokens: Token[];
      shingleList: Shingle[];
      shingleSet: Set<string>;
    }
    const eligible: Eligible[] = [];
    for (const participant of input.participants) {
      const response = participant.responses.get(question.id);
      if (!response || response.kind !== "long") continue;
      const tokens = tokenize(response.text);
      if (!isLongEligible(tokens)) continue;
      const shingleList = shingles(tokens).filter((shingle) => !excluded.has(shingle.text));
      if (!shingleList.length) continue;
      eligible.push({ participantId: participant.participantId, tokens, shingleList, shingleSet: new Set(shingleList.map((s) => s.text)) });
    }
    if (eligible.length < 2) continue;

    const respondents = eligible.length;
    const dfThreshold = Math.max(FRAGMENT_DF_RARITY_FLOOR, Math.floor(FRAGMENT_DF_RARITY_RATIO * respondents));
    const df = new Map<string, number>();
    for (const entry of eligible) {
      for (const text of entry.shingleSet) df.set(text, (df.get(text) ?? 0) + 1);
    }

    for (let i = 0; i < eligible.length; i += 1) {
      for (let j = i + 1; j < eligible.length; j += 1) {
        const a = eligible[i];
        const b = eligible[j];
        const denom = Math.min(a.shingleSet.size, b.shingleSet.size);
        if (denom === 0) continue;

        const sharedRare = new Set<string>();
        for (const text of a.shingleSet) {
          if (b.shingleSet.has(text) && (df.get(text) ?? 0) <= dfThreshold) sharedRare.add(text);
        }
        if (!sharedRare.size) continue;

        const coverage = sharedRare.size / denom;
        const runA = mergeSharedRuns(a.tokens, a.shingleList, sharedRare);
        const runB = mergeSharedRuns(b.tokens, b.shingleList, sharedRare);
        const longestRun = Math.max(runA.longestRun, runB.longestRun);

        let level: SignalLevel | null = null;
        if (coverage >= FRAGMENT_COVERAGE_STRONG && longestRun >= FRAGMENT_LONGEST_RUN_STRONG) level = "strong";
        else if (coverage >= FRAGMENT_COVERAGE_REVIEW && longestRun >= FRAGMENT_LONGEST_RUN_REVIEW) level = "review";
        // Camino aparte, sin pedir cobertura: un tramo raro y largo alcanza
        // solo, aunque el resto de la respuesta sea largo y lo diluya.
        else if (longestRun >= FRAGMENT_LONGEST_RUN_ALONE_REVIEW) level = "review";
        if (!level) continue;

        const key = pairKey(a.participantId, b.participantId);
        // `pairKey` ordena por id, no por el orden en que `eligible` (que sigue
        // el orden de `input.participants`, o sea el de la consulta SQL por
        // `display_name`) trae a `a`/`b`. Sin esto, cuando el orden del array
        // no coincide con el orden de los ids, `spansA` terminaba siendo los
        // spans de `a` (el que vino primero en el array) pero asignados al
        // participante que `combinePairs` arma como "A" a partir de la key ya
        // ordenada (el id menor) — que podía ser el otro. Acá se orientan los
        // spans al mismo criterio que la key, así "A" siempre es el id menor
        // de los dos, sin importar en qué orden llegaron.
        const [spansA, spansB] = a.participantId < b.participantId ? [runA.spans, runB.spans] : [runB.spans, runA.spans];
        const findings = result.get(key) ?? [];
        findings.push({ questionId: question.id, coverage, longestRun, spansA, spansB, level });
        result.set(key, findings);
      }
    }
  }

  return result;
}

// --- Desarrollo: ranking TF-IDF para elegir a quién le conviene preguntarle a Jev ---

export const MIN_CONTENT_TOKEN_LENGTH = 3;

// Lista corta e inline a propósito: solo para bajar el ruido del ranking, no
// para nada que decida por sí solo si hay copia.
const STOPWORDS_ES = new Set([
  "que", "los", "las", "una", "unos", "unas", "del", "por", "para", "con",
  "como", "más", "mas", "pero", "esta", "esta", "este", "estos", "estas",
  "eso", "esa", "esos", "esas", "hay", "hace", "tiene", "tienen", "también",
  "sobre", "entre", "desde", "cuando", "donde", "todo", "toda", "todos",
  "todas", "muy", "sin", "sea", "ser", "son", "fue", "han", "the", "and",
]);

export interface RankedPair {
  a: string;
  b: string;
  score: number;
}

function contentTokens(tokens: Token[]): string[] {
  return tokens.filter((token) => token.text.length >= MIN_CONTENT_TOKEN_LENGTH && !STOPWORDS_ES.has(token.text)).map((token) => token.text);
}

function featuresOf(contentSeq: string[]): string[] {
  const features = [...contentSeq];
  for (let index = 0; index < contentSeq.length - 1; index += 1) features.push(`${contentSeq[index]} ${contentSeq[index + 1]}`);
  return features;
}

/**
 * Ranking de pares por similitud TF-IDF (unigramas + bigramas) sobre una
 * pregunta de desarrollo. No es evidencia de copia por sí solo —una clase que
 * estudió lo mismo tiene TF-IDF alto entre casi todos—, es nada más el orden
 * en el que conviene gastar el presupuesto de llamadas a Jev.
 */
export function rankPairsByTfIdf(input: SimilarityClassInput, questionId: string): RankedPair[] {
  const question = input.questions.find((candidate) => candidate.id === questionId);
  if (!question || question.type !== "long") return [];

  interface Entry {
    participantId: string;
    tf: Map<string, number>;
  }
  const entries: Entry[] = [];
  for (const participant of input.participants) {
    const response = participant.responses.get(questionId);
    if (!response || response.kind !== "long") continue;
    const tokens = tokenize(response.text);
    if (!isLongEligible(tokens)) continue;
    const features = featuresOf(contentTokens(tokens));
    if (!features.length) continue;
    const tf = new Map<string, number>();
    for (const feature of features) tf.set(feature, (tf.get(feature) ?? 0) + 1);
    entries.push({ participantId: participant.participantId, tf });
  }
  if (entries.length < 2) return [];

  const totalDocs = entries.length;
  const df = new Map<string, number>();
  for (const entry of entries) {
    for (const feature of entry.tf.keys()) df.set(feature, (df.get(feature) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [feature, count] of df) idf.set(feature, Math.log((totalDocs + 1) / (count + 1)) + 1);

  interface Vector {
    participantId: string;
    weights: Map<string, number>;
    norm: number;
  }
  const vectors: Vector[] = entries.map((entry) => {
    const weights = new Map<string, number>();
    let normSq = 0;
    for (const [feature, tf] of entry.tf) {
      const weight = tf * (idf.get(feature) ?? 0);
      weights.set(feature, weight);
      normSq += weight * weight;
    }
    return { participantId: entry.participantId, weights, norm: Math.sqrt(normSq) };
  });

  const ranked: RankedPair[] = [];
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      const va = vectors[i];
      const vb = vectors[j];
      if (va.norm === 0 || vb.norm === 0) continue;
      const [smaller, larger] = va.weights.size <= vb.weights.size ? [va, vb] : [vb, va];
      let dot = 0;
      for (const [feature, weight] of smaller.weights) {
        const otherWeight = larger.weights.get(feature);
        if (otherWeight !== undefined) dot += weight * otherWeight;
      }
      const score = dot / (va.norm * vb.norm);
      if (score > 0) ranked.push({ a: va.participantId, b: vb.participantId, score });
    }
  }
  ranked.sort((x, y) => y.score - x.score);
  return ranked;
}
