import { Check, Circle, Square, X } from "lucide-react";

import { RichContent } from "@/components/rich-content";
import { formatPoints, scoreTone } from "@/lib/exam-printout";
import type { StudentResultAnswer, StudentResultQuestion, StudentResults } from "@/lib/student-results";

const toneClass = {
  full: "border-ok/30 text-ok",
  partial: "border-warn/30 text-warn",
  none: "border-alert/30 text-alert",
  pending: "border-line text-muted",
} as const;

/** Lo que el alumno ve de su examen, en el nivel que el docente haya liberado. */
export function StudentResultsView({ results }: { results: StudentResults }) {
  const { score, questions } = results;
  if (!score) return null;
  return (
    <div className="grid gap-4" data-results-level={results.level}>
      <section className="rounded-lg border bg-paper p-5 shadow-card" aria-labelledby="results-score-title">
        <h2 id="results-score-title" className="text-xs font-bold tracking-[.08em] text-muted uppercase">{score.pendingCorrections ? "Nota parcial" : "Nota final"}</h2>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="mono-number text-3xl font-bold text-ink">{score.percent}%</p>
          <p className="mono-number text-sm text-ink-2">{formatPoints(score.awarded)} de {formatPoints(score.max)} puntos</p>
          {score.passed === null ? null : <p className={`text-sm font-semibold ${score.passed ? "text-ok" : "text-alert"}`}>{score.passed ? "Aprobado" : "No aprobado"}</p>}
        </div>
        {score.pendingCorrections ? <p className="mt-2 text-sm text-ink-2">Falta{score.pendingCorrections === 1 ? "" : "n"} corregir {score.pendingCorrections} {score.pendingCorrections === 1 ? "respuesta" : "respuestas"}: la nota todavía puede cambiar.</p> : null}
        {results.level === "answers" ? <p className="mt-2 text-sm text-ink-2">Cuando termine la sesión vas a ver acá qué estuvo bien en cada pregunta.</p> : null}
      </section>
      {questions?.map((question) => <ResultQuestion key={question.id} question={question} />)}
    </div>
  );
}

function ResultQuestion({ question }: { question: StudentResultQuestion }) {
  const review = question.review;
  const tone = review ? scoreTone(review.pointsAwarded, question.points) : null;
  return (
    <article className="rounded-lg border bg-paper p-5 shadow-card" aria-labelledby={`result-${question.id}`}>
      <header className="flex items-start justify-between gap-3">
        <div id={`result-${question.id}`} className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-muted">Pregunta {question.number}</p>
          <RichContent text={question.prompt} assets={question.assets} className="mt-1 font-semibold leading-relaxed text-ink" />
        </div>
        {tone ? (
          <span className={`mono-number shrink-0 rounded-sm border px-2 py-1 text-xs font-semibold ${toneClass[tone]}`}>
            {review?.pointsAwarded === null ? `${formatPoints(question.points)} pts` : `${formatPoints(review?.pointsAwarded ?? 0)}/${formatPoints(question.points)} pts`}
          </span>
        ) : <span className="mono-number shrink-0 text-xs text-muted">{formatPoints(question.points)} pts</span>}
      </header>
      <div className="mt-4"><ResultAnswer answer={question.answer} answered={question.answered} /></div>
      {review && review.pointsAwarded === null ? <p className="mt-3 text-sm font-semibold text-muted">Pendiente de corrección</p> : null}
      {review?.feedback ? (
        <div className="mt-3 rounded-md bg-inset p-3">
          <p className="text-xs font-semibold text-ink-2">Devolución del docente</p>
          <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-ink">{review.feedback}</p>
        </div>
      ) : null}
    </article>
  );
}

function ResultAnswer({ answer, answered }: { answer: StudentResultAnswer; answered: boolean }) {
  if (answer.kind === "text") {
    return (
      <>
        <p className="text-xs font-semibold text-ink-2">Tu respuesta</p>
        <p className={`mt-1 rounded-md border bg-inset p-3 text-sm leading-relaxed whitespace-pre-wrap ${answered ? "text-ink" : "text-muted"}`}>{answered ? answer.value : "Sin responder"}</p>
        {answer.accepted?.length ? <p className="mt-2 text-sm text-ink-2"><span className="font-semibold">Respuestas aceptadas:</span> {answer.accepted.join(", ")}</p> : null}
      </>
    );
  }
  const rows = answer.kind === "choice"
    ? answer.options
    : [
        { id: "true", text: "Verdadero", selected: answer.value === true, correct: answer.correct === undefined ? undefined : answer.correct === true },
        { id: "false", text: "Falso", selected: answer.value === false, correct: answer.correct === undefined ? undefined : answer.correct === false },
      ];
  const Marker = answer.kind === "choice" && answer.multiple ? Square : Circle;
  return (
    <>
      <ul className="grid gap-2">
        {rows.map((row) => (
          <li key={row.id} className={`flex items-start gap-2.5 rounded-md border p-3 text-sm ${row.selected ? "border-brand/40 bg-brand-soft/40" : ""}`}>
            <Marker className={`mt-0.5 size-4 shrink-0 ${row.selected ? "fill-brand text-brand" : "text-muted"}`} aria-hidden="true" />
            <RichContent text={row.text} className="min-w-0 flex-1 leading-relaxed text-ink" />
            <span className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs font-semibold">
              {row.selected ? <span className="text-brand-deep">Tu respuesta</span> : null}
              {row.correct === true ? <span className="inline-flex items-center gap-1 text-ok"><Check className="size-3.5" aria-hidden="true" />Correcta</span> : null}
              {row.correct === false && row.selected ? <span className="inline-flex items-center gap-1 text-alert"><X className="size-3.5" aria-hidden="true" />Incorrecta</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {answered ? null : <p className="mt-2 text-sm text-muted">Sin responder</p>}
    </>
  );
}
