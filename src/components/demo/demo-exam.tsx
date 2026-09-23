import { useEffect, useId, useRef, useState } from "react";
import { AppWindow, ArrowLeft, ArrowRight, ClipboardPaste, Clock3, Copy, Send, type LucideIcon } from "lucide-react";

import { QuestionNavigator } from "@/components/question-navigator";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useSaveStatus } from "@/components/demo/demo-hooks";
import type { FullQuestion, QuestionCompletion } from "@/domain/exam";
import { DEMO_STUDENT_NAME, DEMO_TITLE, formatCountdown, isAnswered, type DemoAnswers } from "@/lib/demo";

// La pantalla de /rendir/<código> con las mismas clases. No importa
// StudentRuntime: ese habla con el servidor y el enunciado pasa por KaTeX, que
// la demo no necesita cargar.

// Fuera de la tarjeta de la pregunta a propósito: son de la demo, no del examen.
const HINTS: ReadonlyArray<{ icon: LucideIcon; text: string }> = [
  { icon: AppWindow, text: "Probalo: cambiá de pestaña y volvé." },
  { icon: Copy, text: "Probalo: copiá el texto de esta pregunta." },
  { icon: ClipboardPaste, text: "Probalo: pegá la respuesta en vez de escribirla." },
];

interface DemoExamProps {
  questions: FullQuestion[];
  answers: DemoAnswers;
  activeIndex: number;
  incidentCount: number;
  remaining: number;
  /** Al volver a rendir, el informe desaparece: el foco va al enunciado. */
  focusOnMount: boolean;
  onActiveIndexChange: (index: number) => void;
  onAnswer: (questionId: string, value: string) => void;
  onSubmit: () => void;
}

export function DemoExam({ questions, answers, activeIndex, incidentCount, remaining, focusOnMount, onActiveIndexChange, onAnswer, onSubmit }: DemoExamProps) {
  const save = useSaveStatus(JSON.stringify(answers));
  const promptId = useId();
  const promptRef = useRef<HTMLParagraphElement>(null);
  // Cuenta el valor con que se montó: la pantalla se vuelve a montar en cada ronda.
  const [focusAtStart] = useState(focusOnMount);
  useEffect(() => {
    if (focusAtStart) promptRef.current?.focus();
  }, [focusAtStart]);

  const active = questions[activeIndex];
  const last = activeIndex === questions.length - 1;
  const states: QuestionCompletion[] = questions.map((question) => (isAnswered(answers[question.id]) ? "complete" : "empty"));
  const hint = HINTS[activeIndex];

  return (
    <>
      <div className="border-b bg-paper">
        <div className="mx-auto max-w-[1020px] px-4 py-3 lg:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted">{DEMO_STUDENT_NAME}</p>
              <h1 className="truncate font-semibold text-ink">{DEMO_TITLE}</h1>
            </div>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-2 text-sm text-ink-2" aria-live="polite">
                <StatusBadge state={save} />
                {save === "loading" ? "Guardando…" : "Guardado"}
              </span>
              <div className="flex items-center gap-2 rounded-md border bg-inset px-3 py-1.5">
                <Clock3 className="size-4 text-muted" aria-hidden="true" />
                <span role="timer" aria-live="off" aria-label={`${remaining} segundos restantes`} className="mono-number font-semibold text-ink">{formatCountdown(remaining)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main id="contenido" className="mx-auto flex w-full max-w-[1020px] flex-1 flex-col gap-5 px-4 py-6 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-ink-2">
            Pregunta {activeIndex + 1} de {questions.length} · <span className="mono-number">{active.points} pt{active.points === 1 ? "" : "s"}</span>
          </p>
          <span className="text-xs text-muted">{incidentCount} aviso{incidentCount === 1 ? "" : "s"} visible{incidentCount === 1 ? "" : "s"}</span>
        </div>

        <div className="grid gap-3">
          <section className="rounded-lg border bg-paper p-5 shadow-card md:p-8" aria-labelledby={promptId}>
            <p ref={promptRef} id={promptId} tabIndex={-1} data-demo-prompt className="max-w-4xl text-lg font-semibold leading-relaxed text-ink outline-none">{active.prompt}</p>
            <div className="mt-7">
              <StudentAnswer key={active.id} question={active} value={answers[active.id]} labelledBy={promptId} onChange={(value) => onAnswer(active.id, value)} />
            </div>
          </section>
          <p className="flex items-center gap-2 px-1 text-sm text-muted">
            <hint.icon className="size-4 shrink-0" aria-hidden="true" />
            {hint.text}
          </p>
        </div>

        <div className="mt-auto rounded-lg border bg-paper p-4 shadow-card">
          <QuestionNavigator states={states} activeIndex={activeIndex} onSelect={onActiveIndexChange} mode="student" />
          <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
            <Button type="button" variant="outline" disabled={activeIndex === 0} onClick={() => onActiveIndexChange(Math.max(0, activeIndex - 1))}>
              <ArrowLeft data-icon="inline-start" />
              Anterior
            </Button>
            {/* Sin revisión ni confirmación: la demo se entrega de una, aunque
                falten respuestas, y el informe es lo que viene. */}
            {last ? (
              <Button type="button" onClick={onSubmit}>
                <Send data-icon="inline-start" />
                Entregar
              </Button>
            ) : (
              <Button type="button" onClick={() => onActiveIndexChange(activeIndex + 1)}>
                Siguiente
                <ArrowRight data-icon="inline-end" />
              </Button>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function StudentAnswer({ question, value, labelledBy, onChange }: { question: FullQuestion; value: string | undefined; labelledBy: string; onChange: (value: string) => void }) {
  const fieldId = useId();
  if (question.type === "mc") {
    return (
      <RadioGroup value={value ?? ""} onValueChange={onChange} aria-labelledby={labelledBy} className="gap-3">
        {question.config.options.map((option) => (
          <FieldLabel key={option.id} className="bg-white">
            <Field orientation="horizontal">
              <RadioGroupItem value={option.id} aria-label={option.text} />
              <span className="leading-relaxed">{option.text}</span>
            </Field>
          </FieldLabel>
        ))}
      </RadioGroup>
    );
  }
  return (
    <Field>
      <FieldLabel htmlFor={fieldId}>Tu respuesta</FieldLabel>
      <Input id={fieldId} value={value ?? ""} onChange={(event) => onChange(event.target.value)} autoComplete="off" />
    </Field>
  );
}
