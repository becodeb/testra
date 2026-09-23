// Lógica pura de la demo pública (/demo). Todo lo que decide algo vive acá y no
// en los componentes, para poder probarlo sin navegador: la demo muestra el
// producto funcionando de verdad, y lo que no se puede probar termina
// mintiendo sin que nadie se entere.

import type { FullQuestion } from "@/domain/exam";
import type { ClientIncident } from "@/hooks/use-exam-monitoring";
import { clipboardDetail, copyForIncident } from "@/lib/incident-copy";
import { gradeExam } from "@/server/grading";

export const DEMO_TITLE = "Qué ve tu docente";
export const DEMO_STUDENT_NAME = "Alumno de prueba";
export const DEMO_DURATION_S = 5 * 60;

/**
 * La evaluación de la demo. Trata sobre lo que registra Testra, así que se
 * responde probando.
 *
 * Las claves viajan en el paquete del navegador porque la demo corrige ahí
 * mismo, sin servidor. En el producto nunca salen del servidor: el alumno
 * recibe `toStudentQuestion()`, sin claves.
 */
export const DEMO_QUESTIONS: FullQuestion[] = [
  {
    id: "demo-pestana",
    position: 0,
    type: "mc",
    prompt: "Si cambiás de pestaña durante la evaluación, ¿qué ve tu docente?",
    points: 1,
    config: {
      options: [
        { id: "demo-pestana-nada", text: "Nada, no se entera" },
        { id: "demo-pestana-aviso", text: "Un aviso con cuánto tiempo estuviste afuera" },
        { id: "demo-pestana-captura", text: "Una captura de la otra pestaña" },
      ],
      correctOptionId: "demo-pestana-aviso",
    },
  },
  {
    id: "demo-portapapeles",
    position: 1,
    type: "mc",
    prompt: "Si copiás o pegás un texto, ¿qué queda registrado?",
    points: 1,
    config: {
      options: [
        { id: "demo-portapapeles-texto", text: "El texto completo" },
        { id: "demo-portapapeles-nada", text: "Nada" },
        { id: "demo-portapapeles-cantidad", text: "La acción y la cantidad de caracteres" },
      ],
      correctOptionId: "demo-portapapeles-cantidad",
    },
  },
  {
    id: "demo-ingreso",
    position: 2,
    type: "sa",
    prompt: "¿Qué necesita un alumno para entrar a la evaluación? Respondé con una palabra.",
    points: 1,
    // `normalizeShortAnswer` ya ignora mayúsculas, tildes y espacios de más:
    // alcanza con la palabra y sus dos formas con artículo.
    config: { accepted: ["código", "el código", "un código"] },
  },
];

export type DemoAnswers = Record<string, string>;

export function isAnswered(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export interface DemoIncident extends ClientIncident {
  id: string;
  /** La pregunta que estaba a la vista cuando ocurrió; la pone el hook en `meta`. */
  questionId: string | null;
}

export function toDemoIncident(incident: ClientIncident, id: string): DemoIncident {
  const questionId = typeof incident.meta.questionId === "string" ? incident.meta.questionId : null;
  return { ...incident, id, questionId };
}

export interface DemoAnswerRow {
  number: number;
  correct: boolean;
  answered: boolean;
  /** Lo que respondió el alumno, legible: el texto de la opción o lo escrito. */
  answer: string;
  correctAnswer: string;
}

export interface DemoResult {
  percent: number;
  correctCount: number;
  rows: DemoAnswerRow[];
}

function answerText(question: FullQuestion, value: string): string {
  if (question.type === "mc") return question.config.options.find((option) => option.id === value)?.text ?? "";
  return value.trim();
}

function correctText(question: FullQuestion): string {
  if (question.type === "mc") return question.config.options.find((option) => option.id === question.config.correctOptionId)?.text ?? "";
  if (question.type === "sa") return question.config.accepted[0] ?? "";
  return "";
}

/** La nota sale de `gradeExam`, el mismo corrector puro que usa el servidor. */
export function demoResult(questions: FullQuestion[], answers: DemoAnswers): DemoResult {
  const grade = gradeExam(questions, Object.entries(answers).map(([questionId, value]) => ({ questionId, value })));
  const rows = questions.map((question, index) => {
    const value = answers[question.id] ?? "";
    return {
      number: index + 1,
      correct: grade.questions[index].auto === true,
      answered: isAnswered(value),
      answer: answerText(question, value),
      correctAnswer: correctText(question),
    };
  });
  return {
    percent: grade.maxPoints > 0 ? Math.round((grade.awardedPoints / grade.maxPoints) * 100) : 0,
    correctCount: rows.filter((row) => row.correct).length,
    rows,
  };
}

export function formatSeconds(durationMs: number): string {
  return (durationMs / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 });
}

/**
 * La línea de cada aviso en el informe, con las palabras del panel del docente.
 * En el portapapeles el detalle ya dice qué pasó ("Pegó 6 caracteres"): se
 * muestra solo, porque repetir "Se usó copiar, cortar o pegar" adelante
 * duplicaba la línea sin agregar nada. Sin punto final, como los demás títulos.
 */
export function teacherIncidentLabel(incident: Pick<ClientIncident, "type" | "durationMs" | "meta">): string {
  const detalle = incident.type === "atajo-copiar-pegar" ? clipboardDetail(incident.meta).replace(/\.$/, "") : "";
  if (detalle) return detalle;
  const duration = incident.durationMs > 0 ? ` (${formatSeconds(incident.durationMs)} s)` : "";
  return `${copyForIncident(incident.type).title}${duration}`;
}

export interface DemoIncidentRow {
  id: string;
  label: string;
  questionNumber: number | null;
  at: number;
}

/** Los avisos del informe, en el orden en que pasaron y con su pregunta. */
export function reportIncidentRows(incidents: readonly DemoIncident[], questions: readonly FullQuestion[]): DemoIncidentRow[] {
  return [...incidents]
    .sort((left, right) => left.at - right.at)
    .map((incident) => {
      const index = incident.questionId ? questions.findIndex((question) => question.id === incident.questionId) : -1;
      return { id: incident.id, label: teacherIncidentLabel(incident), questionNumber: index >= 0 ? index + 1 : null, at: incident.at };
    });
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

// Reloj de 24 horas a propósito: según los datos del navegador, es-AR puede
// salir con "p. m." y la línea del aviso se hace el doble de larga.
const clockFormatter = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

export function formatClock(at: number): string {
  return clockFormatter.format(at);
}
