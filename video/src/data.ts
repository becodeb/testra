import { T } from "./timeline";

// Scene data. Exam and questions follow scripts/seed.sql.

export const EXAM = {
  title: "Fotosíntesis y respiración celular",
  subject: "Biología",
  instructions: "Leé cada consigna antes de responder.",
  code: "K7M4QH",
  timeLimitS: 2400,
  totalPoints: 8,
  questions: [
    { type: "mc", prompt: "¿Qué proceso transforma energía lumínica en química?", points: 2, options: ["Respiración", "Fotosíntesis"] },
    { type: "sa", prompt: "¿Cuál es el pigmento principal?", points: 2 },
    { type: "long", prompt: "Explicá su importancia para el ecosistema.", points: 4 },
  ],
} as const;

export interface Student {
  name: string;
  /** Auto-graded points (mc + sa), known when the run ends. */
  auto: number;
  /** Teacher-confirmed points on the long question. */
  long: number;
  /** Seconds offset for the "Última señal" heartbeat. */
  beat: number;
  started: string;
  submitted: string;
  minutes: number;
}

export const STUDENTS: ReadonlyArray<Student> = [
  { name: "Lucía Paredes", auto: 4, long: 2, beat: 0.4, started: "10:12", submitted: "10:47", minutes: 35 },
  { name: "Sofía Álvarez", auto: 4, long: 3, beat: 1.1, started: "10:12", submitted: "10:49", minutes: 37 },
  { name: "Tomás Benítez", auto: 2, long: 3, beat: 0.7, started: "10:12", submitted: "10:46", minutes: 34 },
  { name: "Mateo Ríos", auto: 4, long: 4, beat: 1.6, started: "10:12", submitted: "10:50", minutes: 38 },
  { name: "Valentina Sosa", auto: 2, long: 2, beat: 1.3, started: "10:12", submitted: "10:44", minutes: 32 },
];

/** Row of Sofía, the answer the AI correction reviews. */
export const SOFIA = 1;
/** Row of Lucía: the student we follow, and the one with the activity signals. */
export const LUCIA = 0;

/** Lucía's answers, as her report shows them. */
export const LUCIA_ANSWERS = ["Fotosíntesis", "clorofila", "Produce oxígeno y alimento para los seres vivos."] as const;

export const SOFIA_ANSWER =
  "La fotosíntesis produce el oxígeno que respiran casi todos los seres vivos y la glucosa que sostiene las cadenas alimentarias. Sin ella no entraría energía al ecosistema.";
export const SOFIA_FEEDBACK =
  "Muy bien: relacionás la fotosíntesis con el oxígeno y con la energía que entra al ecosistema. Te faltó mencionar su papel en el ciclo del carbono.";
export const AI = { score: 3, confidence: 0.82 };

export const TEACHER = { name: "Mariana Costa", role: "Docente", initials: "MC" };

export const percent = (score: number, max = EXAM.totalPoints) => Math.round((score / max) * 100);

// Wall clock: the run starts at 10:12:00 on 25/09/2026 (Buenos Aires), at the start click.
const START_MS = Date.UTC(2026, 8, 25, 13, 12, 0);
const TZ = "America/Argentina/Buenos_Aires";
const timeFormatter = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: TZ });
const dateFormatter = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short", timeZone: TZ });

export const clockMs = (t: number) => START_MS + Math.floor((t - T.clickStart) * 1000);
export const clockLabel = (t: number) => timeFormatter.format(clockMs(t));
export const dateLabel = (ms: number) => dateFormatter.format(ms);
export const PUBLISHED_MS = Date.UTC(2026, 8, 25, 13, 53, 0);
export const SESSION_MS = START_MS - 5 * 60_000;

export function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
