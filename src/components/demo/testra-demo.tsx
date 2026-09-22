import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CircleCheck, ClipboardCheck, ClipboardPaste, Eye, ListChecks, LogIn, Maximize2, PencilLine, Play, ShieldCheck } from "lucide-react";

import { DemoGuide, DemoTopBar, type GuideContent } from "@/components/demo/demo-chrome";
import { BUILDER_HEADING_ID, CONVERT_BUTTON_ID, DemoBuilder } from "@/components/demo/demo-builder";
import { useFullscreen, useMediaQuery, useSecondTicks } from "@/components/demo/demo-hooks";
import { DemoReport } from "@/components/demo/demo-report";
import { DemoStage } from "@/components/demo/demo-stage";
import { DemoWelcome } from "@/components/demo/demo-welcome";
import type { FullQuestion } from "@/domain/exam";
import { parsePastedExam } from "@/domain/exam-import";
import type { ClientIncident } from "@/hooks/use-exam-monitoring";
import {
  challengeProgress,
  DEMO_DURATION_S,
  DEMO_IMPORT_TEXT,
  DEMO_STUDENT_NAME,
  DEMO_TITLE,
  demoGrade,
  emptyAttempt,
  examReadiness,
  formatElapsed,
  remainingSeconds,
  toDemoIncident,
  type ChallengeState,
  type DemoAttempt,
  type DemoExam,
  type SupervisionMode,
} from "@/lib/demo";
import { cn } from "@/lib/utils";

type DemoAct = "armar" | "rendir" | "revisar";

const ACT_STEP: Record<DemoAct, number> = { armar: 0, rendir: 1, revisar: 2 };

/**
 * La demo pública. Todo el estado vive acá, en memoria: nada se guarda en el
 * navegador ni se manda a ningún lado, y recargar la página la empieza de cero.
 */
export function TestraDemo({ markSrc }: { markSrc: string }) {
  // Mismo centinela que el resto de las islas: hasta que hidrata, los
  // controles son HTML plano y un clic no llega a ningún manejador.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const [act, setAct] = useState<DemoAct>("armar");
  const [welcomeOpen, setWelcomeOpen] = useState(true);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const [title, setTitle] = useState(DEMO_TITLE);
  const [importText, setImportText] = useState(DEMO_IMPORT_TEXT);
  const [draft, setDraft] = useState<FullQuestion[]>([]);
  const [convertError, setConvertError] = useState(false);
  const [mode, setMode] = useState<SupervisionMode>("normal");

  const [exam, setExam] = useState<DemoExam | null>(null);
  const [attempt, setAttempt] = useState<DemoAttempt>(() => emptyAttempt(DEMO_STUDENT_NAME));
  const [manualScores, setManualScores] = useState<Record<string, number>>({});
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const incidentSequence = useRef(0);

  const fullscreen = useFullscreen();
  const coarsePointer = useMediaQuery("(pointer: coarse)");
  const joined = attempt.joinedAt !== null;
  const submitted = attempt.submittedAt !== null;

  const remaining = attempt.endsAt === null ? DEMO_DURATION_S : Math.min(DEMO_DURATION_S, remainingSeconds(attempt.endsAt, Date.now()));
  // El reloj de la sala sigue corriendo para el docente aunque el alumno ya
  // haya entregado, como en una toma real; en cero ya no hay nada que contar.
  useSecondTicks(act === "rendir" && joined && remaining > 0);

  useEffect(() => {
    // Entrega automática al terminar el tiempo, como en el producto.
    if (act !== "rendir" || !joined || submitted || remaining > 0) return;
    setAttempt((current) => (current.submittedAt === null ? { ...current, submittedAt: Date.now() } : current));
  }, [act, joined, remaining, submitted]);

  useEffect(() => {
    // El latido que en el producto manda el navegador cada cinco segundos: es
    // lo que mueve la "Última señal" aunque el alumno no toque nada.
    if (act !== "rendir" || !joined || submitted) return;
    const timer = window.setInterval(() => setAttempt((current) => ({ ...current, lastSignalAt: Date.now() })), 5_000);
    return () => window.clearInterval(timer);
  }, [act, joined, submitted]);

  const readiness = examReadiness(title, draft);
  const grade = exam ? demoGrade(exam.questions, attempt.answers, manualScores) : null;
  const graded = act === "revisar" && grade !== null && grade.pendingManualPoints === 0;

  const start = useCallback(() => {
    setWelcomeOpen(false);
    setStartedAt((at) => at ?? Date.now());
  }, []);

  const focusFirstStep = useCallback(() => {
    // En pantallas grandes la guía queda pegada arriba, así que el foco puede
    // ir directo al primer control. En el teléfono ese salto la dejaba fuera
    // de la vista: ahí el foco va al título del paso, sin mover la página.
    if (window.matchMedia("(min-width: 1024px)").matches) document.getElementById(CONVERT_BUTTON_ID)?.focus();
    else document.getElementById(BUILDER_HEADING_ID)?.focus({ preventScroll: true });
  }, []);

  function convert() {
    const parsed = parsePastedExam(importText);
    if (!parsed.length) {
      setConvertError(true);
      return;
    }
    setConvertError(false);
    // Convertir de nuevo arma preguntas nuevas: las claves marcadas se pierden.
    setDraft(parsed);
  }

  function markKey(questionId: string, optionId: string) {
    setDraft((questions) =>
      questions.map((question) =>
        question.id === questionId && question.type === "mc" ? { ...question, config: { ...question.config, correctOptionId: optionId } } : question,
      ),
    );
  }

  function openRoom() {
    if (!readiness.valid) return;
    setExam({ title: title.trim(), questions: structuredClone(draft), mode });
    setAttempt((current) => emptyAttempt(current.studentName));
    setAct("rendir");
  }

  function join(name: string) {
    const at = Date.now();
    setAttempt((current) => ({ ...current, studentName: name, joinedAt: at, endsAt: at + DEMO_DURATION_S * 1000, lastSignalAt: at }));
  }

  const answer = useCallback((questionId: string, value: string) => {
    setAttempt((current) => ({ ...current, answers: { ...current.answers, [questionId]: value }, lastSignalAt: Date.now() }));
  }, []);

  const recordIncident = useCallback((incident: ClientIncident) => {
    incidentSequence.current += 1;
    const record = toDemoIncident(incident, `aviso-${incidentSequence.current}`, Date.now());
    setAttempt((current) => ({ ...current, incidents: [...current.incidents, record] }));
  }, []);

  const submit = useCallback(() => {
    setAttempt((current) => (current.submittedAt === null ? { ...current, submittedAt: Date.now() } : current));
  }, []);

  function viewReport() {
    // La pantalla completa era para rendir; el informe es otra pantalla.
    fullscreen.exit();
    setAct("revisar");
    // Sin desarrollo no queda nada que corregir a mano: la nota ya está cerrada.
    if (exam && demoGrade(exam.questions, attempt.answers, {}).pendingManualPoints === 0) setFinishedAt((at) => at ?? Date.now());
  }

  function scoreAnswer(questionId: string, points: number) {
    const next = { ...manualScores, [questionId]: points };
    setManualScores(next);
    if (exam && demoGrade(exam.questions, attempt.answers, next).pendingManualPoints === 0) setFinishedAt((at) => at ?? Date.now());
  }

  function retake() {
    // Misma evaluación, claves, supervisión y nombre; intento nuevo.
    setAttempt((current) => emptyAttempt(current.studentName));
    setManualScores({});
    setFinishedAt(null);
    setAct("rendir");
  }

  const gate = exam?.mode === "strict" && joined && !submitted && !fullscreen.isFullscreen && !fullscreen.unavailable;
  const challenges = exam
    ? challengeProgress(attempt.incidents, { strict: exam.mode === "strict", coarsePointer, fullscreenAvailable: !fullscreen.unavailable })
    : null;

  let guide: GuideContent;
  let guideChallenges: ChallengeState[] | null = null;
  if (act === "armar") {
    if (!draft.length) {
      guide = { key: "armar", icon: ClipboardPaste, title: "Armá la evaluación", text: "Estas preguntas son de ejemplo. Podés editarlas; después tocá Convertir en preguntas." };
    } else if (readiness.missingKeys > 0 || readiness.incomplete > 0) {
      guide = { key: "claves", icon: ListChecks, title: "Marcá las respuestas correctas", text: "Testra no abre la sala si falta alguna clave. Tocá la opción correcta en cada pregunta." };
    } else if (!readiness.titleOk) {
      guide = { key: "titulo", icon: PencilLine, title: "Falta el título", text: "Escribí un título de al menos 3 caracteres." };
    } else {
      guide = { key: "lista", icon: Play, title: "Lista para abrir", text: "Tocá Abrir sala. Se genera el código con el que entran tus alumnos." };
    }
  } else if (act === "rendir") {
    if (!joined) {
      guide = {
        key: "entrar",
        icon: LogIn,
        title: "Entrá como alumno",
        text: <><span className="lg:hidden">Arriba</span><span className="hidden lg:inline">A la derecha</span> está la sala de tu docente. Escribí tu nombre y entrá.</>,
      };
    } else if (submitted) {
      guide = { key: "entregado", icon: Check, title: "Entrega recibida", text: "Pasá al informe para ver lo que recibe tu docente." };
    } else if (gate) {
      guide = { key: "pantalla", icon: Maximize2, title: "Activá la pantalla completa", text: "La supervisión estricta la pide antes de empezar. Si tu navegador no la permite, seguís igual." };
    } else if (challenges?.allDone) {
      guide = { key: "probado", icon: ShieldCheck, title: "Testra registró todo lo que probaste", text: "Terminá de responder y entregá la evaluación." };
      guideChallenges = challenges.items;
    } else {
      guide = { key: "probar", icon: Eye, title: "Respondé e intentá copiarte" };
      guideChallenges = challenges?.items ?? null;
    }
  } else if (graded && finishedAt !== null && startedAt !== null) {
    guide = { key: "listo", icon: CircleCheck, title: `Listo en ${formatElapsed(finishedAt - startedAt)}`, text: "Armaste, rendiste y corregiste una evaluación. Eso es Testra." };
  } else {
    guide = { key: "informe", icon: ClipboardCheck, title: "Esto recibe tu docente", text: "Las preguntas cerradas se corrigieron solas. Corregí la de desarrollo para cerrar la nota." };
  }

  return (
    <div
      data-demo-ready={ready}
      inert={!ready}
      className={cn("flex min-h-dvh flex-col bg-canvas", act === "rendir" && "lg:h-dvh lg:min-h-[40rem]")}
    >
      <div className="lg:sticky lg:top-0 lg:z-30">
        <DemoTopBar markSrc={markSrc} activeStep={ACT_STEP[act]} done={[act !== "armar", act === "revisar", graded]} />
        <DemoGuide content={guide} challenges={guideChallenges} />
      </div>

      <main id="contenido" className="flex min-h-0 flex-1 flex-col">
        {act === "armar" || !exam ? (
          <DemoBuilder
            title={title}
            onTitleChange={setTitle}
            importText={importText}
            onImportTextChange={(text) => {
              setImportText(text);
              setConvertError(false);
            }}
            convertError={convertError}
            onConvert={convert}
            questions={draft}
            onMarkKey={markKey}
            mode={mode}
            onModeChange={setMode}
            readiness={readiness}
            onOpenRoom={openRoom}
          />
        ) : act === "rendir" ? (
          <DemoStage
            exam={exam}
            attempt={attempt}
            remaining={remaining}
            fullscreen={fullscreen}
            onJoin={join}
            onAnswer={answer}
            onIncident={recordIncident}
            onSubmit={submit}
            onViewReport={viewReport}
          />
        ) : (
          <DemoReport exam={exam} attempt={attempt} manualScores={manualScores} onScore={scoreAnswer} onRetake={retake} />
        )}
      </main>

      <DemoWelcome open={welcomeOpen} onStart={start} onClosed={focusFirstStep} />
    </div>
  );
}
