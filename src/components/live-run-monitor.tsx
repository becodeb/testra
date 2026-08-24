import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock3, Minus, Plus, Radio, Square, Users } from "lucide-react";

import { Button } from "@/components/ui/button";

interface MonitorSnapshot {
  run: {
    id: string;
    code: string;
    title: string;
    status: "lobby" | "running" | "ended";
    started_at: number | null;
    ends_at: number | null;
  };
  questionCount: number;
  serverNow: number;
  participants: Array<Record<string, string | number | null>>;
  incidents: Array<Record<string, string | number | object>>;
  expected: Array<Record<string, string | null>>;
}

interface LiveRunMonitorProps {
  runId: string;
  initialSnapshot: MonitorSnapshot;
}

const timeFormatter = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function LiveRunMonitor({ runId, initialSnapshot }: LiveRunMonitorProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [now, setNow] = useState(initialSnapshot.serverNow);
  const [working, setWorking] = useState(false);

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

    // Cada mensaje del socket dispara una relectura del panel completo. Con un
    // curso entero rindiendo llegan decenas de eventos por segundo —cada
    // respuesta guardada es uno—, así que se agrupan: como mucho una relectura
    // cada 400 ms. El panel sigue sintiéndose inmediato y el servidor deja de
    // resolver la misma consulta pesada una vez por evento.
    let pending = 0;
    const scheduleRefresh = () => {
      if (pending) return;
      pending = window.setTimeout(() => {
        pending = 0;
        void refresh();
      }, 400);
    };

    socket.addEventListener("message", scheduleRefresh);
    const poll = window.setInterval(() => void refresh(), 5_000);
    return () => {
      window.clearTimeout(pending);
      window.clearInterval(poll);
      socket.close();
    };
  }, [refresh, runId]);

  const joinedEmails = useMemo(
    () => new Set(snapshot.participants.map((participant) => String(participant.email ?? "").toLocaleLowerCase())),
    [snapshot.participants],
  );
  const missing = snapshot.expected.filter((student) => !student.email || !joinedEmails.has(student.email.toLocaleLowerCase()));
  const allExpectedPresent = snapshot.expected.length === 0 || missing.length === 0;
  const remaining = snapshot.run.ends_at ? Math.max(0, Math.ceil((snapshot.run.ends_at - now) / 1000)) : null;

  async function control(action: "start" | "end" | "adjust-time", deltaS?: number) {
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

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border bg-paper p-5 shadow-card" aria-labelledby="run-title">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold tracking-[.08em] text-muted uppercase">{snapshot.run.status === "lobby" ? "Sala de espera" : snapshot.run.status === "running" ? "Evaluación en vivo" : "Evaluación finalizada"}</p>
            <h1 id="run-title" className="mt-1 text-2xl font-semibold text-ink">{snapshot.run.title}</h1>
            <p className="mt-3 text-sm text-muted">Código de ingreso</p>
            <p className="mono-number mt-1 text-3xl font-bold tracking-[.18em] text-brand" aria-label={`Código ${snapshot.run.code.split("").join(" ")}`}>{snapshot.run.code}</p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <span className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${snapshot.run.status === "running" ? "border-ok/30 text-ok" : "text-ink-2"}`}><Radio className="size-4" aria-hidden="true" /> {snapshot.run.status === "lobby" ? "Esperando" : snapshot.run.status === "running" ? "En curso" : "Cerrada"}</span>
            {remaining !== null ? <span role="timer" aria-live="off" className="mono-number inline-flex items-center gap-2 text-xl font-semibold"><Clock3 className="size-5 text-muted" aria-hidden="true" />{formatTime(remaining)}</span> : null}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4">
          {snapshot.run.status === "lobby" ? (
            <>
              <Button type="button" disabled={!allExpectedPresent || working} onClick={() => control("start")}>Iniciar evaluación</Button>
              {!allExpectedPresent ? <Button type="button" variant="outline" disabled={working} onClick={() => control("start")}>Forzar inicio con {missing.length} ausente{missing.length === 1 ? "" : "s"}</Button> : null}
            </>
          ) : snapshot.run.status === "running" ? (
            <>
              <Button type="button" variant="outline" disabled={working} onClick={() => control("adjust-time", -300)}><Minus data-icon="inline-start" /> 5 min</Button>
              <Button type="button" variant="outline" disabled={working} onClick={() => control("adjust-time", 300)}><Plus data-icon="inline-start" /> 5 min</Button>
              <Button type="button" variant="destructive" className="ms-auto" disabled={working} onClick={() => control("end")}><Square data-icon="inline-start" /> Finalizar evaluación</Button>
            </>
          ) : <a href={`/resultados?run=${encodeURIComponent(runId)}`} className="text-sm font-semibold text-brand hover:underline">Ver notas y corregir</a>}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
        <section className="overflow-hidden rounded-lg border bg-paper shadow-card" aria-labelledby="participants-title">
          <div className="flex items-center justify-between border-b px-4 py-3"><h2 id="participants-title" className="font-semibold text-ink">Alumnos</h2><span className="mono-number inline-flex items-center gap-2 text-sm text-muted"><Users className="size-4" aria-hidden="true" />{snapshot.participants.length}</span></div>
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full min-w-[580px] text-left text-sm">
              <thead className="sticky top-0 bg-inset text-xs text-ink-2"><tr><th className="px-4 py-2.5">Alumno</th><th className="px-4 py-2.5">Estado</th><th className="px-4 py-2.5 text-right">Avance</th><th className="px-4 py-2.5 text-right">Puntaje</th><th className="px-4 py-2.5 text-right">Última señal</th></tr></thead>
              <tbody className="divide-y">
                {snapshot.participants.map((participant) => <tr key={String(participant.id)}><th scope="row" className="px-4 py-3 font-medium text-ink">{String(participant.name)}</th><td className="px-4 py-3"><Status value={String(participant.status)} /></td><td className="mono-number px-4 py-3 text-right">{Number(participant.answered)}/{snapshot.questionCount}</td><td className="mono-number px-4 py-3 text-right">{participant.score === null ? "—" : `${Number(participant.percent ?? 0)}%`}{Number(participant.pending_manual) ? " + pendiente" : ""}</td><td className="mono-number px-4 py-3 text-right text-muted">{timeFormatter.format(Number(participant.last_seen))}</td></tr>)}
                {!snapshot.participants.length ? <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">Todavía no ingresó ningún alumno.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {missing.length ? <div className="border-t bg-inset px-4 py-3"><p className="text-xs font-semibold text-ink-2">Faltan: {missing.map((student) => student.name).join(", ")}</p></div> : null}
        </section>

        <section className="rounded-lg border bg-paper shadow-card" aria-labelledby="incidents-title">
          <div className="flex items-center justify-between border-b px-4 py-3"><div><h2 id="incidents-title" className="font-semibold text-ink">Avisos de actividad</h2><p className="mt-0.5 text-xs text-muted">Señales para revisar; no prueban una conducta por sí solas.</p></div><span className="mono-number text-sm text-warn">{snapshot.incidents.length}</span></div>
          <div className="max-h-[32rem] divide-y overflow-auto">
            {snapshot.incidents.map((incident) => <article key={String(incident.id)} className="p-4"><div className="flex items-start gap-2"><AlertTriangle className={`mt-0.5 size-4 shrink-0 ${incident.source === "server" ? "text-alert" : "text-warn"}`} aria-hidden="true" /><div><p className="text-sm font-semibold text-ink">{String(incident.name)}</p><p className="mt-0.5 text-sm text-ink-2">{incidentLabel(String(incident.type), Number(incident.duration_ms))}</p><p className="mt-1 text-xs text-muted">{incident.source === "server" ? "Detectado automáticamente" : "Informado por el navegador"} · {timeFormatter.format(Number(incident.at))}</p></div></div></article>)}
            {!snapshot.incidents.length ? <p className="p-6 text-center text-sm text-muted">No hay avisos registrados.</p> : null}
          </div>
        </section>
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
  const labels: Record<string, string> = { waiting: "En espera", active: "Rindiendo", disconnected: "Desconectado", submitted: "Entregó" };
  return <span className={`rounded-sm border px-1.5 py-0.5 text-xs font-semibold ${value === "active" ? "border-ok/25 text-ok" : value === "disconnected" ? "border-alert/25 text-alert" : "text-ink-2"}`}>{labels[value] ?? value}</span>;
}

function incidentLabel(type: string, durationMs: number) {
  const labels: Record<string, string> = {
    "cambio-de-pestana": "Cambió de pestaña",
    "ventana-sin-foco": "La ventana perdió el foco",
    "atajo-f12": "Usó F12",
    "atajo-copiar-pegar": "Usó el portapapeles",
    "salida-pantalla-completa": "Salió de pantalla completa",
    "cierre-pestana": "Cerró u ocultó la pestaña",
    desconexion: "Se perdió la conexión por unos segundos",
    "sesion-duplicada": "Abrió una segunda sesión",
    "cambio-ip": "Cambió de red o conexión (por ejemplo, Wi-Fi a datos)",
    "cambio-user-agent": "Volvió a entrar desde otro navegador o dispositivo",
    "cadencia-respuestas": "Cadencia de respuestas inusual",
  };
  const duration = durationMs > 0 ? ` (${(durationMs / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} s)` : "";
  return `${labels[type] ?? type}${duration}`;
}
