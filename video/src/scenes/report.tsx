import { BrainCircuit, XIcon } from "lucide-react";

import { IncidentList, type Incident } from "@/components/incident-list";
import { Button } from "@/components/ui/button";

import { clockMs, dateLabel, EXAM, LUCIA, LUCIA_ANSWERS, STUDENTS } from "../data";
import { EASE, progress } from "../motion";
import { REPORT_VIEWPORT, reportScrollAt } from "../report-scroll";
import { anchor, useScene } from "../scene-context";
import { T } from "../timeline";

/** Lucía's two incidents, as the server hands them to the report. */
const INCIDENTS: Incident[] = [
  { id: "i-1", at: clockMs(T.back), duration_ms: 4300, type: "cambio-de-pestana", source: "client", questionNumber: 2, questionPrompt: EXAM.questions[1].prompt },
  { id: "i-2", at: clockMs(T.signalPaste), duration_ms: 0, type: "atajo-copiar-pegar", source: "client", questionNumber: 3, questionPrompt: EXAM.questions[2].prompt, meta: { action: "paste", characters: 12 } },
];

const TIMELINE = [
  { label: "Comenzó la evaluación", at: clockMs(T.clickStart) },
  { label: "Entregó", at: clockMs(T.clickEnd) },
];

/**
 * The student detail dialog of results-workspace.tsx (~lines 700–745) for
 * Lucía. Its body scrolls to "Avisos (2)", rendered by the real IncidentList.
 */
export function ReportDialog() {
  const { t, anchors } = useScene();
  if (t < T.reportOpen || t >= T.act4Swap) return null;
  const open = EASE.app(progress(t, T.reportOpen, T.reportOpen + 0.2));
  const scroll = reportScrollAt(t, anchors);
  const student = STUDENTS[LUCIA];
  const answered = [2, 2, null];
  return (
    <div className="absolute inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" style={{ opacity: open }} aria-hidden="true" />
      <div className="absolute inset-0 grid place-items-center px-4">
        <div className="w-full max-w-4xl" style={{ opacity: open, transform: `scale(${(0.95 + 0.05 * open).toFixed(4)})` }} {...anchor("report-dialog")}>
          <div role="dialog" data-slot="dialog-content" className="relative overflow-hidden rounded-lg border bg-background shadow-lg" style={{ height: REPORT_VIEWPORT }}>
            <div className="relative grid gap-4 p-6" style={{ transform: `translateY(${(-scroll).toFixed(2)}px)` }} {...anchor("report-inner")}>
              <div data-slot="dialog-header" className="flex flex-col gap-2 text-left">
                <h2 className="text-lg leading-none font-semibold">{student.name}</h2>
                <p className="text-sm text-muted-foreground">Respuestas, corrección e incidentes ubicados en la pregunta activa.</p>
              </div>
              <div className="grid gap-6">
                <section>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-ink">Respuestas</h3>
                    <Button variant="outline" size="sm"><BrainCircuit />Analizar incidentes</Button>
                  </div>
                  <div className="mt-3 divide-y rounded-md border">
                    {EXAM.questions.map((question, i) => (
                      <article key={question.prompt} className="p-4">
                        <div className="flex justify-between gap-3">
                          <div className="text-sm font-semibold text-ink"><span>{i + 1}. </span><div className="rich-content inline">{question.prompt}</div></div>
                          <span className="mono-number shrink-0 text-sm font-semibold">{answered[i] ?? "—"}/{question.points}</span>
                        </div>
                        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                          <div><dt className="text-xs text-muted">Respondió</dt><dd className="mt-1 text-ink-2">{LUCIA_ANSWERS[i]}</dd></div>
                          {i < 2 ? <div><dt className="text-xs text-muted">Respuesta esperada</dt><dd className="mt-1 text-ink-2">{i === 0 ? "Fotosíntesis" : "clorofila"}</dd></div> : null}
                        </dl>
                      </article>
                    ))}
                  </div>
                </section>
                <section>
                  <h3 className="font-semibold text-ink">Línea de tiempo</h3>
                  <ol className="mt-3 grid gap-2 rounded-md border p-4">
                    {TIMELINE.map((event) => (
                      <li key={event.label} className="flex items-start justify-between gap-3 text-sm">
                        <span>{event.label}</span>
                        <time className="mono-number shrink-0 text-xs text-muted">{dateLabel(event.at)}</time>
                      </li>
                    ))}
                  </ol>
                </section>
                <section {...anchor("report-avisos")} data-anchor-each="report-card" data-anchor-select="article">
                  <h3 className="font-semibold text-ink">Avisos ({INCIDENTS.length})</h3>
                  <IncidentList incidents={INCIDENTS} />
                </section>
              </div>
              <span className="absolute top-4 right-4 rounded-xs opacity-70 [&_svg]:size-4" aria-hidden="true"><XIcon /></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
