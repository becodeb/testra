import { useEffect, useState } from "react";
import { ArrowRight, Clock3 } from "lucide-react";

import type { ExamDraft } from "@/domain/exam";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function NewExamSetup() {
  const [hydrated, setHydrated] = useState(false);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [minutes, setMinutes] = useState(40);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setHydrated(true), []);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const examId = crypto.randomUUID();
    const draft: ExamDraft = {
      id: examId, title: title.trim(), subject: subject.trim(), instructions: "", timeLimitS: minutes * 60,
      questionsToServe: null, longToServe: 2,
      shuffleQuestions: true, shuffleOptions: true, allowBackwards: true, showProgress: true,
      autoSubmit: true, allowReconnect: true, supervisionLevel: "normal", requireFullscreen: false,
      detectFocusLoss: true, blockClipboard: false, recordDisconnects: true,
      violationAction: "warn_and_record", resultsDisplay: "score_only", resultsWhen: "teacher_publishes", sectionQuotas: {},
      status: "draft", updatedAt: new Date().toISOString(),
      questions: [{ id: crypto.randomUUID(), position: 0, type: "mc", prompt: "", points: 1, config: { options: [{ id: crypto.randomUUID(), text: "" }, { id: crypto.randomUUID(), text: "" }], correctOptionId: "" } }],
    };
    const response = await fetch("/api/exams", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
    if (response.ok) window.location.assign(`/evaluaciones/${encodeURIComponent(examId)}`);
    else {
      const body = await response.json().catch(() => ({})) as { error?: string };
      setError(body.error ?? "No se pudo crear la evaluación");
      setLoading(false);
    }
  }

  return <section className="mx-auto max-w-2xl" data-setup-ready={hydrated ? "true" : "false"}>
    <a href="/evaluaciones" className="text-sm font-semibold text-brand hover:underline">← Volver</a>
    <div className="mt-5 overflow-hidden rounded-xl border bg-paper shadow-card">
      <div className="border-b bg-inset p-6"><p className="text-xs font-bold tracking-[.1em] text-brand uppercase">Primer paso</p><h1 className="mt-2 text-2xl font-semibold text-ink">Nueva evaluación</h1><p className="mt-2 text-sm text-ink-2">Después agregás preguntas y ajustás la supervisión.</p></div>
      <form onSubmit={submit} className="grid gap-5 p-6 sm:p-8">
        <p className="rounded-md border border-brand/20 bg-brand-soft/40 px-4 py-3 text-sm leading-6 text-ink-2"><strong className="text-brand-deep">Google Classroom es opcional.</strong> Después de abrir la sala vas a poder publicar la tarea y cargar el padrón.</p>
        <Field><FieldLabel htmlFor="new-title">Título</FieldLabel><Input id="new-title" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={3} autoFocus placeholder="Ej.: Revolución de Mayo" /></Field>
        <Field><FieldLabel htmlFor="new-subject">Materia</FieldLabel><Input id="new-subject" value={subject} onChange={(event) => setSubject(event.target.value)} required placeholder="Ej.: Historia" /></Field>
        <Field><FieldLabel htmlFor="new-duration">Duración</FieldLabel><div className="relative"><Clock3 className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" /><Input id="new-duration" className="ps-9 pe-20" type="number" min={1} max={360} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} required /><span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">minutos</span></div></Field>
        {error ? <FieldError>{error}</FieldError> : null}
        <Button type="submit" size="lg" disabled={loading || title.trim().length < 3 || !subject.trim()}>{loading ? "Creando…" : "Crear y agregar preguntas"}<ArrowRight data-icon="inline-end" /></Button>
      </form>
    </div>
  </section>;
}
