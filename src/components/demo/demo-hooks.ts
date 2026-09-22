import { useCallback, useEffect, useRef, useState } from "react";

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

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
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

export interface FullscreenControl {
  isFullscreen: boolean;
  /** El navegador no la ofrece o la rechazó: la evaluación sigue sin ella. */
  unavailable: boolean;
  request: () => Promise<void>;
  exit: () => void;
}

export function useFullscreen(): FullscreenControl {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const update = () => setIsFullscreen(Boolean(document.fullscreenElement));
    update();
    // En el iPhone no existe la API sobre la página: no hay nada que pedir.
    setUnavailable(!document.fullscreenEnabled || typeof document.documentElement.requestFullscreen !== "function");
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  const request = useCallback(async () => {
    try {
      // Sobre la página entera, para que las dos pantallas sigan a la vista.
      await document.documentElement.requestFullscreen();
    } catch {
      // Pantalla completa es una invitación; un rechazo nunca bloquea la
      // evaluación. Es lo que promete el producto.
      setUnavailable(true);
    }
  }, []);

  const exit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  return { isFullscreen, unavailable, request, exit };
}
