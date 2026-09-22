import { useId } from "react";
import { Check, CircleAlert, ListChecks, Play } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cue } from "@/components/demo/demo-ui";
import { useSaveStatus } from "@/components/demo/demo-hooks";
import { examTotalPoints, getQuestionCompletion, type FullQuestion, type QuestionCompletion } from "@/domain/exam";
import { QUESTION_TYPE_LABELS } from "@/domain/exam-import";
import type { ExamReadiness, SupervisionMode } from "@/lib/demo";
import { cn } from "@/lib/utils";

export const CONVERT_BUTTON_ID = "demo-convertir";
export const BUILDER_HEADING_ID = "demo-armar";

const MODE_COPY: Record<SupervisionMode, string> = {
  normal: "Registra cambios de pestaña o ventana, copiar, pegar y F12. No bloquea nada.",
  strict: "Además pide pantalla completa y bloquea copiar y pegar, aunque igual los registra.",
};

interface DemoBuilderProps {
  title: string;
  onTitleChange: (title: string) => void;
  importText: string;
  onImportTextChange: (text: string) => void;
  convertError: boolean;
  onConvert: () => void;
  questions: FullQuestion[];
  onMarkKey: (questionId: string, optionId: string) => void;
  mode: SupervisionMode;
  onModeChange: (mode: SupervisionMode) => void;
  readiness: ExamReadiness;
  onOpenRoom: () => void;
}

export function DemoBuilder(props: DemoBuilderProps) {
  const { title, onTitleChange, questions, mode, readiness, onOpenRoom } = props;
  const titleErrorId = useId();
  const converted = questions.length > 0;
  // Cada cambio de la evaluación pasa por el indicador de guardado, como en el
  // editor. El texto a importar no: todavía no es parte de la evaluación.
  const save = useSaveStatus(`${title}\n${mode}\n${questions.map((question) => `${question.id}:${question.type === "mc" ? question.config.correctOptionId : ""}`).join(",")}`);

  return (
    <div className="demo-enter">
      <h1 id={BUILDER_HEADING_ID} tabIndex={-1} className="sr-only">Armá la evaluación</h1>
      <div className="border-b bg-paper">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 lg:px-6">
          <div className="min-w-0 flex-1 basis-72">
            <p className="text-xs font-semibold tracking-[.08em] text-muted uppercase">{readiness.valid ? "Evaluación lista" : "Evaluación en borrador"}</p>
            <input
              value={title}
              onChange={(event) => onTitleChange(event.target.value.slice(0, 120))}
              aria-label="Título de la evaluación"
              aria-invalid={!readiness.titleOk}
              aria-describedby={readiness.titleOk ? undefined : titleErrorId}
              className="-mx-1.5 mt-0.5 w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1.5 py-0.5 text-lg font-semibold text-ink outline-none transition-[border-color,box-shadow] hover:border-line focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 aria-invalid:border-destructive"
            />
            {readiness.titleOk ? null : <FieldError id={titleErrorId} className="mt-1">Escribí un título de al menos 3 caracteres.</FieldError>}
          </div>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-2 text-sm text-ink-2" aria-live="polite">
              <StatusBadge state={save} />
              {save === "loading" ? "Guardando…" : "Guardado"}
            </span>
            <Button type="button" disabled={!readiness.valid} onClick={onOpenRoom} className={cue(readiness.valid)}>
              <Play data-icon="inline-start" />
              Abrir sala
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1180px] items-start gap-5 px-4 py-6 lg:grid-cols-12 lg:px-6">
        <div className="grid gap-5 lg:col-span-5">
          <ImportCard {...props} converted={converted} />
          <SupervisionCard mode={mode} onModeChange={props.onModeChange} />
        </div>
        <QuestionsCard {...props} converted={converted} />
      </div>
    </div>
  );
}

function ImportCard({ importText, onImportTextChange, convertError, onConvert, converted }: DemoBuilderProps & { converted: boolean }) {
  const headingId = useId();
  const textId = useId();
  const errorId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-lg border bg-paper p-5 shadow-card">
      <h2 id={headingId} className="font-semibold text-ink">Importar desde texto</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">Un bloque por pregunta. Las opciones empiezan con A), B) o C). Sin opciones, es de desarrollo.</p>
      <Field className="mt-4" data-invalid={convertError || undefined}>
        <FieldLabel htmlFor={textId}>Texto del examen</FieldLabel>
        <Textarea
          id={textId}
          value={importText}
          onChange={(event) => onImportTextChange(event.target.value)}
          spellCheck={false}
          aria-invalid={convertError}
          aria-describedby={convertError ? errorId : undefined}
          // En una notebook de 720 px el texto entero empujaba "Convertir en
          // preguntas" debajo del borde: el alto sigue a la ventana.
          className="max-h-[26rem] min-h-72 font-mono text-[13px] leading-relaxed md:text-[13px] lg:max-h-[min(26rem,max(18rem,calc(100dvh_-_28rem)))]"
        />
        {convertError ? <FieldError id={errorId}>No encontré preguntas en el texto. Separá cada pregunta con una línea en blanco.</FieldError> : null}
      </Field>
      <Button id={CONVERT_BUTTON_ID} type="button" variant={converted ? "outline" : "default"} className={cn("mt-4", cue(!converted))} onClick={onConvert}>
        {converted ? "Convertir de nuevo" : "Convertir en preguntas"}
      </Button>
    </section>
  );
}

function SupervisionCard({ mode, onModeChange }: { mode: SupervisionMode; onModeChange: (mode: SupervisionMode) => void }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-lg border bg-paper p-5 shadow-card">
      <h2 id={headingId} className="font-semibold text-ink">Supervisión</h2>
      <RadioGroupPrimitive.Root
        aria-labelledby={headingId}
        value={mode}
        onValueChange={(value) => onModeChange(value as SupervisionMode)}
        orientation="horizontal"
        className="mt-3 inline-flex rounded-md border bg-inset p-0.5"
      >
        {(["normal", "strict"] as const).map((value) => (
          <RadioGroupPrimitive.Item
            key={value}
            value={value}
            className="h-8 rounded-sm px-4 text-sm font-semibold text-ink-2 transition-[background-color,color,box-shadow] duration-150 ease-[cubic-bezier(.2,.7,.3,1)] hover:text-ink data-[state=checked]:bg-paper data-[state=checked]:text-ink data-[state=checked]:shadow-card"
          >
            {value === "normal" ? "Normal" : "Estricta"}
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
      <p className="mt-3 min-h-10 text-sm leading-5 text-ink-2">{MODE_COPY[mode]}</p>
      <p className="mt-3 text-xs text-muted">Duración: <span className="mono-number">5</span> minutos</p>
    </section>
  );
}

function QuestionsCard({ questions, onMarkKey, readiness, onOpenRoom, converted }: DemoBuilderProps & { converted: boolean }) {
  const headingId = useId();
  const total = examTotalPoints(questions);
  const states = questions.map(getQuestionCompletion);
  // El anillo va a la primera pregunta que todavía no tiene clave.
  const firstMissing = states.indexOf("missing-key");

  return (
    <section aria-labelledby={headingId} className="rounded-lg border bg-paper shadow-card lg:col-span-7">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
        <h2 id={headingId} className="flex items-baseline gap-2 font-semibold text-ink">
          Preguntas <span className="mono-number text-sm font-normal text-muted">{questions.length}</span>
        </h2>
        {converted ? <span className="mono-number text-sm font-semibold text-ink-2">{total} pt{total === 1 ? "" : "s"}</span> : null}
      </div>

      {converted ? (
        <ol className="grid gap-3 p-4 sm:p-5">
          {questions.map((question, index) => (
            <QuestionBlock
              key={question.id}
              question={question}
              index={index}
              state={states[index]}
              cueKey={index === firstMissing}
              onMarkKey={onMarkKey}
            />
          ))}
        </ol>
      ) : (
        <div className="p-4 sm:p-5">
          <div className="rounded-md border border-dashed px-6 py-12 text-center">
            <ListChecks className="mx-auto size-5 text-muted" aria-hidden="true" />
            <p className="mt-3 font-semibold text-ink">Todavía no hay preguntas</p>
            <p className="mt-1 text-sm text-muted">Convertí el texto para armarlas.</p>
          </div>
        </div>
      )}

      {converted ? (
        // Pegado abajo en pantallas grandes: al marcar la última clave en una
        // ventana baja, la fila con "Abrir sala" quedaba debajo del borde.
        <div data-demo-open-row className="flex flex-col gap-3 rounded-b-lg border-t bg-paper px-5 py-3.5 lg:sticky lg:bottom-0 lg:z-10 lg:flex-row lg:items-center lg:justify-between">
          {readiness.incomplete > 0 ? (
            <p role="status" className="flex items-start gap-2 text-sm text-warn">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {readiness.incomplete === 1 ? "Falta completar 1 pregunta antes de abrir la sala." : `Faltan completar ${readiness.incomplete} preguntas antes de abrir la sala.`}
            </p>
          ) : readiness.missingKeys > 0 ? (
            <p role="status" className="flex items-start gap-2 text-sm text-warn">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Falta marcar la clave en {readiness.missingKeys} pregunta{readiness.missingKeys === 1 ? "" : "s"}.
            </p>
          ) : (
            <p role="status" className="flex items-center gap-2 text-sm text-ok">
              <Check className="size-4" aria-hidden="true" /> Todas las preguntas tienen clave y puntaje.
            </p>
          )}
          {/* El mismo botón que el de la cabecera. Al marcar la última clave la
              página ya bajó y el de arriba quedó fuera de la vista, en cualquier
              ancho: acá está donde terminó la mano. */}
          <Button type="button" disabled={!readiness.valid} className={cn("w-full lg:w-auto lg:shrink-0", cue(readiness.valid))} onClick={onOpenRoom}>
            <Play data-icon="inline-start" />
            Abrir sala
          </Button>
        </div>
      ) : null}
    </section>
  );
}

const COMPLETION_CHIP: Record<QuestionCompletion, { label: string; className: string }> = {
  complete: { label: "Completa", className: "border-ok/25 bg-ok/5 text-ok" },
  "missing-key": { label: "Falta la clave", className: "border-warn/25 bg-warn/5 text-warn" },
  empty: { label: "Falta el enunciado", className: "border-warn/25 bg-warn/5 text-warn" },
};

function QuestionBlock({ question, index, state, cueKey, onMarkKey }: { question: FullQuestion; index: number; state: QuestionCompletion; cueKey: boolean; onMarkKey: (questionId: string, optionId: string) => void }) {
  const chip = COMPLETION_CHIP[state];
  return (
    <li className="demo-enter rounded-md border p-4" style={{ animationDelay: `${index * 45}ms` }}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="grid size-6 place-items-center rounded-full border border-line-2 text-xs font-semibold text-ink-2 tabular" aria-hidden="true">{index + 1}</span>
        <span className="sr-only">Pregunta {index + 1}:</span>
        <span className="text-xs font-medium text-muted">{QUESTION_TYPE_LABELS[question.type]} · <span className="mono-number">{question.points} pt{question.points === 1 ? "" : "s"}</span></span>
        <span key={state} className={cn("demo-fade-in ms-auto inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[.7rem] font-semibold", chip.className)}>
          {state === "complete" ? <Check className="size-3" aria-hidden="true" /> : <CircleAlert className="size-3" aria-hidden="true" />}
          {chip.label}
        </span>
      </div>
      <p className="mt-2.5 text-sm font-semibold leading-relaxed text-ink">{question.prompt || "Sin enunciado"}</p>

      {question.type === "mc" ? (
        <div className="mt-3">
          <p aria-hidden="true" className="mb-2 text-xs font-medium text-muted">Respuesta correcta</p>
          <RadioGroup
            value={question.config.correctOptionId}
            onValueChange={(value) => onMarkKey(question.id, value)}
            aria-label={`Respuesta correcta de la pregunta ${index + 1}`}
            className={cn("gap-2 rounded-md", cue(cueKey))}
          >
            {question.config.options.map((option, optionIndex) => {
              const letter = String.fromCharCode(65 + optionIndex);
              const checked = question.config.correctOptionId === option.id;
              return (
                <label
                  key={option.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors duration-150 ease-[cubic-bezier(.2,.7,.3,1)]",
                    checked ? "border-ok bg-ok/5" : "bg-paper hover:bg-inset",
                  )}
                >
                  <RadioGroupItem
                    value={option.id}
                    aria-label={`${letter}) ${option.text}`}
                    className={checked ? "border-ok text-ok [&_svg]:fill-ok" : undefined}
                  />
                  <span className="min-w-0 flex-1 text-ink-2"><span className="font-semibold text-ink">{letter})</span> {option.text}</span>
                  {checked ? (
                    <span className="demo-fade-in inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-ok">
                      <Check className="size-3.5" aria-hidden="true" />
                      Correcta
                    </span>
                  ) : null}
                </label>
              );
            })}
          </RadioGroup>
        </div>
      ) : question.type === "long" ? (
        <p className="mt-3 rounded-md bg-inset px-3 py-2.5 text-sm leading-relaxed text-ink-2">Se corrige a mano al final. En tu cuenta, la IA puede sugerirte un puntaje.</p>
      ) : null}
    </li>
  );
}
