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

// --- mc/ms/tf/sa: opciones o respuestas cortas compartidas y raras ----------

export const CLOSED_MIN_RESPONDENTS = 5;
export const CLOSED_RARITY_RATIO = 0.1;
export const CLOSED_RARE_STRONG_COUNT = 3;
export const CLOSED_RARE_REVIEW_COUNT = 2;
export const CLOSED_SHARED_WRONG_REVIEW_COUNT = 4;

export interface SharedWrongAnswerFinding {
  questionId: string;
  label: string;
  /** Cuántos otros alumnos (sin contar al par) escribieron exactamente lo mismo. */
  othersWithSame: number;
  rare: boolean;
}

/**
 * Para cada pregunta cerrada o de respuesta corta, agrupa a quienes
 * respondieron MAL lo mismo y arma, por cada par que coincide, el hallazgo con
 * su rareza. Se salta preguntas con menos de `CLOSED_MIN_RESPONDENTS`
 * respondentes: con una clase chica cualquier coincidencia parece rara.
 */
export function computeClosedSignals(input: SimilarityClassInput): Map<string, SharedWrongAnswerFinding[]> {
  const result = new Map<string, SharedWrongAnswerFinding[]>();

  for (const question of input.questions) {
    if (question.type === "long") continue;

    const responders: Array<{ participantId: string; response: ClosedResponse | ShortAnswerResponse }> = [];
    for (const participant of input.participants) {
      const response = participant.responses.get(question.id);
      if (response && response.kind !== "long") responders.push({ participantId: participant.participantId, response });
    }
    const respondents = responders.length;
    if (respondents < CLOSED_MIN_RESPONDENTS) continue;

    const wrongByKey = new Map<string, { label: string; participantIds: string[] }>();
    for (const { participantId, response } of responders) {
      if (response.correct) continue;
      const key = response.kind === "closed" ? `mc:${response.key}` : `sa:${response.normalized}`;
      const bucket = wrongByKey.get(key) ?? { label: response.label, participantIds: [] };
      bucket.participantIds.push(participantId);
      wrongByKey.set(key, bucket);
    }

    for (const { label, participantIds } of wrongByKey.values()) {
      if (participantIds.length < 2) continue;
      const othersWithSame = participantIds.length - 2;
      const threshold = Math.floor(CLOSED_RARITY_RATIO * (respondents - 2));
      const rare = othersWithSame <= threshold;
      for (let i = 0; i < participantIds.length; i += 1) {
        for (let j = i + 1; j < participantIds.length; j += 1) {
          const key = pairKey(participantIds[i], participantIds[j]);
          const findings = result.get(key) ?? [];
          findings.push({ questionId: question.id, label, othersWithSame, rare });
          result.set(key, findings);
        }
      }
    }
  }

  return result;
}

export interface ClosedPatternSummary {
  sharedWrong: number;
  rareShared: number;
  level: SignalLevel | null;
}

/** Tally por par sobre TODAS sus preguntas cerradas/sa compartidas mal. */
export function summarizeClosedPattern(findings: SharedWrongAnswerFinding[]): ClosedPatternSummary {
  const sharedWrong = findings.length;
  const rareShared = findings.filter((finding) => finding.rare).length;
  let level: SignalLevel | null = null;
  if (rareShared >= CLOSED_RARE_STRONG_COUNT) level = "strong";
  else if (rareShared === CLOSED_RARE_REVIEW_COUNT || (rareShared >= 1 && sharedWrong >= CLOSED_SHARED_WRONG_REVIEW_COUNT)) level = "review";
  return { sharedWrong, rareShared, level };
}

// --- Desarrollo: fragmentos compartidos y raros ------------------------------

export const SHINGLE_SIZE = 5;
export const FRAGMENT_DF_RARITY_FLOOR = 2;
export const FRAGMENT_DF_RARITY_RATIO = 0.1;
export const FRAGMENT_COVERAGE_STRONG = 0.4;
export const FRAGMENT_LONGEST_RUN_STRONG = 12;
export const FRAGMENT_COVERAGE_REVIEW = 0.15;
export const FRAGMENT_LONGEST_RUN_REVIEW = 8;

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
        if (!level) continue;

        const key = pairKey(a.participantId, b.participantId);
        const findings = result.get(key) ?? [];
        findings.push({ questionId: question.id, coverage, longestRun, spansA: runA.spans, spansB: runB.spans, level });
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
