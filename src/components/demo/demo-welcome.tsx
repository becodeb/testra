import { Lock, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";

const STEPS = [
  { title: "Armá la evaluación", text: "Pegá las preguntas y marcá las respuestas correctas." },
  { title: "Rendila como alumno", text: "Intentá copiarte y mirá qué le llega a tu docente." },
  { title: "Revisá el informe", text: "La nota, los avisos y en qué pregunta estabas." },
];

/**
 * Cerrarla de cualquier forma arranca la demo: con Escape, tocando afuera o
 * con la cruz. Nadie queda atrapado en una bienvenida.
 */
export function DemoWelcome({ open, onStart, onClosed }: { open: boolean; onStart: () => void; onClosed: () => void }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onStart(); }}>
      <DialogPortal>
        {/* El `animate-in` de shadcn no hace nada en este proyecto: la entrada
            es la de la demo, de 150 ms. */}
        <DialogOverlay className="demo-fade-in bg-ink/45 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onClosed();
          }}
          className="demo-dialog-in fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-5 rounded-lg border bg-paper p-6 shadow-lg outline-none sm:p-7"
        >
          <div className="pe-8">
            <DialogPrimitive.Title className="text-xl font-semibold tracking-[-.02em] text-ink">Probá Testra en tres minutos</DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-2 text-sm leading-6 text-ink-2">
              Vas a ver las dos pantallas: la del docente que arma la evaluación y la del alumno que la rinde.
            </DialogPrimitive.Description>
          </div>
          <ol className="grid gap-3.5">
            {STEPS.map((step, index) => (
              <li key={step.title} className="grid grid-cols-[auto_1fr] items-start gap-3">
                <span aria-hidden="true" className="grid size-6 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand-deep tabular">{index + 1}</span>
                <p className="text-sm leading-5">
                  <span className="block font-semibold text-ink">{step.title}</span>
                  <span className="block text-muted">{step.text}</span>
                </p>
              </li>
            ))}
          </ol>
          <p className="flex items-start gap-2 rounded-md bg-inset px-3 py-2.5 text-xs leading-5 text-ink-2">
            <Lock className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden="true" />
            Sin cuenta. Todo pasa en tu navegador: nada se envía a Testra.
          </p>
          <div className="flex justify-end">
            <DialogPrimitive.Close asChild>
              <Button type="button" className="w-full sm:w-auto">Empezar</Button>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Close className="absolute top-4 right-4 grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-inset hover:text-ink" aria-label="Cerrar">
            <X className="size-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
