import { ArrowLeft, ArrowRight, BrainCircuit, Check, CircleAlert, ClipboardPaste, Copy, Eye, GripVertical, Plus, Settings2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { EXAM } from "../data";
import { EASE, fadeIn, progress, spring, SPRINGS, swap } from "../motion";
import { anchor, useControl, useScene } from "../scene-context";
import { T } from "../timeline";
import { StatusBadgeAt } from "./status-badge";

type Completion = "complete" | "missing-key";

/** question-navigator.tsx, teacher mode. */
function Navigator({ states }: { states: Completion[] }) {
  return (
    <nav aria-label="Navegación entre preguntas" className="flex flex-col gap-2 sm:gap-3" {...anchor("editor-bubbles")}>
      <div className="flex flex-wrap items-center gap-2">
        {states.map((state, index) => {
          const active = index === 0;
          return (
            <button
              key={index}
              type="button"
              className={cn(
                "relative grid size-9 place-items-center rounded-full border text-sm font-semibold tabular",
                state === "complete" && "border-brand bg-brand-soft text-brand-deep",
                state === "missing-key" && "border-warn bg-white text-warn",
                active && "bg-brand text-white ring-2 ring-brand/25 ring-offset-2",
              )}
            >
              {index + 1}
              {!active && state === "complete" ? <Check className="absolute -right-1 -bottom-1 size-3.5 rounded-full bg-ok p-0.5 text-white" aria-hidden="true" /> : null}
              {!active && state === "missing-key" ? <CircleAlert className="absolute -right-1 -bottom-1 size-3.5 rounded-full bg-white text-warn" aria-hidden="true" /> : null}
            </button>
          );
        })}
        <Button type="button" variant="outline" size="icon" aria-label="Agregar pregunta"><Plus /></Button>
      </div>
      <div className="hidden flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted sm:flex">
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-brand" aria-hidden="true" /> Activa</span>
        <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-ok" aria-hidden="true" />Completa</span>
        <span className="inline-flex items-center gap-1.5"><CircleAlert className="size-3.5 text-warn" aria-hidden="true" />Falta la clave</span>
        <span className="ms-auto hidden text-muted md:inline">Ctrl/⌘ + Enter para agregar</span>
      </div>
    </nav>
  );
}

/** The select trigger of ui/select.tsx, drawn closed. */
function SelectTriggerStatic({ value }: { value: string }) {
  return (
    <button type="button" data-slot="select-trigger" data-size="default" className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs">
      <span data-slot="select-value" className="line-clamp-1 flex items-center gap-2">{value}</span>
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 text-muted-foreground opacity-50" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
  );
}

export function EditorScreen() {
  const { t } = useScene();
  const q = EXAM.questions[0];
  const keyChosen = t >= T.clickKey;
  const preparing = t >= T.clickPrepare;
  const canReady = keyChosen;
  const states: Completion[] = [keyChosen ? "complete" : "missing-key", "complete", "complete"];

  const eyebrow = swap(t, T.clickPrepare);
  const label = swap(t, T.clickPrepare);
  const saveLabel = t < T.clickKey ? swap(t, -1) : t < T.saveDone ? swap(t, T.clickKey) : swap(t, T.saveDone);
  const saveText = t < T.clickKey ? "Guardado" : t < T.saveDone ? (saveLabel.showNew ? "Guardando…" : "Guardado") : saveLabel.showNew ? "Guardado" : "Guardando…";
  const statusSwap = swap(t, T.clickKey);

  // Disabled buttons sit at 50% like the app; enabling/disabling eases over 120 ms.
  const prepareOpacity = !canReady ? 0.5 : preparing ? 1 - 0.5 * fadeIn(t, T.clickPrepare) : 0.5 + 0.5 * fadeIn(t, T.clickKey);
  const prepareHover = useControl("btn-prepare", "bg-primary/90");

  // Entrance: the band fades in, the question card springs in.
  const bandIn = fadeIn(t, 0.05, 0.35);
  const cardP = spring(t - 0.12, SPRINGS.soft);
  const cardO = EASE.app(progress(t, 0.12, 0.42));

  return (
    <div className="relative flex h-full flex-col bg-canvas">
      <div className="border-b bg-paper" style={{ opacity: bandIn }}>
        <div className="mx-auto flex max-w-[1180px] flex-col gap-4 px-4 py-4 lg:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <a className="grid size-9 shrink-0 place-items-center rounded-md text-muted" aria-label="Volver a evaluaciones"><ArrowLeft className="size-4" /></a>
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-[.08em] text-muted uppercase" style={eyebrow.style}>{eyebrow.showNew ? "Evaluación lista" : "Borrador de evaluación"}</p>
                <h1 className="truncate text-lg font-semibold text-ink">{EXAM.title}</h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:gap-4">
              <span className="inline-flex items-center gap-2 text-sm text-ink-2" aria-live="polite" {...anchor("editor-save")}>
                <StatusBadgeAt t={t} loadingFrom={T.clickKey} doneAt={t < T.clickKey ? -10 : T.saveDone} />
                <span style={saveLabel.style}>{saveText}</span>
              </span>
              <Button type="button" variant="outline" size="sm"><Eye data-icon="inline-start" />Vista previa</Button>
              <Button type="button" variant="outline" size="sm"><Settings2 data-icon="inline-start" />Configuración</Button>
              <span {...anchor("btn-prepare")} className="inline-flex">
                <Button type="button" className={prepareHover} style={{ opacity: prepareOpacity }}>
                  <span style={label.style}>{label.showNew ? "Preparando sala…" : "Preparar para el curso"}</span>
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </span>
            </div>
          </div>
        </div>
      </div>

      <main className="relative mx-auto flex w-full max-w-[1180px] flex-1 flex-col gap-4 px-4 py-5 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3" style={{ opacity: bandIn }}>
          <div className="flex items-center gap-3">
            <Badge variant="outline">Pregunta 1 de {EXAM.questions.length}</Badge>
            <span className="mono-number text-sm font-semibold text-ink-2" {...anchor("editor-pts")}>{EXAM.totalPoints} pts</span>
          </div>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm"><BrainCircuit data-icon="inline-start" />Variantes IA</Button>
            <Button type="button" variant="ghost" size="sm"><Copy data-icon="inline-start" /> Duplicar</Button>
            <Button type="button" variant="ghost" size="sm" disabled aria-label="Mover pregunta a la izquierda"><GripVertical data-icon="inline-start" /> Mover</Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Eliminar pregunta"><Trash2 /></Button>
          </div>
        </div>

        <div {...anchor("cam-question")}>
          <section
            className="rounded-lg border bg-paper shadow-card"
            aria-labelledby="question-heading"
            style={{ opacity: cardO, transform: `translateY(${((1 - cardP) * 18).toFixed(3)}px) scale(${(0.985 + 0.015 * cardP).toFixed(5)})` }}
          >
            <div className="flex flex-col gap-6 p-5 md:p-7">
              <Field>
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel htmlFor="question-prompt" id="question-heading">Enunciado</FieldLabel>
                  <span className="text-xs text-muted">La pregunta ocupa todo el ancho para que puedas leerla completa.</span>
                </div>
                <Textarea id="question-prompt" className="min-h-28 resize-y text-base leading-relaxed" value={q.prompt} readOnly />
              </Field>

              <Separator />

              <div className="grid gap-6 lg:grid-cols-[13rem_1fr]">
                <FieldGroup className="content-start gap-5">
                  <Field>
                    <FieldLabel htmlFor="question-type">Tipo de respuesta</FieldLabel>
                    <SelectTriggerStatic value="Opción única" />
                    <FieldDescription>Podés cambiarlo sin perder el enunciado.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="question-points">Puntaje</FieldLabel>
                    <Input id="question-points" type="number" className="mono-number" value={q.points} readOnly />
                  </Field>
                </FieldGroup>

                <div className="min-w-0 rounded-md bg-inset p-4 md:p-5">
                  <FieldSet>
                    <FieldLegend variant="label">Opciones y clave</FieldLegend>
                    <FieldDescription>Seleccioná una respuesta correcta.</FieldDescription>
                    <FieldGroup className="gap-2">
                      {q.options.map((text, index) => (
                        <Field key={text} orientation="horizontal" className="rounded-md border bg-paper p-2.5">
                          <RadioGroup value={keyChosen && index === 1 ? `o${index}` : ""}>
                            <RadioGroupItem value={`o${index}`} aria-label={`Marcar opción ${index + 1} como correcta`} {...(index === 1 ? anchor("key-radio") : {})} />
                          </RadioGroup>
                          <FieldLabel htmlFor={`option-${index}`} className="sr-only">Opción {index + 1}</FieldLabel>
                          <Input id={`option-${index}`} value={text} readOnly />
                          <Button type="button" variant="ghost" size="icon-sm" disabled aria-label={`Eliminar opción ${index + 1}`}><Trash2 /></Button>
                        </Field>
                      ))}
                    </FieldGroup>
                    <Button type="button" variant="outline" size="sm" className="self-start"><Plus data-icon="inline-start" /> Agregar opción</Button>
                    {!keyChosen ? <FieldError>Marcá cuál es la respuesta correcta.</FieldError> : null}
                  </FieldSet>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div style={{ opacity: bandIn }}>
          {!statusSwap.showNew ? (
            <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-white px-3 py-2.5 text-sm text-ink-2" role="status" style={statusSwap.style}>
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
              <span>Falta completar 1 pregunta antes de abrir la sala.</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-ok" role="status" style={statusSwap.style} {...anchor("editor-ready")}>
              <Check className="size-4" aria-hidden="true" /> Todas las preguntas tienen clave y puntaje.
            </div>
          )}
        </div>
      </main>

      <div className="absolute inset-x-0 bottom-0 z-10 border-t bg-paper/95 px-4 py-2.5 shadow-[0_-8px_24px_rgba(22,24,29,.04)] supports-[backdrop-filter]:bg-paper/90 supports-[backdrop-filter]:backdrop-blur-sm sm:py-4 lg:px-6" style={{ opacity: bandIn }}>
        <div className="mx-auto flex max-w-[1132px] flex-col gap-2 sm:gap-3">
          <Navigator states={states} />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 sm:pt-3">
            <Button type="button" variant="outline" size="sm"><ClipboardPaste data-icon="inline-start" /> Importar desde texto</Button>
            <span className="hidden text-xs text-muted sm:inline">Arrastrá las burbujas para reordenar. También podés usar “Mover”.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
