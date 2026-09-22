// Lógica pura de la demo pública (/demo). Todo lo que decide algo vive acá y no
// en los componentes, para poder probarlo sin navegador: la demo muestra el
// producto funcionando de verdad, y lo que no se puede probar termina
// mintiendo sin que nadie se entere.

import type { Incident } from "@/components/incident-list";
import { getQuestionCompletion, type FullQuestion } from "@/domain/exam";
import type { ClientIncident } from "@/hooks/use-exam-monitoring";
import { clipboardDetail, copyForIncident } from "@/lib/incident-copy";
import { gradeExam, type QuestionGrade } from "@/server/grading";

/**
 * El código de la sala de la demo. Lleva O, 0 y 1, que el alfabeto de los
 * códigos reales excluye (ver `RUN_CODE_ALPHABET`): nunca puede coincidir con
 * una sala de verdad, ni aunque alguien lo copie en /rendir.
 */
export const DEMO_CODE = "DEMO01";
export const DEMO_TITLE = "Qué ve tu docente";
export const DEMO_STUDENT_NAME = "Alumno de prueba";
export const DEMO_DURATION_S = 5 * 60;

// La evaluación trata sobre lo que registra Testra, así que el visitante la
// puede responder probando en el paso siguiente. Claves: 1B, 2C, 3A.
export const DEMO_IMPORT_TEXT = `1) Si cambiás de pestaña durante la evaluación, ¿qué ve tu docente?
A) Nada, no se entera
B) Un aviso con cuánto tiempo estuviste afuera
C) Una captura de la otra pestaña

2) Si copiás o pegás un texto, ¿qué queda registrado?
A) El texto completo
B) Nada
C) La acción y la cantidad de caracteres

3) ¿Qué necesita un alumno para entrar a la evaluación?
A) El código de la sala
B) Una cuenta de Google
C) Instalar una aplicación

4) Si un alumno tiene varios avisos, ¿qué harías? Respondé en una oración.`;

export type SupervisionMode = "normal" | "strict";

/**
 * La evaluación que se congela al abrir la sala, como la copia de preguntas
 * que toma una toma real: lo que se edite después ya no la toca.
 */
export interface DemoExam {
  title: string;
  questions: FullQuestion[];
  mode: SupervisionMode;
}

/** Un intento del alumno de la demo. Vive en memoria: recargar lo borra. */
export interface DemoAttempt {
  studentName: string;
  /** Entrar a la sala arranca el reloj, como en una toma en vivo ya iniciada. */
  joinedAt: number | null;
  endsAt: number | null;
  submittedAt: number | null;
  answers: DemoAnswers;
  incidents: DemoIncident[];
  lastSignalAt: number | null;
}

export function emptyAttempt(studentName: string): DemoAttempt {
  return { studentName, joinedAt: null, endsAt: null, submittedAt: null, answers: {}, incidents: [], lastSignalAt: null };
}

/** Los mismos presets que `applySupervisionPreset` del editor. */
export function supervisionSettings(mode: SupervisionMode) {
  return {
    detectFocusLoss: true,
    requireFullscreen: mode === "strict",
    blockClipboard: mode === "strict",
    violationAction: "warn_and_record" as const,
  };
}

export interface ExamReadiness {
  titleOk: boolean;
  /** Preguntas sin enunciado o con alguna opción vacía. */
  incomplete: number;
  missingKeys: number;
  valid: boolean;
}

/** Mismo criterio que usa el editor para dejar abrir la sala. */
export function examReadiness(title: string, questions: FullQuestion[]): ExamReadiness {
  const states = questions.map(getQuestionCompletion);
  const emptyOptions = questions.filter(
    (question) => (question.type === "mc" || question.type === "ms") && question.config.options.some((option) => !option.text.trim()),
  ).length;
  const incomplete = states.filter((state) => state === "empty").length + emptyOptions;
  const missingKeys = states.filter((state) => state === "missing-key").length;
  const titleOk = title.trim().length >= 3;
  return { titleOk, incomplete, missingKeys, valid: titleOk && questions.length > 0 && incomplete === 0 && missingKeys === 0 };
}

export interface DemoIncident extends ClientIncident {
  id: string;
  /** La pregunta que estaba a la vista cuando ocurrió; la pone el hook en `meta`. */
  questionId: string | null;
  /** Cuándo llegó a la pantalla del docente, para marcarlo como nuevo. */
  receivedAt: number;
}

export function toDemoIncident(incident: ClientIncident, id: string, receivedAt: number): DemoIncident {
  const questionId = typeof incident.meta.questionId === "string" ? incident.meta.questionId : null;
  return { ...incident, id, questionId, receivedAt };
}

export type ChallengeId = "salir" | "copiar" | "pegar" | "f12" | "pantalla-completa";

interface ChallengeDefinition {
  id: ChallengeId;
  label: string;
  matches: (incident: Pick<ClientIncident, "type" | "meta">) => boolean;
}

const usedClipboard = (incident: Pick<ClientIncident, "type" | "meta">, actions: ReadonlySet<string>) =>
  incident.type === "atajo-copiar-pegar" && typeof incident.meta.action === "string" && actions.has(incident.meta.action);

// El atajo de teclado registra la acción en castellano y el evento del
// navegador en inglés: las dos cuentan.
const COPY_ACTIONS = new Set(["copy", "cut", "copiar", "cortar"]);
const PASTE_ACTIONS = new Set(["paste", "pegar"]);

export const CHALLENGES: readonly ChallengeDefinition[] = [
  { id: "salir", label: "Cambiá de pestaña y volvé", matches: (incident) => incident.type === "cambio-de-pestana" || incident.type === "ventana-sin-foco" },
  { id: "copiar", label: "Copiá un texto", matches: (incident) => usedClipboard(incident, COPY_ACTIONS) },
  { id: "pegar", label: "Pegá en una respuesta", matches: (incident) => usedClipboard(incident, PASTE_ACTIONS) },
  { id: "f12", label: "Apretá F12", matches: (incident) => incident.type === "atajo-f12" },
  { id: "pantalla-completa", label: "Salí de pantalla completa", matches: (incident) => incident.type === "salida-pantalla-completa" },
];

export interface ChallengeContext {
  strict: boolean;
  /** Pantallas táctiles: no hay tecla F12 que apretar. */
  coarsePointer: boolean;
  /** Sin pantalla completa disponible no hay de dónde salir. */
  fullscreenAvailable: boolean;
}

export interface ChallengeState {
  id: ChallengeId;
  label: string;
  done: boolean;
}

/** Qué pruebas se muestran y cuáles ya registró el monitoreo real. */
export function challengeProgress(
  incidents: ReadonlyArray<Pick<ClientIncident, "type" | "meta">>,
  context: ChallengeContext,
): { items: ChallengeState[]; allDone: boolean } {
  const items = CHALLENGES
    .filter((challenge) => challenge.id !== "f12" || !context.coarsePointer)
    .filter((challenge) => challenge.id !== "pantalla-completa" || (context.strict && context.fullscreenAvailable))
    .map((challenge) => ({ id: challenge.id, label: challenge.label, done: incidents.some(challenge.matches) }));
  return { items, allDone: items.length > 0 && items.every((item) => item.done) };
}

/** El incidente en la forma que espera `IncidentList`, con su pregunta resuelta. */
export function toReportIncidents(incidents: readonly DemoIncident[], questions: readonly FullQuestion[]): Incident[] {
  return [...incidents]
    .sort((left, right) => left.at - right.at)
    .map((incident) => {
      const index = incident.questionId ? questions.findIndex((question) => question.id === incident.questionId) : -1;
      return {
        id: incident.id,
        at: incident.at,
        duration_ms: incident.durationMs,
        type: incident.type,
        source: "client",
        questionNumber: index >= 0 ? index + 1 : null,
        questionPrompt: index >= 0 ? questions[index].prompt : null,
        meta: incident.meta,
      };
    });
}

export function formatSeconds(durationMs: number): string {
  return (durationMs / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 });
}

/** La línea del panel "Avisos de actividad", igual que en la sala en vivo. */
export function teacherIncidentLabel(incident: Pick<ClientIncident, "type" | "durationMs" | "meta">): string {
  const duration = incident.durationMs > 0 ? ` (${formatSeconds(incident.durationMs)} s)` : "";
  // Para el portapapeles la duración no dice nada; lo que importa es el tamaño.
  const detalle = incident.type === "atajo-copiar-pegar" ? clipboardDetail(incident.meta) : "";
  return `${copyForIncident(incident.type).title}${duration}${detalle ? ` · ${detalle}` : ""}`;
}

export type DemoAnswers = Record<string, string>;

export function isAnswered(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function answeredCount(questions: readonly FullQuestion[], answers: DemoAnswers): number {
  return questions.filter((question) => isAnswered(answers[question.id])).length;
}

export interface DemoGrade {
  questions: QuestionGrade[];
  awardedPoints: number;
  maxPoints: number;
  /** Puntos de desarrollo que todavía no corrigió nadie. */
  pendingManualPoints: number;
  percent: number;
}

/**
 * La nota sale de `gradeExam`, el mismo corrector puro que usa el servidor.
 * Lo único que agrega la demo es el puntaje que el visitante pone a mano en el
 * desarrollo, que `gradeExam` deja pendiente a propósito.
 */
export function demoGrade(questions: FullQuestion[], answers: DemoAnswers, manualScores: Record<string, number>): DemoGrade {
  const result = gradeExam(questions, Object.entries(answers).map(([questionId, value]) => ({ questionId, value })));
  const graded = result.questions.map((grade) => {
    const manual = manualScores[grade.questionId];
    if (grade.auto !== null || manual === undefined) return grade;
    return { ...grade, pointsAwarded: Math.min(grade.maxPoints, Math.max(0, manual)) };
  });
  const awardedPoints = graded.reduce((sum, grade) => sum + (grade.pointsAwarded ?? 0), 0);
  const pendingManualPoints = graded.reduce((sum, grade) => sum + (grade.pointsAwarded === null ? grade.maxPoints : 0), 0);
  return {
    questions: graded,
    awardedPoints,
    maxPoints: result.maxPoints,
    pendingManualPoints,
    percent: result.maxPoints > 0 ? Math.round((awardedPoints / result.maxPoints) * 100) : 0,
  };
}

export function formatPoints(points: number): string {
  return points.toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

export function remainingSeconds(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/** El reloj de la evaluación, con el formato del producto: 05:00. */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** Tiempo transcurrido como m:ss, que es como se dice en voz alta. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const clockFormatter = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const hourFormatter = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" });

/** Hora con segundos, como la "Última señal" de la sala en vivo. */
export function formatClock(at: number): string {
  return clockFormatter.format(at);
}

export function formatHour(at: number): string {
  return hourFormatter.format(at);
}
