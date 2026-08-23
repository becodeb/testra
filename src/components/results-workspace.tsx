import { BrainCircuit, CalendarDays, CheckCircle2, ChevronRight, LoaderCircle, ShieldAlert, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { CorrectionQueue, type CorrectionItem } from "@/components/correction-queue";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { RunSummary } from "@/server/repository";

interface ResultsSnapshot { run: { id: string; title: string; code: string; status: "lobby" | "running" | "ended"; created_at: number }; questionCount: number; totalPoints: number; participants: Array<Record<string, string | number | null>>; }
interface ParticipantDetail { participant: { id: string; name: string; status: string }; run: { id: string; title: string }; questions: Array<{ id: string; number: number; prompt: string; type: string; points: number; answerText: string; correctAnswer: string | null; pointsAwarded: number | null; manuallyOverridden: boolean }>; incidents: Array<{ id: string; at: number; duration_ms: number; type: string; source: string; questionNumber: number | null; questionPrompt: string | null }> }
interface AiEnvelope { content: Record<string, unknown>; model: string; generatedAt: number }

const dateFormatter = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" });
const incidentLabels: Record<string, string> = { "cambio-de-pestana": "Cambió de pestaña o ventana", "ventana-sin-foco": "La ventana perdió el foco", "atajo-copiar-pegar": "Usó copiar, cortar o pegar", "salida-pantalla-completa": "Salió de pantalla completa", "sesion-duplicada": "Se abrió otra sesión", "cambio-ip": "Cambió de red o conexión", "cambio-user-agent": "Cambió de navegador o dispositivo", desconexion: "Se interrumpió la conexión", "cierre-pestana": "Cerró o recargó la pestaña" };

export function ResultsWorkspace({ sessions, snapshot, corrections }: { sessions: RunSummary[]; snapshot: ResultsSnapshot | null; corrections: CorrectionItem[] }) {
  const [liveSnapshot, setLiveSnapshot] = useState(snapshot);
  const [detail, setDetail] = useState<ParticipantDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [personReport, setPersonReport] = useState<AiEnvelope | null>(null);
  const [runReport, setRunReport] = useState<AiEnvelope | null>(null);
  const [aiLoading, setAiLoading] = useState<"run" | "person" | null>(null);
  const [error, setError] = useState("");
  const selectedRunId = liveSnapshot?.run.id;

  useEffect(() => {
    if (!selectedRunId) return;
    let active = true;
    void fetch(`/api/ai/reports?scopeType=run&scopeId=${encodeURIComponent(selectedRunId)}`).then(async (response) => {
      if (active && response.ok) setRunReport(await response.json() as AiEnvelope | null);
    });
    return () => { active = false; };
  }, [selectedRunId]);

  function updateGrade(participantId: string, previous: number | null, next: number) { setLiveSnapshot((current) => current ? { ...current, participants: current.participants.map((participant) => participant.id === participantId ? { ...participant, score: Number(participant.score ?? 0) - Number(previous ?? 0) + next, pending_manual: Math.max(0, Number(participant.pending_manual ?? 0) - (previous === null ? 1 : 0)) } : participant) } : current); }

  async function openStudent(participantId: string) {
    setDetailOpen(true); setDetailLoading(true); setDetail(null); setPersonReport(null); setError("");
    const [detailResponse, reportResponse] = await Promise.all([
      fetch(`/api/results/participants/${encodeURIComponent(participantId)}`),
      fetch(`/api/ai/reports?scopeType=participant&scopeId=${encodeURIComponent(participantId)}`),
    ]);
    if (detailResponse.ok) setDetail(await detailResponse.json() as ParticipantDetail); else setError("No se pudo abrir el detalle del alumno.");
    if (reportResponse.ok) setPersonReport(await reportResponse.json() as AiEnvelope | null);
    setDetailLoading(false);
  }

  async function generateReport(scopeType: "run" | "participant", scopeId: string) {
    setAiLoading(scopeType === "run" ? "run" : "person"); setError("");
    const response = await fetch("/api/ai/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scopeType, scopeId }) });
    const body = await response.json().catch(() => ({})) as AiEnvelope & { error?: string };
    if (!response.ok) setError(body.error ?? "No se pudo generar el reporte IA.");
    else if (scopeType === "run") setRunReport(body); else setPersonReport(body);
    setAiLoading(null);
  }

  return <section className="grid gap-6" aria-labelledby="results-title">
    <header><p className="text-xs font-semibold tracking-[.08em] text-muted uppercase">Por evaluación</p><h1 id="results-title" className="mt-1 text-2xl font-semibold tracking-[-.02em] text-ink">Resultados y correcciones</h1><p className="mt-1 text-sm text-muted">Abrí un alumno para revisar cada respuesta, nota, aviso y su contexto exacto.</p></header>
    {error ? <p className="rounded-md border border-alert/30 bg-red-50 px-4 py-3 text-sm text-alert" role="alert">{error}</p> : null}
    {sessions.length ? <div className="grid gap-5 lg:grid-cols-[18rem_1fr]"><nav className="h-fit overflow-hidden rounded-lg border bg-paper shadow-card" aria-label="Sesiones con resultados"><p className="border-b bg-inset px-4 py-3 text-xs font-semibold text-ink-2">Sesiones</p><div className="divide-y">{sessions.map((session) => { const selected = selectedRunId === session.id; return <a key={session.id} href={`/resultados?run=${encodeURIComponent(session.id)}`} aria-current={selected ? "page" : undefined} className={`flex items-center gap-3 px-4 py-3 transition-colors ${selected ? "bg-brand-soft text-brand-deep" : "text-ink-2 hover:bg-canvas"}`}><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{session.title}</span><span className="mt-1 flex items-center gap-1 text-xs text-muted"><CalendarDays className="size-3" />{dateFormatter.format(session.createdAt)}</span></span><ChevronRight className="size-4 shrink-0" /></a>; })}</div></nav>
      {liveSnapshot ? <div className="min-w-0 space-y-6"><section className="overflow-hidden rounded-lg border bg-paper shadow-card"><div className="flex flex-wrap items-start justify-between gap-3 border-b p-5"><div><p className="mono-number text-xs font-semibold tracking-[.08em] text-brand uppercase">Código {liveSnapshot.run.code}</p><h2 className="mt-1 text-xl font-semibold text-ink">{liveSnapshot.run.title}</h2><p className="mt-1 text-sm text-muted">{liveSnapshot.totalPoints} puntos · {liveSnapshot.questionCount} preguntas</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => void generateReport("run", liveSnapshot.run.id)} disabled={aiLoading === "run"}>{aiLoading === "run" ? <LoaderCircle className="animate-spin" /> : <BrainCircuit />}Analizar test con IA</Button><a href={`/sesiones/${encodeURIComponent(liveSnapshot.run.id)}`} className="inline-flex h-9 items-center px-2 text-sm font-semibold text-brand hover:underline">Ver sesión</a></div></div>
        {runReport ? <AiReportCard report={runReport} kind="run" /> : null}
        <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-inset text-xs text-ink-2"><tr><th className="px-4 py-3">Alumno</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3 text-right">Respondidas</th><th className="px-4 py-3 text-right">Nota</th></tr></thead><tbody className="divide-y">{liveSnapshot.participants.map((participant) => { const pending = Number(participant.pending_manual); const score = Number(participant.score ?? 0); return <tr key={String(participant.id)} className="hover:bg-canvas"><th scope="row" className="px-4 py-3"><button onClick={() => void openStudent(String(participant.id))} className="font-semibold text-brand hover:underline">{String(participant.name)}</button></th><td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${participant.status === "submitted" ? "text-ok" : "text-muted"}`}><CheckCircle2 className="size-3.5" />{participant.status === "submitted" ? "Entregó" : "Sin entregar"}</span></td><td className="mono-number px-4 py-3 text-right">{Number(participant.answered)}/{liveSnapshot.questionCount}</td><td className="px-4 py-3 text-right"><span className="mono-number font-semibold text-ink">{score}/{liveSnapshot.totalPoints}</span>{pending ? <span className="mt-0.5 block text-xs text-warn">Falta corrección manual</span> : null}</td></tr>; })}{!liveSnapshot.participants.length ? <tr><td colSpan={4} className="px-4 py-10 text-center text-muted"><Users className="mx-auto mb-2 size-5" />No hay alumnos.</td></tr> : null}</tbody></table></div></section><CorrectionQueue initialItems={corrections} embedded onGradeSaved={updateGrade} /></div> : null}</div> : <div className="rounded-lg border border-dashed bg-paper p-10 text-center">Todavía no hay resultados.</div>}

    <Dialog open={detailOpen} onOpenChange={setDetailOpen}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>{detail?.participant.name ?? "Detalle del alumno"}</DialogTitle><DialogDescription>Respuestas, corrección e incidentes ubicados en la pregunta activa.</DialogDescription></DialogHeader>{detailLoading ? <div className="grid min-h-48 place-items-center"><LoaderCircle className="animate-spin text-brand" /></div> : detail ? <div className="grid gap-6"><section><div className="flex items-center justify-between"><h3 className="font-semibold text-ink">Respuestas</h3><Button variant="outline" size="sm" onClick={() => void generateReport("participant", detail.participant.id)} disabled={aiLoading === "person"}>{aiLoading === "person" ? <LoaderCircle className="animate-spin" /> : <BrainCircuit />}Analizar incidentes</Button></div><div className="mt-3 divide-y rounded-md border">{detail.questions.map((question) => <article key={question.id} className="p-4"><div className="flex justify-between gap-3"><p className="text-sm font-semibold text-ink">{question.number}. {question.prompt}</p><span className="mono-number shrink-0 text-sm font-semibold">{question.pointsAwarded ?? "—"}/{question.points}</span></div><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted">Respondió</dt><dd className="mt-1 text-ink-2">{question.answerText}</dd></div>{question.correctAnswer ? <div><dt className="text-xs text-muted">Respuesta esperada</dt><dd className="mt-1 text-ink-2">{question.correctAnswer}</dd></div> : null}</dl></article>)}</div></section>{personReport ? <AiReportCard report={personReport} kind="person" /> : null}<section><h3 className="font-semibold text-ink">Avisos ({detail.incidents.length})</h3><div className="mt-3 space-y-2">{detail.incidents.map((incident) => <article key={incident.id} className="rounded-md border p-4"><div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" /><div><p className="text-sm font-semibold text-ink">{incidentLabels[incident.type] ?? incident.type}</p><p className="mt-1 text-xs text-muted">{dateFormatter.format(incident.at)}{incident.duration_ms ? ` · ${(incident.duration_ms / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} s` : ""}</p><p className="mt-2 text-sm text-ink-2">{incident.questionNumber ? `Estaba en la pregunta ${incident.questionNumber}: ${incident.questionPrompt}` : "No hay pregunta asociada (registro anterior a esta mejora o alumno fuera de una pregunta)."}</p></div></div></article>)}{!detail.incidents.length ? <p className="rounded-md bg-inset p-4 text-sm text-muted">No se registraron avisos.</p> : null}</div></section></div> : null}</DialogContent></Dialog>
  </section>;
}

function AiReportCard({ report, kind }: { report: AiEnvelope; kind: "run" | "person" }) {
  const data = report.content;
  const candidates = Array.isArray(data.likelyCopying) ? data.likelyCopying as Array<Record<string, unknown>> : [];
  const evidence = Array.isArray(data.evidence) ? data.evidence as string[] : [];
  return <aside className="m-5 rounded-lg border border-brand/20 bg-brand-soft/40 p-5"><div className="flex items-center gap-2"><BrainCircuit className="size-5 text-brand" /><h3 className="font-semibold text-brand-deep">Reporte orientativo de IA</h3></div><p className="mt-3 text-sm leading-6 text-ink-2">{String(data.summary ?? "Análisis generado.")}</p>{kind === "run" && candidates.length ? <div className="mt-4 grid gap-2">{candidates.map((candidate) => <div key={String(candidate.participantId)} className="rounded-md bg-white p-3 text-sm"><strong>{String(candidate.name)}</strong> · riesgo {String(candidate.risk)} · confianza {String(candidate.confidence)}%<p className="mt-1 text-muted">{Array.isArray(candidate.reasons) ? candidate.reasons.join(" · ") : ""}</p></div>)}</div> : null}{kind === "person" && evidence.length ? <ul className="mt-4 list-disc space-y-1 ps-5 text-sm text-ink-2">{evidence.map((item) => <li key={item}>{item}</li>)}</ul> : null}<p className="mt-4 border-t pt-3 text-xs leading-5 text-muted">{String(data.caveat ?? "Es una lectura orientativa. El docente debe revisar la evidencia antes de tomar una decisión.")}</p></aside>;
}
