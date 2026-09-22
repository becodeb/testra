import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import { ArrowLeft, ArrowRight, Check, Clock3, ListChecks, Maximize2, Send, UserRound } from "lucide-react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

import { QuestionNavigator } from "@/components/question-navigator";
import { StatusBadge } from "@/components/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cue } from "@/components/demo/demo-ui";
import { useSaveStatus } from "@/components/demo/demo-hooks";
import type { FullQuestion, QuestionCompletion } from "@/domain/exam";
import { DEMO_CODE, formatCountdown, isAnswered, type DemoAnswers, type SupervisionMode } from "@/lib/demo";
import { cn } from "@/lib/utils";

// Estas pantallas reproducen las de /rendir/<código> con las mismas clases.
// No importan StudentRuntime ni JoinRun: esos hablan con el servidor y el
// enunciado pasa por KaTeX, que la demo no necesita cargar.

/** Lo que registra de verdad `useExamMonitoring` con cada preset. */
const NOTICE: Record<SupervisionMode, string> = {
  normal: "durante la toma Testra registra cambios de pestaña o ventana, copiar, cortar o pegar y la tecla F12. No guarda el contenido del portapapeles. Estos avisos se muestran al alumno, no cambian la nota y no prueban una infracción por sí solos; la revisión final siempre corresponde al docente.",
  strict: "durante la toma Testra registra cambios de pestaña o ventana, copiar, cortar o pegar, la tecla F12 y las salidas de pantalla completa. Además pide pantalla completa y bloquea copiar y pegar, aunque igual los registra. No guarda el contenido del portapapeles. Estos avisos se muestran al alumno, no cambian la nota y no prueban una infracción por sí solos; la revisión final siempre corresponde al docente.",
};

export function JoinView({ title, mode, defaultName, onJoin }: { title: string; mode: SupervisionMode; defaultName: string; onJoin: (name: string) => void }) {
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState("");
  const inputId = useId();
  const errorId = useId();

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = name.trim().replace(/\s+/g, " ");
    if (clean.length < 2) {
      setError("Escribí tu nombre y apellido.");
      return;
    }
    setError("");
    onJoin(clean);
  }

  return (
    <div className="grid flex-1 place-items-center p-4 sm:p-6">
      <form onSubmit={submit} noValidate className="w-full max-w-md rounded-xl border bg-paper p-6 shadow-card sm:p-7">
        <div className="flex size-11 items-center justify-center rounded-lg bg-brand-soft text-brand-deep" aria-hidden="true">
          <UserRound className="size-5" />
        </div>
        <p className="mt-5 text-xs font-semibold tracking-[.08em] text-muted uppercase">Código {DEMO_CODE}</p>
        <h3 className="mt-2 text-2xl font-semibold text-ink">¿Cómo te llamás?</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Vas a ingresar a <strong className="font-semibold text-ink-2">{title}</strong>. Tu docente verá este nombre en la sala.
        </p>
        <div className="mt-6 grid gap-4">
          <Field data-invalid={Boolean(error) || undefined}>
            <FieldLabel htmlFor={inputId}>Tu nombre y apellido</FieldLabel>
            <Input
              id={inputId}
              value={name}
              onChange={(event) => {
                setName(event.target.value.slice(0, 80));
                if (error) setError("");
              }}
              onFocus={(event) => event.currentTarget.select()}
              className="h-12 text-base"
              autoComplete="name"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              autoFocus
            />
          </Field>
          {error ? <FieldError id={errorId}>{error}</FieldError> : null}
        </div>
        <aside className="mt-5 rounded-md bg-inset p-4 text-xs leading-5 text-ink-2"><strong>Antes de entrar:</strong> {NOTICE[mode]}</aside>
        <Button type="submit" className={cn("mt-5 w-full", cue(true))}>
          Entrar a la sala
          <ArrowRight data-icon="inline-end" />
        </Button>
        <p className="mt-5 border-t pt-4 text-center text-xs leading-relaxed text-muted">No hace falta iniciar sesión.</p>
      </form>
    </div>
  );
}

export function GateView({ onRequest }: { onRequest: () => Promise<void> }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => buttonRef.current?.focus(), []);
  return (
    <div className="grid flex-1 place-items-center p-4 sm:p-6">
      <section className="w-full max-w-md rounded-xl border bg-paper p-8 text-center shadow-card">
        <Maximize2 className="mx-auto size-8 text-brand" aria-hidden="true" />
        <h3 className="mt-4 text-xl font-semibold text-ink">Entrá en pantalla completa</h3>
        <p className="mt-2 text-sm leading-6 text-muted">Esta evaluación usa supervisión estricta. Podés continuar cuando actives la pantalla completa.</p>
        <Button ref={buttonRef} type="button" className={cn("mt-6", cue(true))} onClick={() => void onRequest()}>
          <Maximize2 data-icon="inline-start" />
          Activar pantalla completa
        </Button>
      </section>
    </div>
  );
}

export function SubmittedView({ answered, total, incidents, onViewReport }: { answered: number; total: number; incidents: number; onViewReport: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  // La pantalla de la evaluación desaparece con la entrega: el foco va al paso
  // que sigue en vez de caer en el vacío.
  useEffect(() => buttonRef.current?.focus(), []);

  return (
    <div className="grid flex-1 place-items-center p-4 sm:p-6">
      <div className="demo-enter w-full max-w-md rounded-lg border bg-paper p-8 text-center shadow-card">
        <span className="mx-auto grid size-10 place-items-center rounded-full bg-brand-soft text-brand"><Check aria-hidden="true" /></span>
        <h3 className="mt-4 text-xl font-semibold text-ink">Entrega recibida</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">Tus respuestas quedaron guardadas.</p>
        <dl className="mx-auto mt-6 grid max-w-sm grid-cols-2 gap-3 border-y py-4">
          <div><dt className="text-xs text-muted">Respondidas</dt><dd className="mono-number mt-1 font-semibold">{answered}/{total}</dd></div>
          <div><dt className="text-xs text-muted">Incidentes visibles</dt><dd className="mono-number mt-1 font-semibold">{incidents}</dd></div>
        </dl>
        <Button ref={buttonRef} type="button" className={cn("mt-6", cue(true))} onClick={onViewReport}>
          Ver el informe
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    </div>
  );
}

interface ExamViewProps {
  title: string;
  studentName: string;
  questions: FullQuestion[];
  answers: DemoAnswers;
  incidents: number;
  remaining: number;
  strict: boolean;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  reviewing: boolean;
  onReviewingChange: (reviewing: boolean) => void;
  onAnswer: (questionId: string, value: string) => void;
  onSubmit: () => void;
  onRequestFullscreen: () => Promise<void>;
  /** El marco de la pantalla del alumno: la confirmación se abre adentro. */
  frame: HTMLElement | null;
}

export function ExamView(props: ExamViewProps) {
  const { title, studentName, answers, remaining, reviewing } = props;
  const save = useSaveStatus(JSON.stringify(answers));

  return (
    <>
      <div className="border-b bg-paper px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted">{studentName}</p>
            <h3 className="truncate font-semibold text-ink">{title}</h3>
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
      <div className="flex flex-1 flex-col gap-4 p-4">
        {reviewing ? <ReviewView {...props} /> : <QuestionView {...props} />}
      </div>
    </>
  );
}

function QuestionView({ questions, answers, incidents, strict, activeIndex, onActiveIndexChange, onReviewingChange, onAnswer, onRequestFullscreen }: ExamViewProps) {
  const promptId = useId();
  const promptRef = useRef<HTMLParagraphElement>(null);
  // Se monta al entrar, al volver de la revisión y al recuperar la pantalla
  // completa; en los tres casos el control que tenía el foco ya no existe.
  useEffect(() => promptRef.current?.focus(), []);
  const active = questions[activeIndex];
  const last = activeIndex === questions.length - 1;
  const states: QuestionCompletion[] = questions.map((question) => (isAnswered(answers[question.id]) ? "complete" : "empty"));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink-2">
          Pregunta {activeIndex + 1} de {questions.length} · <span className="mono-number">{active.points} pt{active.points === 1 ? "" : "s"}</span>
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">{incidents} aviso{incidents === 1 ? "" : "s"} visible{incidents === 1 ? "" : "s"}</span>
          {strict ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void onRequestFullscreen()}>
              <Maximize2 data-icon="inline-start" /> Pantalla completa
            </Button>
          ) : null}
        </div>
      </div>
      <section className="rounded-lg border bg-paper p-5 shadow-card md:p-6" aria-labelledby={promptId}>
        <p ref={promptRef} id={promptId} tabIndex={-1} data-demo-prompt className="max-w-4xl text-lg font-semibold leading-relaxed text-ink outline-none">{active.prompt}</p>
        <div className="mt-6">
          <StudentAnswer key={active.id} question={active} value={answers[active.id]} labelledBy={promptId} onChange={(value) => onAnswer(active.id, value)} />
        </div>
      </section>
      <div className="mt-auto rounded-lg border bg-paper p-4 shadow-card">
        <QuestionNavigator
          states={states}
          activeIndex={activeIndex}
          onSelect={(index) => {
            onActiveIndexChange(index);
            onReviewingChange(false);
          }}
          mode="student"
        />
        <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
          <Button type="button" variant="outline" disabled={activeIndex === 0} onClick={() => onActiveIndexChange(Math.max(0, activeIndex - 1))}>
            <ArrowLeft data-icon="inline-start" />
            Anterior
          </Button>
          <Button type="button" onClick={() => (last ? onReviewingChange(true) : onActiveIndexChange(activeIndex + 1))}>
            {last ? "Revisar" : "Siguiente"}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </div>
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
      <FieldLabel htmlFor={fieldId}>Tu desarrollo</FieldLabel>
      <Textarea id={fieldId} className="min-h-40 leading-relaxed" value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

function ReviewView({ questions, answers, onActiveIndexChange, onReviewingChange, onSubmit, frame }: ExamViewProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false);
  const unanswered = questions.filter((question) => !isAnswered(answers[question.id])).length;

  useEffect(() => headingRef.current?.focus(), []);

  return (
    <section className="demo-enter rounded-xl border bg-paper p-5 shadow-card md:p-6" aria-labelledby={headingId}>
      <span className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand"><ListChecks aria-hidden="true" /></span>
      <h3 ref={headingRef} id={headingId} tabIndex={-1} className="mt-4 text-xl font-semibold text-ink">Revisá antes de entregar</h3>
      <p className="mt-2 text-sm text-muted">
        {unanswered === 0 ? "Respondiste todas las preguntas." : `Todavía te ${unanswered === 1 ? "falta" : "faltan"} ${unanswered} ${unanswered === 1 ? "pregunta" : "preguntas"}. Podés volver a cualquiera.`}
      </p>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {questions.map((question, index) => {
          const done = isAnswered(answers[question.id]);
          return (
            <button
              key={question.id}
              type="button"
              onClick={() => {
                onActiveIndexChange(index);
                onReviewingChange(false);
              }}
              className="flex items-center justify-between rounded-md border px-4 py-3 text-left text-sm font-semibold text-ink-2 transition-colors hover:border-brand hover:bg-brand-soft"
            >
              <span>Pregunta {index + 1}</span>
              <span className={done ? "text-ok" : "text-warn"}>{done ? "Respondida" : "Te falta"}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
        <Button type="button" variant="outline" onClick={() => onReviewingChange(false)}>
          <ArrowLeft data-icon="inline-start" />
          Seguir respondiendo
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button">
              <Send data-icon="inline-start" />
              Entregar
            </Button>
          </AlertDialogTrigger>
          {frame ? (
            <AlertDialogPortal container={frame}>
              <AlertDialogOverlay className="demo-fade-in absolute z-40" />
              <AlertDialogPrimitive.Content
                data-size="default"
                onCloseAutoFocus={(event) => {
                  // Al entregar, esta pantalla ya no existe: el foco lo toma
                  // "Ver el informe" y no hay que devolverlo al disparador.
                  if (submitting.current) event.preventDefault();
                }}
                className="group/alert-dialog-content demo-dialog-in fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none lg:absolute"
              >
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Confirmás la entrega?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {unanswered === 0 ? "Después de entregar no vas a poder cambiar tus respuestas." : `Vas a entregar con ${unanswered} ${unanswered === 1 ? "pregunta vacía" : "preguntas vacías"}.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Seguir revisando</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      submitting.current = true;
                      onSubmit();
                    }}
                  >
                    Entregar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogPrimitive.Content>
            </AlertDialogPortal>
          ) : null}
        </AlertDialog>
      </div>
    </section>
  );
}
