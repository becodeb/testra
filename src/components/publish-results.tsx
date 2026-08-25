import { useState } from "react";
import { BadgeCheck, LoaderCircle, Send } from "lucide-react";

import { Button } from "@/components/ui/button";

interface PublishResultsProps {
  runId: string;
  status: "lobby" | "running" | "ended";
  publishedAt: number | null;
  classroomLinked: boolean;
  pendingManual: number;
  onPublished: (publishedAt: number) => void;
}

interface PublishResponse {
  publishedAt: number;
  alreadyPublished: boolean;
  classroomLinked: boolean;
  classroom: { sent: number; skipped: number; unlinked: Array<{ name: string; email: string | null }>; pending: string[]; failures: Array<{ name: string; reason: string }> } | null;
  classroomError?: string;
  error?: string;
}

const dateFormatter = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" });

/**
 * El cierre de la corrección. Un solo gesto: da los resultados por definitivos
 * y, si la toma salió de Classroom, devuelve ahí las notas. Antes eran dos
 * pantallas distintas y era fácil corregir todo y que la nota nunca llegara.
 */
export function PublishResults({ runId, status, publishedAt, classroomLinked, pendingManual, onPublished }: PublishResultsProps) {
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<PublishResponse | null>(null);
  const [error, setError] = useState("");

  const blocked = status !== "ended" || pendingManual > 0;

  async function publish() {
    setWorking(true);
    setError("");
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/results`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sendToClassroom: true }),
    });
    const body = await response.json() as PublishResponse;
    if (response.ok) {
      setResult(body);
      onPublished(body.publishedAt);
    } else {
      setError(body.error ?? "No se pudieron publicar los resultados");
    }
    setWorking(false);
  }

  const alreadyPublished = Boolean(publishedAt) || Boolean(result);

  return (
    <section className="border-b bg-inset/40 px-5 py-4" aria-labelledby="publish-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id="publish-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
            <BadgeCheck className="size-4 text-brand" aria-hidden="true" />
            Cierre de la corrección
          </h3>
          <p className="mt-1 text-sm text-muted">
            {alreadyPublished
              ? `Resultados publicados${publishedAt ? ` el ${dateFormatter.format(publishedAt)}` : ""}.`
              : status !== "ended"
                ? "Vas a poder publicar cuando termine la sesión."
                : pendingManual > 0
                  ? `Faltan corregir ${pendingManual} respuesta${pendingManual === 1 ? "" : "s"} de desarrollo.`
                  : classroomLinked
                    ? "Al publicar, las notas se devuelven a la tarea de Classroom."
                    : "Al publicar, los resultados quedan definitivos."}
          </p>
        </div>
        {!alreadyPublished ? (
          <Button type="button" disabled={blocked || working} onClick={() => void publish()}>
            {working ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}
            {classroomLinked ? "Publicar y enviar a Classroom" : "Publicar resultados"}
          </Button>
        ) : (
          <span className="rounded-sm border border-ok/25 px-2 py-1 text-xs font-semibold text-ok">Publicados</span>
        )}
      </div>

      {error ? <p className="mt-3 rounded-md bg-alert/10 px-3 py-2 text-sm text-alert" role="alert">{error}</p> : null}

      {result ? (
        <div className="mt-3 space-y-2" role="status">
          {result.classroom ? (
            <p className="rounded-md bg-paper px-3 py-2 text-sm text-ink-2">
              Classroom: {result.classroom.sent} nota{result.classroom.sent === 1 ? "" : "s"} devuelta{result.classroom.sent === 1 ? "" : "s"} · {result.classroom.unlinked.length} alumno{result.classroom.unlinked.length === 1 ? "" : "s"} sin vincular · {result.classroom.failures.length} error{result.classroom.failures.length === 1 ? "" : "es"}.
            </p>
          ) : null}
          {result.classroomError ? (
            <p className="rounded-md bg-warn/10 px-3 py-2 text-sm text-warn">
              Los resultados quedaron publicados, pero Classroom rechazó el envío: {result.classroomError}
            </p>
          ) : null}
          {result.classroom?.failures.length ? (
            <ul className="rounded-md bg-warn/10 px-3 py-2 text-sm text-warn">
              {result.classroom.failures.map((failure) => (
                <li key={failure.name}>{failure.name}: {failure.reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
