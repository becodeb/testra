import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, RefreshCw } from "lucide-react";

import type { ExamDraft, StudentQuestion } from "@/domain/exam";
import { toStudentQuestions } from "@/domain/exam";
import { personalizeQuestions } from "@/domain/pool";
import { RichContent } from "@/components/rich-content";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

type Value = string | boolean | string[];

export function ExamPreview({ exam }: { exam: ExamDraft }) {
  const [variant, setVariant] = useState(() => crypto.randomUUID());
  const [activeIndex, setActiveIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Value>>({});
  const questions = useMemo(() => toStudentQuestions(personalizeQuestions(
    exam.questions,
    `preview:${variant}`,
    exam.shuffleQuestions,
    exam.shuffleOptions,
    exam.questionsToServe,
    exam.longToServe,
    exam.sectionQuotas,
  )), [exam, variant]);
  const active = questions[activeIndex];

  function regenerate() {
    setVariant(crypto.randomUUID());
    setActiveIndex(0);
    setAnswers({});
  }

  return (
    <div className="mx-auto grid max-w-[1020px] gap-5 px-4 py-6 lg:px-6" data-preview-ready>
      <aside className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/25 bg-brand-soft p-4">
        <div><p className="font-semibold text-ink">Vista previa — simulación</p><p className="mt-1 text-sm text-ink-2">No crea alumnos, notas, respuestas, incidentes ni actividad en la evaluación.</p></div>
        <Button type="button" variant="outline" onClick={regenerate}><RefreshCw data-icon="inline-start" />Regenerar variante</Button>
      </aside>
      <header className="rounded-lg border bg-paper p-5 shadow-card"><p className="text-xs font-semibold uppercase tracking-[.08em] text-muted">Como lo verá un alumno</p><h1 className="mt-1 text-xl font-semibold text-ink">{exam.title}</h1>{exam.instructions ? <RichContent text={exam.instructions} className="mt-3 text-sm text-ink-2" /> : null}</header>
      <section className="rounded-lg border bg-paper p-5 shadow-card md:p-8">
        <div className="mb-5 flex items-center justify-between gap-3"><p className="text-sm font-semibold text-ink-2">Pregunta {activeIndex + 1} de {questions.length}</p><span className="mono-number text-sm">{active.points} pt{active.points === 1 ? "" : "s"}</span></div>
        <RichContent text={active.prompt} assets={active.assets} className="text-lg font-semibold leading-relaxed text-ink" />
        <div className="mt-7"><PreviewAnswer question={active} value={answers[active.id]} onChange={(value) => setAnswers((current) => ({ ...current, [active.id]: value }))} /></div>
      </section>
      <nav className="flex items-center justify-between rounded-lg border bg-paper p-4 shadow-card" aria-label="Navegación de vista previa">
        <Button type="button" variant="outline" disabled={activeIndex === 0 || !exam.allowBackwards} onClick={() => setActiveIndex((index) => index - 1)}><ArrowLeft data-icon="inline-start" />Anterior</Button>
        <span className="text-xs text-muted">Variante local · sin guardar</span>
        <Button type="button" disabled={activeIndex === questions.length - 1} onClick={() => setActiveIndex((index) => index + 1)}>Siguiente<ArrowRight data-icon="inline-end" /></Button>
      </nav>
    </div>
  );
}

function PreviewAnswer({ question, value, onChange }: { question: StudentQuestion; value?: Value; onChange: (value: Value) => void }) {
  if (question.type === "mc") return <RadioGroup value={typeof value === "string" ? value : ""} onValueChange={onChange} className="gap-3">{question.config.options.map((option) => <FieldLabel key={option.id} className="bg-white"><Field orientation="horizontal"><RadioGroupItem value={option.id} aria-label={option.text} /><RichContent text={option.text} /></Field></FieldLabel>)}</RadioGroup>;
  if (question.type === "ms") {
    const selected = Array.isArray(value) ? value : [];
    return <div className="grid gap-3">{question.config.options.map((option) => <FieldLabel key={option.id} className="bg-white"><Field orientation="horizontal"><Checkbox checked={selected.includes(option.id)} onCheckedChange={(checked) => onChange(checked ? [...selected, option.id] : selected.filter((id) => id !== option.id))} /><RichContent text={option.text} /></Field></FieldLabel>)}</div>;
  }
  if (question.type === "tf") return <RadioGroup value={typeof value === "boolean" ? String(value) : ""} onValueChange={(next) => onChange(next === "true")} className="grid gap-3 sm:grid-cols-2"><FieldLabel className="bg-white"><Field orientation="horizontal"><RadioGroupItem value="true" />Verdadero</Field></FieldLabel><FieldLabel className="bg-white"><Field orientation="horizontal"><RadioGroupItem value="false" />Falso</Field></FieldLabel></RadioGroup>;
  if (question.type === "sa") return <Input aria-label="Tu respuesta" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />;
  return <Textarea aria-label="Tu desarrollo" className="min-h-52" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />;
}
