import { useCallback, useEffect, useRef, useState } from "react";
import { Laptop } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import type { FullscreenControl } from "@/components/demo/demo-hooks";
import { ExamView, GateView, JoinView, SubmittedView } from "@/components/demo/demo-student-views";
import { ScreenFrame } from "@/components/demo/demo-ui";
import { useExamMonitoring, type ClientIncident, type LifecycleReporter } from "@/hooks/use-exam-monitoring";
import { answeredCount, supervisionSettings, type DemoAttempt, type DemoExam } from "@/lib/demo";
import { studentIncidentMessage } from "@/lib/incident-copy";

// En una toma real, ocultar o cerrar la página se le avisa al servidor con un
// beacon. La demo no tiene a quién avisarle y promete que nada sale del
// navegador: el aviso se descarta acá y la detección sigue siendo la misma.
const discardLifecycle: LifecycleReporter = () => {};

interface DemoStudentProps {
  exam: DemoExam;
  attempt: DemoAttempt;
  remaining: number;
  fullscreen: FullscreenControl;
  /** Con la pantalla del docente abierta en el teléfono, el aviso espera. */
  holdIncidentDialog: boolean;
  onJoin: (name: string) => void;
  onAnswer: (questionId: string, value: string) => void;
  onIncident: (incident: ClientIncident) => void;
  onSubmit: () => void;
  onViewReport: () => void;
}

export function DemoStudent({ exam, attempt, remaining, fullscreen, holdIncidentDialog, onJoin, onAnswer, onIncident, onSubmit, onViewReport }: DemoStudentProps) {
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [incident, setIncident] = useState<ClientIncident | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const dialogOpen = useRef(false);
  const returnFocus = useRef<Element | null>(null);

  const joined = attempt.joinedAt !== null;
  const submitted = attempt.submittedAt !== null;
  const settings = supervisionSettings(exam.mode);
  const active = exam.questions[activeIndex];
  // Igual que en el producto: sin pantalla completa no se sigue, salvo que el
  // navegador no la ofrezca o la rechace, porque eso nunca bloquea a nadie.
  const gate = joined && !submitted && settings.requireFullscreen && !fullscreen.isFullscreen && !fullscreen.unavailable;

  const handleIncident = useCallback((next: ClientIncident) => {
    onIncident(next);
    if (settings.violationAction !== "warn_and_record") return;
    if (!dialogOpen.current) {
      dialogOpen.current = true;
      returnFocus.current = document.activeElement;
    }
    // Como en el producto: si llega otro con el aviso abierto, se muestra el último.
    setIncident(next);
  }, [onIncident, settings.violationAction]);

  // El monitoreo es el del producto, sin tocar: los eventos que registra son
  // los que el navegador informa de verdad.
  useExamMonitoring({
    active: joined && !submitted,
    participantId: "demo",
    activeQuestionId: active.id,
    detectFocusLoss: settings.detectFocusLoss,
    blockClipboard: settings.blockClipboard,
    requireFullscreen: settings.requireFullscreen,
    onIncident: handleIncident,
    reportLifecycle: discardLifecycle,
  });

  useEffect(() => {
    // Solo se anuncia el umbral de un minuto: el de cinco coincide con el
    // arranque de esta evaluación.
    if (joined && !submitted && remaining === 60) setAnnouncement("Queda un minuto");
  }, [joined, remaining, submitted]);

  function closeIncident() {
    dialogOpen.current = false;
    setIncident(null);
  }

  function restoreFocus(event: Event) {
    // Radix devuelve el foco al disparador del cuadro, y este no tiene: se abre
    // solo, por un evento. Sin esto el foco caía en el `body` y quien usa
    // teclado perdía el lugar donde estaba escribiendo.
    event.preventDefault();
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target instanceof HTMLElement && target.isConnected && target !== document.body) {
      target.focus({ preventScroll: true });
      return;
    }
    // Lo que tenía el foco desapareció (por ejemplo, la evaluación dejó lugar
    // al cartel de pantalla completa): se va al primer control de la pantalla.
    frame?.querySelector<HTMLElement>("[data-demo-screen] :is(button:not(:disabled), input, textarea)")?.focus();
  }

  return (
    <ScreenFrame icon={Laptop} label="Pantalla del alumno" frameRef={setFrame}>
      <div data-demo-screen className="flex flex-1 flex-col">
        {!joined ? (
          <JoinView title={exam.title} mode={exam.mode} defaultName={attempt.studentName} onJoin={onJoin} />
        ) : submitted ? (
          <SubmittedView answered={answeredCount(exam.questions, attempt.answers)} total={exam.questions.length} incidents={attempt.incidents.length} onViewReport={onViewReport} />
        ) : gate ? (
          <GateView onRequest={fullscreen.request} />
        ) : (
          <ExamView
            title={exam.title}
            studentName={attempt.studentName}
            questions={exam.questions}
            answers={attempt.answers}
            incidents={attempt.incidents.length}
            remaining={remaining}
            strict={settings.requireFullscreen}
            activeIndex={activeIndex}
            onActiveIndexChange={setActiveIndex}
            reviewing={reviewing}
            onReviewingChange={setReviewing}
            onAnswer={onAnswer}
            onSubmit={onSubmit}
            onRequestFullscreen={fullscreen.request}
            frame={frame}
          />
        )}
      </div>
      <div className="sr-only" aria-live="polite">{announcement}</div>

      {frame ? (
        <DialogPrimitive.Root open={incident !== null && !holdIncidentDialog} onOpenChange={(open) => { if (!open) closeIncident(); }}>
          {/* El aviso del producto, pero adentro de la pantalla del alumno:
              la del docente sigue a la vista y se ven las dos cosas a la vez. */}
          <DialogPortal container={frame}>
            <DialogOverlay className="demo-fade-in absolute z-40" />
            <DialogPrimitive.Content
              onCloseAutoFocus={restoreFocus}
              className="demo-dialog-in fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none lg:absolute"
            >
              <DialogHeader>
                <DialogTitle>Este evento quedó registrado</DialogTitle>
                <DialogDescription>
                  {incident ? studentIncidentMessage(incident) : ""} Tu docente ve el mismo registro. Los incidentes no cambian tu nota automáticamente.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" onClick={closeIncident}>Entendido</Button>
              </DialogFooter>
            </DialogPrimitive.Content>
          </DialogPortal>
        </DialogPrimitive.Root>
      ) : null}
    </ScreenFrame>
  );
}
