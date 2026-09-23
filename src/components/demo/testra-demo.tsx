import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DemoIntro, DemoTopBar } from "@/components/demo/demo-chrome";
import { DemoExam } from "@/components/demo/demo-exam";
import { useSecondTicks } from "@/components/demo/demo-hooks";
import { DemoReport } from "@/components/demo/demo-report";
import { useExamMonitoring, type ClientIncident, type LifecycleReporter } from "@/hooks/use-exam-monitoring";
import { DEMO_DURATION_S, DEMO_QUESTIONS, remainingSeconds, toDemoIncident, type DemoAnswers, type DemoIncident } from "@/lib/demo";
import { studentIncidentMessage } from "@/lib/incident-copy";
import { cn } from "@/lib/utils";

// En una toma real, ocultar o cerrar la página se le avisa al servidor con un
// beacon. La demo no tiene a quién avisarle y promete que nada sale del
// navegador: el aviso se descarta acá y la detección sigue siendo la misma.
const discardLifecycle: LifecycleReporter = () => {};

/**
 * La demo pública: una evaluación de prueba y lo que vio el docente. Todo el
 * estado vive acá, en memoria; nada se guarda ni se manda, y recargar la
 * página la empieza de cero.
 */
export function TestraDemo({ markSrc }: { markSrc: string }) {
  // Mismo centinela que el resto de las islas: hasta que hidrata, los
  // controles son HTML plano y un clic no llega a ningún manejador.
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<"exam" | "report">("exam");
  const [round, setRound] = useState(0);
  const [answers, setAnswers] = useState<DemoAnswers>({});
  const [incidents, setIncidents] = useState<DemoIncident[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [warning, setWarning] = useState<ClientIncident | null>(null);
  const sequence = useRef(0);
  const warningOpen = useRef(false);
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => {
    setReady(true);
    // El reloj arranca cuando la página ya responde, no mientras carga.
    setEndsAt(Date.now() + DEMO_DURATION_S * 1000);
  }, []);

  const taking = phase === "exam";
  const remaining = endsAt === null ? DEMO_DURATION_S : Math.min(DEMO_DURATION_S, remainingSeconds(endsAt, Date.now()));
  useSecondTicks(taking && endsAt !== null && remaining > 0);

  const submit = useCallback(() => {
    warningOpen.current = false;
    setWarning(null);
    setPhase("report");
  }, []);

  useEffect(() => {
    // Como en el producto, el tiempo cumplido entrega solo.
    if (taking && endsAt !== null && remaining === 0) submit();
  }, [endsAt, remaining, submit, taking]);

  const recordIncident = useCallback((incident: ClientIncident) => {
    sequence.current += 1;
    const record = toDemoIncident(incident, `aviso-${sequence.current}`);
    setIncidents((current) => [...current, record]);
    if (!warningOpen.current) {
      warningOpen.current = true;
      returnFocus.current = document.activeElement;
    }
    // Como en el producto: si llega otro con el aviso abierto, se muestra el último.
    setWarning(incident);
  }, []);

  // El monitoreo del producto, sin tocar, con el preset "Normal" del editor:
  // registra todo y no bloquea nada.
  useExamMonitoring({
    active: taking,
    participantId: "demo",
    activeQuestionId: DEMO_QUESTIONS[activeIndex].id,
    detectFocusLoss: true,
    blockClipboard: false,
    requireFullscreen: false,
    onIncident: recordIncident,
    reportLifecycle: discardLifecycle,
  });

  const answer = useCallback((questionId: string, value: string) => {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }, []);

  function retake() {
    setAnswers({});
    setIncidents([]);
    setActiveIndex(0);
    setEndsAt(Date.now() + DEMO_DURATION_S * 1000);
    setRound((value) => value + 1);
    setPhase("exam");
  }

  function closeWarning() {
    warningOpen.current = false;
    setWarning(null);
  }

  function restoreFocus(event: Event) {
    // Radix devuelve el foco al disparador del cuadro, y este no tiene: se abre
    // solo, por un evento. Sin esto el foco caía en el `body` y quien usa
    // teclado perdía el lugar donde estaba respondiendo.
    event.preventDefault();
    const target = returnFocus.current;
    returnFocus.current = null;
    const fallback = document.querySelector<HTMLElement>("[data-demo-prompt]");
    const next = target instanceof HTMLElement && target.isConnected && target !== document.body ? target : fallback;
    next?.focus({ preventScroll: true });
  }

  return (
    <div data-demo-ready={ready} inert={!ready} className="flex min-h-dvh flex-col bg-canvas">
      <DemoTopBar markSrc={markSrc} />
      {taking ? (
        <div key={`examen-${round}`} className={cn("flex flex-1 flex-col", round > 0 && "demo-enter")}>
          <DemoIntro />
          <DemoExam
            questions={DEMO_QUESTIONS}
            answers={answers}
            activeIndex={activeIndex}
            incidentCount={incidents.length}
            remaining={remaining}
            focusOnMount={round > 0}
            onActiveIndexChange={setActiveIndex}
            onAnswer={answer}
            onSubmit={submit}
          />
        </div>
      ) : (
        <DemoReport key={`informe-${round}`} questions={DEMO_QUESTIONS} answers={answers} incidents={incidents} onRetake={retake} />
      )}

      {/* El aviso del producto, con su texto. */}
      <Dialog open={warning !== null} onOpenChange={(open) => { if (!open) closeWarning(); }}>
        <DialogContent onCloseAutoFocus={restoreFocus} className="demo-dialog-in">
          <DialogHeader>
            <DialogTitle>Este evento quedó registrado</DialogTitle>
            <DialogDescription>
              {warning ? studentIncidentMessage(warning) : ""} Tu docente ve el mismo registro. Los incidentes no cambian tu nota automáticamente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={closeWarning}>Entendido</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
