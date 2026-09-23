import { useEffect, useId, useRef } from "react";
import { AlertTriangle, CircleCheck, CircleX, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { FullQuestion } from "@/domain/exam";
import { demoResult, formatClock, reportIncidentRows, type DemoAnswers, type DemoIncident } from "@/lib/demo";
import { cn } from "@/lib/utils";

interface DemoReportProps {
  questions: FullQuestion[];
  answers: DemoAnswers;
  incidents: readonly DemoIncident[];
  onRetake: () => void;
}

/** El revelado: la nota y lo que Testra registró, como lo ve el docente. */
export function DemoReport({ questions, answers, incidents, onRetake }: DemoReportProps) {
  const ids = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const result = demoResult(questions, answers);
  const rows = reportIncidentRows(incidents, questions);

  // La evaluación desapareció con la entrega: el foco arranca por el título.
  useEffect(() => headingRef.current?.focus(), []);

  return (
    <main id="contenido" className="demo-enter mx-auto w-full max-w-[1020px] flex-1 px-4 py-8 lg:px-6">
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-[-.02em] text-ink outline-none">Esto vio tu docente</h1>
      <p className="mt-1 text-sm text-muted">Tu nota y cada aviso, con la pregunta en la que estabas.</p>

      <div className="mt-6 grid items-start gap-5 lg:grid-cols-2">
        <section aria-labelledby={`${ids}-nota`} className="rounded-lg border bg-paper shadow-card">
          <div className="border-b px-5 py-3.5"><h2 id={`${ids}-nota`} className="font-semibold text-ink">Cómo te fue</h2></div>
          <div className="px-5 pt-5 pb-3">
            <p className="mono-number text-4xl leading-none font-semibold tracking-[-.02em] text-ink">{result.percent}%</p>
            <p className="mt-2 text-sm text-ink-2">{result.correctCount} de {questions.length} correctas</p>
          </div>
          <ol className="divide-y border-t">
            {result.rows.map((row) => (
              <li key={row.number} className="flex items-start gap-3 px-5 py-3 text-sm leading-5">
                <span className="mono-number w-3 shrink-0 text-muted"><span className="sr-only">Pregunta </span>{row.number}</span>
                {row.correct
                  ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden="true" />
                  : <CircleX className="mt-0.5 size-4 shrink-0 text-alert" aria-hidden="true" />}
                <div className="min-w-0">
                  <p className={cn(row.answered ? "text-ink" : "text-muted")}>
                    <span className="sr-only">{row.correct ? "Bien: " : "Mal: "}</span>
                    {row.answered ? row.answer : "Sin responder"}
                  </p>
                  {row.correct ? null : <p className="mt-0.5 text-muted">Correcta: <span className="text-ok">{row.correctAnswer}</span></p>}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div>
          <section aria-labelledby={`${ids}-avisos`} className="rounded-lg border bg-paper shadow-card">
            <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
              <h2 id={`${ids}-avisos`} className="font-semibold text-ink">Lo que registró Testra</h2>
              <span className={cn("mono-number rounded-sm border px-1.5 py-0.5 text-xs font-semibold", rows.length ? "border-warn/30 bg-warn/5 text-warn" : "text-muted")}>{rows.length}</span>
            </div>
            {/* Una línea por aviso, a propósito. En el producto el docente ve cada
                uno completo (IncidentList): qué es, qué otras causas puede tener y
                qué conviene revisar. Acá sobra: lo que importa es ver que quedó
                registrado y en qué pregunta. */}
            {rows.length ? (
              <ol className="divide-y">
                {rows.map((row) => (
                  <li key={row.id} className="flex items-start gap-2.5 px-5 py-3">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm leading-5 text-ink">{row.label}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {row.questionNumber === null ? "Sin pregunta" : `Pregunta ${row.questionNumber}`} · <span className="tabular">{formatClock(row.at)}</span>
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-5 py-8 text-center text-sm leading-6 text-muted">No hubo avisos. Rendí de nuevo y probá cambiar de pestaña o pegar una respuesta.</p>
            )}
          </section>
          <p className="mt-3 px-1 text-xs leading-5 text-muted">Los avisos dan contexto, no prueban que alguien se copió. Nunca cambian la nota.</p>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t pt-6">
        <p className="text-sm text-ink-2">Armá tu primera evaluación con tu cuenta docente.</p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <a href="/login?modo=registro">Crear mi cuenta</a>
          </Button>
          <Button type="button" variant="outline" onClick={onRetake}>
            <RotateCcw data-icon="inline-start" />
            Rendir de nuevo
          </Button>
        </div>
      </div>
    </main>
  );
}
