import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BrainCircuit, Check, Filter, Maximize2, MessageSquarePlus, Minimize2, Save, Sparkles, X } from "lucide-react";

import type { RubricCriterion } from "@/domain/exam";
import { AiCorrectionReview, type ReviewValues } from "@/components/ai-correction-review";
import { RichContent } from "@/components/rich-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface CorrectionItem {
  participantId: string; runId: string; studentName: string; runTitle: string; runCode?: string; submittedAt: number;
  questionId: string; prompt: string; maxPoints: number; answer: string; pointsAwarded: number | null;
  feedback: string; teacherNote?: string; rubricScores: Record<string, number>; rubric: RubricCriterion[];
  gradingStatus?: string; aiSuggestedScore?: number | null; aiConfidence?: number | null;
  aiFeedback?: string; aiTeacherNote?: string; aiCriteria?: unknown[]; aiError?: string | null;
  gradingCriteria?: string; referenceAnswer?: string;
}

interface Job { id: string; status: "queued" | "processing" | "completed" | "failed" | "cancelled"; total: number; processed: number; failed: number; error?: string | null }
const fechaCorta = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const itemKey = (item: CorrectionItem) => `${item.participantId}:${item.questionId}`;
const pendingStatus = (item: CorrectionItem) => !["graded", "auto_graded"].includes(item.gradingStatus ?? (item.pointsAwarded === null ? "pending_manual" : "graded"));

export function CorrectionQueue({ initialItems, embedded = false, onGradeSaved }: { initialItems: CorrectionItem[]; embedded?: boolean; onGradeSaved?: (participantId: string, previous: number | null, next: number) => void }) {
  const [items, setItems] = useState(initialItems);
  const [selectedKey, setSelectedKey] = useState(initialItems[0] ? itemKey(initialItems[0]) : "");
  /**
   * Nivel 1 son las tomas; nivel 2, las respuestas de una. `null` = nivel 1.
   *
   * Embebida dentro de una toma —la pestaña Correcciones de Resultados— el
   * docente ya eligió la evaluación: mostrarle la lista de tomas ahí sería
   * hacerlo elegir de nuevo lo que acaba de elegir.
   */
  const [openRun, setOpenRun] = useState<string | null>(() => {
    if (!embedded) return null;
    const tomas = new Set(initialItems.map((item) => item.runId));
    return tomas.size === 1 ? [...tomas][0] : null;
  });
  const [studentFilter, setStudentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"pending" | "suggested" | "graded" | "all">("pending");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "week" | "month">("all");
  const [mode, setMode] = useState<"question" | "student">("question");
  const [comments, setComments] = useState<Array<{ id: string; text: string }>>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [jobError, setJobError] = useState("");
  const [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [reviewing, setReviewing] = useState(false);

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
  /** Resumen por toma: es lo que se ve al entrar a Correcciones. */
  const runs = useMemo(() => {
    const porToma = new Map<string, { runId: string; runTitle: string; runCode: string; pending: number; suggested: number; total: number; lastAt: number }>();
    for (const item of items) {
      const fila = porToma.get(item.runId) ?? { runId: item.runId, runTitle: item.runTitle, runCode: item.runCode ?? "", pending: 0, suggested: 0, total: 0, lastAt: 0 };
      fila.total += 1;
      if (pendingStatus(item)) {
        fila.pending += 1;
        if (item.aiSuggestedScore !== null && item.aiSuggestedScore !== undefined) fila.suggested += 1;
      }
      fila.lastAt = Math.max(fila.lastAt, item.submittedAt);
      porToma.set(item.runId, fila);
    }
    // Primero lo que espera hace más tiempo: es lo que el alumno está esperando.
    return [...porToma.values()].sort((a, b) => (b.pending > 0 ? 1 : 0) - (a.pending > 0 ? 1 : 0) || a.lastAt - b.lastAt);
  }, [items]);
  const filtered = useMemo(() => items.filter((item) => {
    if (openRun && item.runId !== openRun) return false;
    if (studentFilter && !item.studentName.toLocaleLowerCase().includes(studentFilter.toLocaleLowerCase())) return false;
    if (statusFilter === "pending" && !pendingStatus(item)) return false;
    if (statusFilter === "suggested" && !["ai_suggested", "ai_review_required"].includes(item.gradingStatus ?? "")) return false;
    if (statusFilter === "graded" && pendingStatus(item)) return false;
    const age = Date.now() - item.submittedAt;
    if (dateFilter === "today" && age > 24 * 60 * 60 * 1000) return false;
    if (dateFilter === "week" && age > 7 * 24 * 60 * 60 * 1000) return false;
    if (dateFilter === "month" && age > 30 * 24 * 60 * 60 * 1000) return false;
    return true;
  }).sort((a, b) => mode === "question" ? a.prompt.localeCompare(b.prompt) || a.studentName.localeCompare(b.studentName) : a.studentName.localeCompare(b.studentName) || a.prompt.localeCompare(b.prompt)), [dateFilter, items, mode, openRun, statusFilter, studentFilter]);
  const activeIndex = Math.max(0, filtered.findIndex((item) => itemKey(item) === selectedKey));
  const active = filtered[activeIndex] ?? null;
  const pending = items.filter(pendingStatus).length;

  // El cuadro de revisión trabaja sobre UNA evaluación: la filtrada, o la de la
  // respuesta abierta. Entran las pendientes que ya tienen sugerencia; las que
  // la IA no llegó a sugerir se cuentan aparte para avisarlo al cerrar, o el
  // docente termina la cola creyendo que no quedó nada.
  const runForReview = openRun || active?.runId || "";
  const reviewQueue = useMemo(
    () => items.filter((item) => item.runId === runForReview && pendingStatus(item) && item.aiSuggestedScore !== null && item.aiSuggestedScore !== undefined),
    [items, runForReview],
  );
  const reviewPendingWithoutSuggestion = useMemo(
    () => items.filter((item) => item.runId === runForReview && pendingStatus(item) && (item.aiSuggestedScore === null || item.aiSuggestedScore === undefined)).length,
    [items, runForReview],
  );
  const reviewRunTitle = items.find((item) => item.runId === runForReview)?.runTitle ?? "";

  useEffect(() => { if (filtered.length && !filtered.some((item) => itemKey(item) === selectedKey)) setSelectedKey(itemKey(filtered[0])); }, [filtered, selectedKey]);
  useEffect(() => {
    if (!job || !["queued", "processing"].includes(job.status)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/corrections/jobs/${encodeURIComponent(job.id)}`);
      if (!response.ok) return;
      const next = await response.json() as Job;
      setJob(next);
      if (["completed", "failed"].includes(next.status)) window.setTimeout(() => window.location.reload(), 500);
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [job]);

  async function analyze() {
    const runId = openRun || active?.runId;
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
  // Mientras esté abierto se monta sí o sí. Si dependiera de `reviewQueue`, al
  // guardar la última respuesta la cola quedaría vacía y el cuadro se cerraría
  // solo: el docente nunca vería la pantalla de cierre ni el aviso de las que
  // quedaron sin sugerencia. El cuadro congela su propia cola al abrirse.
  const review = reviewing ? <AiCorrectionReview
    items={reviewQueue}
    runTitle={reviewRunTitle}
    withoutSuggestion={reviewPendingWithoutSuggestion}
    onClose={() => setReviewing(false)}
    onResolve={(item: CorrectionItem, values: ReviewValues) => save(item, values, false)}
  /> : null;

  const abierta = openRun ? runs.find((fila) => fila.runId === openRun) : null;

  // ── Nivel 1: las tomas que esperan corrección ──────────────────────────
  if (!openRun) {
    const conPendientes = runs.filter((fila) => fila.pending > 0);
    return <section className="grid gap-5" data-correction-ready={ready ? "true" : "false"} data-correction-level="tomas">
      <header>
        <p className="text-xs font-bold tracking-[.1em] text-brand uppercase">Bandeja de trabajo</p>
        <h2 id="correction-title" className="mt-1 text-2xl font-semibold tracking-[-.02em] text-ink">Correcciones pendientes</h2>
        <p className="mt-1 text-sm text-muted">
          {conPendientes.length
            ? `${pending} respuesta${pending === 1 ? "" : "s"} en ${conPendientes.length} ${conPendientes.length === 1 ? "evaluación" : "evaluaciones"}. Empezá por la que espera hace más tiempo.`
            : "No queda nada por corregir."}
        </p>
      </header>

      {conPendientes.length ? <ul className="grid gap-3">
        {conPendientes.map((fila) => {
          const corregidas = fila.total - fila.pending;
          const avance = fila.total ? Math.round(corregidas / fila.total * 100) : 0;
          return <li key={fila.runId}>
            <button
              type="button"
              onClick={() => setOpenRun(fila.runId)}
              className="group grid w-full gap-3 rounded-xl border bg-paper p-5 text-left shadow-card transition-colors hover:border-brand sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold text-ink group-hover:text-brand">{fila.runTitle}</span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">{fila.runCode ? <span className="mono-number rounded-sm bg-inset px-1.5 py-0.5 font-semibold tracking-[.08em] text-ink-2">{fila.runCode}</span> : null}<span>Última entrega {fechaCorta.format(fila.lastAt)}</span></span>
                <span className="mt-3 block h-1.5 max-w-md overflow-hidden rounded-full bg-inset">
                  <span className="block h-full rounded-full bg-brand" style={{ width: `${avance}%` }} />
                </span>
                <span className="mt-1.5 block text-xs text-muted">{corregidas} de {fila.total} corregida{fila.total === 1 ? "" : "s"}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                {fila.suggested ? <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand-deep"><Sparkles className="size-3.5" aria-hidden="true" />{fila.suggested} con sugerencia</span> : null}
                <span className="mono-number rounded-full bg-warn/12 px-3 py-1 text-sm font-bold text-warn">{fila.pending}</span>
                <ArrowRight className="size-4 text-muted group-hover:text-brand" aria-hidden="true" />
              </span>
            </button>
          </li>;
        })}
      </ul> : <div className="rounded-xl border border-dashed bg-paper p-10 text-center">
        <p className="text-xs font-bold tracking-[.1em] text-brand uppercase">Bandeja al día</p>
        <h3 className="mt-2 text-xl font-semibold text-ink">No hay desarrollos para corregir</h3>
        <p className="mt-2 text-sm text-muted">Las respuestas nuevas van a aparecer acá cuando los alumnos entreguen.</p>
      </div>}

      {/* Las tomas ya cerradas siguen accesibles: volver a mirar una corrección
          hecha, o cambiarla, es parte del trabajo y no puede desaparecer solo
          porque no quede nada pendiente. */}
      {runs.some((fila) => fila.pending === 0) ? <details className="rounded-xl border bg-paper">
        <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold text-ink-2 hover:bg-inset">
          Evaluaciones ya corregidas · {runs.filter((fila) => fila.pending === 0).length}
        </summary>
        <ul className="grid gap-1 border-t p-2">
          {runs.filter((fila) => fila.pending === 0).map((fila) => <li key={fila.runId}>
            <button
              type="button"
              onClick={() => setOpenRun(fila.runId)}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-inset"
            >
              <span className="min-w-0 flex-1 truncate text-ink-2">{fila.runTitle}</span>
              {fila.runCode ? <span className="mono-number shrink-0 text-xs tracking-[.08em] text-muted">{fila.runCode}</span> : null}
              <span className="mono-number shrink-0 text-xs text-ok">{fila.total} corregida{fila.total === 1 ? "" : "s"}</span>
            </button>
          </li>)}
        </ul>
      </details> : null}
    </section>;
  }

  // ── Nivel 2: las respuestas de esa toma ────────────────────────────────
  return <section className={`grid gap-4 ${expanded ? "fixed inset-0 z-50 overflow-y-auto bg-canvas p-4 lg:p-6" : ""}`} data-correction-ready={ready ? "true" : "false"} data-correction-expanded={expanded ? "true" : "false"} data-correction-level="respuestas">
    {embedded ? null : <div>
      <button type="button" onClick={() => setOpenRun(null)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"><ArrowLeft className="size-4" aria-hidden="true" />Todas las evaluaciones</button>
    </div>}
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-bold tracking-[.1em] text-brand uppercase">Corrigiendo</p>
        <h2 id="correction-title" className="mt-1 truncate text-2xl font-semibold tracking-[-.02em] text-ink">{abierta?.runTitle ?? ""}</h2>
        {abierta?.runCode ? <p className="mono-number mt-1 text-xs font-semibold tracking-[.12em] text-muted">{abierta.runCode}</p> : null}
        <p className="mt-1 text-sm text-muted">{abierta?.pending ?? 0} por revisar · {(abierta?.total ?? 0) - (abierta?.pending ?? 0)} resueltas</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setExpanded((value) => !value)}>{expanded ? <><Minimize2 data-icon="inline-start" />Salir</> : <><Maximize2 data-icon="inline-start" />Pantalla completa</>}</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void addComment()}><MessageSquarePlus data-icon="inline-start" />Comentario</Button>
        {reviewQueue.length
          ? <Button type="button" size="sm" onClick={() => setReviewing(true)}><Sparkles data-icon="inline-start" />Corregir todo con sugerencias · {reviewQueue.length}</Button>
          : <Button type="button" size="sm" onClick={() => void analyze()} disabled={job?.status === "processing"} aria-busy={job?.status === "processing"}><BrainCircuit data-icon="inline-start" />Pedir sugerencias a la IA</Button>}
      </div>
    </header>
    {job ? <div className="rounded-md border border-brand/20 bg-brand-soft/40 px-4 py-3 text-sm text-ink-2"><div className="flex items-center justify-between gap-3"><span><strong>{job.status === "completed" ? (job.failed ? "Análisis terminado con avisos" : "Análisis completo") : job.status === "failed" ? "El análisis quedó a medias" : "Analizando respuestas en segundo plano"}</strong> · {job.processed}/{job.total}{job.error ? <span className="mt-1 block font-normal text-warn">{job.error}</span> : null}</span>{["queued", "processing"].includes(job.status) ? <Button type="button" variant="ghost" size="xs" onClick={() => void fetch(`/api/corrections/jobs/${job.id}`, { method: "DELETE" }).then(() => setJob({ ...job, status: "cancelled" }))}>Cancelar</Button> : null}</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white"><div className="h-full bg-brand transition-[width]" style={{ width: `${job.total ? job.processed / job.total * 100 : 100}%` }} /></div></div> : null}
    {jobError ? <p className="rounded-md border border-alert/30 bg-alert/5 px-4 py-3 text-sm text-alert">{jobError}</p> : null}
    <div className="grid gap-3 rounded-lg border bg-inset p-3 md:grid-cols-[1fr_9rem_9rem_9rem_auto]">
      <label className="text-xs font-semibold text-ink-2">Alumno<Input className="mt-1" value={studentFilter} onChange={(event) => setStudentFilter(event.target.value)} placeholder="Buscar por nombre" /></label>
      <label className="text-xs font-semibold text-ink-2">Estado<select className="mt-1 h-9 w-full rounded-md border bg-white px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="pending">Pendientes</option><option value="suggested">Con sugerencia IA</option><option value="graded">Corregidas</option><option value="all">Todas</option></select></label>
      <label className="text-xs font-semibold text-ink-2">Fecha<select className="mt-1 h-9 w-full rounded-md border bg-white px-3 text-sm" value={dateFilter} onChange={(event) => setDateFilter(event.target.value as typeof dateFilter)}><option value="all">Cualquier fecha</option><option value="today">Últimas 24 h</option><option value="week">Últimos 7 días</option><option value="month">Últimos 30 días</option></select></label>
      <label className="text-xs font-semibold text-ink-2">Orden<select className="mt-1 h-9 w-full rounded-md border bg-white px-3 text-sm" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="question">Por pregunta</option><option value="student">Por alumno</option></select></label>
      <Button type="button" variant="ghost" size="sm" className="self-end" onClick={() => { setStudentFilter(""); setStatusFilter("pending"); setDateFilter("all"); }}><Filter data-icon="inline-start" />Limpiar</Button>
    </div>
    {active ? <div className={`grid overflow-hidden rounded-xl border bg-paper shadow-card lg:grid-cols-[17rem_1fr] ${expanded ? "min-h-[calc(100dvh-13rem)]" : "min-h-[34rem]"}`}>
      <aside className={`overflow-y-auto border-b bg-inset lg:border-r lg:border-b-0 ${expanded ? "max-h-[calc(100dvh-13rem)]" : "max-h-[72dvh]"}`} aria-label="Respuestas"><div className="sticky top-0 z-10 border-b bg-inset p-3 text-xs font-semibold text-muted">{filtered.length} respuesta{filtered.length === 1 ? "" : "s"}</div>{filtered.map((item, index) => <button key={itemKey(item)} type="button" onClick={() => setSelectedKey(itemKey(item))} className={`w-full border-b p-3 text-left transition-colors ${itemKey(item) === itemKey(active) ? "bg-white shadow-[inset_3px_0_0_var(--color-brand)]" : "hover:bg-white/70"}`}><span className="flex items-center justify-between gap-2"><strong className="truncate text-sm text-ink">{item.studentName}</strong><span className={`size-2 rounded-full ${pendingStatus(item) ? item.aiSuggestedScore !== null && item.aiSuggestedScore !== undefined ? "bg-brand" : "bg-warn" : "bg-ok"}`} /></span><span className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{mode === "question" ? item.answer || "Sin respuesta" : item.prompt}</span><span className="mt-1 block text-[.7rem] text-muted">{index + 1} / {filtered.length}</span></button>)}</aside>
      <FocusedCorrection key={itemKey(active)} item={active} comments={comments} workingPosition={`${activeIndex + 1} de ${filtered.length}`} onPrevious={() => activeIndex > 0 && setSelectedKey(itemKey(filtered[activeIndex - 1]))} onNext={() => activeIndex < filtered.length - 1 && setSelectedKey(itemKey(filtered[activeIndex + 1]))} onSave={save} onReject={() => void rejectSuggestion(active)} />
    </div> : <div className="rounded-lg border border-dashed bg-paper p-10 text-center text-sm text-muted">No hay respuestas que coincidan con estos filtros.</div>}
    {review}
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
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [criteria, setCriteria] = useState(item.gradingCriteria ?? "");
  const [reference, setReference] = useState(item.referenceAnswer ?? "");
  const [criteriaSaved, setCriteriaSaved] = useState(false);
  const suggestion = item.aiSuggestedScore !== null && item.aiSuggestedScore !== undefined;

  // Los criterios se pueden cargar con la evaluacion ya tomada: se guardan sobre
  // la copia congelada de esta toma, no sobre la evaluacion original.
  async function saveCriteria() {
    const response = await fetch("/api/corrections/criteria", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: item.runId, questionId: item.questionId, gradingCriteria: criteria, referenceAnswer: reference }),
    });
    if (response.ok) { setCriteriaSaved(true); window.setTimeout(() => setCriteriaSaved(false), 2500); }
  }
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

  return <article className="flex min-w-0 flex-col"><header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div><p className="text-xs text-muted">{workingPosition} · {item.runTitle}</p><h3 className="mt-1 font-semibold text-ink">{item.studentName}</h3></div><div className="flex gap-1"><Button type="button" variant="ghost" size="icon-sm" onClick={onPrevious} aria-label="Respuesta anterior"><ArrowLeft /></Button><Button type="button" variant="ghost" size="icon-sm" onClick={onNext} aria-label="Respuesta siguiente"><ArrowRight /></Button></div></header><div className="grid flex-1 gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_17rem] xl:p-7"><div className="min-w-0"><p className="text-xs font-bold tracking-[.08em] text-muted uppercase">Consigna</p><RichContent text={item.prompt} className="mt-2 text-base font-semibold leading-7 text-ink" /><p className="mt-6 text-xs font-bold tracking-[.08em] text-muted uppercase">Respuesta</p><blockquote className="mt-2 min-h-32 whitespace-pre-wrap rounded-lg border bg-inset p-5 text-sm leading-7 text-ink">{item.answer || <span className="text-muted">Sin respuesta</span>}</blockquote>{suggestion ? <section className="mt-5 rounded-lg border border-brand/25 bg-brand-soft/35 p-4"><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-semibold text-brand-deep"><Sparkles className="size-4" />Sugerencia de IA: {item.aiSuggestedScore}/{item.maxPoints}</p><p className="mt-1 text-xs text-muted">Confianza {Math.round((item.aiConfidence ?? 0) * 100)}%. Es una propuesta: la nota la ponés vos. Queda registrado que salió de una sugerencia.</p></div><div className="flex gap-1"><Button type="button" size="xs" onClick={acceptSuggestion}><Check data-icon="inline-start" />Aceptar</Button><Button type="button" variant="ghost" size="icon-xs" onClick={onReject} aria-label="Descartar sugerencia"><X /></Button></div></div>{item.aiTeacherNote ? <p className="mt-3 text-sm leading-6 text-ink-2">{item.aiTeacherNote}</p> : null}{Array.isArray(item.aiCriteria) && item.aiCriteria.length ? <ul className="mt-3 grid gap-1 text-xs text-ink-2">{(item.aiCriteria as Array<{ id?: string; score?: number; reason?: string }>).map((criterion, index) => <li key={`${criterion.id ?? "criterio"}-${index}`}><strong>{criterion.score ?? 0} pt:</strong> {criterion.reason ?? "Sin detalle"}</li>)}</ul> : null}</section> : null}<section className="mt-5 rounded-lg border bg-inset/50 p-4"><button type="button" className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold text-ink-2" onClick={() => setCriteriaOpen((value) => !value)} aria-expanded={criteriaOpen}><span className="flex items-center gap-2"><Sparkles className="size-4 text-brand" aria-hidden="true" />Criterios para la IA{criteria || reference ? <span className="rounded-sm bg-ok/15 px-1.5 py-0.5 text-[.7rem] font-semibold text-ok">cargados</span> : <span className="rounded-sm bg-inset px-1.5 py-0.5 text-[.7rem] font-normal text-muted">sin cargar</span>}</span><span className="text-xs font-normal text-muted">{criteriaOpen ? "Ocultar" : "Editar"}</span></button>{criteriaOpen ? <div className="mt-3 grid gap-3"><p className="text-xs leading-5 text-muted">Se aplican a esta toma. Si los cargás ahora y volvés a pedir la corrección con IA, la sugerencia usa estos criterios.</p><label className="block text-xs font-semibold text-ink-2">Qué debe demostrar la respuesta<Textarea className="mt-1 min-h-20 font-normal" value={criteria} onChange={(event) => setCriteria(event.target.value)} placeholder="Conceptos indispensables, relaciones esperadas y errores graves…" /></label><label className="block text-xs font-semibold text-ink-2">Respuesta de referencia · opcional<Textarea className="mt-1 min-h-20 font-normal" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Una respuesta modelo o los puntos clave esperados." /></label><div className="flex items-center gap-3"><Button type="button" size="sm" variant="outline" onClick={() => void saveCriteria()}>Guardar criterios</Button>{criteriaSaved ? <span className="text-xs font-semibold text-ok">Guardados</span> : null}</div></div> : null}</section><label className="mt-5 block text-xs font-semibold text-ink-2">Devolución para el alumno<Textarea ref={feedbackRef} className="mt-1 min-h-24 font-normal" value={feedback} onChange={(event) => setFeedback(event.target.value)} /></label>{comments.length ? <div className="mt-2 flex flex-wrap gap-1">{comments.map((comment) => <button key={comment.id} type="button" className="rounded-full border bg-white px-2 py-1 text-xs text-ink-2 hover:border-brand" onClick={() => setFeedback((value) => value ? `${value}\n${comment.text}` : comment.text)}>{comment.text}</button>)}</div> : null}<label className="mt-4 block text-xs font-semibold text-ink-2">Nota interna<Textarea className="mt-1 min-h-16 font-normal" value={teacherNote} onChange={(event) => setTeacherNote(event.target.value)} placeholder="Solo visible para docentes" /></label></div><aside className="flex flex-col gap-4 border-t pt-5 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6">{item.rubric.map((criterion) => <label key={criterion.id} className="text-xs font-semibold text-ink-2">{criterion.label} / {criterion.maxPoints}<Input type="number" min={0} max={criterion.maxPoints} step={0.25} value={rubricScores[criterion.id] ?? 0} onChange={(event) => { const next = { ...rubricScores, [criterion.id]: Number(event.target.value) }; setRubricScores(next); setPoints(Object.values(next).reduce((sum, value) => sum + value, 0)); }} /></label>)}<div><label className="text-xs font-semibold text-ink-2">Puntaje sobre {item.maxPoints}<Input className="mono-number mt-1 text-lg" type="number" min={0} max={item.maxPoints} step={0.25} value={points} disabled={item.rubric.length > 0} onChange={(event) => setPoints(Number(event.target.value))} /></label>{Number.isInteger(item.maxPoints) && item.maxPoints <= 10 ? <div className="mt-2 grid grid-cols-4 gap-1">{Array.from({ length: item.maxPoints + 1 }, (_, value) => <button key={value} type="button" className={`rounded border py-1 text-xs font-semibold ${points === value ? "border-brand bg-brand-soft text-brand" : "bg-white text-ink-2"}`} onClick={() => setPoints(value)}>{value}</button>)}</div> : null}</div><div className="mt-auto grid gap-2"><Button type="button" disabled={invalid || saving} onClick={() => void submit(true)}><Save data-icon="inline-start" />{saving ? "Guardando…" : "Guardar y siguiente"}</Button><Button type="button" variant="outline" disabled={invalid || saving} onClick={() => void submit(false)}>Guardar acá</Button><p className="text-center text-[.7rem] text-muted">0–9 puntúa · A acepta IA · E edita · Ctrl + Enter avanza</p>{error ? <p className="text-xs text-alert">{error}</p> : null}</div></aside></div></article>;
}
