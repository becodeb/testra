import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Clock3, Link2, Minus, Plus, Radio, Square, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { clipboardDetail, copyForIncident } from "@/lib/incident-copy";
import { formatAssignedProgress } from "@/lib/exam-progress";
import { matchedExpectedStudentIndexes } from "@/lib/student-identity";

interface MonitorSnapshot {
  run: {
    id: string;
    code: string;
    title: string;
    status: "lobby" | "running" | "ended";
    started_at: number | null;
    ends_at: number | null;
    delivery_mode: "sync" | "async";
    available_from: number | null;
    available_until: number | null;
    time_limit_s: number;
  };
  questionCount: number;
  serverNow: number;
  /** Versiones adaptadas de esta evaluación, para asignarlas por alumno. */
  adaptedExams?: Array<{ id: string; title: string; status: string; questionCount: number }>;
  participants: Array<Record<string, string | number | null>>;
  incidents: Array<Record<string, string | number | object>>;
  expected: Array<Record<string, string | null>>;
  events: Array<Record<string, string | number | object | null>>;
}

interface LiveRunMonitorProps {
  runId: string;
  initialSnapshot: MonitorSnapshot;
  canControl?: boolean;
}

const timeFormatter = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const RHYTHM_INCIDENT_TYPES = new Set(["cadencia-respuestas", "ritmo-desarrollo"]);

export function LiveRunMonitor({ runId, initialSnapshot, canControl = true }: LiveRunMonitorProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [now, setNow] = useState(initialSnapshot.serverNow);
  const [working, setWorking] = useState(false);
  const [selectedParticipant, setSelectedParticipant] = useState<string | null>(null);
  // Mismo centinela que el resto de las islas: hasta que no hidrata, los
  // controles son HTML plano y un clic no llega a ningún manejador.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [linkCopiado, setLinkCopiado] = useState(false);

  /**
   * El link sale del origen del navegador, no de un dominio fijo: así funciona
   * igual en producción, en una copia de prueba o en desarrollo.
   */
  async function copiarLink() {
    const url = `${window.location.origin}/rendir/${snapshot.run.code}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Sin permiso de portapapeles —o sin HTTPS— queda el camino de siempre:
      // se muestra el link para copiarlo a mano.
      window.prompt("Copiá el link para compartirlo:", url);
      return;
    }
    setLinkCopiado(true);
    window.setTimeout(() => setLinkCopiado(false), 2_000);
  }

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/state`);
    if (response.ok) {
      const next = await response.json() as MonitorSnapshot;
      setSnapshot(next);
      setNow(next.serverNow);
    }
  }, [runId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow((value) => value + 1_000), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/runs/${encodeURIComponent(runId)}/socket?role=teacher`);

    // Cada mensaje del socket puede pedir una relectura del panel completo. Con
    // un curso entero rindiendo llegan decenas por segundo, así que se agrupan y
    // nunca se permiten snapshots solapados contra Postgres.
    let pending = 0;
    let refreshing = false;
    let queued = false;
    const runRefresh = async () => {
      if (refreshing) {
        queued = true;
        return;
      }
      refreshing = true;
      await refresh();
      refreshing = false;
      if (queued) {
        queued = false;
        scheduleRefresh();
      }
    };
    const scheduleRefresh = () => {
      if (pending) return;
      pending = window.setTimeout(() => {
        pending = 0;
        void runRefresh();
      }, 800);
    };

    socket.addEventListener("message", scheduleRefresh);
    const poll = window.setInterval(() => void runRefresh(), 5_000);
    return () => {
      window.clearTimeout(pending);
      window.clearInterval(poll);
      socket.close();
    };
  }, [refresh, runId]);

  const presentExpectedIndexes = useMemo(
    () => matchedExpectedStudentIndexes(snapshot.expected, snapshot.participants),
    [snapshot.expected, snapshot.participants],
  );
  const missing = snapshot.expected.filter((_, index) => !presentExpectedIndexes.has(index));
  const allExpectedPresent = snapshot.expected.length === 0 || missing.length === 0;
  const remaining = snapshot.run.ends_at ? Math.max(0, Math.ceil((snapshot.run.ends_at - now) / 1000)) : null;
  const activityIncidents = useMemo(() => snapshot.incidents.filter((incident) => !RHYTHM_INCIDENT_TYPES.has(String(incident.type))), [snapshot.incidents]);
  const rhythmIncidents = useMemo(() => snapshot.incidents.filter((incident) => RHYTHM_INCIDENT_TYPES.has(String(incident.type))), [snapshot.incidents]);

  async function control(action: "start" | "end" | "adjust-time", deltaS?: number) {
    if (action === "end" && snapshot.participants.some((participant) => participant.status === "active")
      && !window.confirm("Hay alumnos rindiendo. ¿Querés finalizar la evaluación para todos?")) return;
    setWorking(true);
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...(deltaS === undefined ? {} : { deltaS }) }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      window.alert(body.error ?? "No se pudo actualizar la sesión");
    }
    await refresh();
    setWorking(false);
  }

  async function participantControl(participant: Record<string, string | number | null>, action: "participant-time" | "reopen") {
    const raw = window.prompt(action === "reopen" ? "Minutos extra al reabrir (puede ser 0):" : "Tiempo extra total en minutos:", action === "reopen" ? "15" : String(Math.round(Number(participant.extra_time_s ?? 0) / 60)));
    if (raw === null) return;
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) return window.alert("Ingresá entre 0 y 1440 minutos");
    setWorking(true);
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, participantId: participant.id, extraTimeS: Math.round(minutes * 60) }) });
    if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; window.alert(body.error ?? "No se pudo actualizar al alumno"); }
    await refresh();
    setWorking(false);
  }

  /**
   * La versión adaptada se asigna antes de que el alumno empiece: cambiarla
   * después dejaría sus respuestas colgando de preguntas que ya no tiene. El
   * servidor lo rechaza igual; acá se avisa con el motivo.
   */
  async function assignExam(participantId: string, examId: string) {
    setWorking(true);
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "assign-exam", participantId, examId: examId || null }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      window.alert(body.error ?? "No se pudo asignar la versión");
    }
    await refresh();
    setWorking(false);
  }

  return (
    <div className="grid gap-5" data-monitor-ready={ready}>
      <section className="rounded-lg border bg-paper p-5 shadow-card" aria-labelledby="run-title">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold tracking-[.08em] text-muted uppercase">{snapshot.run.status === "ended" ? "Evaluación finalizada" : snapshot.run.delivery_mode === "async" ? "Evaluación asincrónica" : snapshot.run.status === "lobby" ? "Sala de espera" : "Evaluación en vivo"}</p>
            <h1 id="run-title" className="mt-1 text-2xl font-semibold text-ink">{snapshot.run.title}</h1>
            <p className="mt-3 text-sm text-muted">Código de ingreso</p>
            <p className="mono-number mt-1 text-3xl font-bold tracking-[.18em] text-brand" aria-label={`Código ${snapshot.run.code.split("").join(" ")}`}>{snapshot.run.code}</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void copiarLink()}>
              {linkCopiado ? <Check data-icon="inline-start" aria-hidden="true" /> : <Link2 data-icon="inline-start" aria-hidden="true" />}
              {linkCopiado ? "Link copiado" : "Copiar link de ingreso"}
            </Button>
            <span aria-live="polite" className="sr-only">{linkCopiado ? "Link copiado al portapapeles" : ""}</span>
          </div>
          <div className="flex flex-col items-end gap-3">
            <span className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${snapshot.run.status === "running" ? "border-ok/30 text-ok" : "text-ink-2"}`}><Radio className="size-4" aria-hidden="true" /> {snapshot.run.status === "lobby" ? "Esperando" : snapshot.run.status === "running" ? "En curso" : "Cerrada"}</span>
            {remaining !== null ? <div className="text-right"><span className="text-xs text-muted">{snapshot.run.delivery_mode === "async" ? "La ventana cierra en" : "Tiempo restante"}</span><span role="timer" aria-live="off" className="mono-number mt-1 flex items-center gap-2 text-xl font-semibold"><Clock3 className="size-5 text-muted" aria-hidden="true" />{formatTime(remaining)}</span></div> : null}
          </div>
        </div>

        {canControl ? <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4">
          {snapshot.run.status === "lobby" ? (
            <>
              <Button type="button" disabled={!allExpectedPresent || working} onClick={() => control("start")}>Iniciar evaluación</Button>
              {!allExpectedPresent ? <Button type="button" variant="outline" disabled={working} onClick={() => control("start")}>Forzar inicio con {missing.length} ausente{missing.length === 1 ? "" : "s"}</Button> : null}
            </>
          ) : snapshot.run.status === "running" && snapshot.run.delivery_mode === "sync" ? (
            <>
              <Button type="button" variant="outline" disabled={working} onClick={() => control("adjust-time", -300)}><Minus data-icon="inline-start" /> 5 min</Button>
              <Button type="button" variant="outline" disabled={working} onClick={() => control("adjust-time", 300)}><Plus data-icon="inline-start" /> 5 min</Button>
              <Button type="button" variant="destructive" className="ms-auto" disabled={working} onClick={() => control("end")}><Square data-icon="inline-start" /> Finalizar evaluación</Button>
            </>
          ) : snapshot.run.status === "running" ? <><p className="text-sm text-ink-2">Cada alumno dispone de {Math.round(snapshot.run.time_limit_s / 60)} minutos desde que inicia.</p><Button type="button" variant="destructive" className="ms-auto" disabled={working} onClick={() => control("end")}><Square data-icon="inline-start" /> Cerrar ventana</Button></> : <a href={`/resultados?run=${encodeURIComponent(runId)}`} className="text-sm font-semibold text-brand hover:underline">Ver notas y corregir</a>}
        </div> : null}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
        <section className="overflow-hidden rounded-lg border bg-paper shadow-card" aria-labelledby="participants-title">
          <div className="flex items-center justify-between border-b px-4 py-3"><h2 id="participants-title" className="font-semibold text-ink">Alumnos</h2><span className="mono-number inline-flex items-center gap-2 text-sm text-muted"><Users className="size-4" aria-hidden="true" />{snapshot.participants.length}</span></div>
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full min-w-[580px] text-left text-sm">
              <thead className="sticky top-0 bg-inset text-xs text-ink-2"><tr><th className="px-4 py-2.5">Alumno</th><th className="px-4 py-2.5">Estado</th><th className="px-4 py-2.5 text-right">Avance</th><th className="px-4 py-2.5 text-right">Puntaje</th><th className="px-4 py-2.5 text-right">Tiempo</th><th className="px-4 py-2.5 text-right">Última señal</th><th className="px-4 py-2.5">Acciones</th></tr></thead>
              <tbody className="divide-y">
                {snapshot.participants.map((participant) => <tr key={String(participant.id)}><th scope="row" className="px-4 py-3 font-medium text-ink"><button type="button" className="hover:text-brand hover:underline" onClick={() => setSelectedParticipant(String(participant.id))}>{String(participant.name)}</button>{snapshot.run.delivery_mode === "async" ? <span className="mt-1 block text-xs font-normal text-muted">{participant.attempt_started_at ? `Inició ${timeFormatter.format(Number(participant.attempt_started_at))}` : "Todavía no inició"}</span> : null}</th><td className="px-4 py-3"><Status value={String(participant.status)} /></td><td className="mono-number px-4 py-3 text-right">{formatAssignedProgress(Number(participant.answered), Number(participant.assigned_questions ?? snapshot.questionCount))}</td><td className="mono-number px-4 py-3 text-right">{participant.score === null ? "—" : `${Number(participant.percent ?? 0)}%`}{Number(participant.pending_manual) ? " + pendiente" : ""}</td><td className="mono-number px-4 py-3 text-right">{Number(participant.extra_time_s) > 0 ? `+${Math.round(Number(participant.extra_time_s) / 60)} min` : "base"}</td><td className="mono-number px-4 py-3 text-right text-muted">{timeFormatter.format(Number(participant.last_seen))}</td><td className="px-4 py-3"><div className="flex flex-wrap items-center gap-1">{(snapshot.adaptedExams ?? []).length ? <><label className="sr-only" htmlFor={`version-${participant.id}`}>Versión de {String(participant.name)}</label><select id={`version-${participant.id}`} className="h-7 max-w-[11rem] rounded-md border bg-paper px-1.5 text-xs text-ink-2" value={String(participant.assigned_exam_id ?? "")} disabled={working || participant.status === "submitted" || snapshot.run.status === "ended"} onChange={(event) => void assignExam(String(participant.id), event.target.value)}><option value="">Versión original</option>{(snapshot.adaptedExams ?? []).map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}</select></> : null}<Button type="button" size="xs" variant="outline" disabled={working || snapshot.run.status === "ended"} onClick={() => void participantControl(participant, "participant-time")}>Tiempo</Button>{participant.status === "submitted" && snapshot.run.status === "running" ? <Button type="button" size="xs" variant="outline" disabled={working} onClick={() => void participantControl(participant, "reopen")}>Reabrir</Button> : null}</div></td></tr>)}
                {!snapshot.participants.length ? <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">Todavía no ingresó ningún alumno.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {missing.length ? <div className="border-t bg-inset px-4 py-3"><p className="text-xs font-semibold text-ink-2">Faltan: {missing.map((student) => student.name).join(", ")}</p></div> : null}
          {selectedParticipant ? <div className="border-t bg-inset p-4"><div className="flex items-center justify-between"><p className="text-sm font-semibold text-ink">Línea de tiempo</p><Button type="button" variant="ghost" size="xs" onClick={() => setSelectedParticipant(null)}>Cerrar</Button></div><ol className="mt-3 grid max-h-56 gap-2 overflow-auto">{snapshot.events.filter((event) => String(event.participant_id) === selectedParticipant).map((event) => <li key={String(event.id)} className="flex items-start justify-between gap-3 text-xs"><span>{timelineLabel(String(event.type))}{event.actor_name ? ` · ${String(event.actor_name)}` : ""}</span><time className="mono-number shrink-0 text-muted">{timeFormatter.format(Number(event.at))}</time></li>)}{!snapshot.events.some((event) => String(event.participant_id) === selectedParticipant) ? <li className="text-xs text-muted">Todavía no hay eventos auditables.</li> : null}</ol></div> : null}
        </section>

        <section className="rounded-lg border bg-paper shadow-card" aria-labelledby="incidents-title">
          <div className="flex items-center justify-between border-b px-4 py-3"><div><h2 id="incidents-title" className="font-semibold text-ink">Avisos de actividad</h2><p className="mt-0.5 text-xs text-muted">Señales para revisar; no prueban una conducta por sí solas.</p></div><span className="mono-number text-sm text-warn">{activityIncidents.length}</span></div>
          <div className="max-h-[32rem] divide-y overflow-auto">
            {activityIncidents.map((incident) => <article key={String(incident.id)} className="p-4"><div className="flex items-start gap-2"><AlertTriangle className={`mt-0.5 size-4 shrink-0 ${incident.source === "server" ? "text-alert" : "text-warn"}`} aria-hidden="true" /><div><p className="text-sm font-semibold text-ink">{String(incident.name)}</p><p className="mt-0.5 text-sm text-ink-2">{incidentLabel(String(incident.type), Number(incident.duration_ms), incident.meta as Record<string, unknown> | undefined)}</p><p className="mt-1 text-xs text-muted">{incident.source === "server" ? "Detectado automáticamente" : "Informado por el navegador"} · {timeFormatter.format(Number(incident.at))}</p></div></div></article>)}
            {!activityIncidents.length ? <p className="p-6 text-center text-sm text-muted">No hay avisos de actividad registrados.</p> : null}
          </div>
        </section>

        {rhythmIncidents.length ? <section className="rounded-lg border bg-paper shadow-card" aria-labelledby="rhythm-title"><div className="flex items-center justify-between border-b px-4 py-3"><div><h2 id="rhythm-title" className="flex items-center gap-2 font-semibold text-ink"><Clock3 className="size-4 text-muted" />Ritmo de resolución</h2><p className="mt-0.5 text-xs text-muted">Contexto secundario; no es una señal de integridad ni prueba una conducta.</p></div><span className="mono-number text-sm text-muted">{rhythmIncidents.length}</span></div><div className="max-h-72 divide-y overflow-auto">{rhythmIncidents.map((incident) => <article key={String(incident.id)} className="p-4"><div className="flex items-start gap-2"><Clock3 className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" /><div><p className="text-sm font-semibold text-ink">{String(incident.name)}</p><p className="mt-0.5 text-sm text-ink-2">{incidentLabel(String(incident.type), Number(incident.duration_ms), incident.meta as Record<string, unknown> | undefined)}</p><p className="mt-1 text-xs text-muted">Observación automática · {timeFormatter.format(Number(incident.at))}</p></div></div></article>)}</div></section> : null}
      </div>

      <aside className="rounded-md border border-warn/25 bg-paper p-4 text-sm leading-relaxed text-ink-2"><strong className="text-ink">Los avisos necesitan contexto.</strong> Cambiar de Wi-Fi, perder conexión o alternar ventanas puede generar señales legítimas. Testra nunca cambia una nota automáticamente por estos eventos. <a href="/docs/vigilancia" className="font-semibold text-brand underline-offset-2 hover:underline">Qué significa cada aviso</a>.</aside>
    </div>
  );
}

function formatTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function Status({ value }: { value: string }) {
  const labels: Record<string, string> = { waiting: "Sin iniciar", active: "Rindiendo", disconnected: "Desconectado", submitted: "Entregó", expired: "No inició" };
  return <span className={`rounded-sm border px-1.5 py-0.5 text-xs font-semibold ${value === "active" ? "border-ok/25 text-ok" : value === "disconnected" ? "border-alert/25 text-alert" : "text-ink-2"}`}>{labels[value] ?? value}</span>;
}

function incidentLabel(type: string, durationMs: number, meta?: Record<string, unknown>) {
  const duration = durationMs > 0 ? ` (${(durationMs / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} s)` : "";
  // Para el portapapeles la duración no dice nada; lo que importa es el tamaño.
  const detalle = type === "atajo-copiar-pegar" ? clipboardDetail(meta) : "";
  return `${copyForIncident(type).title}${duration}${detalle ? ` · ${detalle}` : ""}`;
}

function timelineLabel(type: string) {
  const labels: Record<string, string> = { "exam-started": "Comenzó la evaluación", "attempt-started": "Inició su intento", "attempt-window-expired": "No inició dentro de la ventana", submitted: "Entregó", "extra-time-changed": "Se cambió el tiempo extra", "submission-reopened": "Se reabrió la entrega", disconnected: "Se desconectó", reconnected: "Se reconectó" };
  return labels[type] ?? type;
}
