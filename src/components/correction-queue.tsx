import { useEffect, useState } from "react";
import { Check, Save, MessageSquarePlus, Rows3, ListChecks } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RichContent } from "@/components/rich-content";
import type { RubricCriterion } from "@/domain/exam";
import { groupCorrectionsByQuestion } from "@/server/correction-groups";

export interface CorrectionItem {
  participantId: string;
  runId: string;
  studentName: string;
  runTitle: string;
  submittedAt: number;
  questionId: string;
  prompt: string;
  maxPoints: number;
  answer: string;
  pointsAwarded: number | null;
  feedback: string;
  rubricScores: Record<string, number>;
  rubric: RubricCriterion[];
}

export function CorrectionQueue({ initialItems, embedded = false, onGradeSaved }: { initialItems: CorrectionItem[]; embedded?: boolean; onGradeSaved?: (participantId: string, previous: number | null, next: number) => void }) {
  const [items, setItems] = useState(initialItems);
  const [workingKey, setWorkingKey] = useState("");
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"student" | "question">("student");
  const [comments, setComments] = useState<Array<{ id: string; text: string }>>([]);
  const pending = items.filter((item) => item.pointsAwarded === null).length;
  const questionGroups = groupCorrectionsByQuestion(items);

  useEffect(() => { setReady(true); void fetch("/api/corrections/comments").then((response) => response.ok ? response.json() : []).then(setComments); }, []);

  async function save(item: CorrectionItem, pointsAwarded: number, feedback: string, rubricScores: Record<string, number>) {
    const key = `${item.participantId}:${item.questionId}`;
    setWorkingKey(key);
    const response = await fetch("/api/corrections/grade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantId: item.participantId, questionId: item.questionId, pointsAwarded, feedback, rubricScores }),
    });
    if (response.ok) {
      setItems((current) => current.map((candidate) => candidate.participantId === item.participantId && candidate.questionId === item.questionId ? { ...candidate, pointsAwarded, feedback, rubricScores } : candidate));
      onGradeSaved?.(item.participantId, item.pointsAwarded, pointsAwarded);
    }
    else window.alert("No se pudo guardar la corrección");
    setWorkingKey("");
  }

  async function addComment() {
    const text = window.prompt("Texto del comentario reutilizable:");
    if (!text?.trim()) return;
    const response = await fetch("/api/corrections/comments", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    if (response.ok) { const item = await response.json() as { id: string; text: string }; setComments((current) => [item, ...current]); }
  }

  async function editComment(comment: { id: string; text: string }) {
    const text = window.prompt("Editar comentario:", comment.text);
    if (!text?.trim()) return;
    const response = await fetch("/api/corrections/comments", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: comment.id, text }) });
    if (response.ok) { const next = await response.json() as { id: string; text: string }; setComments((current) => current.map((item) => item.id === next.id ? next : item)); }
  }

  async function removeComment(id: string) {
    const response = await fetch("/api/corrections/comments", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    if (response.ok) setComments((current) => current.filter((item) => item.id !== id));
  }

  if (!items.length) return <section className={`flex flex-col items-center justify-center rounded-lg border border-dashed bg-paper p-8 text-center ${embedded ? "min-h-40" : "min-h-[55dvh]"}`} aria-labelledby={embedded ? undefined : "page-title"}><p className="mb-2 text-xs font-semibold tracking-[.08em] text-muted uppercase">Sin pendientes</p><h2 id={embedded ? undefined : "page-title"} className="text-xl font-semibold text-ink">No hay respuestas para corregir a mano</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-muted">Las preguntas cerradas ya tienen puntaje automático. Los desarrollos aparecerán acá.</p>{!embedded ? <a href="/sesiones" className="mt-5 inline-flex h-9 items-center rounded-md border bg-white px-4 text-sm font-semibold text-ink-2 hover:bg-inset">Ver sesiones</a> : null}</section>;

  return (
    <section className="grid gap-5" aria-labelledby="page-title" data-correction-ready={ready}>
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="mb-1 text-xs font-semibold tracking-[.08em] text-muted uppercase">Corrección manual</p><h2 id="correction-title" className="text-xl font-semibold text-ink">Correcciones pendientes</h2><p className="mt-1 text-sm text-muted">{pending ? `${pending} respuesta${pending === 1 ? "" : "s"} pendiente${pending === 1 ? "" : "s"}.` : "Todo corregido. Podés revisar y ajustar los puntajes."}</p></div><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setMode((value) => value === "student" ? "question" : "student")}>{mode === "student" ? <ListChecks data-icon="inline-start" /> : <Rows3 data-icon="inline-start" />}{mode === "student" ? "Por pregunta" : "Por alumno"}</Button><Button type="button" size="sm" variant="outline" onClick={() => void addComment()}><MessageSquarePlus data-icon="inline-start" />Comentario</Button><span className="mono-number rounded-md border bg-paper px-3 py-2 text-sm font-semibold">{pending}/{items.length}</span></div></div>
      {comments.length ? <div className="flex flex-wrap gap-1.5" aria-label="Comentarios reutilizables">{comments.map((comment) => <span key={comment.id} className="inline-flex overflow-hidden rounded-full border bg-paper text-xs"><button type="button" className="px-2 py-1 hover:bg-inset" title="Editar" onClick={() => void editComment(comment)}>{comment.text}</button><button type="button" className="border-l px-2 text-alert hover:bg-inset" aria-label={`Eliminar ${comment.text}`} onClick={() => void removeComment(comment.id)}>×</button></span>)}</div> : null}
      {mode === "student" ? (
        <div className="divide-y overflow-hidden rounded-lg border bg-paper shadow-card">
          {[...items].sort((a, b) => a.studentName.localeCompare(b.studentName) || a.questionId.localeCompare(b.questionId)).map((item) => <CorrectionRow key={`${item.participantId}:${item.questionId}`} item={item} comments={comments} working={workingKey === `${item.participantId}:${item.questionId}`} onSave={save} />)}
        </div>
      ) : (
        <div className="grid gap-5">
          {questionGroups.map((group, index) => (
            <section key={group.questionId} className="overflow-hidden rounded-lg border bg-paper shadow-card" aria-labelledby={`correction-question-${group.questionId}`}>
              <header className="flex flex-wrap items-start justify-between gap-3 border-b bg-inset px-4 py-3 md:px-5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-[.08em] text-muted uppercase">Pregunta {index + 1} · Desarrollo</p>
                  <RichContent id={`correction-question-${group.questionId}`} text={group.prompt} className="mt-1 line-clamp-2 text-sm font-semibold text-ink" />
                </div>
                <p className="mono-number shrink-0 rounded-full border bg-white px-2.5 py-1 text-xs font-semibold text-ink-2">{group.completed}/{group.total} corregidas</p>
              </header>
              <div className="divide-y">
                {group.items.map((item) => <CorrectionRow key={`${item.participantId}:${item.questionId}`} item={item} comments={comments} working={workingKey === `${item.participantId}:${item.questionId}`} onSave={save} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function CorrectionRow({ item, comments, working, onSave }: { item: CorrectionItem; comments: Array<{ id: string; text: string }>; working: boolean; onSave: (item: CorrectionItem, points: number, feedback: string, rubricScores: Record<string, number>) => Promise<void> }) {
  const [points, setPoints] = useState(item.pointsAwarded ?? 0);
  const [feedback, setFeedback] = useState(item.feedback ?? "");
  const [rubricScores, setRubricScores] = useState(item.rubricScores ?? {});
  const invalid = points < 0 || points > item.maxPoints;
  return (
    <article className="grid gap-4 p-4 md:grid-cols-[12rem_1fr_9rem] md:p-5">
      <div><p className="font-semibold text-ink">{item.studentName}</p><p className="mt-1 text-xs text-muted">{item.runTitle}</p><a href={`/sesiones/${encodeURIComponent(item.runId)}`} className="mt-2 inline-block text-xs font-semibold text-brand hover:underline">Ver sesión</a></div>
      <div><RichContent text={item.prompt} className="text-sm font-semibold leading-relaxed text-ink-2" /><blockquote className="mt-3 whitespace-pre-wrap rounded-md bg-inset p-4 text-sm leading-relaxed text-ink">{item.answer || <span className="text-muted">Sin respuesta</span>}</blockquote><label className="mt-3 block text-xs font-semibold text-ink-2">Devolución final<Textarea className="mt-1 min-h-20 font-normal" value={feedback} onChange={(event) => setFeedback(event.target.value)} /></label>{comments.length ? <div className="mt-2 flex flex-wrap gap-1">{comments.map((comment) => <button key={comment.id} type="button" className="rounded-full border bg-white px-2 py-1 text-xs text-ink-2 hover:border-brand" onClick={() => setFeedback((value) => value ? `${value}\n${comment.text}` : comment.text)}>{comment.text}</button>)}</div> : null}</div>
      <div className="flex flex-col gap-2">{item.rubric.map((criterion) => <label key={criterion.id} className="text-xs font-semibold text-ink-2">{criterion.label} / {criterion.maxPoints}<Input type="number" min={0} max={criterion.maxPoints} step={0.25} value={rubricScores[criterion.id] ?? 0} onChange={(event) => { const next = { ...rubricScores, [criterion.id]: Number(event.target.value) }; setRubricScores(next); setPoints(Object.values(next).reduce((sum, value) => sum + value, 0)); }} /></label>)}<label htmlFor={`points-${item.participantId}-${item.questionId}`} className="text-xs font-semibold text-ink-2">Puntaje sobre {item.maxPoints}</label><Input id={`points-${item.participantId}-${item.questionId}`} type="number" min={0} max={item.maxPoints} step={0.5} value={points} disabled={item.rubric.length > 0} aria-invalid={invalid} onChange={(event) => setPoints(Number(event.target.value))} className="mono-number" /><Button type="button" size="sm" variant={item.pointsAwarded === points && item.feedback === feedback ? "outline" : "default"} disabled={invalid || working} onClick={() => void onSave(item, points, feedback, rubricScores)}>{item.pointsAwarded === points && item.feedback === feedback ? <Check data-icon="inline-start" /> : <Save data-icon="inline-start" />}{working ? "Guardando…" : item.pointsAwarded === points && item.feedback === feedback ? "Guardado" : "Guardar"}</Button>{invalid ? <p className="text-xs text-alert" role="alert">Usá un valor entre 0 y {item.maxPoints}.</p> : null}</div>
    </article>
  );
}
