/**
 * Señal secundaria de ritmo: sólo mira desarrollos distintos y ya sustantivos.
 * No es una señal de integridad ni una prueba de copia.
 */
export const WRITING_CADENCE_WINDOW_MS = 25_000;
export const WRITING_CADENCE_MIN_ANSWERS = 4;
export const WRITING_CADENCE_MIN_CHARS = 80;

export interface WritingCadenceEntry {
  questionId: string;
  at: number;
}

export interface WritingCadenceInput {
  questionId: string;
  questionType: string;
  answerLength: number;
  at: number;
}

export function nextWritingCadence(existing: WritingCadenceEntry[], input: WritingCadenceInput) {
  const recent = existing.filter((entry) => input.at - entry.at <= WRITING_CADENCE_WINDOW_MS && entry.questionId !== input.questionId);
  if (input.questionType !== "long" || input.answerLength < WRITING_CADENCE_MIN_CHARS) {
    return { recent, unusual: false };
  }
  const next = [...recent, { questionId: input.questionId, at: input.at }].slice(-WRITING_CADENCE_MIN_ANSWERS);
  return { recent: next, unusual: next.length >= WRITING_CADENCE_MIN_ANSWERS };
}
