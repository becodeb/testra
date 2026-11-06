// Lo que el alumno puede ver de su examen después de entregar, según lo que el
// docente configuró. Es lo único que libera las respuestas correctas hacia el
// alumno, así que la decisión vive en un solo lugar y con tests.

import type { QuestionAsset } from "@/domain/exam";

export type ResultsDisplay = "score_only" | "score_and_answers" | "hidden";
export type ResultsWhen = "teacher_publishes" | "after_submit" | "after_run";

/**
 * - `none`: nada todavía, o nunca.
 * - `score`: solo la nota.
 * - `answers`: la nota y lo que respondió, sin decir qué estuvo bien.
 * - `detail`: además, puntos por pregunta, devolución y respuesta correcta.
 */
export type ResultsLevel = "none" | "score" | "answers" | "detail";

export type ResultsWaitingFor = "teacher" | "run-end" | null;

export function resultsVisibility(input: {
  display: ResultsDisplay;
  when: ResultsWhen;
  runStatus: "lobby" | "running" | "ended";
  publishedAt: number | null;
  participantStatus: string;
}): { level: ResultsLevel; waitingFor: ResultsWaitingFor } {
  if (input.display === "hidden" || input.participantStatus !== "submitted") return { level: "none", waitingFor: null };
  const closed = input.runStatus === "ended";
  if (input.when === "teacher_publishes" && !input.publishedAt) return { level: "none", waitingFor: "teacher" };
  if (input.when === "after_run" && !closed) return { level: "none", waitingFor: "run-end" };
  if (input.display === "score_only") return { level: "score", waitingFor: null };
  // Con otros alumnos rindiendo, decir qué estuvo bien se lo pasa a los demás:
  // el detalle espera al cierre aunque el docente haya elegido "Al entregar".
  return closed ? { level: "detail", waitingFor: null } : { level: "answers", waitingFor: "run-end" };
}

export type StudentResultAnswer =
  | { kind: "choice"; multiple: boolean; options: Array<{ id: string; text: string; selected: boolean; correct?: boolean }> }
  | { kind: "tf"; value: boolean | null; correct?: boolean }
  | { kind: "text"; value: string; accepted?: string[] };

export interface StudentResultQuestion {
  id: string;
  number: number;
  prompt: string;
  assets: QuestionAsset[];
  points: number;
  answered: boolean;
  answer: StudentResultAnswer;
  /** Solo en `detail`. `pointsAwarded` en null es que todavía no se corrigió. */
  review?: { pointsAwarded: number | null; feedback: string };
}

export interface StudentResults {
  level: ResultsLevel;
  waitingFor: ResultsWaitingFor;
  /** Ya no va a cambiar: el alumno deja de preguntar. */
  final: boolean;
  score?: {
    awarded: number;
    max: number;
    percent: number;
    pendingCorrections: number;
    passed: boolean | null;
  };
  questions?: StudentResultQuestion[];
}

/** Quita lo que todavía no se liberó: no tiene que viajar al navegador ni oculto. */
export function withoutGrading(answer: StudentResultAnswer): StudentResultAnswer {
  if (answer.kind === "choice") return { ...answer, options: answer.options.map(({ id, text, selected }) => ({ id, text, selected })) };
  if (answer.kind === "tf") return { kind: "tf", value: answer.value };
  return { kind: "text", value: answer.value };
}
