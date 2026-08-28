import {
  BarChart3,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  History,
  ListChecks,
  LoaderCircle,
  SquarePen,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  CorrectionQueue,
  type CorrectionItem,
} from "@/components/correction-queue";
import { IncidentList } from "@/components/incident-list";
import { PublishResults } from "@/components/publish-results";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RunSummary } from "@/server/repository";
import {
  AnalyticsPanel,
  type AnalyticsEnvelope,
} from "@/components/analytics-panel";
import { RichContent } from "@/components/rich-content";

interface ResultsSnapshot {
  run: {
    id: string;
    title: string;
    code: string;
    status: "lobby" | "running" | "ended";
    created_at: number;
    results_published_at: number | null;
    classroom_course_id: string | null;
    classroom_coursework_id: string | null;
  };
  questionCount: number;
  totalPoints: number;
  poolSize: number;
  participants: Array<Record<string, string | number | null>>;
}
interface ParticipantDetail {
  participant: { id: string; name: string; status: string };
  run: { id: string; title: string };
  questions: Array<{
    id: string;
    number: number;
    prompt: string;
    type: string;
    points: number;
    answerText: string;
    correctAnswer: string | null;
    pointsAwarded: number | null;
    manuallyOverridden: boolean;
  }>;
  incidents: Array<{
    id: string;
    at: number;
    duration_ms: number;
    type: string;
    source: string;
    questionNumber: number | null;
    questionPrompt: string | null;
  }>;
  timeline: Array<{
    id: string;
    at: number;
    type: string;
    kind: string;
    actorName: string | null;
  }>;
}
interface AiEnvelope {
  content: Record<string, unknown>;
  model: string;
  generatedAt: number;
}

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
});
const attemptFormatter = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
function attemptDuration(started: unknown, submitted: unknown) {
  const start = Number(started || 0);
  const end = Number(submitted || 0);
  if (!start || !end) return "—";
  const minutes = Math.max(0, Math.round((end - start) / 60_000));
  return `${minutes} min`;
}

// Las tres vistas de una toma. El `id` viaja en `?tab=` para que recargar,
// compartir el link o cambiar de sesión no devuelva al docente a la primera.
const TABS = [
  { id: "notas", label: "Notas", icon: ListChecks },
  { id: "correcciones", label: "Correcciones", icon: SquarePen },
  { id: "analisis", label: "Análisis", icon: BarChart3 },
] as const;
type TabId = (typeof TABS)[number]["id"];
const isTabId = (value: string | null): value is TabId =>
  TABS.some((tab) => tab.id === value);

export function ResultsWorkspace({
  sessions,
  snapshot,
  corrections,
  analytics,
  canPublish,
}: {
  sessions: RunSummary[];
  snapshot: ResultsSnapshot | null;
  corrections: CorrectionItem[];
  analytics: AnalyticsEnvelope | null;
  canPublish: boolean;
}) {
  const [liveSnapshot, setLiveSnapshot] = useState(snapshot);
  const [detail, setDetail] = useState<ParticipantDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [personReport, setPersonReport] = useState<AiEnvelope | null>(null);
  const [runReport, setRunReport] = useState<AiEnvelope | null>(null);
  const [aiLoading, setAiLoading] = useState<"run" | "person" | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabId>("notas");
  const [tabsReady, setTabsReady] = useState(false);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const selectedRunId = liveSnapshot?.run.id;
  const [historialAbierto, setHistorialAbierto] = useState(false);

  // La bandeja muestra solo lo que falta corregir: asi se vacia sola en vez de
  // crecer con cada evaluacion. El historico completo vive en el cajon.
  const porCorregir = useMemo(
    () => sessions.filter((session) => session.pendingCorrections > 0),
    [sessions],
  );
  // La toma abierta se mantiene visible aunque ya no tenga pendientes: si no,
  // desaparece de la lista justo cuando terminas de corregirla.
  const enLaLista = useMemo(() => {
    const abierta = sessions.find((session) => session.id === selectedRunId);
    if (!abierta || porCorregir.some((session) => session.id === abierta.id)) return porCorregir;
    return [abierta, ...porCorregir];
  }, [porCorregir, selectedRunId, sessions]);
  const pendingCorrections = liveSnapshot?.participants.reduce((total, participant) => total + Number(participant.pending_manual ?? 0), 0) ?? 0;
  const correctionTotal = corrections.length;
  const correctedCount = Math.max(0, correctionTotal - pendingCorrections);
  const correctionPercent = correctionTotal ? Math.round(correctedCount / correctionTotal * 100) : 100;

  useEffect(() => {
    if (!selectedRunId) return;
    let active = true;
    void fetch(
      `/api/ai/reports?scopeType=run&scopeId=${encodeURIComponent(selectedRunId)}`,
    ).then(async (response) => {
      if (active && response.ok)
        setRunReport((await response.json()) as AiEnvelope | null);
    });
    return () => {
      active = false;
    };
  }, [selectedRunId]);

  // La pestaña se lee después de hidratar: en el servidor no hay `location` y
  // arrancar por "notas" en ambos lados evita el desajuste de hidratación.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (isTabId(requested)) setTab(requested);
    setTabsReady(true);
  }, []);

  function selectTab(next: TabId) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  function moveTab(event: React.KeyboardEvent, index: number) {
    const keys: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      Home: 0,
      End: TABS.length - 1,
    };
    const target = keys[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = TABS[(target + TABS.length) % TABS.length];
    selectTab(next.id);
    tabRefs.current[next.id]?.focus();
  }

  // El porcentaje se recalcula acá y no solo el puntaje: si no, la tabla seguía
  // mostrando el valor previo a la corrección manual hasta recargar la página.
  function updateGrade(
    participantId: string,
    previous: number | null,
    next: number,
  ) {
    setLiveSnapshot((current) =>
      current
        ? {
            ...current,
            participants: current.participants.map((participant) => {
              if (participant.id !== participantId) return participant;
              const score =
                Number(participant.score ?? 0) - Number(previous ?? 0) + next;
              const maxPoints = Number(
                participant.max_points ?? current.totalPoints,
              );
              return {
                ...participant,
                score,
                percent:
                  maxPoints > 0 ? Math.round((score / maxPoints) * 100) : 0,
                pending_manual: Math.max(
                  0,
                  Number(participant.pending_manual ?? 0) -
                    (previous === null ? 1 : 0),
                ),
              };
            }),
          }
        : current,
    );
  }

  async function openStudent(participantId: string) {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    setPersonReport(null);
    setError("");
    const [detailResponse, reportResponse] = await Promise.all([
      fetch(`/api/results/participants/${encodeURIComponent(participantId)}`),
      fetch(
        `/api/ai/reports?scopeType=participant&scopeId=${encodeURIComponent(participantId)}`,
      ),
    ]);
    if (detailResponse.ok)
      setDetail((await detailResponse.json()) as ParticipantDetail);
    else setError("No se pudo abrir el detalle del alumno.");
    if (reportResponse.ok)
      setPersonReport((await reportResponse.json()) as AiEnvelope | null);
    setDetailLoading(false);
  }

  async function generateReport(
    scopeType: "run" | "participant",
    scopeId: string,
  ) {
    setAiLoading(scopeType === "run" ? "run" : "person");
    setError("");
    const response = await fetch("/api/ai/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scopeType, scopeId }),
    });
    const body = (await response.json().catch(() => ({}))) as AiEnvelope & {
      error?: string;
    };
    if (!response.ok)
      setError(body.error ?? "No se pudo generar el reporte IA.");
    else if (scopeType === "run") setRunReport(body);
    else setPersonReport(body);
    setAiLoading(null);
  }

  return (
    <section className="grid gap-6" aria-labelledby="results-title">
      <header>
        <p className="text-xs font-semibold tracking-[.08em] text-muted uppercase">
          Por evaluación
        </p>
        <h1
          id="results-title"
          className="mt-1 text-2xl font-semibold tracking-[-.02em] text-ink"
        >
          Resultados y correcciones
        </h1>
        <p className="mt-1 text-sm text-muted">
          Abrí un alumno para revisar cada respuesta, nota, aviso y su contexto
          exacto.
        </p>
      </header>
      {error ? (
        <p
          className="rounded-md border border-alert/30 bg-red-50 px-4 py-3 text-sm text-alert"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {sessions.length ? (
        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          <nav
            className="h-fit overflow-hidden rounded-lg border bg-paper shadow-card"
            aria-label="Sesiones por corregir"
          >
            <div className="flex items-center justify-between gap-2 border-b bg-inset px-4 py-3">
              <p className="text-xs font-semibold text-ink-2">
                {porCorregir.length ? "Por corregir" : "Sesiones"}
              </p>
              {porCorregir.length ? (
                <span className="mono-number rounded-sm bg-warn/15 px-1.5 py-0.5 text-xs font-semibold text-warn">
                  {porCorregir.reduce((total, session) => total + session.pendingCorrections, 0)}
                </span>
              ) : null}
            </div>
            <div className="divide-y">
              {enLaLista.map((session) => {
                const selected = selectedRunId === session.id;
                return (
                  <a
                    key={session.id}
                    href={`/resultados?run=${encodeURIComponent(session.id)}&tab=${tab}`}
                    aria-current={selected ? "page" : undefined}
                    className={`flex items-center gap-3 px-4 py-3 transition-colors ${selected ? "bg-brand-soft text-brand-deep" : "text-ink-2 hover:bg-canvas"}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {session.title}
                      </span>
                      <span className="mt-1 flex items-center gap-1 text-xs text-muted">
                        <CalendarDays className="size-3" />
                        {dateFormatter.format(session.createdAt)}
                      </span>
                    </span>
                    {session.pendingCorrections ? (
                      <span className="mono-number shrink-0 rounded-sm bg-warn/15 px-1.5 py-0.5 text-xs font-semibold text-warn">
                        {session.pendingCorrections}
                      </span>
                    ) : null}
                    <ChevronRight className="size-4 shrink-0" />
                  </a>
                );
              })}
              {!enLaLista.length ? (
                <p className="px-4 py-6 text-center text-sm text-muted">
                  No te queda nada por corregir.
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setHistorialAbierto(true)}
              className="flex w-full items-center justify-center gap-2 border-t px-4 py-3 text-sm font-semibold text-brand hover:bg-canvas"
            >
              <History className="size-4" aria-hidden="true" />
              Ver todas ({sessions.length})
            </button>
          </nav>

          {/* El historial completo aparece encima y se va: no compite por ancho
              con la vista donde el docente efectivamente corrige. */}
          <Dialog open={historialAbierto} onOpenChange={setHistorialAbierto}>
            <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Todas las sesiones</DialogTitle>
                <DialogDescription>
                  {sessions.length} en total. La lista de la izquierda muestra solo las que tienen correcciones pendientes.
                </DialogDescription>
              </DialogHeader>
              <div className="divide-y rounded-md border">
                {sessions.map((session) => (
                  <a
                    key={session.id}
                    href={`/resultados?run=${encodeURIComponent(session.id)}&tab=${tab}`}
                    aria-current={selectedRunId === session.id ? "page" : undefined}
                    className={`flex items-center gap-3 px-4 py-3 transition-colors ${selectedRunId === session.id ? "bg-brand-soft text-brand-deep" : "text-ink-2 hover:bg-canvas"}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{session.title}</span>
                      <span className="mono-number mt-1 flex items-center gap-2 text-xs text-muted">
                        {session.code}
                        <span className="flex items-center gap-1"><CalendarDays className="size-3" />{dateFormatter.format(session.createdAt)}</span>
                        <span>{session.participantCount} alumno{session.participantCount === 1 ? "" : "s"}</span>
                      </span>
                    </span>
                    {session.pendingCorrections ? (
                      <span className="mono-number shrink-0 rounded-sm bg-warn/15 px-1.5 py-0.5 text-xs font-semibold text-warn">
                        {session.pendingCorrections} por corregir
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs font-semibold text-ok">Corregida</span>
                    )}
                    <ChevronRight className="size-4 shrink-0" />
                  </a>
                ))}
              </div>
            </DialogContent>
          </Dialog>

          {liveSnapshot ? (
            <div className="min-w-0 space-y-6">
              <section className="overflow-hidden rounded-lg border bg-paper shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5">
                  <div>
                    <p className="mono-number text-xs font-semibold tracking-[.08em] text-brand uppercase">
                      Código {liveSnapshot.run.code}
                    </p>
                    <h2 className="mt-1 text-xl font-semibold text-ink">
                      {liveSnapshot.run.title}
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                      {liveSnapshot.totalPoints} puntos ·{" "}
                      {liveSnapshot.questionCount} preguntas
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={`/sesiones/${encodeURIComponent(liveSnapshot.run.id)}`}
                      className="inline-flex h-9 items-center px-2 text-sm font-semibold text-brand hover:underline"
                    >
                      Ver sesión
                    </a>
                  </div>
                </div>
                <div
                  role="tablist"
                  aria-label="Vistas de la toma"
                  data-results-ready={tabsReady ? "true" : "false"}
                  className="flex gap-1 overflow-x-auto bg-inset px-3"
                >
                  {TABS.map((item, index) => {
                    const current = tab === item.id;
                    const badge =
                      item.id === "correcciones" ? pendingCorrections : 0;
                    return (
                      <button
                        key={item.id}
                        ref={(node) => {
                          tabRefs.current[item.id] = node;
                        }}
                        type="button"
                        role="tab"
                        id={`results-tab-${item.id}`}
                        aria-selected={current}
                        aria-controls={`results-panel-${item.id}`}
                        tabIndex={current ? 0 : -1}
                        onClick={() => selectTab(item.id)}
                        onKeyDown={(event) => moveTab(event, index)}
                        className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold whitespace-nowrap transition-colors ${current ? "border-brand text-brand-deep" : "border-transparent text-ink-2 hover:text-ink"}`}
                      >
                        <item.icon className="size-4" />
                        {item.label}
                        {badge ? (
                          <span className="mono-number rounded-full bg-warn/15 px-1.5 py-0.5 text-[.7rem] font-bold text-warn">
                            {badge}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
              <div
                role="tabpanel"
                id="results-panel-notas"
                aria-labelledby="results-tab-notas"
                hidden={tab !== "notas"}
                className={tab === "notas" ? "grid gap-6" : "hidden"}
              >
                <section className="overflow-hidden rounded-lg border bg-paper shadow-card">
                  {canPublish ? (
                    <PublishResults
                      runId={liveSnapshot.run.id}
                      status={liveSnapshot.run.status}
                      publishedAt={liveSnapshot.run.results_published_at}
                      classroomLinked={Boolean(
                        liveSnapshot.run.classroom_course_id &&
                          liveSnapshot.run.classroom_coursework_id,
                      )}
                      pendingManual={liveSnapshot.participants.reduce(
                        (total, participant) =>
                          total + Number(participant.pending_manual ?? 0),
                        0,
                      )}
                      onPublished={(publishedAt) =>
                        setLiveSnapshot((current) =>
                          current
                            ? {
                                ...current,
                                run: {
                                  ...current.run,
                                  results_published_at: publishedAt,
                                },
                              }
                            : current,
                        )
                      }
                    />
                  ) : null}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px] text-left text-sm">
                      <thead className="bg-inset text-xs text-ink-2">
                        <tr>
                          <th className="px-4 py-3">Alumno</th>
                          <th className="px-4 py-3">Estado</th>
                          <th className="px-4 py-3">Inicio</th>
                          <th className="px-4 py-3">Entrega</th>
                          <th className="px-4 py-3 text-right">Tiempo</th>
                          <th className="px-4 py-3 text-right">Respondidas</th>
                          <th className="px-4 py-3 text-right">Nota</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {liveSnapshot.participants.map((participant) => {
                          const pending = Number(participant.pending_manual);
                          const score = Number(participant.score ?? 0);
                          const maxPoints = Number(
                            participant.max_points ?? liveSnapshot.totalPoints,
                          );
                          const percent = Number(participant.percent ?? 0);
                          return (
                            <tr
                              key={String(participant.id)}
                              className="hover:bg-canvas"
                            >
                              <th scope="row" className="px-4 py-3">
                                <button
                                  onClick={() =>
                                    void openStudent(String(participant.id))
                                  }
                                  className="font-semibold text-brand hover:underline"
                                >
                                  {String(participant.name)}
                                </button>
                              </th>
                              <td className="px-4 py-3">
                                <span
                                  className={`inline-flex items-center gap-1.5 text-xs font-semibold ${participant.status === "submitted" ? "text-ok" : "text-muted"}`}
                                >
                                  <CheckCircle2 className="size-3.5" />
                                  {participant.status === "submitted" ? pending ? "Entregó" : "Corregida" : participant.status === "expired" ? "Vencida" : participant.status === "active" || participant.status === "disconnected" ? "En curso" : "No iniciada"}
                                </span>
                              </td>
                              <td className="mono-number px-4 py-3 text-xs text-muted">{participant.attempt_started_at ? attemptFormatter.format(Number(participant.attempt_started_at)) : "—"}</td>
                              <td className="mono-number px-4 py-3 text-xs text-muted">{participant.submitted_at ? attemptFormatter.format(Number(participant.submitted_at)) : "—"}</td>
                              <td className="mono-number px-4 py-3 text-right text-xs text-muted">{attemptDuration(participant.attempt_started_at, participant.submitted_at)}</td>
                              <td className="mono-number px-4 py-3 text-right">
                                {Number(participant.answered)}/
                                {Number(
                                  participant.assigned_questions ??
                                    liveSnapshot.questionCount,
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span className="mono-number text-base font-semibold text-ink">
                                  {percent}%
                                </span>
                                <span className="mono-number mt-0.5 block text-xs text-muted">
                                  {score}/{maxPoints} puntos
                                </span>
                                {pending ? (
                                  <span className="mt-0.5 block text-xs text-warn">
                                    Falta corrección manual
                                  </span>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                        {!liveSnapshot.participants.length ? (
                          <tr>
                            <td
                              colSpan={7}
                              className="px-4 py-10 text-center text-muted"
                            >
                              <Users className="mx-auto mb-2 size-5" />
                              No hay alumnos.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
              <div
                role="tabpanel"
                id="results-panel-correcciones"
                aria-labelledby="results-tab-correcciones"
                hidden={tab !== "correcciones"}
                className={tab === "correcciones" ? "grid gap-6" : "hidden"}
              >
                {correctionTotal ? <section className="rounded-lg border bg-inset p-4" aria-label="Progreso de corrección"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold tracking-[.08em] text-muted uppercase">Corrección {correctionPercent}%</p><p className="mt-1 text-sm font-semibold text-ink">{correctedCount} corregida{correctedCount === 1 ? "" : "s"} · {pendingCorrections} pendiente{pendingCorrections === 1 ? "" : "s"}</p></div>{pendingCorrections ? <a href={`/correcciones?run=${encodeURIComponent(liveSnapshot.run.id)}`} className="text-sm font-semibold text-brand hover:underline">Abrir la bandeja completa →</a> : <span className="text-sm font-semibold text-ok">Corrección terminada</span>}</div><div className="mt-3 h-2 overflow-hidden rounded-full bg-white"><div className="h-full bg-brand" style={{ width: `${correctionPercent}%` }} /></div></section> : null}
                <CorrectionQueue
                  initialItems={corrections}
                  embedded
                  onGradeSaved={updateGrade}
                />
              </div>
              <div
                role="tabpanel"
                id="results-panel-analisis"
                aria-labelledby="results-tab-analisis"
                hidden={tab !== "analisis"}
                className={tab === "analisis" ? "grid gap-6" : "hidden"}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-paper p-4 shadow-card">
                  <p className="text-sm text-muted">
                    La IA ordena las señales de la toma para leerlas rápido. No
                    califica ni sanciona.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void generateReport("run", liveSnapshot.run.id)
                    }
                    disabled={aiLoading === "run"}
                  >
                    {aiLoading === "run" ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <BrainCircuit />
                    )}
                    Analizar test con IA
                  </Button>
                </div>
                {runReport ? (
                  <AiReportCard report={runReport} kind="run" />
                ) : null}
                {analytics ? <AnalyticsPanel data={analytics} /> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed bg-paper p-10 text-center">
          Todavía no hay resultados.
        </div>
      )}

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {detail?.participant.name ?? "Detalle del alumno"}
            </DialogTitle>
            <DialogDescription>
              Respuestas, corrección e incidentes ubicados en la pregunta
              activa.
            </DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="grid min-h-48 place-items-center">
              <LoaderCircle className="animate-spin text-brand" />
            </div>
          ) : detail ? (
            <div className="grid gap-6">
              <section>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-ink">Respuestas</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void generateReport("participant", detail.participant.id)
                    }
                    disabled={aiLoading === "person"}
                  >
                    {aiLoading === "person" ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <BrainCircuit />
                    )}
                    Analizar incidentes
                  </Button>
                </div>
                <div className="mt-3 divide-y rounded-md border">
                  {detail.questions.map((question) => (
                    <article key={question.id} className="p-4">
                      <div className="flex justify-between gap-3">
                        <div className="text-sm font-semibold text-ink">
                          <span>{question.number}. </span>
                          <RichContent text={question.prompt} className="inline" />
                        </div>
                        <span className="mono-number shrink-0 text-sm font-semibold">
                          {question.pointsAwarded ?? "—"}/{question.points}
                        </span>
                      </div>
                      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-xs text-muted">Respondió</dt>
                          <dd className="mt-1 text-ink-2">
                            {question.answerText}
                          </dd>
                        </div>
                        {question.correctAnswer ? (
                          <div>
                            <dt className="text-xs text-muted">
                              Respuesta esperada
                            </dt>
                            <dd className="mt-1 text-ink-2">
                              {question.correctAnswer}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    </article>
                  ))}
                </div>
              </section>
              {personReport ? (
                <AiReportCard report={personReport} kind="person" />
              ) : null}
              <section>
                <h3 className="font-semibold text-ink">Línea de tiempo</h3>
                <ol className="mt-3 grid gap-2 rounded-md border p-4">
                  {detail.timeline.map((event) => (
                    <li key={`${event.kind}:${event.id}`} className="flex items-start justify-between gap-3 text-sm">
                      <span>{timelineLabel(event.type)}{event.actorName ? ` · ${event.actorName}` : ""}</span>
                      <time className="mono-number shrink-0 text-xs text-muted">{dateFormatter.format(event.at)}</time>
                    </li>
                  ))}
                  {!detail.timeline.length ? <li className="text-sm text-muted">No hay eventos registrados.</li> : null}
                </ol>
              </section>
              <section>
                <h3 className="font-semibold text-ink">
                  Avisos ({detail.incidents.length})
                </h3>
                <IncidentList incidents={detail.incidents} />
              </section>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function timelineLabel(type: string) {
  const labels: Record<string, string> = {
    "exam-started": "Comenzó la evaluación",
    submitted: "Entregó",
    "extra-time-changed": "Se cambió el tiempo extra",
    "submission-reopened": "Se reabrió la entrega",
    disconnected: "Se desconectó",
    reconnected: "Se reconectó",
  };
  return labels[type] ?? type;
}

function AiReportCard({
  report,
  kind,
}: {
  report: AiEnvelope;
  kind: "run" | "person";
}) {
  const data = report.content;
  const candidates = Array.isArray(data.likelyCopying)
    ? (data.likelyCopying as Array<Record<string, unknown>>)
    : [];
  const evidence = Array.isArray(data.evidence)
    ? (data.evidence as string[])
    : [];
  const benign = Array.isArray(data.benignExplanations)
    ? (data.benignExplanations as string[])
    : [];
  const reviewLabel: Record<string, string> = {
    high: "prioridad alta",
    medium: "prioridad media",
    low: "prioridad baja",
  };
  return (
    <aside className="rounded-lg border border-brand/20 bg-brand-soft/40 p-5">
      <div className="flex items-center gap-2">
        <BrainCircuit className="size-5 text-brand" />
        <h3 className="font-semibold text-brand-deep">
          Lectura orientativa para el docente
        </h3>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted">
        La IA organiza señales para ahorrar tiempo. No califica, no sanciona y
        no puede determinar por sí sola si alguien copió.
      </p>
      <p className="mt-3 text-sm leading-6 text-ink-2">
        {String(data.summary ?? "Análisis generado.")}
      </p>
      {kind === "run" && candidates.length ? (
        <div className="mt-4 grid gap-2">
          {candidates.map((candidate) => (
            <div
              key={String(candidate.participantId)}
              className="rounded-md bg-white p-3 text-sm"
            >
              <strong>{String(candidate.name)}</strong>
              <span className="ms-2 text-xs font-semibold text-brand">
                {reviewLabel[String(candidate.risk)] ?? "para revisar"}
              </span>
              <p className="mt-1 leading-5 text-muted">
                {Array.isArray(candidate.reasons)
                  ? candidate.reasons.join(" · ")
                  : ""}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {kind === "person" && evidence.length ? (
        <section className="mt-4">
          <h4 className="text-sm font-semibold text-ink">Qué ocurrió</h4>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-ink-2">
            {evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {kind === "person" && benign.length ? (
        <section className="mt-4">
          <h4 className="text-sm font-semibold text-ink">
            Explicaciones normales posibles
          </h4>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-muted">
            {benign.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {data.recommendation ? (
        <p className="mt-4 rounded-md bg-white p-3 text-sm leading-6 text-ink-2">
          <strong>Qué conviene revisar:</strong> {String(data.recommendation)}
        </p>
      ) : null}
      <p className="mt-4 border-t pt-3 text-xs leading-5 text-muted">
        {String(
          data.caveat ??
            "Es una lectura orientativa. El docente debe revisar el contexto antes de tomar una decisión.",
        )}
      </p>
    </aside>
  );
}
