import { AlertTriangle, Clock3, Link2, Minus, Plus, Radio, Square, Users } from "lucide-react";

import { Button } from "@/components/ui/button";

import { clockLabel, EXAM, formatTime, percent, STUDENTS, TOMAS } from "../data";
import { enter, EASE, fadeIn, fadeOut, progress, spring, SPRINGS, swap } from "../motion";
import { anchor, useControl, useScene } from "../scene-context";
import { codeKeyTimes, entregoTimes, progressTicks, rindiendoTimes, T } from "../timeline";

type RunStatus = "lobby" | "running" | "ended";

export function runStatus(t: number): RunStatus {
  if (t < T.runningSwap) return "lobby";
  if (t < T.endedSwap) return "running";
  return "ended";
}

/** Seconds left on the timer: runs from the start click, freezes at the end click. */
function remaining(t: number) {
  const elapsed = Math.floor(Math.min(t, T.clickEnd) - T.clickStart);
  return EXAM.timeLimitS - Math.max(0, elapsed);
}

/** When each row appears in the table: row 1 lands from the join card. */
export const rowEnterTimes = [T.morphRowEnd, ...T.rowsEnter];

type ParticipantStatus = "waiting" | "active" | "submitted";

function participantStatus(t: number, i: number): { value: ParticipantStatus; swapAt: number } {
  if (t >= entregoTimes[i]) return { value: "submitted", swapAt: entregoTimes[i] };
  if (t >= rindiendoTimes[i]) return { value: "active", swapAt: rindiendoTimes[i] };
  return { value: "waiting", swapAt: -1 };
}

/** Status of live-run-monitor.tsx. */
function Status({ value }: { value: ParticipantStatus }) {
  const labels: Record<ParticipantStatus, string> = { waiting: "Sin iniciar", active: "Rindiendo", submitted: "Entregó" };
  return <span className={`rounded-sm border px-1.5 py-0.5 text-xs font-semibold ${value === "active" ? "border-ok/25 text-ok" : "text-ink-2"}`}>{labels[value]}</span>;
}

function SwapStatus({ t, i }: { t: number; i: number }) {
  const now = participantStatus(t, i);
  const s = swap(t, now.swapAt);
  const previous: ParticipantStatus = now.value === "submitted" ? "active" : "waiting";
  return <span className="inline-block" style={s.style}><Status value={s.showNew ? now.value : previous} /></span>;
}

function answered(t: number, i: number) {
  return progressTicks[i].filter((tick) => t >= tick).length;
}

function lastSeen(t: number, i: number) {
  const joined = rowEnterTimes[i];
  if (t < T.clickStart) return clockLabel(joined);
  const beat = STUDENTS[i].beat;
  const at = Math.min(t, T.clickEnd);
  return clockLabel(Math.max(joined, Math.floor((at - beat) / 2) * 2 + beat));
}

export function Row({ i, force = false, hideName = false }: { i: number; force?: boolean; hideName?: boolean }) {
  const { t } = useScene();
  const student = STUDENTS[i];
  const status = runStatus(t);
  const enterAt = rowEnterTimes[i];
  // Row 1 is revealed by the morph box; the rest rise in on their beat.
  const shown = force ? { opacity: 1 } : i === 0 ? { opacity: t >= T.morphRowEnd - 0.05 ? 1 : 0 } : t < enterAt ? { opacity: 0 } : enter(t, enterAt, 10, SPRINGS.ui);
  // Collapsed table borders ignore the row's opacity, so the divider fades explicitly.
  const style = { ...shown, borderBottomColor: `rgba(227,230,235,${shown.opacity.toFixed(3)})` };
  const n = answered(t, i);
  const answeredSwap = swap(t, progressTicks[i][Math.max(0, n - 1)] ?? -1, 0.1);
  const scoreSwap = swap(t, entregoTimes[i]);
  const ended = t >= entregoTimes[i];
  return (
    <tr style={style} {...anchor(`room-row-${i}`)}>
      <th scope="row" className="px-4 py-3 font-medium text-ink"><button type="button" style={hideName ? { visibility: "hidden" } : undefined} {...(i === 0 ? anchor("room-row-0-name") : {})}>{student.name}</button></th>
      <td className="px-4 py-3"><SwapStatus t={t} i={i} /></td>
      <td className="mono-number px-4 py-3 text-right"><span className="inline-block" style={n ? answeredSwap.style : undefined}>{answeredSwap.showNew || !n ? n : n - 1}/{EXAM.questions.length}</span></td>
      <td className="mono-number px-4 py-3 text-right"><span className="inline-block" style={ended ? scoreSwap.style : undefined}>{ended && scoreSwap.showNew ? `${percent(student.auto)}% + pendiente` : "—"}</span></td>
      <td className="mono-number px-4 py-3 text-right">base</td>
      <td className="mono-number px-4 py-3 text-right whitespace-nowrap text-muted">{lastSeen(t, i)}</td>
      <td className="px-4 py-3"><div className="flex flex-wrap items-center gap-1"><Button type="button" size="xs" variant="outline" disabled={status === "ended"}>Tiempo</Button></div></td>
    </tr>
  );
}

/** The run card of live-run-monitor.tsx; also drawn inside the morph box. */
export function RoomCard() {
  const { t } = useScene();
  const status = runStatus(t);
  const typed = codeKeyTimes.filter((k) => t >= k).length;
  const eyebrowSwap = t >= T.endedSwap ? swap(t, T.endedSwap) : swap(t, T.runningSwap);
  const eyebrowNow = status === "ended" ? "Evaluación finalizada" : status === "running" ? "Evaluación en vivo" : "Sala de espera";
  const eyebrowOld = status === "ended" ? "Evaluación en vivo" : "Sala de espera";
  const pillNow = status === "lobby" ? "Esperando" : status === "running" ? "En curso" : "Cerrada";
  const pillOld = status === "ended" ? "En curso" : "Esperando";
  const pillShowNew = eyebrowSwap.showNew;
  const pillLabel = pillShowNew ? pillNow : pillOld;
  const pillRunning = pillLabel === "En curso";
  const timerIn = fadeIn(t, T.runningSwap, 0.2);
  const controlsSwap = t >= T.endedSwap ? swap(t, T.endedSwap) : swap(t, T.runningSwap);
  const controls = controlsSwap.showNew ? status : status === "ended" ? "running" : "lobby";
  const startHover = useControl("btn-start", "bg-primary/90");
  const endHover = useControl("btn-end", "bg-destructive/90");

  return (
    <section className="rounded-lg border bg-paper p-5 shadow-card" aria-labelledby="run-title">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="text-xs font-semibold tracking-[.08em] text-muted uppercase" style={eyebrowSwap.style}>{eyebrowSwap.showNew ? eyebrowNow : eyebrowOld}</p>
          <h1 id="run-title" className="mt-1 text-2xl font-semibold text-ink">{EXAM.title}</h1>
          <p className="mt-3 text-sm text-muted">Código de ingreso</p>
          <p className="mono-number mt-1 text-3xl font-bold tracking-[.18em] text-brand" aria-label={`Código ${EXAM.code.split("").join(" ")}`} {...anchor("room-code")}>
            <span {...anchor("room-code-text")}>{EXAM.code.slice(0, typed)}</span>
            <span className="invisible">{EXAM.code.slice(typed) || "​"}</span>
          </p>
          <Button type="button" variant="outline" size="sm" className="mt-3"><Link2 data-icon="inline-start" aria-hidden="true" />Copiar link de ingreso</Button>
        </div>
        <div className="flex flex-col items-end gap-3">
          <span className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${pillRunning ? "border-ok/30 text-ok" : "text-ink-2"}`} {...anchor("room-pill")}>
            <Radio className="size-4" aria-hidden="true" /> <span style={eyebrowSwap.style}>{pillLabel}</span>
          </span>
          {status !== "lobby" ? (
            <div className="text-right" style={{ opacity: timerIn }}>
              <span className="text-xs text-muted">Tiempo restante</span>
              <span role="timer" className="mono-number mt-1 flex items-center gap-2 text-xl font-semibold"><Clock3 className="size-5 text-muted" aria-hidden="true" />{formatTime(remaining(t))}</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4" {...anchor("room-controls")}>
        <div className="flex w-full flex-wrap items-center gap-2" style={controlsSwap.style}>
          {controls === "lobby" ? (
            <span {...anchor("btn-start")} className="inline-flex"><Button type="button" className={startHover}>Iniciar evaluación</Button></span>
          ) : controls === "running" ? (
            <>
              <Button type="button" variant="outline"><Minus data-icon="inline-start" /> 5 min</Button>
              <Button type="button" variant="outline"><Plus data-icon="inline-start" /> 5 min</Button>
              <span {...anchor("btn-end")} className="ms-auto inline-flex"><Button type="button" variant="destructive" className={endHover}><Square data-icon="inline-start" /> Finalizar evaluación</Button></span>
            </>
          ) : (
            <a className="text-sm font-semibold text-brand">Ver notas y corregir</a>
          )}
        </div>
      </div>
    </section>
  );
}

function ParticipantCount() {
  const { t } = useScene();
  // Ticks as each row lands: Lucía when the morph box settles, the rest once risen in.
  const ticks = [T.morphRowEnd - 0.17, ...T.rowsEnter.map((k) => k + 0.1)];
  const count = ticks.filter((k) => t >= k).length;
  const last = [...ticks].reverse().find((k) => t >= k) ?? -1;
  const s = swap(t, last, 0.1);
  return <span className="mono-number inline-flex items-center gap-2 text-sm text-muted"><Users className="size-4" aria-hidden="true" /><span className="inline-block" style={s.style}>{s.showNew ? count : Math.max(0, count - 1)}</span></span>;
}

function Signal() {
  const { t, anchors } = useScene();
  const inner = anchors["signal-inner"]?.h ?? 96;
  const p = spring(t - T.signal, SPRINGS.soft);
  const o = EASE.app(progress(t, T.signal + 0.04, T.signal + 0.22));
  const incident = STUDENTS[TOMAS];
  return (
    <div style={{ height: t < T.signal ? 0 : inner * p, overflow: "hidden" }}>
      <article className="p-4" {...anchor("signal-inner")} style={{ opacity: o, transform: `translateY(${((1 - p) * -6).toFixed(3)}px)` }}>
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-ink">{incident.name}</p>
            <p className="mt-0.5 text-sm text-ink-2">La evaluación dejó de estar visible (4,2 s)</p>
            <p className="mt-1 text-xs text-muted">Informado por el navegador · {clockLabel(T.signal)}</p>
          </div>
        </div>
      </article>
    </div>
  );
}

export function RoomScreen() {
  const { t } = useScene();
  const counter = swap(t, T.signal);
  const emptyRows = fadeOut(t, T.morphRow - 0.1, 0.1);
  const emptySignals = t < T.signal ? fadeOut(t, T.signal - 0.1, 0.1) : 0;
  const part = (i: number) => enter(t, T.morphRoomEnd + i * 0.125, 14, SPRINGS.soft);
  const cardVisible = t >= T.morphRoomEnd - 0.1;

  return (
    <main className="mx-auto w-full max-w-[1280px] px-4 py-7 lg:px-6">
      <div className="grid gap-5">
        <div {...anchor("room-card")} style={{ opacity: cardVisible ? 1 : 0 }}>
          <RoomCard />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
          <section className="overflow-hidden rounded-lg border bg-paper shadow-card" aria-labelledby="participants-title" style={part(0)} {...anchor("room-table")}>
            <div className="flex items-center justify-between border-b px-4 py-3"><h2 id="participants-title" className="font-semibold text-ink">Alumnos</h2><ParticipantCount /></div>
            <div className="relative">
              <table className="w-full min-w-[580px] text-left text-sm">
                <thead className="bg-inset text-xs text-ink-2"><tr>{["Alumno", "Estado", "Avance", "Puntaje", "Tiempo", "Última señal", "Acciones"].map((label, c) => <th key={label} className={`px-4 py-2.5${c >= 2 && c <= 5 ? " text-right" : ""}`} {...anchor(`room-col-${c}`)}>{label}</th>)}</tr></thead>
                <tbody className="divide-y">
                  {STUDENTS.map((_, i) => <Row key={i} i={i} />)}
                </tbody>
              </table>
              {emptyRows > 0 ? <p className="absolute inset-x-0 top-[2.3rem] px-4 py-10 text-center text-sm text-muted" style={{ opacity: emptyRows }}>Todavía no ingresó ningún alumno.</p> : null}
            </div>
          </section>

          <section className="rounded-lg border bg-paper shadow-card" aria-labelledby="incidents-title" style={part(1)} {...anchor("avisos")}>
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div><h2 id="incidents-title" className="font-semibold text-ink">Avisos de actividad</h2><p className="mt-0.5 text-xs text-muted">Señales para revisar; no prueban una conducta por sí solas.</p></div>
              <span className="mono-number text-sm text-warn"><span className="inline-block" style={counter.style}>{counter.showNew ? 1 : 0}</span></span>
            </div>
            <div className="divide-y">
              {t < T.signal ? <p className="p-6 text-center text-sm text-muted" style={{ opacity: emptySignals }}>No hay avisos de actividad registrados.</p> : <Signal />}
            </div>
          </section>
        </div>

        <aside className="rounded-md border border-warn/25 bg-paper p-4 text-sm leading-relaxed text-ink-2" style={part(2)}><strong className="text-ink">Los avisos necesitan contexto.</strong> Cambiar de Wi-Fi, perder conexión o alternar ventanas puede generar señales legítimas. Testra nunca cambia una nota automáticamente por estos eventos. <a className="font-semibold text-brand underline-offset-2">Qué significa cada aviso</a>.</aside>
      </div>
    </main>
  );
}
