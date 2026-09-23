import { readFileSync } from "node:fs";

import { pairKey, type ParticipantEntry, type SimilarityClassInput, type SimilarityQuestion } from "@/server/similarity-signals";

// Carga y adapta `dataset.json` (generado por `generate.mjs`) a las formas que
// entiende el resto del repo. Ninguna otra parte del harness lee el JSON
// crudo directamente: todas pasan por acá.

export type CopyKind = "verbatim" | "partial" | "paraphrase" | "shared_error";
export type HardNegativeKind = "class_definition" | "common_misconception";
export type AnswerRole = "independent" | "memorizer" | "common_misconception" | "distinctive_error_source" | "copy";

export interface DatasetAnswer {
  id: string;
  role: AnswerRole;
  profile: string;
  text: string;
  copyOf?: string;
  copyKind?: CopyKind;
}

export interface DatasetPair {
  a: string;
  b: string;
  kind: string;
}

export interface DatasetQuestion {
  id: string;
  subject: string;
  prompt: string;
  referenceAnswer: string;
  classDefinition: string;
  answers: DatasetAnswer[];
  positives: DatasetPair[];
  hardNegatives: DatasetPair[];
}

export interface Dataset {
  version: number;
  generatedAt: string;
  questions: DatasetQuestion[];
}

export function loadDataset(path: string): Dataset {
  return JSON.parse(readFileSync(path, "utf-8")) as Dataset;
}

/**
 * Arma la clase de UNA pregunta como la vería producción: una sola pregunta
 * de desarrollo, con `expectedText` = la respuesta de referencia del docente.
 * A propósito NUNCA incluye `classDefinition`: un docente real casi nunca la
 * carga en el sistema (es lo que dictó de palabra o escribió en el pizarrón),
 * así que el detector tiene que arreglárselas sin ella, igual que en producción.
 */
export function questionToClassInput(question: DatasetQuestion): SimilarityClassInput {
  const similarityQuestion: SimilarityQuestion = {
    id: question.id,
    label: question.prompt,
    type: "long",
    prompt: question.prompt,
    expectedText: question.referenceAnswer,
  };
  const participants: ParticipantEntry[] = question.answers.map((answer) => ({
    participantId: answer.id,
    // Los ids del dataset ya son opacos (q1-s01, ...): sirven de nombre acá sin exponer nada.
    name: answer.id,
    responses: new Map([[question.id, { kind: "long" as const, text: answer.text }]]),
  }));
  return { questions: [similarityQuestion], participants };
}

export function allPairs(ids: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) pairs.push([ids[i], ids[j]]);
  }
  return pairs;
}

/** Clave `questionId::pairKey(a,b)`, única en todo el dataset (no solo dentro de una pregunta). */
export function globalPairKey(questionId: string, a: string, b: string): string {
  return `${questionId}::${pairKey(a, b)}`;
}
