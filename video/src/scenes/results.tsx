import { BadgeCheck, BarChart3, CalendarDays, CheckCircle2, ChevronRight, History, ListChecks, LoaderCircle, Send, SquarePen } from "lucide-react";

import { Button } from "@/components/ui/button";

import { dateLabel, EXAM, percent, PUBLISHED_MS, SESSION_MS, SOFIA, STUDENTS } from "../data";
import { enter, fadeIn, SPRINGS, swap } from "../motion";
import { anchor, useControl, useScene } from "../scene-context";
import { T } from "../timeline";

const SESSIONS_TOTAL = 6;
const attemptFormatter = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const attemptLabel = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return attemptFormatter.format(Date.UTC(2026, 8, 25, h + 3, m, 0));
};

/** publish-results.tsx, not linked to Classroom. */
function PublishResults({ pendingManual }: { pendingManual: number }) {
  const { t } = useScene();
  const working = t >= T.clickPublish + 0.06 && t < T.published;
  const published = t >= T.published;
  const blocked = pendingManual > 0;
  const hover = useControl("btn-publish", "bg-primary/90");
  const textSwap = t >= T.published ? swap(t, T.published) : swap(t, T.publishEnabled);
  const text = published && textSwap.showNew
    ? `Resultados publicados el ${dateLabel(PUBLISHED_MS)}.`
    : t >= T.publishEnabled && (textSwap.showNew || published)
      ? "Al publicar, los resultados quedan definitivos."
      : "Faltan corregir 1 respuesta de desarrollo.";
  const enabledP = fadeIn(t, T.publishEnabled);
  const opacity = blocked ? 0.5 : working ? 0.5 : 0.5 + 0.5 * enabledP;
  const chipSwap = swap(t, T.published);
  const spin = ((t - T.clickPublish) / 1) * 360;

  return (
    <section className="border-b bg-inset/40 px-5 py-4" aria-labelledby="publish-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id="publish-title" className="flex items-center gap-2 text-sm font-semibold text-ink"><BadgeCheck className="size-4 text-brand" aria-hidden="true" />Cierre de la corrección</h3>
          <p className="mt-1 text-sm text-muted"><span className="inline-block" style={textSwap.style}>{text}</span></p>
        </div>
        <div className="flex h-9 items-center" style={chipSwap.style}>
          {!chipSwap.showNew ? (
            <span {...anchor("btn-publish")} className="inline-flex">
              <Button type="button" className={blocked ? "" : hover} style={{ opacity }}>
                {working ? <LoaderCircle data-icon="inline-start" style={{ transform: `rotate(${spin.toFixed(1)}deg)` }} /> : <Send data-icon="inline-start" />}
                Publicar resultados
              </Button>
            </span>
          ) : (
            <span className="rounded-sm border border-ok/25 px-2 py-1 text-xs font-semibold text-ok">Publicados</span>
          )}
        </div>
      </div>
    </section>
  );
}

export function ResultRow({ i, landed, force = false }: { i: number; landed: boolean; force?: boolean }) {
  const { t } = useScene();
  const s = STUDENTS[i];
  const pending = i === SOFIA && !landed;
  const score = pending ? s.auto : s.auto + s.long;
  const isTarget = i === SOFIA;
  // Sofía's slot is filled by the morph; the other rows populate around it as it
  // lands, so the flying card never passes over their text.
  const order = i < SOFIA ? i : i - 1;
  const shown = force ? { opacity: 1 } : isTarget ? { opacity: t >= T.morphResultsEnd - 0.05 ? 1 : 0 } : t < T.morphResultsEnd - 0.05 ? { opacity: 0 } : enter(t, T.morphResultsEnd - 0.05 + order * 0.0625, 8, SPRINGS.ui);
  // Collapsed table borders ignore the row's opacity, so the divider fades explicitly.
  const style = { ...shown, borderBottomColor: `rgba(227,230,235,${shown.opacity.toFixed(3)})` };
  return (
    <tr className="hover:bg-canvas" style={style} {...anchor(`results-row-${i}`)}>
      <th scope="row" className="px-4 py-3"><button className="font-semibold text-brand">{s.name}</button></th>
      <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ok"><CheckCircle2 className="size-3.5" />{pending ? "Entregó" : "Corregida"}</span></td>
      <td className="mono-number px-4 py-3 text-xs whitespace-nowrap text-muted">{attemptLabel(s.started)}</td>
      <td className="mono-number px-4 py-3 text-xs whitespace-nowrap text-muted">{attemptLabel(s.submitted)}</td>
      <td className="mono-number px-4 py-3 text-right text-xs text-muted">{s.minutes} min</td>
      <td className="mono-number px-4 py-3 text-right">3/3</td>
      <td className="px-4 py-3 text-right">
        <span className="mono-number text-base font-semibold text-ink">{percent(score)}%</span>
        <span className="mono-number mt-0.5 block text-xs text-muted">{score}/{EXAM.totalPoints} puntos</span>
        {pending ? <span className="mt-0.5 block text-xs text-warn">Falta corrección manual</span> : null}
      </td>
    </tr>
  );
}

export function ResultsScreen() {
  const { t } = useScene();
  const landed = t >= T.morphResultsEnd;
  const pendingManual = landed ? 0 : 1;
  const part = (i: number) => enter(t, T.morphResults + 0.05 + i * 0.0625, 12, SPRINGS.soft);
  const tabs = [
    { id: "notas", label: "Notas", icon: ListChecks },
    { id: "correcciones", label: "Correcciones", icon: SquarePen },
    { id: "analisis", label: "Análisis", icon: BarChart3 },
  ] as const;

  return (
    <main className="mx-auto w-full max-w-[1280px] px-4 py-7 lg:px-6">
      <section className="grid gap-6" aria-labelledby="results-title">
        <header style={part(0)}>
          <p className="text-xs font-semibold tracking-[.08em] text-muted uppercase">Por evaluación</p>
          <h1 id="results-title" className="mt-1 text-2xl font-semibold tracking-[-.02em] text-ink">Resultados y correcciones</h1>
          <p className="mt-1 text-sm text-muted">Abrí un alumno para revisar cada respuesta, nota, aviso y su contexto exacto.</p>
        </header>
        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          <nav className="h-fit overflow-hidden rounded-lg border bg-paper shadow-card" aria-label="Sesiones por corregir" style={part(1)}>
            <div className="flex items-center justify-between gap-2 border-b bg-inset px-4 py-3">
              <p className="text-xs font-semibold text-ink-2">{pendingManual ? "Por corregir" : "Sesiones"}</p>
              {pendingManual ? <span className="mono-number rounded-sm bg-warn/15 px-1.5 py-0.5 text-xs font-semibold text-warn">{pendingManual}</span> : null}
            </div>
            <div className="divide-y">
              <a aria-current="page" className="flex items-center gap-3 bg-brand-soft px-4 py-3 text-brand-deep">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{EXAM.title}</span>
                  <span className="mt-1 flex items-center gap-1 text-xs text-muted"><CalendarDays className="size-3" />{dateLabel(SESSION_MS)}</span>
                </span>
                {pendingManual ? <span className="mono-number shrink-0 rounded-sm bg-warn/15 px-1.5 py-0.5 text-xs font-semibold text-warn">{pendingManual}</span> : null}
                <ChevronRight className="size-4 shrink-0" />
              </a>
            </div>
            <button type="button" className="flex w-full items-center justify-center gap-2 border-t px-4 py-3 text-sm font-semibold text-brand"><History className="size-4" aria-hidden="true" />Ver todas ({SESSIONS_TOTAL})</button>
          </nav>

          <div className="min-w-0 space-y-6" {...anchor("results-main")}>
            <section className="overflow-hidden rounded-lg border bg-paper shadow-card" style={part(2)}>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5">
                <div>
                  <p className="mono-number text-xs font-semibold tracking-[.08em] text-brand uppercase">Código {EXAM.code}</p>
                  <h2 className="mt-1 text-xl font-semibold text-ink">{EXAM.title}</h2>
                  <p className="mt-1 text-sm text-muted"><span {...anchor("results-points")}>{EXAM.totalPoints} puntos · {EXAM.questions.length} preguntas</span></p>
                </div>
                <div className="flex gap-2"><a className="inline-flex h-9 items-center px-2 text-sm font-semibold text-brand">Ver sesión</a></div>
              </div>
              <div role="tablist" aria-label="Vistas de la toma" className="flex gap-1 bg-inset px-3">
                {tabs.map((item) => {
                  const current = item.id === "notas";
                  const badge = item.id === "correcciones" ? pendingManual : 0;
                  return (
                    <button key={item.id} type="button" role="tab" aria-selected={current} className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold whitespace-nowrap ${current ? "border-brand text-brand-deep" : "border-transparent text-ink-2"}`}>
                      <item.icon className="size-4" />
                      {item.label}
                      {badge ? <span className="mono-number rounded-full bg-warn/15 px-1.5 py-0.5 text-[.7rem] font-bold text-warn">{badge}</span> : null}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border bg-paper shadow-card" style={{ opacity: fadeIn(t, T.morphResults + 0.2, 0.2) }} {...anchor("results-notas")}>
              {/* The section's text populates once the flying card has landed, so it never passes over text. */}
              <div style={{ opacity: fadeIn(t, T.morphResultsEnd - 0.05, 0.15) }}>
                <PublishResults pendingManual={pendingManual} />
              </div>
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-inset text-xs text-ink-2" style={{ opacity: fadeIn(t, T.morphResultsEnd - 0.05, 0.15) }}>
                  <tr>
                    {["Alumno", "Estado", "Inicio", "Entrega", "Tiempo", "Respondidas", "Nota"].map((label, c) => (
                      <th key={label} className={`px-4 py-3${c >= 4 ? " text-right" : ""}`} {...anchor(`results-col-${c}`)}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {STUDENTS.map((_, i) => <ResultRow key={i} i={i} landed={landed} />)}
                </tbody>
              </table>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
