import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Sparkles, X } from "lucide-react";

import type { CorrectionItem } from "@/components/correction-queue";
import { RichContent } from "@/components/rich-content";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export interface ReviewValues {
  pointsAwarded: number;
  feedback: string;
  teacherNote: string;
  rubricScores: Record<string, number>;
}

interface AiCorrectionReviewProps {
  /** Ya vienen filtradas a una evaluación y con sugerencia cargada. */
  items: CorrectionItem[];
  runTitle: string;
  /** Pendientes de la misma toma que la IA no llegó a sugerir. */
  withoutSuggestion: number;
  onClose: () => void;
  onResolve: (item: CorrectionItem, values: ReviewValues) => Promise<void>;
}

/** Niveles de confianza. Una sugerencia floja tiene que verse floja. */
export function confidenceLevel(confidence: number): "alta" | "media" | "baja" {
  if (confidence >= 0.85) return "alta";
  return confidence >= 0.65 ? "media" : "baja";
}

/**
 * Cuando la pregunta tiene rúbrica, el puntaje no se guarda suelto: se guarda
 * criterio por criterio y el total sale de la suma. Si la IA no devolvió un
 * puntaje para cada criterio no se puede aceptar de una, porque guardaría la
 * rúbrica vacía y el docente perdería el desglose sin enterarse. En ese caso
 * queda el camino de ajustar a mano.
 */
export function rubricScoresFromSuggestion(
  rubric: CorrectionItem["rubric"],
  criteria: unknown[] | undefined,
): Record<string, number> | null {
  if (!rubric.length) return {};
  const byId = new Map(
    (criteria ?? [])
      .filter((entry): entry is { id?: string; score?: number } => typeof entry === "object" && entry !== null)
      .filter((entry) => typeof entry.id === "string" && typeof entry.score === "number")
      .map((entry) => [entry.id as string, entry.score as number]),
  );
  const scores: Record<string, number> = {};
  for (const criterion of rubric) {
    const score = byId.get(criterion.id);
    if (score === undefined) return null;
    scores[criterion.id] = Math.max(0, Math.min(criterion.maxPoints, score));
  }
  return scores;
}

const CONFIDENCE_STYLES = {
  alta: { bar: "bg-ok", text: "text-ink-2" },
  media: { bar: "bg-brand", text: "text-ink-2" },
  baja: { bar: "bg-warn", text: "font-semibold text-warn" },
} as const;

export function AiCorrectionReview({ items, runTitle, withoutSuggestion, onClose, onResolve }: AiCorrectionReviewProps) {
  const [index, setIndex] = useState(0);
  const [adjusting, setAdjusting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [resolved, setResolved] = useState<Record<string, number>>({});
  const advanceTimer = useRef(0);

  /**
   * La cola se congela al abrir. Si se recalculara sobre las pendientes, cada
   * respuesta guardada saldría de la lista y el total bajaría mientras el
   * docente avanza: se corrige una de 45 y el cuadro pasa a decir "2 de 44".
   * Además la confirmación de guardado no llegaría a verse, porque el ítem
   * desaparecería en el mismo instante.
   */
  const [queue] = useState(() => items);
  const [pendingWithout] = useState(() => withoutSuggestion);

  const item = queue[index];
  const done = index >= queue.length;
  const resolvedCount = Object.keys(resolved).length;

  const suggestedRubric = useMemo(
    () => (item ? rubricScoresFromSuggestion(item.rubric, item.aiCriteria) : null),
    [item],
  );
  // Sin desglose utilizable, aceptar de una engañaría: se ofrece ajustar.
  const canAcceptDirectly = suggestedRubric !== null;

  const [feedback, setFeedback] = useState("");
  useEffect(() => { setFeedback(item?.aiFeedback ?? ""); setAdjusting(false); setError(""); }, [item]);

  /**
   * Mismo tratamiento que la pantalla completa de la bandeja: el fondo no
   * scrollea y `data-overlay-open` neutraliza el `view-transition-name` de
   * `.page-content`, que si no convierte al contenedor en bloque de los
   * `fixed` y deja el cuadro atrapado debajo del encabezado.
   */
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.dataset.overlayOpen = "true";
    return () => {
      document.body.style.overflow = previous;
      delete document.documentElement.dataset.overlayOpen;
      window.clearTimeout(advanceTimer.current);
    };
  }, []);

  async function resolve(points: number) {
    if (!item || saving) return;
    setSaving(true);
    setError("");
    try {
      const rubricScores = item.rubric.length
        ? suggestedRubric && points === item.aiSuggestedScore
          ? suggestedRubric
          : { ...item.rubricScores }
        : {};
      await onResolve(item, {
        pointsAwarded: points,
        feedback,
        teacherNote: item.aiTeacherNote ?? item.teacherNote ?? "",
        rubricScores,
      });
      setResolved((current) => ({ ...current, [`${item.participantId}:${item.questionId}`]: points }));
      // El "Guardado" tiene que alcanzar a leerse antes de pasar a la siguiente.
      advanceTimer.current = window.setTimeout(() => setIndex((value) => value + 1), 620);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return onClose();
      if (done || !item || saving) return;
      const target = event.target as HTMLElement | null;
      if (target && ["TEXTAREA", "INPUT", "SELECT"].includes(target.tagName)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === "a" && canAcceptDirectly && item.aiSuggestedScore !== null && item.aiSuggestedScore !== undefined) {
        event.preventDefault();
        void resolve(item.aiSuggestedScore);
        return;
      }
      if (/^[0-9]$/.test(event.key) && Number(event.key) <= item.maxPoints) {
        event.preventDefault();
        void resolve(Number(event.key));
      }
    };
    // En burbujeo a proposito: no tapa a nadie que escuche en captura.
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const progress = queue.length ? Math.min(index, queue.length) / queue.length * 100 : 100;
  const currentKey = item ? `${item.participantId}:${item.questionId}` : "";
  const justResolved = currentKey in resolved;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/55 p-3 sm:p-6" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="revision-ia-titulo"
        data-ai-review-ready="true"
        className="my-auto w-full max-w-3xl overflow-hidden rounded-xl border bg-paper shadow-card"
      >
        <header className="border-b px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-bold tracking-[.09em] text-brand uppercase">Corrección con IA</p>
              <h2 id="revision-ia-titulo" className="mt-1 truncate font-semibold text-ink">{runTitle}</h2>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="mono-number text-sm text-muted">{Math.min(index + 1, queue.length)} / {queue.length}</span>
              <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar la revisión"><X /></Button>
            </div>
          </div>
          <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-inset">
            <div className="h-full bg-brand transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${done ? 100 : progress}%` }} />
          </div>
        </header>

        {done ? (
          <div className="px-6 py-12 text-center">
            <span className="mx-auto grid size-13 place-items-center rounded-full bg-ok/15 text-ok"><Check className="size-6" /></span>
            <h3 className="mt-4 text-lg font-semibold text-ink">Terminaste la cola</h3>
            <p className="mx-auto mt-2 max-w-[34ch] text-sm text-muted">
              Revisaste todas las sugerencias de esta evaluación. Los puntajes ya están guardados.
            </p>
            <dl className="mt-6 flex justify-center gap-8">
              <div><dt className="text-[.7rem] font-semibold tracking-[.07em] text-muted uppercase">Corregidas</dt><dd className="mono-number mt-1 text-2xl font-bold text-ink">{resolvedCount}</dd></div>
              <div><dt className="text-[.7rem] font-semibold tracking-[.07em] text-muted uppercase">Puntos dados</dt><dd className="mono-number mt-1 text-2xl font-bold text-ink">{Object.values(resolved).reduce((total, value) => total + value, 0)}</dd></div>
            </dl>
            {pendingWithout > 0 ? (
              <p className="mx-auto mt-6 max-w-[42ch] rounded-md border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-ink-2">
                Quedan <strong>{pendingWithout}</strong> respuesta{pendingWithout === 1 ? "" : "s"} sin sugerencia de la IA en esta evaluación. Se corrigen a mano desde la bandeja.
              </p>
            ) : null}
            <div className="mt-6"><Button type="button" onClick={onClose}>Volver a la bandeja</Button></div>
          </div>
        ) : item ? (
          <>
            <div className="max-h-[60dvh] overflow-y-auto px-5 py-5">
              <p className="text-[.67rem] font-bold tracking-[.09em] text-muted uppercase">{item.maxPoints} punto{item.maxPoints === 1 ? "" : "s"}</p>
              <RichContent text={item.prompt} className="mt-1 text-base font-semibold leading-6 text-ink" />

              <p className="mt-6 text-[.67rem] font-bold tracking-[.09em] text-muted uppercase">{item.studentName} respondió</p>
              <blockquote className="mt-2 min-h-24 rounded-lg border bg-inset p-4 text-sm leading-7 whitespace-pre-wrap text-ink-2">
                {item.answer || <span className="text-muted italic">No entregó respuesta.</span>}
              </blockquote>

              <section className="mt-5 rounded-lg border border-brand/25 bg-brand-soft/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-bold text-brand-deep"><Sparkles className="size-4" aria-hidden="true" />La IA sugiere</p>
                    {(() => {
                      const level = confidenceLevel(item.aiConfidence ?? 0);
                      const style = CONFIDENCE_STYLES[level];
                      return (
                        <p className="mt-2 flex items-center gap-2">
                          <span className="h-[5px] w-22 overflow-hidden rounded-full bg-ink/10"><span className={`block h-full rounded-full ${style.bar}`} style={{ width: `${Math.round((item.aiConfidence ?? 0) * 100)}%` }} /></span>
                          <span className={`text-xs ${style.text}`}>Confianza {Math.round((item.aiConfidence ?? 0) * 100)}%{level === "baja" ? " · revisala con cuidado" : ""}</span>
                        </p>
                      );
                    })()}
                  </div>
                  <p className="flex items-baseline gap-1"><span className="mono-number text-3xl leading-none font-bold text-brand-deep">{item.aiSuggestedScore}</span><span className="text-sm font-medium text-ink-2">de {item.maxPoints}</span></p>
                </div>

                {item.aiTeacherNote ? <p className="mt-3 text-sm leading-6 text-ink-2">{item.aiTeacherNote}</p> : null}
                {Array.isArray(item.aiCriteria) && item.aiCriteria.length ? (
                  <ul className="mt-3 grid gap-1">
                    {(item.aiCriteria as Array<{ id?: string; score?: number; reason?: string }>).map((criterion, position) => (
                      <li key={`${criterion.id ?? "criterio"}-${position}`} className="flex gap-2 text-xs text-ink-2">
                        <strong className="mono-number shrink-0 text-brand-deep">{criterion.score ?? 0} pt</strong>
                        <span>{criterion.reason ?? "Sin detalle"}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {justResolved ? (
                  <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-ok">
                    <Check className="size-4" aria-hidden="true" />
                    Guardado {resolved[currentKey]} de {item.maxPoints}
                    {resolved[currentKey] === item.aiSuggestedScore ? " · aceptaste la sugerencia" : " · ajustaste el puntaje"}
                  </p>
                ) : adjusting ? (
                  <>
                    <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Puntaje">
                      {Array.from({ length: item.maxPoints + 1 }, (_, value) => (
                        <button
                          key={value}
                          type="button"
                          disabled={saving}
                          onClick={() => void resolve(value)}
                          className="mono-number size-9 rounded-md border bg-paper text-sm font-semibold text-ink-2 transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
                        >{value}</button>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted">Elegí el puntaje que corresponde. Se guarda y pasa a la siguiente.</p>
                  </>
                ) : (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {canAcceptDirectly ? (
                      <Button type="button" disabled={saving} onClick={() => void resolve(item.aiSuggestedScore ?? 0)}>
                        <Check data-icon="inline-start" />{saving ? "Guardando…" : `Aceptar ${item.aiSuggestedScore} de ${item.maxPoints}`}
                      </Button>
                    ) : null}
                    <Button type="button" variant="outline" disabled={saving} onClick={() => setAdjusting(true)}>Ajustar puntaje</Button>
                    {canAcceptDirectly ? null : <span className="text-xs text-warn">La IA no puntuó cada criterio de la rúbrica: cargalos vos.</span>}
                  </div>
                )}
                {error ? <p className="mt-2 text-xs text-alert">{error}</p> : null}
              </section>

              <details className="mt-4 overflow-hidden rounded-lg border bg-paper" open={!justResolved}>
                <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-ink-2 hover:bg-inset">Devolución sugerida para {item.studentName.split(" ")[0]}</summary>
                <div className="px-4 pb-4">
                  <Textarea className="min-h-20 font-normal" value={feedback} onChange={(event) => setFeedback(event.target.value)} aria-label="Devolución para el alumno" />
                  <p className="mt-1.5 text-xs text-muted">La escribió la IA y podés editarla. Se guarda con la nota.</p>
                </div>
              </details>

              {item.referenceAnswer || item.gradingCriteria ? (
                <details className="mt-2 overflow-hidden rounded-lg border bg-paper">
                  <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-ink-2 hover:bg-inset">Respuesta esperada y criterios de la toma</summary>
                  <div className="grid gap-2 px-4 pb-4 text-sm leading-6 text-ink-2">
                    {item.gradingCriteria ? <p>{item.gradingCriteria}</p> : null}
                    {item.referenceAnswer ? <p>{item.referenceAnswer}</p> : null}
                    <p className="text-xs text-muted">La definiste para esta evaluación y vale para todos los alumnos: no es una respuesta modelo de esta corrección.</p>
                  </div>
                </details>
              ) : null}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-inset px-5 py-3">
              <p className="text-sm font-semibold text-ink-2">La nota la ponés vos.</p>
              <p className="flex flex-wrap items-center gap-3 text-xs text-muted">
                <span><kbd className="rounded-sm border px-1 py-0.5">A</kbd> aceptar</span>
                <span><kbd className="rounded-sm border px-1 py-0.5">0</kbd>–<kbd className="rounded-sm border px-1 py-0.5">9</kbd> puntuar</span>
                <span><kbd className="rounded-sm border px-1 py-0.5">Esc</kbd> salir</span>
              </p>
            </footer>
          </>
        ) : null}
      </section>
    </div>
  );
}
