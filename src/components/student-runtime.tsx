import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Clock3, ListChecks, Maximize2, Send, Users } from "lucide-react";

import type { StudentQuestion } from "@/domain/exam";
import { useExamMonitoring, type ClientIncident } from "@/hooks/use-exam-monitoring";
import { QuestionNavigator } from "@/components/question-navigator";
import { StatusBadge } from "@/components/status-badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { RichContent } from "@/components/rich-content";

export type StudentAnswerValue = string | boolean | string[];

interface StudentRuntimeProps {
  runId: string;
  code: string;
  title: string;
  instructions?: string;
  participantId: string;
  studentName: string;
  questions: StudentQuestion[];
  initialAnswers?: Record<string, StudentAnswerValue>;
  initialStatus: "lobby" | "running" | "ended";
  participantStatus?: "waiting" | "active" | "submitted" | "disconnected" | "expired";
  deliveryMode?: "sync" | "async";
  availableFrom?: number | null;
  availableUntil?: number | null;
  attemptStartedAt?: number | null;
  timeLimitS?: number;
  serverNow: number;
  endsAt: number | null;
  allowBackwards?: boolean;
  showProgress?: boolean;
  autoSubmit?: boolean;
  allowReconnect?: boolean;
  requireFullscreen?: boolean;
  detectFocusLoss?: boolean;
  blockClipboard?: boolean;
  violationAction?: "warn_and_record" | "record_only";
}

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function isAnswered(value: StudentAnswerValue | undefined) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return typeof value === "boolean";
}

export function StudentRuntime({
  runId,
  code,
  title,
  instructions = "",
  participantId,
  studentName,
  questions,
  initialAnswers = {},
  initialStatus,
  participantStatus = "waiting",
  deliveryMode = "sync",
  availableFrom = null,
  availableUntil = null,
  attemptStartedAt = null,
  timeLimitS = 0,
  serverNow,
  endsAt: initialEndsAt,
  allowBackwards = true,
  showProgress = true,
  autoSubmit = true,
  allowReconnect = true,
  requireFullscreen = false,
  detectFocusLoss = true,
  blockClipboard = false,
  violationAction = "warn_and_record",
}: StudentRuntimeProps) {
  const [ready, setReady] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [answers, setAnswers] = useState<Record<string, StudentAnswerValue>>(initialAnswers);
  const [saveState, setSaveState] = useState<"loading" | "done">("done");
  const [saveError, setSaveError] = useState("");
  const [runStatus, setRunStatus] = useState(initialStatus);
  const [endsAt, setEndsAt] = useState(initialEndsAt);
  const [remaining, setRemaining] = useState(() => initialEndsAt ? Math.max(0, Math.ceil((initialEndsAt - serverNow) / 1000)) : 0);
  const [incident, setIncident] = useState<ClientIncident | null>(null);
  const [incidentCount, setIncidentCount] = useState(0);
  const [submitted, setSubmitted] = useState(participantStatus === "submitted");
  const [attemptActive, setAttemptActive] = useState(participantStatus === "active" || participantStatus === "disconnected" || attemptStartedAt !== null);
  const [availabilityNow, setAvailabilityNow] = useState(serverNow);
  const [startError, setStartError] = useState("");
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(() => typeof document !== "undefined" && Boolean(document.fullscreenElement));
  const announcedRef = useRef(new Set<number>());
  const clockOffset = useRef(serverNow - Date.now());
  const answersRef = useRef(answers);
  const saveTimers = useRef(new Map<string, number>());
  const submittingRef = useRef(false);
  const active = questions[activeIndex];

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    const update = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const onIncident = useCallback((nextIncident: ClientIncident) => {
    setIncidentCount((count) => count + 1);
    if (violationAction === "warn_and_record") setIncident(nextIncident);
    void fetch("/api/student/incident", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantId, ...nextIncident }),
      keepalive: true,
    });
  }, [participantId, violationAction]);

  useExamMonitoring({ active: runStatus === "running" && attemptActive && !submitted, participantId, activeQuestionId: active.id, detectFocusLoss, blockClipboard, requireFullscreen, onIncident });

  const persistAnswer = useCallback(async (questionId: string, value: StudentAnswerValue) => {
    setSaveState("loading");
    setSaveError("");
    try {
      const response = await fetch("/api/student/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ participantId, questionId, value }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "No se pudo guardar la respuesta");
      }
      setSaveState("done");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Sin conexión; reintentando");
      window.setTimeout(() => {
        if (!submittingRef.current) void persistAnswer(questionId, answersRef.current[questionId] ?? value);
      }, 2_000);
    }
  }, [participantId]);

  const finish = useCallback(async (reason: "manual" | "timer") => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    for (const timer of saveTimers.current.values()) window.clearTimeout(timer);
    saveTimers.current.clear();
    await Promise.all(Object.entries(answersRef.current).map(([questionId, value]) => persistAnswer(questionId, value)));
    const response = await fetch("/api/student/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantId, reason }),
    });
    if (response.ok) {
      setSubmitted(true);
    } else {
      setSaveError("No se pudo entregar. Testra seguirá intentando mientras esta pestaña esté abierta.");
      submittingRef.current = false;
      setSubmitting(false);
      window.setTimeout(() => void finish(reason), 2_000);
    }
  }, [participantId, persistAnswer]);

  useEffect(() => {
    if (runStatus !== "running" || !attemptActive || endsAt === null || submitted) return;
    const timer = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((endsAt - (Date.now() + clockOffset.current)) / 1000));
      setRemaining(next);
      if (next === 0 && autoSubmit) void finish("timer");
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [attemptActive, autoSubmit, endsAt, finish, runStatus, submitted]);

  useEffect(() => {
    if (submitted) return;
    const sendHeartbeat = async () => {
      const response = await fetch("/api/student/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ participantId, questionId: active.id }),
        keepalive: true,
      });
      if (!response.ok) return;
      const body = await response.json() as { serverNow: number; endsAt: number | null; status: "lobby" | "running" | "ended"; participantStatus?: string };
      clockOffset.current = body.serverNow - Date.now();
      setEndsAt(body.endsAt);
      setRunStatus(body.status);
      // El servidor es el que sabe si el alumno ya esta rindiendo: al abrir la
      // sala marca a los participantes como `active`. El cliente descartaba ese
      // dato y solo se enteraba al recargar la pagina, asi que para quien habia
      // entrado antes de que empezara la toma `attemptActive` se quedaba en
      // false. Como la supervision exige `runStatus === "running" &&
      // attemptActive`, quedaba apagada entera: ni cambio de pestana, ni
      // ventana sin foco, ni portapapeles. Se espeja con el mismo criterio con
      // el que se calcula el estado inicial.
      if (body.participantStatus === "active" || body.participantStatus === "disconnected") setAttemptActive(true);
      if (body.status === "ended" && attemptActive) void finish("timer");
    };
    void sendHeartbeat();
    const heartbeat = window.setInterval(() => void sendHeartbeat(), runStatus === "lobby" ? 1_500 : 5_000);
    return () => window.clearInterval(heartbeat);
  }, [active.id, attemptActive, finish, participantId, runStatus, submitted]);

  useEffect(() => {
    if (!submitted || runStatus === "ended") return;
    const checkReopen = async () => {
      const response = await fetch("/api/student/heartbeat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId, questionId: active.id }) });
      if (!response.ok) return;
      const body = await response.json() as { status: "lobby" | "running" | "ended"; participantStatus?: string; endsAt: number | null; serverNow: number };
      if (body.participantStatus === "active") {
        submittingRef.current = false;
        setSubmitting(false);
        setSubmitted(false);
        setAttemptActive(true);
        setRunStatus("running");
        setEndsAt(body.endsAt);
        clockOffset.current = body.serverNow - Date.now();
      } else if (body.status === "ended") setRunStatus("ended");
    };
    void checkReopen();
    const timer = window.setInterval(() => void checkReopen(), 4_000);
    return () => window.clearInterval(timer);
  }, [active.id, participantId, runStatus, submitted]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry = 0;
    let retryTimer = 0;
    let disposed = false;
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/api/runs/${encodeURIComponent(runId)}/socket?role=student&participantId=${encodeURIComponent(participantId)}`);
      socket.addEventListener("open", () => { retry = 0; });
      socket.addEventListener("message", (event) => {
        const payload = JSON.parse(String(event.data)) as { type?: string; run?: { status?: typeof runStatus; endsAt?: number | null }; endsAt?: number | null; serverNow?: number };
        if (payload.serverNow) clockOffset.current = payload.serverNow - Date.now();
        if (payload.run?.endsAt !== undefined) setEndsAt(payload.run.endsAt);
        if (payload.endsAt !== undefined) setEndsAt(payload.endsAt);
        if (payload.type === "run-started") {
          setRunStatus("running");
          setEndsAt(payload.run?.endsAt ?? null);
        }
        if (payload.type === "attempt-started") setAttemptActive(true);
        if (payload.type === "run-ended" && attemptActive) void finish("timer");
      });
      socket.addEventListener("close", () => {
        if (disposed || submitted || !allowReconnect) return;
        retry += 1;
        retryTimer = window.setTimeout(connect, Math.min(5_000, 500 * 2 ** retry));
      });
    };
    connect();
    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [allowReconnect, attemptActive, finish, participantId, runId, submitted]);

  useEffect(() => {
    if (deliveryMode !== "async" || attemptActive) return;
    const update = () => setAvailabilityNow(Date.now() + clockOffset.current);
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [attemptActive, deliveryMode]);

  async function startAttempt() {
    setStarting(true);
    setStartError("");
    const response = await fetch("/api/student/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantId }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string; deadlineAt?: number; serverNow?: number };
    if (!response.ok || !body.deadlineAt) {
      setStartError(body.error ?? "No se pudo iniciar el intento");
      setStarting(false);
      return;
    }
    if (body.serverNow) clockOffset.current = body.serverNow - Date.now();
    setEndsAt(body.deadlineAt);
    setRemaining(Math.max(0, Math.ceil((body.deadlineAt - (body.serverNow ?? Date.now())) / 1000)));
    setRunStatus("running");
    setAttemptActive(true);
    setStarting(false);
  }

  useEffect(() => {
    if (!(remaining === 300 || remaining === 60) || announcedRef.current.has(remaining)) return;
    announcedRef.current.add(remaining);
    const region = document.getElementById("time-announcement");
    if (region) region.textContent = remaining === 300 ? "Quedan cinco minutos" : "Queda un minuto";
  }, [remaining]);

  const states = useMemo(
    () => questions.map((question) => isAnswered(answers[question.id]) ? "complete" : "empty"),
    [answers, questions],
  );
  const unanswered = states.filter((state) => state === "empty").length;

  function setAnswer(questionId: string, value: StudentAnswerValue) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
    const priorTimer = saveTimers.current.get(questionId);
    if (priorTimer) window.clearTimeout(priorTimer);
    setSaveState("loading");
    saveTimers.current.set(questionId, window.setTimeout(() => {
      saveTimers.current.delete(questionId);
      void persistAnswer(questionId, value);
    }, 450));
  }

  async function enterFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Pantalla completa es una invitación; un rechazo nunca bloquea la evaluación.
    }
  }

  if (deliveryMode === "async" && !attemptActive && !submitted) {
    const upcoming = availableFrom !== null && availabilityNow < availableFrom;
    const closed = participantStatus === "expired" || runStatus === "ended" || availableUntil === null || availabilityNow >= availableUntil;
    const formatDate = (value: number | null) => value === null ? "—" : new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(value).replace(/\s/g, " ");
    return <main id="contenido" className="mx-auto grid min-h-[calc(100dvh-3.75rem)] max-w-2xl place-items-center px-4 py-12"><section className="w-full rounded-xl border bg-paper p-7 shadow-card sm:p-9"><p className="text-xs font-bold tracking-[.1em] text-brand uppercase">Evaluación asincrónica · {code}</p><h1 className="mt-3 text-2xl font-semibold text-ink">{title}</h1><p className="mt-2 text-sm leading-6 text-muted">Hola, {studentName}. El tiempo empieza únicamente cuando confirmás el inicio.</p><dl className="mt-6 grid gap-px overflow-hidden rounded-lg border bg-line sm:grid-cols-3"><div className="bg-paper p-4"><dt className="text-xs text-muted">Disponible desde</dt><dd className="mt-1 text-sm font-semibold text-ink">{formatDate(availableFrom)}</dd></div><div className="bg-paper p-4"><dt className="text-xs text-muted">Podés iniciar hasta</dt><dd className="mt-1 text-sm font-semibold text-ink">{formatDate(availableUntil)}</dd></div><div className="bg-paper p-4"><dt className="text-xs text-muted">Tiempo del intento</dt><dd className="mono-number mt-1 text-sm font-semibold text-ink">{Math.round(timeLimitS / 60)} minutos</dd></div></dl>{closed ? <div className="mt-6 rounded-md border border-alert/30 bg-alert/5 px-4 py-3 text-sm text-alert">La ventana para iniciar esta evaluación ya cerró. Si necesitás rendir, comunicate con tu docente.</div> : upcoming ? <div className="mt-6 rounded-md border bg-inset px-4 py-3 text-sm text-ink-2">Todavía no está disponible. Esta pantalla se actualizará automáticamente.</div> : <div className="mt-6 flex flex-wrap items-center justify-between gap-4"><p className="max-w-md text-sm leading-6 text-ink-2">Cuando empieces se activarán el reloj, el autoguardado y las mismas señales de supervisión informadas al ingresar.</p><AlertDialog><AlertDialogTrigger asChild><Button type="button" disabled={starting}><Clock3 data-icon="inline-start" />{starting ? "Iniciando…" : "Iniciar intento"}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>¿Empezar ahora?</AlertDialogTitle><AlertDialogDescription>Al confirmar comenzarán tus {Math.round(timeLimitS / 60)} minutos. No se puede reiniciar el reloj saliendo de la página.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Ahora no</AlertDialogCancel><AlertDialogAction onClick={() => void startAttempt()}>Sí, empezar</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>}{startError ? <p className="mt-3 text-sm text-alert" role="alert">{startError}</p> : null}</section></main>;
  }

  if (runStatus === "lobby" && !submitted) {
    return (
      <main id="contenido" className="mx-auto grid min-h-[calc(100dvh-3.75rem)] max-w-2xl place-items-center px-4 py-12">
        <div className="w-full rounded-lg border bg-paper p-8 text-center shadow-card">
          <span className="mx-auto grid size-10 place-items-center rounded-full bg-brand-soft text-brand"><Users aria-hidden="true" /></span>
          <p className="mt-4 text-xs font-semibold tracking-[.08em] text-muted uppercase">Sala de espera · {code}</p>
          <h1 className="mt-2 text-xl font-semibold text-ink">Ya estás en la sala, {studentName}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{title}. La evaluación se abrirá en esta misma pantalla cuando el docente la inicie.</p>
          <div className="mx-auto mt-6 inline-flex items-center gap-2 rounded-md border bg-inset px-4 py-2 text-sm text-ink-2"><StatusBadge state="loading" /> Esperando al curso</div>
        </div>
      </main>
    );
  }

  if (submitted) {
    return (
      <main id="contenido" className="mx-auto grid min-h-[calc(100dvh-3.75rem)] max-w-2xl place-items-center px-4 py-12">
        <div className="w-full rounded-lg border bg-paper p-8 text-center shadow-card">
          <span className="mx-auto grid size-10 place-items-center rounded-full bg-brand-soft text-brand"><Check aria-hidden="true" /></span>
          <h1 className="mt-4 text-xl font-semibold text-ink">Entrega recibida</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">Tus respuestas quedaron guardadas. Podés cerrar esta pestaña.</p>
          <dl className="mx-auto mt-6 grid max-w-sm grid-cols-2 gap-3 border-y py-4"><div><dt className="text-xs text-muted">Respondidas</dt><dd className="mono-number mt-1 font-semibold">{questions.length - unanswered}/{questions.length}</dd></div><div><dt className="text-xs text-muted">Incidentes visibles</dt><dd className="mono-number mt-1 font-semibold">{incidentCount}</dd></div></dl>
        </div>
      </main>
    );
  }

  if (runStatus === "running" && requireFullscreen && !isFullscreen) {
    return <main id="contenido" className="mx-auto grid min-h-[calc(100dvh-3.75rem)] max-w-xl place-items-center px-4 py-12"><section className="w-full rounded-xl border bg-paper p-8 text-center shadow-card"><Maximize2 className="mx-auto size-8 text-brand" /><h1 className="mt-4 text-xl font-semibold text-ink">Entrá en pantalla completa</h1><p className="mt-2 text-sm leading-6 text-muted">Esta evaluación usa supervisión estricta. Podés continuar cuando actives la pantalla completa.</p><Button type="button" className="mt-6" onClick={enterFullscreen}><Maximize2 data-icon="inline-start" />Activar pantalla completa</Button></section></main>;
  }

  return (
    <div className="flex min-h-[calc(100dvh-3.75rem)] flex-col" data-student-ready={ready} data-monitoring-active={runStatus === "running" && attemptActive && !submitted} inert={!ready}>
      <div className="border-b bg-paper"><div className="mx-auto flex max-w-[1020px] flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6"><div className="min-w-0"><p className="text-xs text-muted">{studentName}</p><h1 className="truncate font-semibold text-ink">{title}</h1></div><div className="flex items-center gap-4"><span className={`inline-flex items-center gap-2 text-sm ${saveError ? "text-alert" : "text-ink-2"}`} aria-live="polite"><StatusBadge state={saveState} /> {saveError || (saveState === "loading" ? "Guardando…" : "Guardado")}</span><div className="flex items-center gap-2 rounded-md border bg-inset px-3 py-1.5"><Clock3 className="size-4 text-muted" aria-hidden="true" /><span role="timer" aria-live="off" aria-label={`${remaining} segundos restantes`} className="mono-number font-semibold text-ink">{formatTime(remaining)}</span></div></div></div></div>

      <main id="contenido" className="mx-auto flex w-full max-w-[1020px] flex-1 flex-col gap-5 px-4 py-6 lg:px-6">
        {instructions ? <p className="rounded-md border bg-inset px-4 py-3 text-sm leading-relaxed text-ink-2"><strong>Indicaciones:</strong> {instructions}</p> : null}
        {reviewing ? (
          <section className="rounded-xl border bg-paper p-5 shadow-card md:p-8" aria-labelledby="review-title">
            <span className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand"><ListChecks aria-hidden="true" /></span>
            <h2 id="review-title" className="mt-4 text-2xl font-semibold text-ink">Revisá antes de entregar</h2>
            <p className="mt-2 text-sm text-muted">{unanswered === 0 ? "Respondiste todas las preguntas." : `Todavía te ${unanswered === 1 ? "falta" : "faltan"} ${unanswered} ${unanswered === 1 ? "pregunta" : "preguntas"}. Podés volver a cualquiera.`}</p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {questions.map((question, index) => <button key={question.id} type="button" onClick={() => { setActiveIndex(index); setReviewing(false); }} className="flex items-center justify-between rounded-md border px-4 py-3 text-left text-sm font-semibold text-ink-2 transition-colors hover:border-brand hover:bg-brand-soft"><span>Pregunta {index + 1}</span><span className={states[index] === "complete" ? "text-ok" : "text-warn"}>{states[index] === "complete" ? "Respondida" : "Falta"}</span></button>)}
            </div>
            <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
              <Button type="button" variant="outline" onClick={() => setReviewing(false)}><ArrowLeft data-icon="inline-start" />Volver a responder</Button>
              <AlertDialog><AlertDialogTrigger asChild><Button type="button" disabled={submitting}><Send data-icon="inline-start" />{submitting ? "Entregando…" : "Entregar evaluación"}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>¿Confirmás la entrega?</AlertDialogTitle><AlertDialogDescription>{unanswered === 0 ? "Después de entregar no vas a poder cambiar tus respuestas." : `Vas a entregar con ${unanswered} ${unanswered === 1 ? "pregunta vacía" : "preguntas vacías"}.`}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Seguir revisando</AlertDialogCancel><AlertDialogAction onClick={() => void finish("manual")}>Entregar</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
            </div>
          </section>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold text-ink-2">Pregunta {activeIndex + 1} de {questions.length} · <span className="mono-number">{active.points} pt{active.points === 1 ? "" : "s"}</span></p><div className="flex items-center gap-2"><span className="text-xs text-muted">{incidentCount} aviso{incidentCount === 1 ? "" : "s"} visible{incidentCount === 1 ? "" : "s"}</span>{requireFullscreen ? <Button type="button" variant="outline" size="sm" onClick={enterFullscreen}><Maximize2 data-icon="inline-start" /> Pantalla completa</Button> : null}</div></div>
            <section className="rounded-lg border bg-paper p-5 shadow-card md:p-8" aria-labelledby="student-question"><div id="student-question"><RichContent text={active.prompt} assets={active.assets} className="max-w-4xl text-lg font-semibold leading-relaxed text-ink" /></div><div className="mt-7"><StudentAnswer question={active} value={answers[active.id]} onChange={(value) => setAnswer(active.id, value)} /></div></section>
            <div className="mt-auto rounded-lg border bg-paper p-4 shadow-card">{showProgress ? <QuestionNavigator states={states} activeIndex={activeIndex} onSelect={(index) => { if (allowBackwards || index >= activeIndex) { setActiveIndex(index); setReviewing(false); } }} mode="student" /> : null}<div className={`${showProgress ? "mt-4 border-t pt-4" : ""} flex items-center justify-between gap-3`}><Button type="button" variant="outline" disabled={!allowBackwards || activeIndex === 0} onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}><ArrowLeft data-icon="inline-start" />Anterior</Button><Button type="button" onClick={() => activeIndex === questions.length - 1 ? setReviewing(true) : setActiveIndex((index) => index + 1)}>{activeIndex === questions.length - 1 ? "Revisar" : "Siguiente"}<ArrowRight data-icon="inline-end" /></Button></div></div>
          </>
        )}
      </main>

      <div id="time-announcement" className="sr-only" aria-live="polite" />
      <Dialog open={Boolean(incident)} onOpenChange={(open) => !open && setIncident(null)}><DialogContent><DialogHeader><DialogTitle>Este evento quedó registrado</DialogTitle><DialogDescription>{incident ? incidentMessage(incident) : ""} Tu docente ve el mismo registro. Los incidentes no cambian tu nota automáticamente.</DialogDescription></DialogHeader><DialogFooter><Button type="button" onClick={() => setIncident(null)}>Entendido</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

function StudentAnswer({ question, value, onChange }: { question: StudentQuestion; value?: StudentAnswerValue; onChange: (value: StudentAnswerValue) => void }) {
  if (question.type === "mc") return <RadioGroup value={typeof value === "string" ? value : ""} onValueChange={onChange} className="gap-3">{question.config.options.map((option) => <FieldLabel key={option.id} className="bg-white"><Field orientation="horizontal"><RadioGroupItem value={option.id} aria-label={option.text} /><RichContent text={option.text} className="leading-relaxed" /></Field></FieldLabel>)}</RadioGroup>;
  if (question.type === "ms") {
    const selected = Array.isArray(value) ? value : [];
    return <div className="flex flex-col gap-3">{question.config.options.map((option) => <FieldLabel key={option.id} className="bg-white"><Field orientation="horizontal"><Checkbox aria-label={option.text} checked={selected.includes(option.id)} onCheckedChange={(checked) => onChange(checked ? [...selected, option.id] : selected.filter((id) => id !== option.id))} /><RichContent text={option.text} className="leading-relaxed" /></Field></FieldLabel>)}</div>;
  }
  if (question.type === "tf") return <RadioGroup value={typeof value === "boolean" ? String(value) : ""} onValueChange={(next) => onChange(next === "true")} className="grid gap-3 sm:grid-cols-2"><FieldLabel className="bg-white"><Field orientation="horizontal"><RadioGroupItem value="true" aria-label="Verdadero" />Verdadero</Field></FieldLabel><FieldLabel className="bg-white"><Field orientation="horizontal"><RadioGroupItem value="false" aria-label="Falso" />Falso</Field></FieldLabel></RadioGroup>;
  if (question.type === "sa") return <Field><FieldLabel htmlFor={`answer-${question.id}`}>Tu respuesta</FieldLabel><Input id={`answer-${question.id}`} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} autoComplete="off" /></Field>;
  return <Field><FieldLabel htmlFor={`answer-${question.id}`}>Tu desarrollo</FieldLabel><Textarea id={`answer-${question.id}`} className="min-h-56 leading-relaxed" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} /></Field>;
}

function incidentMessage(incident: ClientIncident) {
  if (incident.type === "cambio-de-pestana" || incident.type === "ventana-sin-foco") return `Estuviste fuera de la ventana ${(incident.durationMs / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} s.`;
  if (incident.type === "atajo-copiar-pegar") {
    const action = incident.meta.action === "copy" ? "copiar" : incident.meta.action === "cut" ? "cortar" : incident.meta.action === "paste" ? "pegar" : "el portapapeles";
    const characters = typeof incident.meta.characters === "number" ? ` (${incident.meta.characters} caracteres)` : " (cantidad no disponible)";
    return `Usaste ${action}${characters}. Testra no guarda el contenido.`;
  }
  if (incident.type === "salida-pantalla-completa") return "Saliste de pantalla completa.";
  if (incident.type === "manipulacion-de-supervision") return "Se detectó que se modificaron funciones del navegador que usa la supervisión. Quedó registrado.";
  return "Se detectó el uso de F12. Testra lo registra; no pretende bloquear las herramientas del navegador.";
}
