import { useEffect, useRef, useState } from "react";

/**
 * Re-renderiza una vez por segundo mientras `running` sea verdadero. El reloj
 * se lee con `Date.now()` al dibujar: el intervalo solo avisa que hay que
 * volver a mirar, así que una pestaña estrangulada no lo atrasa.
 */
export function useSecondTicks(running: boolean) {
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTicks((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);
  return ticks;
}

/**
 * "Guardando…" y después "Guardado" cada vez que cambia `signal`, con la pausa
 * del autoguardado del producto. No hay servidor: lo guardado queda en memoria,
 * y eso es lo que dice el indicador.
 */
export function useSaveStatus(signal: string): "loading" | "done" {
  const [state, setState] = useState<"loading" | "done">("done");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setState("loading");
    const timer = window.setTimeout(() => setState("done"), 450);
    return () => window.clearTimeout(timer);
  }, [signal]);
  return state;
}
