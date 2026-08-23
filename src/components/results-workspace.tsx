import { CalendarDays, CheckCircle2, ChevronRight, Users } from "lucide-react";
import { useState } from "react";

import { CorrectionQueue, type CorrectionItem } from "@/components/correction-queue";
import type { RunSummary } from "@/server/repository";

interface ResultsSnapshot {
  run: { id: string; title: string; code: string; status: "lobby" | "running" | "ended"; created_at: number };
  questionCount: number;
  totalPoints: number;
  participants: Array<Record<string, string | number | null>>;
}

const dateFormatter = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" });

export function ResultsWorkspace({ sessions, snapshot, corrections }: { sessions: RunSummary[]; snapshot: ResultsSnapshot | null; corrections: CorrectionItem[] }) {
  const [liveSnapshot, setLiveSnapshot] = useState(snapshot);
  const selectedRunId = liveSnapshot?.run.id;

  function updateGrade(participantId: string, previous: number | null, next: number) {
    setLiveSnapshot((current) => current ? {
      ...current,
      participants: current.participants.map((participant) => participant.id === participantId ? {
        ...participant,
        score: Number(participant.score ?? 0) - Number(previous ?? 0) + next,
        pending_manual: Math.max(0, Number(participant.pending_manual ?? 0) - (previous === null ? 1 : 0)),
      } : participant),
    } : current);
  }
  return (
    <section className="grid gap-6" aria-labelledby="results-title">
      <header>
        <p className="text-xs font-semibold tracking-[.08em] text-muted uppercase">Por evaluación</p>
        <h1 id="results-title" className="mt-1 text-2xl font-semibold tracking-[-.02em] text-ink">Resultados y correcciones</h1>
        <p className="mt-1 text-sm text-muted">Elegí una sesión para ver las notas de cada alumno y corregir sus respuestas de desarrollo.</p>
      </header>

      {sessions.length ? (
        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          <nav className="h-fit overflow-hidden rounded-lg border bg-paper shadow-card" aria-label="Sesiones con resultados">
            <p className="border-b bg-inset px-4 py-3 text-xs font-semibold text-ink-2">Sesiones</p>
            <div className="divide-y">
              {sessions.map((session) => {
                const selected = selectedRunId === session.id;
                return <a key={session.id} href={`/resultados?run=${encodeURIComponent(session.id)}`} aria-current={selected ? "page" : undefined} className={`flex items-center gap-3 px-4 py-3 transition-colors ${selected ? "bg-brand-soft text-brand-deep" : "text-ink-2 hover:bg-canvas"}`}><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{session.title}</span><span className="mt-1 flex items-center gap-1 text-xs text-muted"><CalendarDays className="size-3" aria-hidden="true" />{dateFormatter.format(session.createdAt)}</span></span><ChevronRight className="size-4 shrink-0" aria-hidden="true" /></a>;
              })}
            </div>
          </nav>

          {liveSnapshot ? <div className="min-w-0 space-y-6">
            <section className="overflow-hidden rounded-lg border bg-paper shadow-card" aria-labelledby="student-results-title">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5"><div><p className="mono-number text-xs font-semibold tracking-[.08em] text-brand uppercase">Código {liveSnapshot.run.code}</p><h2 id="student-results-title" className="mt-1 text-xl font-semibold text-ink">{liveSnapshot.run.title}</h2><p className="mt-1 text-sm text-muted">{liveSnapshot.totalPoints} puntos totales · {liveSnapshot.questionCount} preguntas</p></div><a href={`/sesiones/${encodeURIComponent(liveSnapshot.run.id)}`} className="text-sm font-semibold text-brand hover:underline">Ver sesión y avisos</a></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-inset text-xs text-ink-2"><tr><th className="px-4 py-3">Alumno</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3 text-right">Respondidas</th><th className="px-4 py-3 text-right">Nota</th></tr></thead><tbody className="divide-y">{liveSnapshot.participants.map((participant) => { const pending = Number(participant.pending_manual); const score = Number(participant.score ?? 0); return <tr key={String(participant.id)}><th scope="row" className="px-4 py-3 font-semibold text-ink">{String(participant.name)}</th><td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${participant.status === "submitted" ? "text-ok" : "text-muted"}`}><CheckCircle2 className="size-3.5" aria-hidden="true" />{participant.status === "submitted" ? "Entregó" : "Sin entregar"}</span></td><td className="mono-number px-4 py-3 text-right">{Number(participant.answered)}/{liveSnapshot.questionCount}</td><td className="px-4 py-3 text-right"><span className="mono-number font-semibold text-ink">{score}/{liveSnapshot.totalPoints}</span>{pending ? <span className="mt-0.5 block text-xs text-warn">Falta corrección manual</span> : null}</td></tr>; })}{!liveSnapshot.participants.length ? <tr><td colSpan={4} className="px-4 py-10 text-center text-muted"><Users className="mx-auto mb-2 size-5" aria-hidden="true" />No hay alumnos en esta sesión.</td></tr> : null}</tbody></table></div>
            </section>
            <CorrectionQueue initialItems={corrections} embedded onGradeSaved={updateGrade} />
          </div> : null}
        </div>
      ) : <div className="rounded-lg border border-dashed bg-paper p-10 text-center"><h2 className="font-semibold text-ink">Todavía no hay resultados</h2><p className="mt-1 text-sm text-muted">Cuando una evaluación tenga alumnos, sus notas aparecerán acá.</p><a href="/evaluaciones" className="mt-5 inline-flex h-9 items-center rounded-md bg-brand px-4 text-sm font-semibold text-white">Ir a evaluaciones</a></div>}
    </section>
  );
}
