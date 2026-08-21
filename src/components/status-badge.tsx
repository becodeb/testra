import { useEffect, useLayoutEffect, useRef, useState } from "react";

type StatusState = "loading" | "done";

export function StatusBadge({ state, label }: { state: StatusState; label?: string }) {
  const markRef = useRef<SVGPathElement>(null);
  const mounted = useRef(false);
  const [length, setLength] = useState<number>();
  const [crossing, setCrossing] = useState(false);

  useLayoutEffect(() => {
    if (markRef.current) setLength(Math.ceil(markRef.current.getTotalLength()));
  }, []);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }

    setCrossing(true);
    const timer = window.setTimeout(() => setCrossing(false), 90);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <span className={`t-check-blur-wrap${crossing ? " is-crossing" : ""}`}>
      <span
        className="t-check-badge"
        data-state={state}
        style={length ? ({ "--check-mark-len": length } as React.CSSProperties) : undefined}
        role="img"
        aria-label={label ?? (state === "done" ? "Guardado" : "Guardando")}
      >
        <span className="t-check-ring" aria-hidden="true" />
        <span className="t-check-arc" aria-hidden="true" />
        <span className="t-check-fill" aria-hidden="true" />
        <span className="t-check-disc" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path ref={markRef} className="t-check-mark" d="M8 12.5L10.8 15.5L16.4 9.5" />
          </svg>
        </span>
      </span>
    </span>
  );
}
