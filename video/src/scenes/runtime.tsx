import { ArrowLeft, ArrowRight, Check, CircleAlert, Clock3, Type, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { studentIncidentMessage } from "@/lib/incident-copy";
import { cn } from "@/lib/utils";

import { EXAM, formatTime } from "../data";
import { EASE, lerp, progress } from "../motion";
import { anchor, useControl, useScene } from "../scene-context";
import { ANSWER, answerKeyTimes, STUDENT_NAME, T } from "../timeline";
import { StatusBadgeAt } from "./status-badge";
import { StudentHeader } from "./student-header";

const INPUT = "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none md:text-sm";

type StudentState = "complete" | "empty";

/** question-navigator.tsx in student mode (question 2 active). */
function StudentNavigator({ states }: { states: StudentState[] }) {
  return (
    <nav aria-label="Navegación entre preguntas" className="flex flex-col gap-2 sm:gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {states.map((state, index) => {
          const active = index === 1;
          return (
            <button
              key={index}
              type="button"
              className={cn(
                "relative grid size-9 place-items-center rounded-full border text-sm font-semibold tabular",
                state === "complete" && "border-brand bg-brand-soft text-brand-deep",
                state === "empty" && "border-line-2 bg-white text-muted",
                active && "bg-brand text-white ring-2 ring-brand/25 ring-offset-2",
              )}
            >
              {index + 1}
              {!active && state === "complete" ? <Check className="absolute -right-1 -bottom-1 size-3.5 rounded-full bg-ok p-0.5 text-white" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      <div className="hidden flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted sm:flex">
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-brand" aria-hidden="true" /> Activa</span>
        <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-ok" aria-hidden="true" />Respondida</span>
        <span className="inline-flex items-center gap-1.5"><CircleAlert className="size-3.5 text-warn" aria-hidden="true" />Te falta</span>
      </div>
    </nav>
  );
}

/** The dialog of student-runtime.tsx (~line 425), for a 4,3 s absence. */
export function StudentDialog() {
  const hover = useControl("btn-understood", "bg-primary/90");
  const message = studentIncidentMessage({ type: "cambio-de-pestana", durationMs: 4300, meta: {} });
  return (
    <div role="dialog" data-slot="dialog-content" className="relative grid w-full gap-4 rounded-lg border bg-background p-6 shadow-lg">
      <div data-slot="dialog-header" className="flex flex-col gap-2 text-left">
        <h2 data-slot="dialog-title" className="text-lg leading-none font-semibold">Este evento quedó registrado</h2>
        <p data-slot="dialog-description" className="text-sm text-muted-foreground">
          {message} Tu docente ve el mismo registro. Los incidentes no cambian tu nota automáticamente.
        </p>
      </div>
      <div data-slot="dialog-footer" className="flex flex-row justify-end gap-2">
        <span className="inline-flex" {...anchor("btn-understood")}>
          <Button type="button" className={hover}>Entendido</Button>
        </span>
      </div>
      <span className="absolute top-4 right-4 rounded-xs opacity-70 [&_svg]:size-4" aria-hidden="true"><XIcon /></span>
    </div>
  );
}

/** student-runtime.tsx: Lucía on question 2, the short answer. */
export function Runtime() {
  const { t } = useScene();
  const q = EXAM.questions[1];
  const typed = answerKeyTimes.filter((k) => t >= k).length;
  const states: StudentState[] = ["complete", typed > 0 ? "complete" : "empty", "empty"];
  const remaining = EXAM.timeLimitS - Math.max(0, Math.floor(t - T.clickStart));
  const saving = t >= T.answerType && t < T.answerSaved;
  const incidents = t >= T.dialogOpen ? 1 : 0;
  // Focus leaves the field while she is away and while the dialog holds it.
  const focused = t < T.leave;

  // Away: the whole window recedes and dims; nothing here is Testra UI.
  const away = EASE.inOut(progress(t, T.leave, T.leave + 0.15)) * (1 - EASE.inOut(progress(t, T.back, T.back + 0.15)));
  // The real dialog: overlay fade + content zoom-in-95, 200 ms.
  const dlgIn = EASE.app(progress(t, T.dialogOpen, T.dialogOpen + 0.2));
  const dlgOut = EASE.app(progress(t, T.flyStart, T.flyStart + 0.2));
  const overlay = dlgIn * (1 - dlgOut);
  const dialogShown = t >= T.dialogOpen && t < T.flyStart;

  return (
    <div className="absolute inset-0 overflow-hidden bg-canvas">
      <div className="absolute inset-0" style={{ transform: `scale(${lerp(1, 0.96, away).toFixed(4)})`, transformOrigin: "50% 50%" }}>
        <div className="flex h-full flex-col" {...anchor("runtime-page")}>
          <StudentHeader />
          <div className="border-b bg-paper">
            <div className="mx-auto max-w-[1020px] px-4 py-3 lg:px-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0"><p className="text-xs text-muted">{STUDENT_NAME}</p><h1 className="truncate font-semibold text-ink">{EXAM.title}</h1></div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-2 text-sm text-ink-2" aria-live="polite">
                    <StatusBadgeAt t={t} loadingFrom={T.answerType} doneAt={t < T.answerType ? -10 : T.answerSaved} /> {saving ? "Guardando…" : "Guardado"}
                  </span>
                  <div className="flex items-center gap-2 rounded-md border bg-inset px-3 py-1.5"><Clock3 className="size-4 text-muted" aria-hidden="true" /><span role="timer" className="mono-number font-semibold text-ink">{formatTime(remaining)}</span></div>
                  <Button type="button" variant="outline" size="sm"><Type data-icon="inline-start" aria-hidden="true" />Lectura</Button>
                </div>
              </div>
            </div>
          </div>

          <main className="mx-auto flex w-full max-w-[1020px] flex-1 flex-col gap-5 px-4 py-6 lg:px-6" data-lectura {...anchor("runtime-main")}>
            <p className="rounded-md border bg-inset px-4 py-3 text-sm leading-relaxed text-ink-2"><strong>Indicaciones:</strong> {EXAM.instructions}</p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink-2">Pregunta 2 de {EXAM.questions.length} · <span className="mono-number">{q.points} pts</span></p>
              <div className="flex items-center gap-2"><span className="text-xs text-muted">{incidents} aviso{incidents === 1 ? "" : "s"} visible{incidents === 1 ? "" : "s"}</span></div>
            </div>
            <section className="rounded-lg border bg-paper p-5 shadow-card md:p-8" aria-labelledby="student-question">
              <div id="student-question" className="rich-content max-w-4xl text-lg font-semibold leading-relaxed text-ink"><p>{q.prompt}</p></div>
              <div className="mt-7">
                <Field>
                  <FieldLabel htmlFor="answer-q2">Tu respuesta</FieldLabel>
                  <div id="answer-q2" className={cn(INPUT, "flex items-center", focused && "border-ring ring-[3px] ring-ring/50")} {...anchor("runtime-input")}>
                    <span className="whitespace-pre">{ANSWER.slice(0, typed)}</span>
                    {focused ? <span className="scene-caret" style={{ height: 18 }} aria-hidden="true" /> : null}
                  </div>
                </Field>
              </div>
            </section>
            <div className="mt-auto rounded-lg border bg-paper p-4 shadow-card">
              <StudentNavigator states={states} />
              <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
                <Button type="button" variant="outline"><ArrowLeft data-icon="inline-start" />Anterior</Button>
                <Button type="button">Siguiente<ArrowRight data-icon="inline-end" /></Button>
              </div>
            </div>
          </main>
        </div>
      </div>

      {away > 0 ? <div className="absolute inset-0" style={{ background: `rgba(22,24,29,${(0.35 * away).toFixed(3)})` }} aria-hidden="true" /> : null}
      {overlay > 0 ? <div className="absolute inset-0 bg-black/50" style={{ opacity: overlay }} aria-hidden="true" /> : null}
      {t >= T.dialogOpen ? (
        <div className="absolute inset-0 grid place-items-center">
          <div className="w-full max-w-lg" {...anchor("student-dialog")} style={{ opacity: dialogShown ? dlgIn : 0, transform: `scale(${(0.95 + 0.05 * dlgIn).toFixed(4)})` }}>
            <StudentDialog />
          </div>
        </div>
      ) : null}
    </div>
  );
}
