import { useEffect, useState } from "react";
import { Check, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
}

export function CorrectionQueue({ initialItems, embedded = false, onGradeSaved }: { initialItems: CorrectionItem[]; embedded?: boolean; onGradeSaved?: (participantId: string, previous: number | null, next: number) => void }) {
  const [items, setItems] = useState(initialItems);
  const [workingKey, setWorkingKey] = useState("");
  const [ready, setReady] = useState(false);
  const pending = items.filter((item) => item.pointsAwarded === null).length;

  useEffect(() => setReady(true), []);

  async function save(item: CorrectionItem, pointsAwarded: number) {
    const key = `${item.participantId}:${item.questionId}`;
    setWorkingKey(key);
    const response = await fetch("/api/corrections/grade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantId: item.participantId, questionId: item.questionId, pointsAwarded }),
    });
    if (response.ok) {
      setItems((current) => current.map((candidate) => candidate.participantId === item.participantId && candidate.questionId === item.questionId ? { ...candidate, pointsAwarded } : candidate));
      onGradeSaved?.(item.participantId, item.pointsAwarded, pointsAwarded);
    }
    else window.alert("No se pudo guardar la corrección");
    setWorkingKey("");
  }

  if (!items.length) return <section className={`flex flex-col items-center justify-center rounded-lg border border-dashed bg-paper p-8 text-center ${embedded ? "min-h-40" : "min-h-[55dvh]"}`} aria-labelledby={embedded ? undefined : "page-title"}><p className="mb-2 text-xs font-semibold tracking-[.08em] text-muted uppercase">Sin pendientes</p><h2 id={embedded ? undefined : "page-title"} className="text-xl font-semibold text-ink">No hay respuestas para corregir a mano</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-muted">Las preguntas cerradas ya tienen puntaje automático. Los desarrollos aparecerán acá.</p>{!embedded ? <a href="/sesiones" className="mt-5 inline-flex h-9 items-center rounded-md border bg-white px-4 text-sm font-semibold text-ink-2 hover:bg-inset">Ver sesiones</a> : null}</section>;

  return (
    <section className="grid gap-5" aria-labelledby="page-title" data-correction-ready={ready}>
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="mb-1 text-xs font-semibold tracking-[.08em] text-muted uppercase">Corrección manual</p><h2 id="correction-title" className="text-xl font-semibold text-ink">Correcciones pendientes</h2><p className="mt-1 text-sm text-muted">{pending ? `${pending} respuesta${pending === 1 ? "" : "s"} pendiente${pending === 1 ? "" : "s"}.` : "Todo corregido. Podés revisar y ajustar los puntajes."}</p></div><span className="mono-number rounded-md border bg-paper px-3 py-2 text-sm font-semibold">{pending}/{items.length} pendientes</span></div>
      <div className="divide-y overflow-hidden rounded-lg border bg-paper shadow-card">
        {items.map((item) => <CorrectionRow key={`${item.participantId}:${item.questionId}`} item={item} working={workingKey === `${item.participantId}:${item.questionId}`} onSave={save} />)}
      </div>
    </section>
  );
}

function CorrectionRow({ item, working, onSave }: { item: CorrectionItem; working: boolean; onSave: (item: CorrectionItem, points: number) => Promise<void> }) {
  const [points, setPoints] = useState(item.pointsAwarded ?? 0);
  const invalid = points < 0 || points > item.maxPoints;
  return (
    <article className="grid gap-4 p-4 md:grid-cols-[12rem_1fr_9rem] md:p-5">
      <div><p className="font-semibold text-ink">{item.studentName}</p><p className="mt-1 text-xs text-muted">{item.runTitle}</p><a href={`/sesiones/${encodeURIComponent(item.runId)}`} className="mt-2 inline-block text-xs font-semibold text-brand hover:underline">Ver sesión</a></div>
      <div><h2 className="text-sm font-semibold leading-relaxed text-ink-2">{item.prompt}</h2><blockquote className="mt-3 whitespace-pre-wrap rounded-md bg-inset p-4 text-sm leading-relaxed text-ink">{item.answer || <span className="text-muted">Sin respuesta</span>}</blockquote></div>
      <div className="flex flex-col gap-2"><label htmlFor={`points-${item.participantId}-${item.questionId}`} className="text-xs font-semibold text-ink-2">Puntaje sobre {item.maxPoints}</label><Input id={`points-${item.participantId}-${item.questionId}`} type="number" min={0} max={item.maxPoints} step={1} value={points} aria-invalid={invalid} onChange={(event) => setPoints(Number(event.target.value))} className="mono-number" /><Button type="button" size="sm" variant={item.pointsAwarded === points ? "outline" : "default"} disabled={invalid || working} onClick={() => void onSave(item, points)}>{item.pointsAwarded === points ? <Check data-icon="inline-start" /> : <Save data-icon="inline-start" />}{working ? "Guardando…" : item.pointsAwarded === points ? "Guardado" : "Guardar"}</Button>{invalid ? <p className="text-xs text-alert" role="alert">Usá un valor entre 0 y {item.maxPoints}.</p> : null}</div>
    </article>
  );
}
