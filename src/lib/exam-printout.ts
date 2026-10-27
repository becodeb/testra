// Lo que no depende del servidor en la hoja imprimible: el armado del link, los
// rótulos y cómo se lee un puntaje. Vive aparte para que lo compartan la página
// que imprime y el diálogo que la abre, y para poder probarlo sin base.

export interface PrintoutTarget {
  runId: string;
  /** Sin alumno, la hoja trae a todos los que entregaron, uno por página. */
  participantId?: string;
  includeIncidents: boolean;
  /** Abre el diálogo de impresión del navegador apenas carga la página. */
  autoPrint?: boolean;
}

export function printoutUrl(target: PrintoutTarget): string {
  const params = new URLSearchParams({ run: target.runId });
  if (target.participantId) params.set("alumno", target.participantId);
  if (target.includeIncidents) params.set("incidentes", "si");
  if (target.autoPrint) params.set("imprimir", "1");
  return `/resultados/imprimir?${params.toString()}`;
}

/** Solo quien terminó la evaluación tiene una hoja que imprimir. */
export function hasFinished(status: string): boolean {
  return status === "submitted" || status === "expired";
}

/**
 * Por qué todavía no se puede imprimir la hoja de un alumno, para el `title`
 * del botón; `null` cuando ya se puede. La copia en papel es de un examen
 * corregido: con una respuesta pendiente la nota impresa después cambia.
 */
export function printBlockedReason(status: string, pendingCorrections: number): string | null {
  if (!hasFinished(status)) return "Se habilita cuando el alumno entregue";
  if (pendingCorrections > 0) return "Se habilita cuando termines de corregir este examen";
  return null;
}

/** A quién se imprime cuando es la toma entera, para el texto del diálogo. */
export function printAllSubject(finishedCount: number): string {
  return finishedCount === 1 ? "todos los que entregaron (1 alumno)" : `los ${finishedCount} alumnos que entregaron, uno por hoja`;
}

export type ScoreTone = "full" | "partial" | "none" | "pending";

export function scoreTone(awarded: number | null, points: number): ScoreTone {
  if (awarded === null) return "pending";
  if (awarded >= points) return "full";
  return awarded > 0 ? "partial" : "none";
}

const pointsFormatter = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

/** Los medios puntos existen: `1,5` y no `1.5`, que en papel se lee como otra cosa. */
export function formatPoints(value: number): string {
  return pointsFormatter.format(value);
}

export function submitReasonLabel(reason: string | null, status: string): string {
  if (status === "expired") return "Venció el plazo";
  if (reason === "manual") return "La entregó el alumno";
  if (reason === "timer") return "Se terminó el tiempo";
  if (reason === "teacher") return "La cerró el docente";
  return "—";
}

export function gradedByLabel(gradedBy: string | null, status: string | null): string {
  if (status && status !== "auto_graded" && status !== "graded") return "Sin corregir";
  if (gradedBy === "teacher") return "Corregida por el docente";
  if (gradedBy === "ai") return "Corregida con IA";
  return "Corrección automática";
}

export function attemptMinutes(startedAt: number | null, submittedAt: number | null): string {
  if (!startedAt || !submittedAt) return "—";
  const minutes = Math.max(0, Math.round((submittedAt - startedAt) / 60_000));
  return `${minutes} min`;
}
