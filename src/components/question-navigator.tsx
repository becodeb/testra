import { Check, CircleAlert, Plus } from "lucide-react";

import type { QuestionCompletion } from "@/domain/exam";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface QuestionNavigatorProps {
  states: QuestionCompletion[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onAdd?: () => void;
  onMove?: (from: number, to: number) => void;
  mode?: "teacher" | "student";
}

const stateLabel: Record<QuestionCompletion, string> = {
  complete: "completa",
  "missing-key": "falta la clave",
  empty: "sin completar",
};

export function QuestionNavigator({
  states,
  activeIndex,
  onSelect,
  onAdd,
  onMove,
  mode = "teacher",
}: QuestionNavigatorProps) {
  return (
    <nav aria-label="Navegación entre preguntas" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {states.map((state, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={index}
              type="button"
              draggable={Boolean(onMove)}
              onDragStart={(event) => event.dataTransfer.setData("text/plain", String(index))}
              onDragOver={(event) => onMove && event.preventDefault()}
              onDrop={(event) => {
                if (!onMove) return;
                event.preventDefault();
                const from = Number(event.dataTransfer.getData("text/plain"));
                if (Number.isInteger(from)) onMove(from, index);
              }}
              onClick={() => onSelect(index)}
              aria-current={active ? "step" : undefined}
              aria-label={`Pregunta ${index + 1}, ${active ? "activa, " : ""}${stateLabel[state]}`}
              className={cn(
                "relative grid size-9 place-items-center rounded-full border text-sm font-semibold tabular transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-[cubic-bezier(.2,.7,.3,1)] active:scale-[.97]",
                state === "complete" && "border-brand bg-brand-soft text-brand-deep",
                state === "missing-key" && "border-warn bg-white text-warn",
                state === "empty" && "border-line-2 bg-white text-muted",
                active && "bg-brand text-white ring-2 ring-brand/25 ring-offset-2",
              )}
            >
              {index + 1}
              {!active && state === "complete" ? (
                <Check className="absolute -right-1 -bottom-1 size-3.5 rounded-full bg-ok p-0.5 text-white" aria-hidden="true" />
              ) : null}
              {!active && state === "missing-key" ? (
                <CircleAlert className="absolute -right-1 -bottom-1 size-3.5 rounded-full bg-white text-warn" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
        {onAdd ? (
          <Button type="button" variant="outline" size="icon" onClick={onAdd} aria-label="Agregar pregunta">
            <Plus />
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-brand" aria-hidden="true" /> Activa
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Check className="size-3.5 text-ok" aria-hidden="true" />
          {mode === "teacher" ? "Completa" : "Respondida"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <CircleAlert className="size-3.5 text-warn" aria-hidden="true" />
          {mode === "teacher" ? "Falta la clave" : "Te falta"}
        </span>
        {onAdd ? <span className="ms-auto hidden text-muted md:inline">Ctrl/⌘ + Enter para agregar</span> : null}
      </div>
    </nav>
  );
}
