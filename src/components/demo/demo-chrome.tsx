import type { ReactNode } from "react";
import { Check, Circle, CircleCheck, X, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Crossfade } from "@/components/demo/demo-ui";
import type { ChallengeState } from "@/lib/demo";
import { cn } from "@/lib/utils";

const STEPS = ["Armar", "Rendir", "Revisar"] as const;

export function DemoTopBar({ markSrc, activeStep, done }: { markSrc: string; activeStep: number; done: readonly boolean[] }) {
  return (
    <header className="border-b bg-paper">
      <div className="mx-auto flex h-14 max-w-[1180px] items-center justify-between gap-3 px-4 sm:grid sm:grid-cols-[1fr_auto_1fr] lg:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <a href="/" className="flex items-center gap-2.5" aria-label="Testra, inicio">
            <span className="testra-mark" aria-hidden="true"><img src={markSrc} alt="" width={64} height={64} /></span>
            <span className="hidden font-bold tracking-[-.025em] text-brand-deep sm:inline">Testra</span>
          </a>
          <span className="rounded-sm bg-inset px-1.5 text-xs font-medium text-ink-2">Demo</span>
        </div>
        <DemoStepper activeStep={activeStep} done={done} />
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" asChild>
            <a href="/">
              <X data-icon="inline-start" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">Salir</span>
            </a>
          </Button>
        </div>
      </div>
    </header>
  );
}

function DemoStepper({ activeStep, done }: { activeStep: number; done: readonly boolean[] }) {
  return (
    <ol aria-label="Pasos de la demo" className="flex items-center gap-2">
      {STEPS.map((label, index) => {
        const isDone = done[index];
        const isActive = index === activeStep;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={isActive ? "step" : undefined}>
            {index > 0 ? (
              <span aria-hidden="true" className="relative h-px w-3 overflow-hidden bg-line-2 sm:w-8">
                <span className="demo-connector-fill absolute inset-0 bg-brand" style={{ transform: `scaleX(${done[index - 1] ? 1 : 0})` }} />
              </span>
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular transition-colors duration-150 ease-[cubic-bezier(.2,.7,.3,1)]",
                isDone ? "border-ok bg-paper text-ok" : isActive ? "border-brand bg-brand text-white" : "border-line-2 bg-paper text-muted",
              )}
            >
              {isDone ? <Check key="hecho" className="demo-check-in size-3.5" strokeWidth={2.5} /> : index + 1}
            </span>
            {/* En pantallas angostas solo queda a la vista el paso activo; los
                otros nombres siguen ahí para quien usa lector de pantalla. */}
            <span className={cn("text-sm font-medium", isActive ? "text-ink" : "sr-only text-muted sm:not-sr-only")}>
              {label}
              {isDone ? <span className="sr-only">, hecho</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export interface GuideContent {
  /** Identifica el mensaje: cuando cambia, el texto se reemplaza con un fundido. */
  key: string;
  icon: LucideIcon;
  title: string;
  text?: ReactNode;
}

/**
 * La voz de la demo. Es lo único que le habla al visitante; de acá para abajo
 * todo se ve como el producto.
 */
export function DemoGuide({ content, challenges }: { content: GuideContent; challenges: ChallengeState[] | null }) {
  return (
    <section aria-label="Guía de la demo" className="border-b border-brand/10 bg-brand-soft text-brand-deep">
      <div className="mx-auto flex min-h-[5.25rem] max-w-[1180px] flex-col justify-center gap-2.5 px-4 py-3 lg:min-h-[4.25rem] lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:px-6">
        <div aria-live="polite" className="min-w-0">
          <Crossfade
            id={content.key}
            value={content}
            render={(item) => (
              <div className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-paper text-brand">
                  <item.icon className="size-4" aria-hidden="true" />
                </span>
                <p className="min-w-0 text-sm leading-5">
                  <strong className="block font-semibold">{item.title}</strong>
                  {item.text ? <span className="block text-brand-deep/80">{item.text}</span> : null}
                </p>
              </div>
            )}
          />
        </div>
        {/* Fuera de la región viva a propósito: el aviso del alumno ya anuncia
            cada detección, y repetirla acá como "detectado" suelto no suma. */}
        {challenges ? <ChallengeList items={challenges} /> : null}
      </div>
    </section>
  );
}

function ChallengeList({ items }: { items: ChallengeState[] }) {
  return (
    <ul aria-label="Qué probar" className="demo-fade-in flex flex-wrap gap-2 ps-11 lg:justify-end lg:ps-0">
      {items.map((item) => (
        <li
          key={item.id}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border bg-paper px-2 text-xs font-medium whitespace-nowrap transition-colors duration-150 ease-[cubic-bezier(.2,.7,.3,1)]",
            item.done ? "border-ok/40 text-ok" : "border-brand/15 text-ink-2",
          )}
        >
          {item.done
            ? <CircleCheck key="hecho" className="demo-check-in size-3.5" aria-hidden="true" />
            : <Circle key="pendiente" className="size-3.5 text-muted" aria-hidden="true" />}
          {item.label}
          {item.done ? <span className="sr-only">, detectado</span> : null}
        </li>
      ))}
    </ul>
  );
}
