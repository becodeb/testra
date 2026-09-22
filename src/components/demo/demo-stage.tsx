import { useEffect, useState } from "react";
import { ChevronRight, Monitor, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import type { FullscreenControl } from "@/components/demo/demo-hooks";
import { DemoStudent } from "@/components/demo/demo-student";
import { DemoTeacher } from "@/components/demo/demo-teacher";
import { resumeAt, ScreenFrame, useAgeOnMount } from "@/components/demo/demo-ui";
import type { ClientIncident } from "@/hooks/use-exam-monitoring";
import type { DemoAttempt, DemoExam, DemoIncident } from "@/lib/demo";
import { copyForIncident } from "@/lib/incident-copy";

interface DemoStageProps {
  exam: DemoExam;
  attempt: DemoAttempt;
  remaining: number;
  fullscreen: FullscreenControl;
  onJoin: (name: string) => void;
  onAnswer: (questionId: string, value: string) => void;
  onIncident: (incident: ClientIncident) => void;
  onSubmit: () => void;
  onViewReport: () => void;
}

/**
 * Las dos pantallas a la vez. Es el momento que se tiene que recordar de la
 * demo: el alumno hace algo a la izquierda y el docente lo ve a la derecha en
 * el mismo instante.
 */
export function DemoStage(props: DemoStageProps) {
  const { exam, attempt, remaining } = props;
  const [teacherOpen, setTeacherOpen] = useState(false);

  useEffect(() => {
    // Si la ventana se agranda con la pantalla del docente abierta como
    // cuadro, se cierra: el panel ya está a la vista al costado.
    const wide = window.matchMedia("(min-width: 1024px)");
    const close = () => { if (wide.matches) setTeacherOpen(false); };
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);

  return (
    <div className="demo-enter mx-auto flex w-full max-w-[1180px] flex-1 flex-col gap-3 px-4 py-4 lg:min-h-0 lg:px-6">
      <h1 className="sr-only">Rendí la evaluación</h1>

      <DialogPrimitive.Root open={teacherOpen} onOpenChange={setTeacherOpen}>
        <TeacherTicker attempt={attempt} />
        <DialogPortal>
          <DialogOverlay className="demo-fade-in" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="demo-dialog-in fixed inset-x-2 top-2 bottom-2 z-50 flex flex-col overflow-hidden rounded-lg border bg-paper shadow-lg outline-none sm:inset-x-6"
          >
            <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b px-3">
              <DialogPrimitive.Title className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Monitor className="size-4 text-muted" aria-hidden="true" />
                Pantalla del docente
              </DialogPrimitive.Title>
              <DialogPrimitive.Close asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Volver a la pantalla del alumno"><X /></Button>
              </DialogPrimitive.Close>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-canvas">
              <DemoTeacher exam={exam} attempt={attempt} remaining={remaining} />
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </DialogPrimitive.Root>

      <div className="flex flex-1 flex-col gap-4 lg:grid lg:min-h-0 lg:grid-cols-[minmax(0,58fr)_minmax(0,42fr)] lg:grid-rows-[minmax(0,1fr)]">
        <DemoStudent {...props} holdIncidentDialog={teacherOpen} />
        <ScreenFrame icon={Monitor} label="Pantalla del docente" className="hidden lg:flex">
          <DemoTeacher exam={exam} attempt={attempt} remaining={remaining} />
        </ScreenFrame>
      </div>
    </div>
  );
}

/**
 * En el teléfono no entran las dos pantallas: arriba queda una línea con lo
 * último que vio el docente, pegada mientras se rinde, y tocándola se abre la
 * pantalla entera. Así causa y efecto siguen a la vista.
 */
function TeacherTicker({ attempt }: { attempt: DemoAttempt }) {
  const latest = attempt.incidents.at(-1);
  const count = attempt.incidents.length;
  return (
    <DialogPrimitive.Trigger asChild>
      <button
        type="button"
        className="sticky top-0 z-20 isolate flex w-full items-center gap-2.5 overflow-hidden rounded-lg border bg-paper px-3 py-2.5 text-left shadow-card lg:hidden"
      >
        {latest ? <FreshLayer key={latest.id} incident={latest} /> : null}
        <Monitor className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="shrink-0 text-sm font-semibold text-ink">Pantalla del docente</span>
        <span className="mono-number shrink-0 rounded-sm border border-warn/30 bg-warn/5 px-1.5 text-xs font-semibold text-warn">
          {count}<span className="sr-only"> {count === 1 ? "aviso" : "avisos"}</span>
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{latest ? copyForIncident(latest.type).title : "Sin avisos"}</span>
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
      </button>
    </DialogPrimitive.Trigger>
  );
}

function FreshLayer({ incident }: { incident: DemoIncident }) {
  const age = useAgeOnMount(incident.receivedAt);
  if (age >= 2_600) return null;
  return <span aria-hidden="true" className="demo-fresh absolute inset-0 -z-10" style={resumeAt(age)} />;
}
