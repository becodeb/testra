import { ArrowRight, KeyRound, UserRound } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";

import { EXAM } from "../data";
import { swap } from "../motion";
import { anchor, useScene } from "../scene-context";
import { Runtime } from "./runtime";
import { StudentHeader } from "./student-header";
import { nameKeyTimes, STUDENT_NAME, T } from "../timeline";

const INPUT = "w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none md:text-sm";
const FOCUS = "border-ring ring-[3px] ring-ring/50";

/** Old/new text pair swapped in place with the scene's 120 ms blur. */
function Swapped({ at, before, after, className }: { at: number; before: ReactNode; after: ReactNode; className?: string }) {
  const { t } = useScene();
  const s = swap(t, at);
  return <span className={cn("inline-block", className)} style={s.style}>{s.showNew ? after : before}</span>;
}

/** The student can only type: a solid caret, no pointer. */
const Caret = ({ h }: { h: number }) => <span className="scene-caret" style={{ height: h }} aria-hidden="true" />;

/** join-run.tsx, both steps, driven by t. */
export function JoinCard({ hideName = false }: { hideName?: boolean }) {
  const { t } = useScene();
  const named = t >= T.nameStep + 0.06;
  const codeIn = t >= T.codeLand;
  const typed = nameKeyTimes.filter((k) => t >= k).length;
  const continuePressed = t >= T.pressContinue && t < T.pressContinue + 0.09;
  const enterPressed = t >= T.pressEnter && t < T.pressEnter + 0.09;
  const pressed = continuePressed || enterPressed;

  return (
    <form className="w-full rounded-xl border bg-paper p-6 shadow-card sm:p-8" onSubmit={(e) => e.preventDefault()}>
      <div className="flex size-11 items-center justify-center rounded-lg bg-brand-soft text-brand-deep" aria-hidden="true">
        <Swapped at={T.nameStep} before={<KeyRound className="size-5" />} after={<UserRound className="size-5" />} className="leading-none" />
      </div>
      <p className="mt-5 text-xs font-semibold tracking-[.08em] text-muted uppercase"><Swapped at={T.nameStep} before="Ingreso de alumnos" after={`Código ${EXAM.code}`} /></p>
      <h1 className="mt-2 text-2xl font-semibold text-ink"><Swapped at={T.nameStep} before="Entrá a tu evaluación" after="¿Cómo te llamás?" /></h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        <Swapped
          at={T.nameStep}
          before="Usá el código de seis caracteres que muestra tu docente. No necesitás una cuenta."
          after={<>Vas a ingresar a <strong className="font-semibold text-ink-2">{EXAM.title}</strong>. Tu docente verá este nombre en la sala.</>}
        />
      </p>

      {named ? (
        <div className="mt-6 grid gap-4">
          <Field>
            <FieldLabel htmlFor="student-name"><Swapped at={T.nameStep} before="Código de la evaluación" after="Tu nombre y apellido" /></FieldLabel>
            <div id="student-name" className={cn(INPUT, FOCUS, "flex h-12 items-center text-base")} {...anchor("join-input")}>
              <Swapped at={T.nameStep} before="" after={<><span {...anchor("join-name-text")} style={{ opacity: hideName ? 0 : 1 }}>{STUDENT_NAME.slice(0, typed)}</span><Caret h={20} /></>} className="whitespace-pre" />
            </div>
          </Field>
        </div>
      ) : (
        <Field className="mt-6">
          <FieldLabel htmlFor="run-code"><Swapped at={T.nameStep} before="Código de la evaluación" after="Tu nombre y apellido" /></FieldLabel>
          <div id="run-code" className={cn(INPUT, FOCUS, "mono-number flex h-14 items-center justify-center text-center text-2xl font-bold tracking-[.2em] uppercase")} {...anchor("join-input")}>
            <Swapped at={T.nameStep} before={<>{codeIn ? EXAM.code : ""}<Caret h={26} /></>} after="" />
          </div>
        </Field>
      )}

      <Button type="submit" className={cn("mt-5 w-full", pressed && "translate-y-px bg-primary/90")}>
        <Swapped at={t >= T.pressEnter ? T.pressEnter + 0.06 : T.nameStep} before={t >= T.pressEnter ? "Entrar a la sala" : "Continuar"} after={t >= T.pressEnter ? "Ingresando…" : "Entrar a la sala"} />
        <ArrowRight data-icon="inline-end" />
      </Button>

      <p className="mt-5 border-t pt-4 text-center text-xs leading-relaxed text-muted">
        <Swapped at={T.nameStep} before={<>¿Querés usar tu cuenta? <a className="font-medium text-brand-deep underline underline-offset-4">Iniciá sesión (opcional)</a></>} after="No hace falta iniciar sesión." />
      </p>
    </form>
  );
}

export function StudentPage() {
  const { t } = useScene();
  if (t >= T.act2Swap) return <Runtime />;
  // The card is hidden while the morph box carries it back to the teacher.
  const cardOpacity = t >= T.morphRow ? 0 : 1;
  return (
    <div className="absolute inset-0 bg-canvas">
      <StudentHeader />
      <main className="mx-auto grid min-h-[750px] max-w-lg place-items-center px-4 py-12">
        <div className="w-full" {...anchor("join-card")} style={{ opacity: cardOpacity }}>
          <JoinCard />
        </div>
      </main>
    </div>
  );
}
