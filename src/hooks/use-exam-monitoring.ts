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

interface Absence {
  startedAt: number;
  sawHidden: boolean;
}

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

    const reconcilePresence = () => {
      if (!watching()) {
        absenceRef.current = null;
        return;
      }

      const hidden = document.visibilityState === "hidden";
      const unfocused = !document.hasFocus();
      if (detectFocusLoss && (hidden || unfocused)) {
        if (!absenceRef.current) absenceRef.current = { startedAt: Date.now(), sawHidden: hidden };
        if (hidden) absenceRef.current.sawHidden = true;
        return;
      }

      const absence = absenceRef.current;
      if (!absence) return;
      absenceRef.current = null;
      emit({
        type: absence.sawHidden ? "cambio-de-pestana" : "ventana-sin-foco",
        at: absence.startedAt,
        durationMs: Math.max(0, Date.now() - absence.startedAt),
        meta: {},
      });
    };

    const scheduleReconciliation = () => window.setTimeout(reconcilePresence, 0);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") sendLifecycle("hidden");
      scheduleReconciliation();
    };
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
    window.addEventListener("blur", scheduleReconciliation);
    window.addEventListener("focus", scheduleReconciliation);
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("copy", onClipboard);
    document.addEventListener("cut", onClipboard);
    document.addEventListener("paste", onClipboard);
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", scheduleReconciliation);
      window.removeEventListener("focus", scheduleReconciliation);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("copy", onClipboard);
      document.removeEventListener("cut", onClipboard);
      document.removeEventListener("paste", onClipboard);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [blockClipboard, detectFocusLoss, participantId, requireFullscreen]);
}
