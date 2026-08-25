import { useEffect, useState } from "react";
import { CircleDot, ClipboardList, Clock3, Radio, Square, Users } from "lucide-react";

import type { PlatformOverview } from "@/server/repository";

const dateFormatter = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

/**
 * Consola de plataforma. El bloque de salas abiertas se relee cada 10 segundos
 * porque es lo unico que cambia solo; el reloj de cada sala baja cada segundo
 * en el cliente para no pedirle al servidor una lectura por segundo.
 */
export function AdminConsole({ initial }: { initial: PlatformOverview }) {
  const [overview, setOverview] = useState(initial);
  const [now, setNow] = useState(initial.serverNow);
  const [stale, setStale] = useState(false);
  const [closingRunId, setClosingRunId] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow((value) => value + 1_000), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const poll = window.setInterval(async () => {
      try {
        const response = await fetch("/api/admin/overview");
        if (!active) return;
        if (!response.ok) return setStale(true);
        const next = await response.json() as PlatformOverview;
        setOverview(next);
        setNow(next.serverNow);
        setStale(false);
      } catch {
        if (active) setStale(true);
      }
    }, 10_000);
    return () => { active = false; window.clearInterval(poll); };
  }, []);

  const { totals, liveRuns, recentRuns, platformExams } = overview;

  async function closeRun(run: (typeof liveRuns)[number]) {
    const hasStudents = Number(run.active) > 0 || Number(run.participants) > 0;
    if (hasStudents && !window.confirm(`Hay ${run.participants} alumno${Number(run.participants) === 1 ? "" : "s"} en esta sala. ¿Querés cerrarla para todos?`)) return;
    setClosingRunId(run.id);
    const response = await fetch(`/api/admin/runs/${encodeURIComponent(run.id)}/close`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmed: true }),
    });
    if (response.ok) {
      setOverview((current) => ({ ...current, liveRuns: current.liveRuns.filter((candidate) => candidate.id !== run.id), totals: { ...current.totals, live_runs: Math.max(0, Number(current.totals.live_runs) - 1) } }));
    } else setStale(true);
    setClosingRunId("");
  }

  return (
    <div className="grid gap-6">
      <section aria-labelledby="totales-title">
        <h2 id="totales-title" className="sr-only">Totales de la plataforma</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Docentes", value: totals.teachers },
            { label: "Alumnos", value: totals.students },
            { label: "Evaluaciones", value: totals.exams },
            { label: "Tomas", value: totals.runs },
            { label: "Participaciones", value: totals.participants },
            { label: "Respuestas", value: totals.answers },
            { label: "Salas abiertas", value: totals.live_runs, highlight: true },
          ].map((card) => (
            <div key={card.label} className={`rounded-lg border bg-paper p-4 shadow-card ${card.highlight && card.value > 0 ? "border-ok/40" : ""}`}>
              <p className="text-xs font-semibold tracking-[.08em] text-muted uppercase">{card.label}</p>
              <p className={`mono-number mt-1 text-2xl font-bold ${card.highlight && card.value > 0 ? "text-ok" : "text-ink"}`}>{card.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border bg-paper shadow-card" aria-labelledby="salas-title">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
          <div>
            <h2 id="salas-title" className="flex items-center gap-2 font-semibold text-ink">
              <Radio className="size-4 text-brand" aria-hidden="true" />
              Salas abiertas ahora
            </h2>
            <p className="mt-1 text-sm text-muted">Se actualiza sola cada 10 segundos.</p>
          </div>
          {stale ? <span className="rounded-sm border border-warn/30 px-2 py-1 text-xs font-semibold text-warn">Sin conexión</span> : null}
        </div>

        {liveRuns.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-inset text-xs text-ink-2">
                <tr>
                  <th className="px-4 py-3">Evaluación</th>
                  <th className="px-4 py-3">Docente</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Alumnos</th>
                  <th className="px-4 py-3 text-right">Restante</th>
                  <th className="px-4 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {liveRuns.map((run) => {
                  const remaining = run.ends_at === null ? null : Math.ceil((run.ends_at - now) / 1000);
                  return (
                    <tr key={run.id} className="hover:bg-canvas">
                      <th scope="row" className="px-4 py-3">
                        <a href={`/sesiones/${encodeURIComponent(run.id)}`} className="font-semibold text-brand hover:underline">{run.title}</a>
                        <span className="mono-number mt-0.5 block text-xs text-muted">{run.code}</span>
                      </th>
                      <td className="px-4 py-3">
                        <span className="block text-ink-2">{run.teacher_name ?? "—"}</span>
                        <span className="block text-xs text-muted">{run.teacher_email ?? ""}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${run.status === "running" ? "text-ok" : "text-ink-2"}`}>
                          <CircleDot className="size-3.5" aria-hidden="true" />
                          {run.status === "running" ? "En curso" : "Sala de espera"}
                        </span>
                      </td>
                      <td className="mono-number px-4 py-3 text-right">
                        {run.active}/{run.participants}
                        {run.submitted ? <span className="mt-0.5 block text-xs text-muted">{run.submitted} entregaron</span> : null}
                      </td>
                      <td className="px-4 py-3 text-right"><button type="button" disabled={closingRunId === run.id} onClick={() => void closeRun(run)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-alert/25 px-2.5 text-xs font-semibold text-alert hover:bg-alert/5 disabled:opacity-50"><Square className="size-3.5" />{closingRunId === run.id ? "Cerrando…" : "Cerrar sala"}</button></td>
                      <td className="mono-number px-4 py-3 text-right">
                        {remaining === null ? "—" : <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5 text-muted" aria-hidden="true" />{formatTime(remaining)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-10 text-center text-sm text-muted">No hay ninguna sala abierta en este momento.</p>
        )}
      </section>

      <section className="rounded-lg border bg-paper shadow-card" aria-labelledby="exams-title">
        <div className="border-b p-5">
          <h2 id="exams-title" className="flex items-center gap-2 font-semibold text-ink">
            <ClipboardList className="size-4 text-brand" aria-hidden="true" />
            Todas las evaluaciones
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-inset text-xs text-ink-2">
              <tr>
                <th className="px-4 py-3">Evaluación</th>
                <th className="px-4 py-3">Materia</th>
                <th className="px-4 py-3">Docente</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Preguntas</th>
                <th className="px-4 py-3 text-right">Tomas</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {platformExams.map((exam) => (
                <tr key={exam.id} className="hover:bg-canvas">
                  <th scope="row" className="px-4 py-3"><a href={`/admin/evaluaciones/${encodeURIComponent(exam.id)}`} className="font-semibold text-brand hover:underline">{exam.title}</a></th>
                  <td className="px-4 py-3 text-ink-2">{exam.subject}</td>
                  <td className="px-4 py-3"><span className="block text-ink-2">{exam.teacher_name ?? "—"}</span><span className="block text-xs text-muted">{exam.teacher_email ?? ""}</span></td>
                  <td className="px-4 py-3 text-xs font-semibold">{exam.status === "ready" ? "Lista" : "Borrador"}</td>
                  <td className="mono-number px-4 py-3 text-right">{exam.questions}</td>
                  <td className="mono-number px-4 py-3 text-right">{exam.runs}</td>
                </tr>
              ))}
              {!platformExams.length ? <tr><td colSpan={6} className="px-4 py-10 text-center text-muted"><Users className="mx-auto mb-2 size-5" />No hay evaluaciones.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border bg-paper shadow-card" aria-labelledby="recientes-title">
        <div className="border-b p-5">
          <h2 id="recientes-title" className="font-semibold text-ink">Últimas tomas cerradas</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-inset text-xs text-ink-2">
              <tr>
                <th className="px-4 py-3">Evaluación</th>
                <th className="px-4 py-3">Docente</th>
                <th className="px-4 py-3">Cerrada</th>
                <th className="px-4 py-3 text-right">Alumnos</th>
                <th className="px-4 py-3">Resultados</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recentRuns.map((run) => (
                <tr key={run.id} className="hover:bg-canvas">
                  <th scope="row" className="px-4 py-3">
                    <a href={`/sesiones/${encodeURIComponent(run.id)}`} className="font-semibold text-brand hover:underline">{run.title}</a>
                    <span className="mono-number mt-0.5 block text-xs text-muted">{run.code}</span>
                  </th>
                  <td className="px-4 py-3 text-ink-2">{run.teacher_name ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted">{run.ended_at ? dateFormatter.format(run.ended_at) : "—"}</td>
                  <td className="mono-number px-4 py-3 text-right">{run.participants}</td>
                  <td className="px-4 py-3 text-xs">
                    {run.results_published_at
                      ? <span className="font-semibold text-ok">Publicados</span>
                      : <span className="text-warn">Sin publicar</span>}
                  </td>
                </tr>
              ))}
              {!recentRuns.length ? <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">Todavía no hay tomas cerradas.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
