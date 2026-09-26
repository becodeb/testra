import { Check, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { AI, EXAM, SOFIA, SOFIA_ANSWER, SOFIA_FEEDBACK, STUDENTS } from "../data";
import { EASE, progress, spring, SPRINGS, swap } from "../motion";
import { anchor, useControl, useScene } from "../scene-context";
import { T } from "../timeline";

const QUEUE = 5;
const POSITION = 5; // Sofía's answer is the last one left in the queue.

/** The review dialog of ai-correction-review.tsx for Sofía's long answer. */
export function AiCard() {
  const { t } = useScene();
  const long = EXAM.questions[2];
  const student = STUDENTS[SOFIA];
  const count = EASE.inOut(progress(t, T.aiCountStart, T.aiCountEnd));
  const score = Math.round(count * AI.score);
  const conf = spring(t - T.aiCountStart, SPRINGS.soft) * AI.confidence;
  // The suggestion arrives with its count-up, so "0 de 4 · Confianza 0%" is never read.
  const reveal = EASE.app(progress(t, T.aiCountStart, T.aiCountStart + 0.12));
  const saving = t >= T.clickAccept + 0.06 && t < T.saved;
  const resolved = t >= T.saved;
  const resolvedSwap = swap(t, T.saved);
  const savingSwap = swap(t, T.clickAccept + 0.06);
  const acceptHover = useControl("btn-accept", "bg-primary/90");
  const progressPct = ((POSITION - 1) / QUEUE) * 100;

  return (
    <section role="dialog" aria-labelledby="revision-ia-titulo" className="w-full max-w-3xl overflow-hidden rounded-xl border bg-paper shadow-card">
      <header className="border-b px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-[.09em] text-brand uppercase">Corrección con IA</p>
            <h2 id="revision-ia-titulo" className="mt-1 truncate font-semibold text-ink">{EXAM.title}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="mono-number text-sm text-muted">{POSITION} / {QUEUE}</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Cerrar la revisión"><X /></Button>
          </div>
        </div>
        <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-inset">
          <div className="h-full bg-brand" style={{ width: `${progressPct}%` }} />
        </div>
      </header>

      <div className="max-h-[540px] overflow-hidden px-5 py-5">
        <p className="text-[.67rem] font-bold tracking-[.09em] text-muted uppercase">{long.points} puntos</p>
        <div className="rich-content mt-1 text-base font-semibold leading-6 text-ink"><p>{long.prompt}</p></div>

        <p className="mt-6 text-[.67rem] font-bold tracking-[.09em] text-muted uppercase">{student.name} respondió</p>
        <blockquote className="mt-2 min-h-24 rounded-lg border bg-inset p-4 text-sm leading-7 whitespace-pre-wrap text-ink-2">{SOFIA_ANSWER}</blockquote>

        <section className="mt-5 rounded-lg border border-brand/25 bg-brand-soft/40 p-4" {...anchor("ai-suggestion")}>
          <p className="flex items-center gap-2 text-sm font-bold text-brand-deep"><Sparkles className="size-4" aria-hidden="true" />La IA sugiere</p>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1" style={{ opacity: reveal }}>
            <span className="mono-number text-5xl leading-none font-bold tracking-[-.03em] text-brand-deep">{score}</span>
            <span className="text-lg font-semibold text-ink-2">de {long.points} puntos</span>
          </p>
          <p className="mt-2.5 flex items-center gap-2" style={{ opacity: reveal }}>
            <span className="h-[5px] w-24 overflow-hidden rounded-full bg-ink/10"><span className="block h-full rounded-full bg-brand" style={{ width: `${(conf * 100).toFixed(2)}%` }} /></span>
            <span className="text-xs text-ink-2">Confianza {Math.round(conf * 100)}%</span>
          </p>

          <div className="mt-4 min-h-9" style={resolvedSwap.style}>
            {resolvedSwap.showNew && resolved ? (
              <p className="flex h-9 items-center gap-2 text-sm font-semibold text-ok">
                <Check className="size-4" aria-hidden="true" />
                Guardado {AI.score} de {long.points} · aceptaste la sugerencia
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span {...anchor("btn-accept")} className="inline-flex">
                  <Button type="button" className={acceptHover} style={{ opacity: saving ? 0.5 : 1 }}>
                    <Check data-icon="inline-start" /><span style={savingSwap.style}>{savingSwap.showNew ? "Guardando…" : "Aceptar esta sugerencia"}</span>
                  </Button>
                </span>
                <Button type="button" variant="outline" style={{ opacity: saving ? 0.5 : 1 }}>Poner otro puntaje</Button>
              </div>
            )}
          </div>
        </section>

        <details className="mt-4 overflow-hidden rounded-lg border bg-paper" open>
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-ink-2">Devolución sugerida para {student.name.split(" ")[0]}</summary>
          <div className="px-4 pb-4">
            <Textarea className="min-h-20 font-normal" value={SOFIA_FEEDBACK} readOnly aria-label="Devolución para el alumno" />
            <p className="mt-1.5 text-xs text-muted">La escribió la IA y podés editarla. Se guarda con la nota.</p>
          </div>
        </details>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-inset px-5 py-3">
        <p className="text-sm font-semibold text-ink-2" {...anchor("ai-note")}>La nota la ponés vos.</p>
        <p className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <span><kbd className="rounded-sm border px-1 py-0.5">A</kbd> aceptar</span>
          <span><kbd className="rounded-sm border px-1 py-0.5">0</kbd>–<kbd className="rounded-sm border px-1 py-0.5">9</kbd> puntuar</span>
          <span><kbd className="rounded-sm border px-1 py-0.5">S</kbd> saltear</span>
          <span><kbd className="rounded-sm border px-1 py-0.5">Esc</kbd> salir</span>
        </p>
      </footer>
    </section>
  );
}

export function CorrectionScreen() {
  const { t } = useScene();
  const visible = t >= T.act4Swap && t < T.morphResults;
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="w-full max-w-3xl" {...anchor("ai-card")} style={{ opacity: visible ? 1 : 0 }}>
        <AiCard />
      </div>
    </div>
  );
}
