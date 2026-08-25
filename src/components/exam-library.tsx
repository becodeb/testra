import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Copy, Pencil, Play, Search, Trash2 } from "lucide-react";

import type { ExamSummary } from "@/server/repository";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ExamLibraryProps {
  initialExams: ExamSummary[];
  subjects: string[];
}

const dateFormatter = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" });

export function ExamLibrary({ initialExams, subjects }: ExamLibraryProps) {
  const [exams, setExams] = useState(initialExams);
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [workingId, setWorkingId] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const [actionError, setActionError] = useState("");
  const [ready, setReady] = useState(false);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => setReady(true), []);

  const filtered = useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase("es");
    return exams.filter((exam) =>
      (!normalized || exam.title.toLocaleLowerCase("es").includes(normalized)) &&
      (!subject || exam.subject === subject),
    );
  }, [deferredQuery, exams, subject]);

  async function createRun(examId: string) {
    setWorkingId(examId);
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examId }),
    });
    const body = await response.json() as { id?: string; error?: string };
    if (response.ok && body.id) window.location.assign(`/sesiones/${encodeURIComponent(body.id)}`);
    else setActionError(body.error ?? "No se pudo abrir la sala de espera");
    setWorkingId("");
  }

  async function duplicate(examId: string) {
    setWorkingId(examId);
    const response = await fetch(`/api/exams/${encodeURIComponent(examId)}/duplicate`, { method: "POST" });
    const body = await response.json() as { id?: string; error?: string };
    if (response.ok && body.id) window.location.assign(`/evaluaciones/${encodeURIComponent(body.id)}`);
    else setActionError(body.error ?? "No se pudo duplicar la evaluación");
    setWorkingId("");
  }

  async function remove(examId: string) {
    if (deleteId !== examId) {
      setDeleteId(examId);
      return;
    }
    setWorkingId(examId);
    const response = await fetch(`/api/exams/${encodeURIComponent(examId)}`, { method: "DELETE" });
    if (response.ok) setExams((current) => current.filter((exam) => exam.id !== examId));
    else {
      const body = await response.json().catch(() => ({})) as { error?: string };
      setActionError(body.error ?? "No se pudo borrar la evaluación");
    }
    setWorkingId("");
    setDeleteId("");
  }

  return (
    <div className="contents" data-library-ready={ready}>
      {actionError ? <div className="flex items-center justify-between gap-3 rounded-md border border-alert/30 bg-paper px-4 py-3 text-sm text-alert" role="alert"><span>{actionError}</span><button type="button" className="font-semibold underline" onClick={() => setActionError("")}>Cerrar</button></div> : null}
      <div className="grid gap-3 rounded-lg border bg-paper p-4 shadow-card sm:grid-cols-[1fr_14rem]" role="search">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-2">
          Buscar por título
          <span className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ej.: fotosíntesis" className="pl-9" />
          </span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-2">
          Materia
          <select value={subject} onChange={(event) => setSubject(event.target.value)} className="h-9 rounded-md border border-line-2 bg-white px-3 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20">
            <option value="">Todas</option>
            {subjects.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
      </div>

      {filtered.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((exam) => (
            <article key={exam.id} className={`group relative flex min-h-56 flex-col rounded-lg border bg-paper p-5 shadow-card ${workingId === exam.id && deleteId === exam.id ? "smoky-removing" : ""}`}>
              {exam.runCount > 1 ? <div aria-hidden="true" className="pointer-events-none absolute inset-x-3 -top-1 -z-10 h-full rounded-lg border bg-inset transition-transform duration-150 ease-[cubic-bezier(.2,.7,.3,1)] group-hover:-translate-y-1" /> : null}
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs font-semibold tracking-[.05em] text-brand uppercase">{exam.subject || "Sin materia"}</span>
                <span className={`rounded-sm border px-1.5 py-0.5 text-[.7rem] font-semibold ${exam.status === "ready" ? "border-ok/25 bg-ok/5 text-ok" : "border-warn/25 bg-warn/5 text-warn"}`}>{exam.status === "ready" ? "Lista" : "Borrador"}</span>
              </div>
              <h2 className="mt-3 text-lg font-semibold leading-snug tracking-[-.01em] text-ink">{exam.title || "Sin título"}</h2>
              {exam.accessRole !== "owner" ? <p className="mt-1 text-xs font-medium text-muted">Compartida por {exam.ownerName} · {exam.accessRole === "edit" ? "podés editar" : exam.accessRole === "correct" ? "podés corregir" : "solo lectura"}</p> : null}
              <dl className="mt-4 grid grid-cols-3 gap-3 border-y py-3">
                <div><dt className="text-[.7rem] text-muted">Preguntas</dt><dd className="mono-number mt-0.5 text-sm font-semibold">{exam.questionCount}</dd></div>
                <div><dt className="text-[.7rem] text-muted">Puntaje</dt><dd className="mono-number mt-0.5 text-sm font-semibold">{exam.totalPoints}</dd></div>
                <div><dt className="text-[.7rem] text-muted">Sesiones</dt><dd className="mono-number mt-0.5 text-sm font-semibold">{exam.runCount}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-muted">Última sesión: <span className="tabular text-ink-2">{exam.lastRunAt ? dateFormatter.format(exam.lastRunAt) : "Nunca"}</span></p>
              <div className="mt-auto flex flex-wrap items-center gap-1 pt-5">
                {exam.accessRole === "owner" || exam.accessRole === "edit" ? <Button type="button" size="sm" disabled={exam.status !== "ready" || workingId === exam.id} onClick={() => createRun(exam.id)}><Play data-icon="inline-start" /> Abrir sala</Button> : null}
                <Button asChild variant="outline" size="sm"><a href={`/evaluaciones/${encodeURIComponent(exam.id)}`}><Pencil data-icon="inline-start" /> {exam.accessRole === "owner" || exam.accessRole === "edit" ? "Editar" : "Ver"}</a></Button>
                <Button type="button" variant="ghost" size="icon-sm" disabled={workingId === exam.id} aria-label={`Duplicar ${exam.title}`} onClick={() => duplicate(exam.id)}><Copy /></Button>
                {exam.accessRole === "owner" ? <Button type="button" variant={deleteId === exam.id ? "destructive" : "ghost"} size={deleteId === exam.id ? "sm" : "icon-sm"} disabled={workingId === exam.id} aria-label={`Borrar ${exam.title}`} onClick={() => remove(exam.id)}><Trash2 />{deleteId === exam.id ? "Confirmar borrado" : null}</Button> : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed bg-paper p-10 text-center"><h2 className="font-semibold text-ink">No hay evaluaciones para mostrar</h2><p className="mt-1 text-sm text-muted">Probá con otro filtro o creá una evaluación nueva.</p></div>
      )}
    </div>
  );
}
