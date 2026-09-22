import { useId, useState, type AnimationEvent, type CSSProperties, type ReactNode, type Ref } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** El anillo quieto sobre el control que el visitante tiene que usar ahora. */
export function cue(active: boolean) {
  return active ? "demo-cue" : undefined;
}

/**
 * Cuánto hacía que había pasado `at` cuando el elemento se montó. Se calcula
 * una sola vez: así un aviso que se vuelve a montar (al abrir la pantalla del
 * docente en el teléfono) retoma su animación donde iba en vez de repetirla.
 */
export function useAgeOnMount(at: number | null) {
  const [age] = useState(() => (at === null ? Number.POSITIVE_INFINITY : Math.max(0, Date.now() - at)));
  return age;
}

/** Retraso negativo para retomar una animación que ya empezó. */
export function resumeAt(ageMs: number): CSSProperties {
  return { animationDelay: `-${Math.round(ageMs)}ms` };
}

/**
 * Cambia de contenido con un fundido cruzado de 150 ms. `id` dice cuándo es
 * otro contenido; si solo cambió el texto de adentro, se actualiza en el lugar.
 */
export function Crossfade<T>({ id, value, render, className }: { id: string; value: T; render: (value: T) => ReactNode; className?: string }) {
  const [shownId, setShownId] = useState(id);
  const [snapshot, setSnapshot] = useState(value);
  const [leaving, setLeaving] = useState<{ id: string; value: T } | null>(null);

  if (id !== shownId) {
    setLeaving({ id: shownId, value: snapshot });
    setShownId(id);
    setSnapshot(value);
  }

  // `animationend` burbujea: sin este filtro, la animación de un hijo daba por
  // terminado el fundido antes de tiempo.
  const done = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) setLeaving(null);
  };

  return (
    <div className={cn("grid", className)}>
      {leaving ? (
        <div key={`out-${leaving.id}`} aria-hidden="true" className="demo-fade-out [grid-area:1/1]" onAnimationEnd={done}>
          {render(leaving.value)}
        </div>
      ) : null}
      <div key={`in-${id}`} className={cn("[grid-area:1/1]", leaving && "demo-fade-in")}>
        {render(value)}
      </div>
    </div>
  );
}

/** Un número que da un saltito cuando cambia, no cuando aparece. */
export function BumpValue({ value, className }: { value: string; className?: string }) {
  const [seen, setSeen] = useState(value);
  const [bumps, setBumps] = useState(0);
  if (value !== seen) {
    setSeen(value);
    setBumps((count) => count + 1);
  }
  return <span key={bumps} className={cn("inline-block", bumps > 0 && "demo-bump", className)}>{value}</span>;
}

/**
 * El marco de cada pantalla del escenario. Adentro va el producto tal cual; el
 * marco es lo único que agrega la demo, y por eso es mínimo.
 */
export function ScreenFrame({
  icon: Icon,
  label,
  className,
  frameRef,
  children,
}: {
  icon: LucideIcon;
  label: string;
  className?: string;
  frameRef?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  const labelId = useId();
  return (
    <section
      ref={frameRef}
      aria-labelledby={labelId}
      className={cn("relative isolate flex min-h-0 flex-col overflow-hidden rounded-lg border bg-paper shadow-card", className)}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-paper px-3 text-xs font-semibold text-muted">
        <Icon className="size-3.5" aria-hidden="true" />
        <h2 id={labelId}>{label}</h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col bg-canvas lg:overflow-y-auto">{children}</div>
    </section>
  );
}
