import { ChevronDown, LoaderCircle, Search, Users2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  closedPatternLine,
  closedPatternQuestionLine,
  closedPatternQuestionsOf,
  fragmentCoverageLine,
  longFindingsOf,
  pairEvidenceLine,
  pairKeyOf,
  relativeTimeLabel,
  relevantSemanticFindings,
  semanticStatusLine,
  similarityCopy,
} from "@/lib/similarity-copy";
import type { PairQuestionFinding, SimilarityPair, SimilarityReport } from "@/server/similarity-analysis";
import type { FragmentSpan, SignalLevel } from "@/server/similarity-signals";

// Tarjeta "Coincidencias entre alumnos" de la pestaña Análisis, y el bloque
// chico que se reusa en el diálogo de un alumno. SOLO tipos de
// `@/server/similarity-*` (`import type`): esos módulos tocan la base y el
// cliente de Jev, y este archivo corre en el navegador (ver
// `similarity-copy.ts`). Ver `odd/tasks/jev-copy-detection.md`.

interface SimilarityResponse {
  report: SimilarityReport | null;
  stale?: boolean;
  updatedAt?: number;
}

const ERROR_LOAD = "No se pudo cargar la comparación entre alumnos.";
const ERROR_RUN = "No se pudo comparar a los alumnos.";

function LevelBadge({ level }: { level: SignalLevel }) {
  const label = level === "strong" ? "Coincidencia fuerte" : "Para revisar";
  const className =
    level === "strong"
      ? "border-brand/30 bg-brand-soft text-brand-deep"
      : "border-warn/25 bg-warn/5 text-warn";
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}>{label}</span>;
}

/** Recorta `text` en nodos de texto planos y `<mark>` para los tramos compartidos. Nunca HTML crudo: los spans vienen del servidor como offsets, no como markup. */
function renderHighlighted(text: string, spans: FragmentSpan[]) {
  if (!spans.length) return text;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((span, index) => {
    const start = Math.max(cursor, Math.min(span.start, text.length));
    const end = Math.max(start, Math.min(span.end, text.length));
    if (start > cursor) nodes.push(text.slice(cursor, start));
    if (end > start) nodes.push(
      <mark key={`frag-${index}`} className="rounded-sm bg-warn/30 px-0.5 text-ink">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = Math.max(cursor, end);
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function ClosedPatternDetail({ pair }: { pair: SimilarityPair }) {
  if (!pair.closedPattern) return null;
  // Siempre que `closedPattern` existe hay al menos una pregunta acá (viene
  // de `sharedWrong ≥ 1`, independiente de si esa señal sola alcanza a
  // marcar al par): ya no hace falta un estado "sin detalle".
  const questions = closedPatternQuestionsOf(pair);
  return (
    <section>
      <h5 className="text-sm font-semibold text-ink">Respuestas incorrectas en común</h5>
      <p className="mt-1 text-sm text-ink-2">{closedPatternLine(pair.closedPattern)}</p>
      <ul className="mt-2 space-y-2">
        {questions.map((question) => (
          <li key={question.questionId} className="rounded-md bg-inset p-3 text-sm text-ink-2">
            {closedPatternQuestionLine(question)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function LongQuestionDetail({ finding }: { finding: PairQuestionFinding }) {
  const semanticFindings = finding.semantic ? relevantSemanticFindings(finding.semantic) : [];
  return (
    <section>
      <h5 className="text-sm font-semibold text-ink">{finding.label}</h5>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <p className="rounded-md border bg-paper p-3 text-sm leading-6 text-ink-2">{renderHighlighted(finding.answerA, finding.fragments?.spansA ?? [])}</p>
        <p className="rounded-md border bg-paper p-3 text-sm leading-6 text-ink-2">{renderHighlighted(finding.answerB, finding.fragments?.spansB ?? [])}</p>
      </div>
      {finding.fragments ? <p className="mt-2 text-sm text-ink-2">{fragmentCoverageLine(finding.fragments.coverage)}</p> : null}
      {semanticFindings.length ? (
        <ul className="mt-2 space-y-2">
          {semanticFindings.map(({ key, word }) => {
            const copy = similarityCopy[key];
            return (
              <li key={key} className="rounded-md bg-brand-soft/40 p-3 text-sm">
                <p className="font-medium text-brand-deep">
                  {copy.title}: {word}.
                </p>
                <p className="mt-0.5 text-xs text-muted">{copy.normal}</p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function PairRow({ pair, expanded, onToggle }: { pair: SimilarityPair; expanded: boolean; onToggle: () => void }) {
  const key = pairKeyOf(pair);
  const detailId = `similitud-detalle-${key.replace(/[^a-zA-Z0-9-]/g, "")}`;
  const longFindings = longFindingsOf(pair);
  return (
    <li className="rounded-md border">
      <button
        type="button"
        className="flex w-full flex-col gap-1 p-4 text-left sm:flex-row sm:items-center sm:justify-between sm:gap-3"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={onToggle}
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">
              {pair.a.name} · {pair.b.name}
            </span>
            <LevelBadge level={pair.level} />
          </span>
          <span className="mt-1 block text-sm text-ink-2">{pairEvidenceLine(pair)}</span>
        </span>
        <ChevronDown className={`size-4 shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {expanded ? (
        <div id={detailId} className="space-y-4 border-t p-4">
          <ClosedPatternDetail pair={pair} />
          {longFindings.map((finding) => <LongQuestionDetail key={finding.questionId} finding={finding} />)}
        </div>
      ) : null}
    </li>
  );
}

export function SimilarityCard({ runId }: { runId: string }) {
  const [report, setReport] = useState<SimilarityReport | null>(null);
  const [stale, setStale] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [lastAction, setLastAction] = useState<"load" | "run">("load");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setLastAction("load");
    void fetch(`/api/ai/similarity?runId=${encodeURIComponent(runId)}`)
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) throw new Error(ERROR_LOAD);
        const body = (await response.json()) as SimilarityResponse;
        setReport(body.report);
        setStale(Boolean(body.stale));
        setUpdatedAt(body.updatedAt ?? null);
      })
      .catch(() => { if (active) setError(ERROR_LOAD); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [runId]);

  async function run() {
    setLastAction("run");
    setRunning(true);
    setError("");
    try {
      const response = await fetch("/api/ai/similarity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const body = (await response.json().catch(() => ({}))) as SimilarityResponse & { error?: string };
      if (!response.ok) setError(body.error ?? ERROR_RUN);
      else {
        setReport(body.report);
        setStale(Boolean(body.stale));
        setUpdatedAt(body.updatedAt ?? null);
      }
    } catch {
      setError(ERROR_RUN);
    } finally {
      setRunning(false);
    }
  }

  function retry() {
    if (lastAction === "run") void run();
    else {
      setLoading(true);
      setError("");
      void fetch(`/api/ai/similarity?runId=${encodeURIComponent(runId)}`)
        .then(async (response) => {
          if (!response.ok) throw new Error(ERROR_LOAD);
          const body = (await response.json()) as SimilarityResponse;
          setReport(body.report);
          setStale(Boolean(body.stale));
          setUpdatedAt(body.updatedAt ?? null);
        })
        .catch(() => setError(ERROR_LOAD))
        .finally(() => setLoading(false));
    }
  }

  function toggle(key: string) {
    setExpandedKey((current) => (current === key ? null : key));
  }

  return (
    <section aria-labelledby="similitud-titulo" className="rounded-lg border bg-paper p-5 shadow-card">
      <div>
        <h3 id="similitud-titulo" className="flex items-center gap-2 font-semibold text-ink">
          <Users2 className="size-5 text-brand" aria-hidden="true" />
          Coincidencias entre alumnos
        </h3>
        <p className="mt-1 text-sm text-muted">Compara las respuestas de cada par de alumnos de esta toma.</p>
      </div>

      <p className="mt-3 text-sm leading-6 text-ink-2">
        Que dos respuestas se parezcan no es copia: estudiaron lo mismo. Testra marca solo lo que el tema no explica: el mismo error, frases poco comunes idénticas o varias
        respuestas incorrectas iguales que casi nadie más eligió.
      </p>

      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-medium text-brand">Qué es normal y qué no</summary>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-bold tracking-[.08em] text-muted uppercase">Normal</p>
            <ul className="mt-1 list-disc space-y-1 ps-5 text-ink-2">
              <li>Respuestas correctas parecidas.</li>
              <li>Repetir la definición vista en clase.</li>
              <li>Usar el vocabulario del tema.</li>
              <li>Coincidir en verdadero/falso o en el distractor que eligió media clase.</li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold tracking-[.08em] text-warn uppercase">Para revisar</p>
            <ul className="mt-1 list-disc space-y-1 ps-5 text-ink-2">
              <li>El mismo error o dato inventado.</li>
              <li>Frases o ejemplos idénticos que nadie más escribió.</li>
              <li>Una respuesta que sigue a otra punto por punto con otras palabras.</li>
              <li>Varias respuestas incorrectas iguales y poco elegidas.</li>
            </ul>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">Es una señal para mirar, no una prueba. Hablá con los alumnos antes de sacar conclusiones.</p>
      </details>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={() => void run()} disabled={running || loading}>
          {running ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
          {running ? "Comparando respuestas…" : report ? "Volver a buscar" : "Buscar coincidencias"}
        </Button>
        {running ? (
          <span className="text-xs text-muted">Puede tardar hasta un minuto.</span>
        ) : stale && report ? (
          <span className="text-xs font-medium text-warn">Las respuestas cambiaron desde la última búsqueda.</span>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-alert/25 bg-alert/5 p-3 text-sm text-alert">
          {error}{" "}
          <button type="button" className="font-semibold underline" onClick={retry}>
            Reintentar
          </button>
        </p>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-muted">Cargando…</p>
      ) : report ? (
        <div className="mt-4">
          <p className="text-sm text-muted">
            Comparó {report.participantsCompared} alumno{report.participantsCompared === 1 ? "" : "s"} en {report.questionsCompared.length} pregunta
            {report.questionsCompared.length === 1 ? "" : "s"} · {relativeTimeLabel(updatedAt ?? report.generatedAt)}
          </p>
          <p className="mt-1 text-sm text-ink-2">{semanticStatusLine(report.semantic)}</p>

          {report.pairs.length ? (
            <ul className="mt-4 space-y-2">
              {report.pairs.map((pair) => {
                const key = pairKeyOf(pair);
                return <PairRow key={key} pair={pair} expanded={expandedKey === key} onToggle={() => toggle(key)} />;
              })}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted">No encontramos coincidencias que el tema no explique.</p>
          )}
        </div>
      ) : null}

      <p className="mt-5 border-t pt-3 text-xs leading-5 text-muted">
        Para revisar la redacción se envían a Jev (TypeSafe AI, vía Vercel) las respuestas sin nombres, con retención cero de datos.
      </p>
    </section>
  );
}

/** Bloque chico para el diálogo de un alumno: sus pares dentro del reporte ya guardado, o nada si no hay reporte o no aparece en ninguno. */
export function StudentSimilarityMatches({ runId, participantId }: { runId: string; participantId: string }) {
  const [pairs, setPairs] = useState<SimilarityPair[]>([]);

  useEffect(() => {
    let active = true;
    setPairs([]);
    void fetch(`/api/ai/similarity?runId=${encodeURIComponent(runId)}`)
      .then(async (response) => {
        if (!active || !response.ok) return;
        const body = (await response.json()) as SimilarityResponse;
        const mine = (body.report?.pairs ?? []).filter((pair) => pair.a.participantId === participantId || pair.b.participantId === participantId);
        setPairs(mine);
      })
      .catch(() => { /* silencioso: es un bloque secundario del diálogo, no bloquea el resto del detalle */ });
    return () => { active = false; };
  }, [runId, participantId]);

  if (!pairs.length) return null;

  return (
    <section>
      <h3 className="font-semibold text-ink">Coincidencias con otros alumnos</h3>
      <ul className="mt-3 space-y-2">
        {pairs.map((pair) => {
          const other = pair.a.participantId === participantId ? pair.b : pair.a;
          return (
            <li key={pairKeyOf(pair)} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <LevelBadge level={pair.level} />
                <span className="font-medium text-ink">{other.name}</span>
              </div>
              <p className="mt-1 text-ink-2">{pairEvidenceLine(pair)}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
