import { Eye, X } from "lucide-react";

import { Button } from "@/components/ui/button";

/** La cabecera de la demo: la de StudentLayout lleva al login y a las páginas legales. */
export function DemoTopBar({ markSrc }: { markSrc: string }) {
  return (
    <header className="border-b bg-paper">
      <div className="mx-auto flex h-12 max-w-[1020px] items-center justify-between gap-3 px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <a href="/" className="flex items-center gap-2.5" aria-label="Testra, inicio">
            <span className="testra-mark" aria-hidden="true"><img src={markSrc} alt="" width={64} height={64} /></span>
            <span className="font-bold tracking-[-.025em] text-brand-deep">Testra</span>
          </a>
          <span className="rounded-sm bg-inset px-1.5 text-xs font-medium text-ink-2">Demo</span>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <a href="/">
            <X data-icon="inline-start" aria-hidden="true" />
            Salir
          </a>
        </Button>
      </div>
    </header>
  );
}

/**
 * Lo único que la demo le dice al visitante. De acá para abajo, todo es la
 * pantalla del alumno tal como se ve en una toma real.
 */
export function DemoIntro() {
  return (
    <div className="border-b border-brand/10 bg-brand-soft">
      <p className="mx-auto flex max-w-[1020px] items-start gap-2 px-4 py-2 text-sm leading-5 text-brand-deep lg:px-6">
        <Eye className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
        Evaluación de prueba: respondé y probá copiarte. Al entregar ves lo que vio tu docente.
      </p>
    </div>
  );
}
