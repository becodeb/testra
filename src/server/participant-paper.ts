import type { FullQuestion } from "@/domain/exam";
import { personalizeQuestions } from "@/domain/pool";

// Vive en su propio módulo, sin dependencias de servidor, para que lo puedan
// usar tanto el repositorio como el actor de la toma sin importarse entre sí.

/** Lo mínimo que hay que saber del participante para armarle su examen. */
export interface ParticipantPaper {
  id: string;
  /**
   * El examen adaptado que le asignó el docente, congelado al asignarlo. Se
   * llama distinto que el de la toma a propósito: las consultas que unen las
   * dos tablas con `p.*` quedarían con dos columnas del mismo nombre.
   */
  assigned_questions_snapshot?: string | null;
}

/**
 * El examen que le toca a este alumno. Es el único lugar donde se decide, y
 * tiene que seguir siéndolo: cualquier consumidor que lea el snapshot de la
 * toma por su cuenta se saltea la adecuación y le muestra el examen equivocado
 * a quien tiene una versión asignada.
 */
export function questionsForParticipant(
  run: {
    id: string;
    questions_snapshot: string;
    shuffle_questions: number;
    shuffle_options: number;
    questions_to_serve: number | null;
    long_to_serve?: number;
    section_quotas?: string | null;
  },
  participant: string | ParticipantPaper,
): FullQuestion[] {
  const participantId = typeof participant === "string" ? participant : participant.id;
  const assigned = typeof participant === "string" ? null : parseSnapshot(participant.assigned_questions_snapshot);

  if (assigned) {
    // La versión adaptada ya viene curada por el docente: se respeta entera.
    // Aplicarle el sorteo del banco del original podría dejar al chico con dos
    // preguntas de las seis que se le prepararon, que es lo contrario de lo que
    // se buscaba. El barajado sí se mantiene, porque no cambia qué entra.
    return personalizeQuestions(
      assigned,
      `${run.id}:${participantId}`,
      Boolean(run.shuffle_questions),
      Boolean(run.shuffle_options),
    );
  }

  let sectionQuotas: Record<string, number> = {};
  if (run.section_quotas) {
    try {
      sectionQuotas = JSON.parse(run.section_quotas) as Record<string, number>;
    } catch {
      // Una toma vieja o un valor corrupto no puede dejar al alumno sin examen:
      // se cae al sorteo plano de siempre.
    }
  }
  return personalizeQuestions(
    JSON.parse(run.questions_snapshot) as FullQuestion[],
    `${run.id}:${participantId}`,
    Boolean(run.shuffle_questions),
    Boolean(run.shuffle_options),
    run.questions_to_serve,
    run.long_to_serve ?? 2,
    sectionQuotas,
  );
}

/** Un snapshot ilegible no puede dejar a nadie sin examen: se cae al original. */
function parseSnapshot(raw: string | null | undefined): FullQuestion[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FullQuestion[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}
