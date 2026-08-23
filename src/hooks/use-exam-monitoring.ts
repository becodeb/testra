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

export function useExamMonitoring({ active, participantId, onIncident, activeQuestionId, detectFocusLoss = true, blockClipboard = false, requireFullscreen = false }: UseExamMonitoringOptions) {
  const activeRef = useRef(active);
  const callbackRef = useRef(onIncident);
  const absenceRef = useRef<Absence | null>(null);
  const wasFullscreenRef = useRef(false);
  const questionRef = useRef(activeQuestionId);

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
      if (!blockClipboard) return;
      event.preventDefault();
      if (event.key === "F12") {
        emit({ type: "atajo-f12", at: Date.now(), durationMs: 0, meta: {} });
      }
    };
    const onClipboard = (event: ClipboardEvent) => {
      if (!watching()) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      emit({
        type: "atajo-copiar-pegar",
        at: Date.now(),
        durationMs: 0,
        meta: { action: event.type, characters: text.length },
      });
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
