import { useEffect, useId, useRef } from "react";
import { CircleCheck, CircleX, RotateCcw } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";

import { IncidentList } from "@/components/incident-list";
import { Button } from "@/components/ui/button";
import { Crossfade, cue } from "@/components/demo/demo-ui";
import type { FullQuestion } from "@/domain/exam";
import type { QuestionGrade } from "@/server/grading";
import {
  answeredCount,
  demoGrade,
  formatElapsed,
  formatHour,
  formatPoints,
  isAnswered,
  toReportIncidents,
  type DemoAttempt,
  type DemoExam,
} from "@/lib/demo";
import { cn } from "@/lib/utils";

interface DemoReportProps {
  exam: DemoExam;
  attempt: DemoAttempt;
  manualScores: Record<string, number>;
  onScore: (questionId: string, points: number) => void;
  onRetake: () => void;
}

/** Lo que recibe el docente: la nota, cada respuesta y los avisos con su contexto. */
export function DemoReport({ exam, attempt, manualScores, onScore, onRetake }: DemoReportProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const grade = demoGrade(exam.questions, attempt.answers, manualScores);
  const answered = answeredCount(exam.questions, attempt.answers);
  const incidents = toReportIncidents(attempt.incidents, exam.questions);
  const submittedAt = attempt.submittedAt ?? Date.now();
  const duration = attempt.joinedAt === null ? 0 : submittedAt - attempt.joinedAt;
  const ids = useId();

  // Cambió la pantalla entera: el foco arranca por el nombre del alumno.
  useEffect(() => headingRef.current?.focus(), []);

  return (
    <div className="demo-enter">
      <div className="border-b bg-paper">
        <div className="mx-auto max-w-[1180px] px-4 py-6 lg:px-6">
          <p className="text-xs font-semibold tracking-[.08em] text-muted uppercase">Resultados</p>
          <h1 ref={headingRef} tabIndex={-1} className="mt-1 text-2xl font-semibold tracking-[-.02em] text-ink outline-none">{attempt.studentName}</h1>
          <p className="mt-1 text-sm text-muted">{exam.title} · Entregó a las {formatHour(submittedAt)}</p>

          <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-5 border-t pt-5 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">Nota</dt>
              <dd className="mt-1">
                <Crossfade
                  id={`${grade.awardedPoints}/${grade.maxPoints}`}
                  value={grade}
                  render={(value) => (
                    <div>
                      <span className="mono-number block text-4xl leading-none font-semibold tracking-[-.02em] text-ink">{value.percent}%</span>
                      <span className="mono-number mt-1.5 block text-sm text-ink-2">{formatPoints(value.awardedPoints)}/{formatPoints(value.maxPoints)} puntos</span>
                    </div>
                  )}
                />
                {grade.pendingManualPoints > 0 ? <span className="mt-0.5 block text-xs text-warn">Falta corrección manual</span> : null}
              </dd>
            </div>
            <Stat label="Respondidas" value={`${answered}/${exam.questions.length}`} />
            <Stat label="Tiempo" value={formatElapsed(duration)} />
            <Stat label="Avisos" value={String(incidents.length)} />
          </dl>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1180px] items-start gap-5 px-4 py-6 lg:grid-cols-12 lg:px-6">
        <section aria-labelledby={`${ids}-respuestas`} className="rounded-lg border bg-paper shadow-card lg:col-span-7">
          <div className="border-b px-5 py-3.5"><h2 id={`${ids}-respuestas`} className="font-semibold text-ink">Respuestas</h2></div>
          <ol className="divide-y">
            {exam.questions.map((question, index) => (
              <AnswerRow
                key={question.id}
                question={question}
                index={index}
                grade={grade.questions[index]}
                answer={attempt.answers[question.id]}
                score={manualScores[question.id]}
                cueScore={grade.pendingManualPoints > 0 && manualScores[question.id] === undefined}
                onScore={onScore}
              />
            ))}
          </ol>
        </section>

        <section aria-labelledby={`${ids}-avisos`} className="rounded-lg border bg-paper p-5 shadow-card lg:col-span-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id={`${ids}-avisos`} className="font-semibold text-ink">Avisos de actividad</h2>
            <span className="mono-number rounded-sm border border-warn/30 bg-warn/5 px-1.5 py-0.5 text-xs font-semibold text-warn">{incidents.length}</span>
          </div>
          {incidents.length ? (
            <>
              <IncidentList incidents={incidents} />
              <aside className="mt-5 rounded-md border border-warn/25 bg-paper p-4 text-sm leading-relaxed text-ink-2">
                <strong className="text-ink">Los avisos necesitan contexto.</strong> Cambiar de Wi-Fi, perder conexión o alternar ventanas puede generar señales legítimas. Testra nunca cambia una nota automáticamente por estos eventos.
              </aside>
            </>
          ) : (
            <div className="mt-4 rounded-md border border-dashed px-5 py-8 text-center">
              <p className="font-semibold text-ink">No hubo avisos</p>
              <p className="mt-1 text-sm text-muted">Volvé a rendir y probá cambiar de pestaña o copiar un texto.</p>
              <Button type="button" variant="outline" className="mt-4" onClick={onRetake}>
                <RotateCcw data-icon="inline-start" />
                Rendir de nuevo
              </Button>
            </div>
          )}
        </section>
      </div>

      <section aria-labelledby={`${ids}-cierre`} className="bg-brand-deep">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-6 px-4 py-10 lg:px-6">
          <div>
            <h2 id={`${ids}-cierre`} className="text-2xl font-semibold tracking-[-.03em] text-white md:text-3xl">Armá tu primera evaluación</h2>
            <p className="mt-2 max-w-[52ch] text-sm leading-6 text-blue-100">Con tu cuenta docente. Tus alumnos entran con un código, sin cuenta.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href="/login?modo=registro"
              className="inline-flex h-11 items-center rounded-md bg-white px-5 text-sm font-semibold text-brand-deep transition-colors hover:bg-blue-50 focus-visible:outline-white active:translate-y-px"
            >
              Crear mi cuenta
            </a>
            <button
              type="button"
              onClick={onRetake}
              className="inline-flex h-11 items-center gap-2 rounded-md border border-white/30 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-white active:translate-y-px"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              Rendir de nuevo
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mono-number mt-1 text-2xl leading-none font-semibold text-ink">{value}</dd>
    </div>
  );
}

interface AnswerRowProps {
  question: FullQuestion;
  index: number;
  grade: QuestionGrade;
  answer: string | undefined;
  score: number | undefined;
  cueScore: boolean;
  onScore: (questionId: string, points: number) => void;
}

function AnswerRow({ question, index, grade, answer, score, cueScore, onScore }: AnswerRowProps) {
  const labelId = useId();
  const answeredIt = isAnswered(answer);
  const pending = grade.pointsAwarded === null;

  return (
    <li className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs font-semibold text-muted">Pregunta {index + 1}</p>
        {pending
          ? <span className="text-xs font-semibold text-warn">Sin corregir</span>
          : <span className="mono-number text-sm font-semibold text-ink">{formatPoints(grade.pointsAwarded ?? 0)}/{formatPoints(grade.maxPoints)}</span>}
      </div>
      <p className="mt-1 text-sm font-semibold leading-relaxed text-ink">{question.prompt}</p>

      {question.type === "mc" ? (
        <dl className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 text-sm">
          <dt className="pt-px text-xs text-muted">Tu respuesta</dt>
          <dd className="flex items-start gap-1.5 text-ink-2">
            {grade.auto
              ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden="true" />
              : <CircleX className="mt-0.5 size-4 shrink-0 text-alert" aria-hidden="true" />}
            <span className={cn(!answeredIt && "text-muted")}>
              <span className="sr-only">{grade.auto ? "Bien: " : "Mal: "}</span>
              {answeredIt ? optionLabel(question, answer) : "Sin responder"}
            </span>
          </dd>
          {grade.auto ? null : (
            <>
              <dt className="pt-px text-xs text-muted">Correcta</dt>
              <dd className="text-ok">{optionLabel(question, question.config.correctOptionId)}</dd>
            </>
          )}
        </dl>
      ) : (
        <div className="mt-2.5 grid gap-3">
          <div>
            <p className="text-xs text-muted">Tu respuesta</p>
            <p className={cn("mt-1 rounded-md bg-inset px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap", answeredIt ? "text-ink-2" : "text-muted-foreground")}>{answeredIt ? answer : "Sin responder"}</p>
          </div>
          <div>
            <p id={labelId} className="text-sm font-semibold text-ink">Corregí esta respuesta</p>
            <RadioGroupPrimitive.Root
              aria-labelledby={labelId}
              value={score === undefined ? "" : String(score)}
              onValueChange={(value) => onScore(question.id, Number(value))}
              orientation="horizontal"
              className={cn("mt-2 inline-flex rounded-md border bg-inset p-0.5", cue(cueScore))}
            >
              {Array.from({ length: Math.floor(question.points) + 1 }, (_, points) => (
                <RadioGroupPrimitive.Item
                  key={points}
                  value={String(points)}
                  className="mono-number h-8 rounded-sm px-4 text-sm font-semibold text-ink-2 transition-[background-color,color,box-shadow] duration-150 ease-[cubic-bezier(.2,.7,.3,1)] hover:text-ink data-[state=checked]:bg-paper data-[state=checked]:text-ink data-[state=checked]:shadow-card"
                >
                  {points} pt{points === 1 ? "" : "s"}
                </RadioGroupPrimitive.Item>
              ))}
            </RadioGroupPrimitive.Root>
            <p className="mt-2 text-xs leading-5 text-muted">En tu cuenta, la IA puede sugerirte un puntaje y un comentario. La nota la ponés vos.</p>
          </div>
        </div>
      )}
    </li>
  );
}

function optionLabel(question: FullQuestion, optionId: string | undefined) {
  if (question.type !== "mc") return "";
  const index = question.config.options.findIndex((option) => option.id === optionId);
  return index < 0 ? "" : `${String.fromCharCode(65 + index)}) ${question.config.options[index].text}`;
}
