import { useId } from "react";
import { AlertTriangle, Clock3, Radio, Users } from "lucide-react";

import { BumpValue, resumeAt, useAgeOnMount } from "@/components/demo/demo-ui";
import { formatAssignedProgress } from "@/lib/exam-progress";
import {
  answeredCount,
  DEMO_CODE,
  formatClock,
  formatCountdown,
  teacherIncidentLabel,
  type DemoAttempt,
  type DemoExam,
  type DemoIncident,
} from "@/lib/demo";
import { cn } from "@/lib/utils";

// La sala en vivo de LiveRunMonitor, compacta y con las mismas clases. No se
// importa el componente real porque vive de un WebSocket y de pedirle el
// estado al servidor cada cinco segundos.

const ENTER_MS = 180;
const FRESH_MS = 2_600;

export function DemoTeacher({ exam, attempt, remaining }: { exam: DemoExam; attempt: DemoAttempt; remaining: number }) {
  const ids = useId();
  const joined = attempt.joinedAt !== null;
  const submitted = attempt.submittedAt !== null;
  const ended = joined && remaining === 0;
  const answered = answeredCount(exam.questions, attempt.answers);
  // Lo último arriba, como un registro que se va escribiendo.
  const incidents = [...attempt.incidents].reverse();

  return (
    <div className="flex flex-1 flex-col gap-3 p-3">
      <section className="rounded-lg border bg-paper p-4 shadow-card" aria-labelledby={`${ids}-titulo`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[.08em] text-muted uppercase">{ended ? "Evaluación finalizada" : "Evaluación en vivo"}</p>
            <h3 id={`${ids}-titulo`} className="mt-1 truncate text-lg font-semibold text-ink">{exam.title}</h3>
          </div>
          <span className={cn("inline-flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm font-semibold", ended ? "text-ink-2" : "border-ok/30 text-ok")}>
            <Radio className="size-4" aria-hidden="true" /> {ended ? "Cerrada" : "En curso"}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted">Código de ingreso</p>
            <p className="mono-number mt-0.5 text-2xl font-bold tracking-[.18em] text-brand" aria-label={`Código ${DEMO_CODE.split("").join(" ")}`}>{DEMO_CODE}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted">Tiempo restante</p>
            <p role="timer" aria-live="off" className="mono-number mt-0.5 flex items-center justify-end gap-1.5 text-lg font-semibold text-ink">
              <Clock3 className="size-4 text-muted" aria-hidden="true" />
              {formatCountdown(remaining)}
            </p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border bg-paper shadow-card" aria-labelledby={`${ids}-alumnos`}>
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h3 id={`${ids}-alumnos`} className="text-sm font-semibold text-ink">Alumnos</h3>
          <span className="mono-number inline-flex items-center gap-1.5 text-sm text-muted"><Users className="size-4" aria-hidden="true" />{joined ? 1 : 0}</span>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="bg-inset text-xs text-ink-2">
            <tr>
              <th className="px-4 py-2">Alumno</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-right">Avance</th>
              <th className="hidden px-4 py-2 text-right xl:table-cell">Última señal</th>
            </tr>
          </thead>
          <tbody>
            {joined ? (
              <StudentRow
                name={attempt.studentName}
                joinedAt={attempt.joinedAt}
                submitted={submitted}
                progress={formatAssignedProgress(answered, exam.questions.length)}
                lastSignalAt={attempt.lastSignalAt}
              />
            ) : (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">Todavía no ingresó ningún alumno.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="flex min-h-56 flex-1 flex-col overflow-hidden rounded-lg border bg-paper shadow-card" aria-labelledby={`${ids}-avisos`}>
        <div className="flex items-start justify-between gap-3 border-b px-4 py-2.5">
          <div>
            <h3 id={`${ids}-avisos`} className="text-sm font-semibold text-ink">Avisos de actividad</h3>
            <p className="mt-0.5 text-xs text-muted">Señales para revisar; no prueban una conducta por sí solas.</p>
          </div>
          <span className="mono-number rounded-sm border border-warn/30 bg-warn/5 px-1.5 py-0.5 text-xs font-semibold text-warn">{incidents.length}</span>
        </div>
        {/* No se anuncia: el que avisa es el cuadro del alumno, y decirlo dos
            veces tapa lo que importa. */}
        <div aria-live="off" className="min-h-0 flex-1 divide-y overflow-y-auto">
          {incidents.map((incident) => <IncidentItem key={incident.id} incident={incident} name={attempt.studentName} />)}
          {!incidents.length ? <p className="p-6 text-center text-sm text-muted">No hay avisos de actividad registrados.</p> : null}
        </div>
      </section>
    </div>
  );
}

function StudentRow({ name, joinedAt, submitted, progress, lastSignalAt }: { name: string; joinedAt: number | null; submitted: boolean; progress: string; lastSignalAt: number | null }) {
  const age = useAgeOnMount(joinedAt);
  const status = submitted ? "submitted" : "active";
  return (
    <tr className={cn(age < ENTER_MS && "demo-enter")} style={age < ENTER_MS ? resumeAt(age) : undefined}>
      <th scope="row" className="px-4 py-2.5 font-medium text-ink">{name}</th>
      <td className="px-3 py-2.5">
        <span key={status} className={cn("demo-fade-in rounded-sm border px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap", status === "active" ? "border-ok/25 text-ok" : "text-ink-2")}>
          {status === "active" ? "Rindiendo" : "Entregó"}
        </span>
      </td>
      <td className="mono-number px-3 py-2.5 text-right"><BumpValue value={progress} /></td>
      <td className="mono-number hidden px-4 py-2.5 text-right whitespace-nowrap text-muted xl:table-cell">{lastSignalAt === null ? "" : formatClock(lastSignalAt)}</td>
    </tr>
  );
}

function IncidentItem({ incident, name }: { incident: DemoIncident; name: string }) {
  const age = useAgeOnMount(incident.receivedAt);
  return (
    <article className={cn(age < ENTER_MS && "demo-arrive")} style={age < ENTER_MS ? resumeAt(age) : undefined}>
      <div className={cn("flex items-start gap-2 p-3.5", age < FRESH_MS && "demo-fresh")} style={age < FRESH_MS ? resumeAt(age) : undefined}>
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{name}</p>
          <p className="mt-0.5 text-sm text-ink-2">{teacherIncidentLabel(incident)}</p>
          {/* Sobre el fondo del aviso nuevo, el gris de siempre no llega a 4,5:1. */}
          <p className={cn("mt-1 text-xs", age < FRESH_MS ? "text-muted-foreground" : "text-muted")}>Informado por el navegador · {formatClock(incident.at)}</p>
        </div>
      </div>
    </article>
  );
}
