import { useEffect, useRef } from "react";

export type ClientIncidentType =
  | "cambio-de-pestana"
  | "ventana-sin-foco"
  | "atajo-f12"
  | "atajo-copiar-pegar"
  | "salida-pantalla-completa";

export interface ClientIncident {
  type: ClientIncidentType;
  at: number;
  durationMs: number;
  meta: Record<string, unknown>;
}

interface UseExamMonitoringOptions {
  active: boolean;
  participantId: string;
  onIncident: (incident: ClientIncident) => void;
  activeQuestionId: string;
  detectFocusLoss?: boolean;
  blockClipboard?: boolean;
  requireFullscreen?: boolean;
}

export interface Absence {
  startedAt: number;
  sawHidden: boolean;
}

export type PresenceSignal = "blur" | "focus" | "hidden" | "visible";

interface ClipboardLikeEvent {
  type: string;
  clipboardData?: { getData(type: string): string } | null;
  target?: EventTarget | null;
}

/** Devuelve solamente la longitud; el texto nunca sale de esta funcion. */
export function clipboardCharacterCount(
  event: ClipboardLikeEvent,
  selectionText = typeof window === "undefined" ? "" : window.getSelection()?.toString() ?? "",
): number | null {
  if (event.type === "paste") {
    const pasted = event.clipboardData?.getData("text/plain") ?? "";
    return pasted.length > 0 ? pasted.length : null;
  }

  const target = event.target;
  if (typeof HTMLInputElement !== "undefined" && typeof HTMLTextAreaElement !== "undefined"
    && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    const start = target.selectionStart;
    const end = target.selectionEnd;
    if (start !== null && end !== null && end > start) return end - start;
  }
  return selectionText.length > 0 ? selectionText.length : null;
}

export function isDuplicateClipboardIncident(
  previous: { action: string; characters: number | null; questionId: string; at: number } | null,
  next: { action: string; characters: number | null; questionId: string; at: number },
  windowMs = 750,
) {
  return Boolean(previous
    && previous.action === next.action
    && previous.characters === next.characters
    && previous.questionId === next.questionId
    && next.at - previous.at >= 0
    && next.at - previous.at <= windowMs);
}

/**
 * Decide si el alumno se fue o volvio, a partir del evento y no del estado del DOM.
 *
 * Antes esto se resolvia preguntandole a `document.hasFocus()` desde un
 * `setTimeout(0)`, y en macOS eso no funciona: al hacer Cmd+Tab o cambiar de
 * Space la ventana queda ocluida, el navegador congela los timers y la
 * devolucion de llamada recien corre cuando el alumno ya volvio. Para entonces
 * el DOM dice "visible y con foco" y la ausencia nunca se abria. Safari agrega
 * lo suyo: no marca `visibilityState = "hidden"` al cambiar de aplicacion y
 * `hasFocus()` puede seguir devolviendo `true` en segundo plano.
 *
 * Manejando el evento en si, de forma sincrona, las dos cosas dejan de importar.
 */
export function nextPresence(current: Absence | null, signal: PresenceSignal, at: number): {
  absence: Absence | null;
  returned: Absence | null;
} {
  if (signal === "blur" || signal === "hidden") {
    // `blur` llega antes que `visibilitychange` al cambiar de pestana, asi que
    // la ausencia se abre con el primero y el segundo solo la reclasifica.
    if (!current) return { absence: { startedAt: at, sawHidden: signal === "hidden" }, returned: null };
    return { absence: { ...current, sawHidden: current.sawHidden || signal === "hidden" }, returned: null };
  }
  if (!current) return { absence: null, returned: null };
  return { absence: null, returned: current };
}

export function useExamMonitoring({ active, participantId, onIncident, activeQuestionId, detectFocusLoss = true, blockClipboard = false, requireFullscreen = false }: UseExamMonitoringOptions) {
  const activeRef = useRef(active);
  const callbackRef = useRef(onIncident);
  const absenceRef = useRef<Absence | null>(null);
  const wasFullscreenRef = useRef(false);
  const questionRef = useRef(activeQuestionId);
  const lastClipboardRef = useRef<{ action: string; characters: number | null; questionId: string; at: number } | null>(null);

  useEffect(() => {
    activeRef.current = active;
    callbackRef.current = onIncident;
    questionRef.current = activeQuestionId;
  }, [active, activeQuestionId, onIncident]);

  useEffect(() => {
    const watching = () => activeRef.current;
    const emit = (incident: ClientIncident) => {
      if (!watching()) return;
      callbackRef.current({ ...incident, meta: { ...incident.meta, questionId: questionRef.current } });
    };

    const sendLifecycle = (event: "hidden" | "pagehide") => {
      if (!watching()) return;
      const body = JSON.stringify({ participantId, event, at: Date.now(), questionId: questionRef.current });
      navigator.sendBeacon("/api/student/lifecycle", new Blob([body], { type: "application/json" }));
    };

    const applyPresence = (signal: PresenceSignal) => {
      if (!watching() || !detectFocusLoss) {
        absenceRef.current = null;
        return;
      }

      const at = Date.now();
      const { absence, returned } = nextPresence(absenceRef.current, signal, at);
      absenceRef.current = absence;
      if (!returned) return;
      emit({
        type: returned.sawHidden ? "cambio-de-pestana" : "ventana-sin-foco",
        at: returned.startedAt,
        durationMs: Math.max(0, at - returned.startedAt),
        meta: {},
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        sendLifecycle("hidden");
        applyPresence("hidden");
        return;
      }
      applyPresence("visible");
    };
    const onBlur = () => applyPresence("blur");
    const onFocus = () => applyPresence("focus");
    const onKeyDown = (event: KeyboardEvent) => {
      if (!watching()) return;
      if (event.key === "F12") {
        if (blockClipboard) event.preventDefault();
        emit({ type: "atajo-f12", at: Date.now(), durationMs: 0, meta: {} });
      }
    };
    const onClipboard = (event: ClipboardEvent) => {
      if (!watching()) return;
      const at = Date.now();
      const action = event.type;
      const characters = clipboardCharacterCount(event);
      const fingerprint = { action, characters, questionId: questionRef.current, at };
      if (isDuplicateClipboardIncident(lastClipboardRef.current, fingerprint)) {
        if (blockClipboard) event.preventDefault();
        return;
      }
      lastClipboardRef.current = fingerprint;
      emit({
        type: "atajo-copiar-pegar",
        at,
        durationMs: 0,
        meta: { action, characters },
      });
      // Bloquear el evento real preserva la deteccion de Ctrl/Cmd+C/V.
      if (blockClipboard) event.preventDefault();
    };
    const onFullscreen = () => {
      if (document.fullscreenElement) {
        wasFullscreenRef.current = true;
        return;
      }
      if (watching() && requireFullscreen && wasFullscreenRef.current) {
        wasFullscreenRef.current = false;
        emit({ type: "salida-pantalla-completa", at: Date.now(), durationMs: 0, meta: {} });
      }
    };
    const onPageHide = () => sendLifecycle("pagehide");

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("copy", onClipboard);
    document.addEventListener("cut", onClipboard);
    document.addEventListener("paste", onClipboard);
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("copy", onClipboard);
      document.removeEventListener("cut", onClipboard);
      document.removeEventListener("paste", onClipboard);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [blockClipboard, detectFocusLoss, participantId, requireFullscreen]);
}
