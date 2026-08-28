import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BrainCircuit, Check, Filter, Maximize2, MessageSquarePlus, Minimize2, Save, Sparkles, X } from "lucide-react";

import type { RubricCriterion } from "@/domain/exam";
import { RichContent } from "@/components/rich-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface CorrectionItem {
  participantId: string; runId: string; studentName: string; runTitle: string; submittedAt: number;
  questionId: string; prompt: string; maxPoints: number; answer: string; pointsAwarded: number | null;
  feedback: string; teacherNote?: string; rubricScores: Record<string, number>; rubric: RubricCriterion[];
  gradingStatus?: string; aiSuggestedScore?: number | null; aiConfidence?: number | null;
  aiFeedback?: string; aiTeacherNote?: string; aiCriteria?: unknown[]; aiError?: string | null;
}

interface Job { id: string; status: "queued" | "processing" | "completed" | "failed" | "cancelled"; total: number; processed: number; failed: number; error?: string | null }
const itemKey = (item: CorrectionItem) => `${item.participantId}:${item.questionId}`;
const pendingStatus = (item: CorrectionItem) => !["graded", "auto_graded"].includes(item.gradingStatus ?? (item.pointsAwarded === null ? "pending_manual" : "graded"));

export function CorrectionQueue({ initialItems, embedded = false, onGradeSaved }: { initialItems: CorrectionItem[]; embedded?: boolean; onGradeSaved?: (participantId: string, previous: number | null, next: number) => void }) {
  const [items, setItems] = useState(initialItems);
  const [selectedKey, setSelectedKey] = useState(initialItems[0] ? itemKey(initialItems[0]) : "");
  const [runFilter, setRunFilter] = useState("");
  const [studentFilter, setStudentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"pending" | "suggested" | "graded" | "all">("pending");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "week" | "month">("all");
  const [mode, setMode] = useState<"question" | "student">("question");
  const [comments, setComments] = useState<Array<{ id: string; text: string }>>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [jobError, setJobError] = useState("");
  const [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => { setReady(true); void fetch("/api/corrections/comments").then((response) => response.ok ? response.json() : []).then(setComments); }, []);
  // Escape sale de pantalla completa y el fondo no scrollea mientras tanto.
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.dataset.overlayOpen = "true";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      delete document.documentElement.dataset.overlayOpen;
      window.removeEventListener("keydown", onKey);
    };
  }, [expanded]);
  const runs = useMemo(() => [...new Map(items.map((item) => [item.runId, item.runTitle])).entries()], [items]);
  const filtered = useMemo(() => items.filter((item) => {
    if (runFilter && item.runId !== runFilter) return false;
    if (studentFilter && !item.studentName.toLocaleLowerCase().includes(studentFilter.toLocaleLowerCase())) return false;
    if (statusFilter === "pending" && !pendingStatus(item)) return false;
    if (statusFilter === "suggested" && !["ai_suggested", "ai_review_required"].includes(item.gradingStatus ?? "")) return false;
    if (statusFilter === "graded" && pendingStatus(item)) return false;
    const age = Date.now() - item.submittedAt;
    if (dateFilter === "today" && age > 24 * 60 * 60 * 1000) return false;
    if (dateFilter === "week" && age > 7 * 24 * 60 * 60 * 1000) return false;
    if (dateFilter === "month" && age > 30 * 24 * 60 * 60 * 1000) return false;
    return true;
  }).sort((a, b) => mode === "question" ? a.prompt.localeCompare(b.prompt) || a.studentName.localeCompare(b.studentName) : a.studentName.localeCompare(b.studentName) || a.prompt.localeCompare(b.prompt)), [dateFilter, items, mode, runFilter, statusFilter, studentFilter]);
  const activeIndex = Math.max(0, filtered.findIndex((item) => itemKey(item) === selectedKey));
  const active = filtered[activeIndex] ?? null;
  const pending = items.filter(pendingStatus).length;

  useEffect(() => { if (filtered.length && !filtered.some((item) => itemKey(item) === selectedKey)) setSelectedKey(itemKey(filtered[0])); }, [filtered, selectedKey]);
  useEffect(() => {
    if (!job || !["queued", "processing"].includes(job.status)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/corrections/jobs/${encodeURIComponent(job.id)}`);
      if (!response.ok) return;
      const next = await response.json() as Job;
      setJob(next);
      if (next.status === "completed") window.setTimeout(() => window.location.reload(), 500);
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [job]);

  async function analyze() {
    const runId = runFilter || active?.runId;
    if (!runId) return;
    setJobError("");
    const response = await fetch("/api/corrections/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId }) });
    const body = await response.json().catch(() => ({})) as Job & { error?: string };
    if (!response.ok) setJobError(body.error ?? "No se pudo iniciar el análisis");
    // Un lote de cero no es un error del servidor: es que ninguna pregunta de
    // desarrollo tiene la IA habilitada, y sin avisarlo parece que no hizo nada.
    else if (!body.total) setJobError("Ninguna pregunta de esta evaluación tiene activada la corrección con IA. Activala en la evaluación, en cada pregunta de desarrollo.");
    else setJob(body);
  }

  async function save(item: CorrectionItem, values: { pointsAwarded: number; feedback: string; teacherNote: string; rubricScores: Record<string, number> }, moveNext: boolean) {
    const response = await fetch("/api/corrections/grade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: item.participantId, questionId: item.questionId, ...values }) });
    if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo guardar");
    setItems((current) => current.map((candidate) => itemKey(candidate) === itemKey(item) ? { ...candidate, ...values, gradingStatus: "graded" } : candidate));
    onGradeSaved?.(item.participantId, item.pointsAwarded, values.pointsAwarded);
    if (moveNext && filtered.length > 1) setSelectedKey(itemKey(filtered[Math.min(activeIndex + 1, filtered.length - 1)]));
  }

  async function rejectSuggestion(item: CorrectionItem) {
    const response = await fetch("/api/corrections/ai-review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: item.participantId, questionId: item.questionId, action: "reject" }) });
    if (response.ok) setItems((current) => current.map((candidate) => itemKey(candidate) === itemKey(item) ? { ...candidate, gradingStatus: "pending_manual", aiSuggestedScore: null, aiFeedback: "", aiTeacherNote: "" } : candidate));
  }

  async function addComment() {
    const text = window.prompt("Texto del comentario reutilizable:");
    if (!text?.trim()) return;
    const response = await fetch("/api/corrections/comments", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    if (response.ok) {
      const saved = await response.json() as { id: string; text: string };
      setComments((current) => [saved, ...current]);
    }
  }

  if (!items.length) return <section data-correction-ready={ready ? "true" : "false"} className={`grid place-items-center rounded-xl border border-dashed bg-paper p-10 text-center ${embedded ? "min-h-44" : "min-h-[55dvh]"}`}><div><p className="text-xs font-bold tracking-[.1em] text-brand uppercase">Bandeja al día</p><h2 className="mt-2 text-xl font-semibold text-ink">No hay desarrollos para corregir</h2><p className="mt-2 text-sm text-muted">Las respuestas nuevas van a aparecer acá cuando los alumnos entreguen.</p></div></section>;

  // En pantalla completa la bandeja tapa la navegación y la lista de sesiones:
  // corregir desarrollos con media pantalla era el reclamo real.
  return <section className={`grid gap-4 ${expanded ? "fixed inset-0 z-50 overflow-y-auto bg-canvas p-4 lg:p-6" : ""}`} data-correction-ready={ready ? "true" : "false"} data-correction-expanded={expanded ? "true" : "false"}>
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold tracking-[.1em] text-brand uppercase">Bandeja de trabajo</p><h2 id="correction-title" className="mt-1 text-2xl font-semibold text-ink">Correcciones pendientes</h2><p className="mt-1 text-sm text-muted">{pending} por revisar · {items.length - pending} resueltas</p></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setExpanded((value) => !value)}>{expanded ? <><Minimize2 data-icon="inline-start" />Salir</> : <><Maximize2 data-icon="inline-start" />Pantalla completa</>}</Button><Button type="button" variant="outline" size="sm" onClick={() => void addComment()}><MessageSquarePlus data-icon="inline-start" />Comentario</Button><Button type="button" size="sm" onClick={() => void analyze()} disabled={!active || job?.status === "processing"}><BrainCircuit data-icon="inline-start" />Corregir todo con IA</Button></div></header>
    {job ? <div className="rounded-md border border-brand/20 bg-brand-soft/40 px-4 py-3 text-sm text-ink-2"><div className="flex items-center justify-between gap-3"><span><strong>{job.status === "completed" ? "Análisis completo" : job.status === "failed" ? "El análisis se interrumpió" : "Analizando respuestas en segundo plano"}</strong> · {job.processed}/{job.total}{job.failed ? ` · ${job.failed} sin analizar` : ""}</span>{["queued", "processing"].includes(job.status) ? <Button type="button" variant="ghost" size="xs" onClick={() => void fetch(`/api/corrections/jobs/${job.id}`, { method: "DELETE" }).then(() => setJob({ ...job, status: "cancelled" }))}>Cancelar</Button> : null}</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white"><div className="h-full bg-brand transition-[width]" style={{ width: `${job.total ? job.processed / job.total * 100 : 100}%` }} /></div></div> : null}
    {jobError ? <p className="rounded-md border border-alert/30 bg-alert/5 px-4 py-3 text-sm text-alert">{jobError}</p> : null}
    <div className="grid gap-3 rounded-lg border bg-inset p-3 md:grid-cols-[1fr_1fr_9rem_9rem_9rem_auto]"><label className="text-xs font-semibold text-ink-2">Evaluación<select className="mt-1 h-9 w-full rounded-md border bg-white px-3 text-sm" value={runFilter} onChange={(event) => setRunFilter(event.target.value)}><option value="">Todas</option>{runs.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label><label className="text-xs font-semibold text-ink-2">Alumno<Input className="mt-1" value={studentFilter} onChange={(event) => setStudentFilter(event.target.value)} placeholder="Buscar por nombre" /></label><label className="text-xs font-semibold text-ink-2">Estado<select className="mt-1 h-9 w-full rounded-md border bg-white px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="pending">Pendientes</option><option value="suggested">Con sugerencia IA</option><option value="graded">Corregidas</option><option value="all">Todas</option></select></label><label className="text-xs font-semibold text-ink-2">Fecha<select className="mt-1 h-9 w-full rounded-md border bg-white px-3 text-sm" value={dateFilter} onChange={(event) => setDateFilter(event.target.value as typeof dateFilter)}><option value="all">Cualquier fecha</option><option value="today">Últimas 24 h</option><option value="week">Últimos 7 días</option><option value="month">Últimos 30 días</option></select></label><label className="text-xs font-semibold text-ink-2">Orden<select className="mt-1 h-9 w-full rounded-md border bg-white px-3 text-sm" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="question">Por pregunta</option><option value="student">Por alumno</option></select></label><Button type="button" variant="ghost" size="sm" className="self-end" onClick={() => { setRunFilter(""); setStudentFilter(""); setStatusFilter("pending"); setDateFilter("all"); }}><Filter data-icon="inline-start" />Limpiar</Button></div>
    {active ? <div className={`grid overflow-hidden rounded-xl border bg-paper shadow-card lg:grid-cols-[17rem_1fr] ${expanded ? "min-h-[calc(100dvh-13rem)]" : "min-h-[34rem]"}`}>
      <aside className={`overflow-y-auto border-b bg-inset lg:border-r lg:border-b-0 ${expanded ? "max-h-[calc(100dvh-13rem)]" : "max-h-[72dvh]"}`} aria-label="Respuestas"><div className="sticky top-0 z-10 border-b bg-inset p-3 text-xs font-semibold text-muted">{filtered.length} respuesta{filtered.length === 1 ? "" : "s"}</div>{filtered.map((item, index) => <button key={itemKey(item)} type="button" onClick={() => setSelectedKey(itemKey(item))} className={`w-full border-b p-3 text-left transition-colors ${itemKey(item) === itemKey(active) ? "bg-white shadow-[inset_3px_0_0_var(--color-brand)]" : "hover:bg-white/70"}`}><span className="flex items-center justify-between gap-2"><strong className="truncate text-sm text-ink">{item.studentName}</strong><span className={`size-2 rounded-full ${pendingStatus(item) ? item.aiSuggestedScore !== null && item.aiSuggestedScore !== undefined ? "bg-brand" : "bg-warn" : "bg-ok"}`} /></span><span className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{mode === "question" ? item.answer || "Sin respuesta" : item.prompt}</span><span className="mt-1 block text-[.7rem] text-muted">{index + 1} / {filtered.length} · {item.runTitle}</span></button>)}</aside>
      <FocusedCorrection key={itemKey(active)} item={active} comments={comments} workingPosition={`${activeIndex + 1} de ${filtered.length}`} onPrevious={() => activeIndex > 0 && setSelectedKey(itemKey(filtered[activeIndex - 1]))} onNext={() => activeIndex < filtered.length - 1 && setSelectedKey(itemKey(filtered[activeIndex + 1]))} onSave={save} onReject={() => void rejectSuggestion(active)} />
    </div> : <div className="rounded-lg border border-dashed bg-paper p-10 text-center text-sm text-muted">No hay respuestas que coincidan con estos filtros.</div>}
  </section>;
}

function FocusedCorrection({ item, comments, workingPosition, onPrevious, onNext, onSave, onReject }: { item: CorrectionItem; comments: Array<{ id: string; text: string }>; workingPosition: string; onPrevious: () => void; onNext: () => void; onSave: (item: CorrectionItem, values: { pointsAwarded: number; feedback: string; teacherNote: string; rubricScores: Record<string, number> }, moveNext: boolean) => Promise<void>; onReject: () => void }) {
  const [points, setPoints] = useState(item.pointsAwarded ?? item.aiSuggestedScore ?? 0);
  const [feedback, setFeedback] = useState(item.feedback || item.aiFeedback || "");
  const [teacherNote, setTeacherNote] = useState(item.teacherNote || item.aiTeacherNote || "");
  const [rubricScores, setRubricScores] = useState(item.rubricScores ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const suggestion = item.aiSuggestedScore !== null && item.aiSuggestedScore !== undefined;
  const invalid = points < 0 || points > item.maxPoints;

  async function submit(moveNext: boolean) {
    if (invalid || saving) return;
    setSaving(true); setError("");
    try { await onSave(item, { pointsAwarded: points, feedback, teacherNote, rubricScores }, moveNext); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar"); }
    finally { setSaving(false); }
  }
  function acceptSuggestion() {
    if (!suggestion) return;
    setPoints(item.aiSuggestedScore!); setFeedback(item.aiFeedback ?? ""); setTeacherNote(item.aiTeacherNote ?? "");
    const criteria = Array.isArray(item.aiCriteria) ? item.aiCriteria as Array<{ id?: string; score?: number }> : [];
    if (criteria.length) setRubricScores(Object.fromEntries(criteria.filter((value) => value.id && typeof value.score === "number").map((value) => [value.id!, value.score!] )));
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable='true']");
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void submit(true); return; }
      if (editing) return;
      if (event.key === "ArrowLeft") onPrevious();
      if (event.key === "ArrowRight") onNext();
      if (event.key.toLocaleLowerCase() === "a" && suggestion) acceptSuggestion();
      if (/^[0-9]$/.test(event.key) && Number(event.key) <= item.maxPoints) setPoints(Number(event.key));
      if (event.key.toLocaleLowerCase() === "e") feedbackRef.current?.focus();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  return <article className="flex min-w-0 flex-col"><header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div><p className="text-xs text-muted">{workingPosition} · {item.runTitle}</p><h3 className="mt-1 font-semibold text-ink">{item.studentName}</h3></div><div className="flex gap-1"><Button type="button" variant="ghost" size="icon-sm" onClick={onPrevious} aria-label="Respuesta anterior"><ArrowLeft /></Button><Button type="button" variant="ghost" size="icon-sm" onClick={onNext} aria-label="Respuesta siguiente"><ArrowRight /></Button></div></header><div className="grid flex-1 gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_17rem] xl:p-7"><div className="min-w-0"><p className="text-xs font-bold tracking-[.08em] text-muted uppercase">Consigna</p><RichContent text={item.prompt} className="mt-2 text-base font-semibold leading-7 text-ink" /><p className="mt-6 text-xs font-bold tracking-[.08em] text-muted uppercase">Respuesta</p><blockquote className="mt-2 min-h-32 whitespace-pre-wrap rounded-lg border bg-inset p-5 text-sm leading-7 text-ink">{item.answer || <span className="text-muted">Sin respuesta</span>}</blockquote>{suggestion ? <section className="mt-5 rounded-lg border border-brand/25 bg-brand-soft/35 p-4"><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-semibold text-brand-deep"><Sparkles className="size-4" />Sugerencia de IA: {item.aiSuggestedScore}/{item.maxPoints}</p><p className="mt-1 text-xs text-muted">Confianza {Math.round((item.aiConfidence ?? 0) * 100)}%. Es una propuesta: revisala antes de guardar.</p></div><div className="flex gap-1"><Button type="button" size="xs" onClick={acceptSuggestion}><Check data-icon="inline-start" />Aceptar</Button><Button type="button" variant="ghost" size="icon-xs" onClick={onReject} aria-label="Descartar sugerencia"><X /></Button></div></div>{item.aiTeacherNote ? <p className="mt-3 text-sm leading-6 text-ink-2">{item.aiTeacherNote}</p> : null}{Array.isArray(item.aiCriteria) && item.aiCriteria.length ? <ul className="mt-3 grid gap-1 text-xs text-ink-2">{(item.aiCriteria as Array<{ id?: string; score?: number; reason?: string }>).map((criterion, index) => <li key={`${criterion.id ?? "criterio"}-${index}`}><strong>{criterion.score ?? 0} pt:</strong> {criterion.reason ?? "Sin detalle"}</li>)}</ul> : null}</section> : null}<label className="mt-5 block text-xs font-semibold text-ink-2">Devolución para el alumno<Textarea ref={feedbackRef} className="mt-1 min-h-24 font-normal" value={feedback} onChange={(event) => setFeedback(event.target.value)} /></label>{comments.length ? <div className="mt-2 flex flex-wrap gap-1">{comments.map((comment) => <button key={comment.id} type="button" className="rounded-full border bg-white px-2 py-1 text-xs text-ink-2 hover:border-brand" onClick={() => setFeedback((value) => value ? `${value}\n${comment.text}` : comment.text)}>{comment.text}</button>)}</div> : null}<label className="mt-4 block text-xs font-semibold text-ink-2">Nota interna<Textarea className="mt-1 min-h-16 font-normal" value={teacherNote} onChange={(event) => setTeacherNote(event.target.value)} placeholder="Solo visible para docentes" /></label></div><aside className="flex flex-col gap-4 border-t pt-5 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6">{item.rubric.map((criterion) => <label key={criterion.id} className="text-xs font-semibold text-ink-2">{criterion.label} / {criterion.maxPoints}<Input type="number" min={0} max={criterion.maxPoints} step={0.25} value={rubricScores[criterion.id] ?? 0} onChange={(event) => { const next = { ...rubricScores, [criterion.id]: Number(event.target.value) }; setRubricScores(next); setPoints(Object.values(next).reduce((sum, value) => sum + value, 0)); }} /></label>)}<div><label className="text-xs font-semibold text-ink-2">Puntaje sobre {item.maxPoints}<Input className="mono-number mt-1 text-lg" type="number" min={0} max={item.maxPoints} step={0.25} value={points} disabled={item.rubric.length > 0} onChange={(event) => setPoints(Number(event.target.value))} /></label>{Number.isInteger(item.maxPoints) && item.maxPoints <= 10 ? <div className="mt-2 grid grid-cols-4 gap-1">{Array.from({ length: item.maxPoints + 1 }, (_, value) => <button key={value} type="button" className={`rounded border py-1 text-xs font-semibold ${points === value ? "border-brand bg-brand-soft text-brand" : "bg-white text-ink-2"}`} onClick={() => setPoints(value)}>{value}</button>)}</div> : null}</div><div className="mt-auto grid gap-2"><Button type="button" disabled={invalid || saving} onClick={() => void submit(true)}><Save data-icon="inline-start" />{saving ? "Guardando…" : "Guardar y siguiente"}</Button><Button type="button" variant="outline" disabled={invalid || saving} onClick={() => void submit(false)}>Guardar acá</Button><p className="text-center text-[.7rem] text-muted">0–9 puntúa · A acepta IA · E edita · Ctrl + Enter avanza</p>{error ? <p className="text-xs text-alert">{error}</p> : null}</div></aside></div></article>;
}
