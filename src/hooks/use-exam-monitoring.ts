import { useEffect, useRef } from "react";

const INTEGRITY_MS = 10_000;
const CLOCK_MS = 2_000;

export type ClientIncidentType =
  | "cambio-de-pestana"
  | "ventana-sin-foco"
  | "atajo-f12"
  | "atajo-copiar-pegar"
  | "salida-pantalla-completa"
  | "manipulacion-de-supervision";

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

/**
 * El atajo de portapapeles, mirado como tecla.
 *
 * El evento `copy` sólo llega si el navegador tuvo algo que copiar: sin
 * selección, Ctrl+C no dispara nada y la acción quedaba sin registrar. Mirar la
 * tecla cubre ese caso, y en Mac hay que aceptar Cmd además de Ctrl.
 */
export function clipboardShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean }): "copiar" | "cortar" | "pegar" | null {
  if (!event.ctrlKey && !event.metaKey) return null;
  const key = event.key.toLowerCase();
  if (key === "c") return "copiar";
  if (key === "x") return "cortar";
  if (key === "v") return "pegar";
  return null;
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

/**
 * `focus` y `blur` no burbujean, pero si atraviesan la fase de captura. Como los
 * oyentes estan puestos sobre `window` con `capture: true` —para que un script
 * pegado en la consola no pueda taparlos—, tambien llegan los de cada campo de
 * la evaluacion: pasar de una pregunta a otra dispara el `blur` del control que
 * se deja y el `focus` del que se toma.
 *
 * Sin este filtro ese gesto abria y cerraba una ausencia en el mismo instante
 * (el incidente de 0 segundos) y, peor, pisaba la ausencia real: la salida de
 * verdad quedaba cerrada por el primer clic al volver. Ademas mantenia vivo el
 * `lastPresenceAt`, que es justo lo que apaga la deteccion por reloj.
 *
 * Solo la ventana entera cuenta como presencia.
 */
export function isWindowPresenceEvent(event: { target: unknown }, win: unknown): boolean {
  return event.target === win;
}

/**
 * Detecta que alguien anuló la supervision desde la consola.
 *
 * La evaluacion corre en una pestana comun: cualquiera puede abrir las
 * herramientas del navegador y pegar un script. Impedirlo desde la pagina es
 * imposible —el codigo pegado corre en el mismo lugar y con los mismos
 * permisos que el nuestro—, asi que en vez de intentar bloquearlo se registra.
 *
 * Los scripts que circulan hacen siempre lo mismo: reemplazan
 * `document.hasFocus`, redefinen `visibilityState` o pisan `window.onblur`.
 * Todo eso deja la misma huella, que donde el navegador traia una funcion
 * nativa ahora hay una escrita en la pagina. `[native code]` sólo aparece en
 * las nativas.
 */
export function supervisionTampering(
  doc: Document | object = typeof document === "undefined" ? {} : document,
  win: Window | object = typeof window === "undefined" ? {} : window,
): string[] {
  const signals: string[] = [];
  const isNative = (value: unknown) =>
    typeof value === "function" && Function.prototype.toString.call(value).includes("[native code]");

  const check = (holder: object, prop: string) => {
    let cursor: object | null = holder;
    while (cursor) {
      const found = Object.getOwnPropertyDescriptor(cursor, prop);
      if (found) {
        // Los manejadores tipo `onblur` valen `null` mientras nadie los asigne.
        const impl = found.get ?? found.value;
        if (impl !== null && impl !== undefined && !isNative(impl)) signals.push(prop);
        return;
      }
      cursor = Object.getPrototypeOf(cursor) as object | null;
    }
  };

  check(doc, "hasFocus");
  check(doc, "visibilityState");
  check(doc, "hidden");
  check(doc, "addEventListener");
  check(doc, "onvisibilitychange");
  check(win, "onblur");
  return signals;
}

/**
 * Una pestana tapada no ejecuta sus temporizadores a tiempo: el navegador los
 * estrangula desde afuera y ningun script de la pagina puede evitarlo. Si entre
 * dos vueltas paso mucho mas de lo previsto, la pestana estuvo oculta aunque
 * ningun evento lo haya dicho. Es la senal que sobrevive a que anulen `blur` y
 * `visibilitychange`.
 */
export function clockGap(elapsedMs: number, expectedMs: number, toleranceMs = 6_000): number | null {
  const drift = elapsedMs - expectedMs;
  return drift > toleranceMs ? drift : null;
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
    const onBlur = (event: Event) => { if (isWindowPresenceEvent(event, window)) applyPresence("blur"); };
    const onFocus = (event: Event) => { if (isWindowPresenceEvent(event, window)) applyPresence("focus"); };
    // Cuándo llegó el último evento real de portapapeles, para no contar dos
    // veces la misma acción: si el navegador ya lo reportó con su cantidad de
    // caracteres, ese registro es mejor que el del atajo y manda.
    let ultimoPortapapeles = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!watching()) return;
      if (event.key === "F12") {
        if (blockClipboard) event.preventDefault();
        emit({ type: "atajo-f12", at: Date.now(), durationMs: 0, meta: {} });
        return;
      }
      const atajo = clipboardShortcut(event);
      if (!atajo) return;
      // No se bloquea acá: bloquear la tecla impediría que llegue el evento de
      // portapapeles, que es el que sabe cuántos caracteres eran.
      const at = Date.now();
      window.setTimeout(() => {
        if (!watching() || ultimoPortapapeles >= at) return;
        emit({ type: "atajo-copiar-pegar", at, durationMs: 0, meta: { action: atajo, characters: null, deteccion: "atajo" } });
      }, 250);
    };
    const onClipboard = (event: ClipboardEvent) => {
      if (!watching()) return;
      const at = Date.now();
      ultimoPortapapeles = at;
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

    // Todo va en fase de captura, y no de burbujeo, a proposito. Un script
    // pegado en la consola despues de que cargo la pagina se registra tambien en
    // captura y llama a `stopImmediatePropagation`; eso solo frena a los
    // oyentes que se anotaron DESPUES que el, en la misma fase y el mismo
    // objetivo. Estando ya anotados desde la carga, los nuestros corren
    // primero y el script no llega a taparlos. En burbujeo, en cambio, cualquier
    // captura ajena los mataba a todos: era el agujero.
    const captura = true;
    document.addEventListener("visibilitychange", onVisibility, captura);
    window.addEventListener("blur", onBlur, captura);
    window.addEventListener("focus", onFocus, captura);
    window.addEventListener("keydown", onKeyDown, captura);
    document.addEventListener("copy", onClipboard, captura);
    document.addEventListener("cut", onClipboard, captura);
    document.addEventListener("paste", onClipboard, captura);
    document.addEventListener("fullscreenchange", onFullscreen, captura);
    window.addEventListener("pagehide", onPageHide, captura);

    // Segunda linea, para cuando los eventos no llegan: se avisa de la
    // manipulacion en si, y se mira el reloj para descubrir ausencias que
    // ningun evento reporto.
    let reported = "";
    const integrity = window.setInterval(() => {
      if (!watching()) return;
      const signals = supervisionTampering();
      const fingerprint = signals.join(",");
      if (!fingerprint || fingerprint === reported) return;
      reported = fingerprint;
      emit({ type: "manipulacion-de-supervision", at: Date.now(), durationMs: 0, meta: { signals } });
    }, INTEGRITY_MS);

    let lastTick = Date.now();
    let lastPresenceAt = 0;
    const clock = window.setInterval(() => {
      const at = Date.now();
      const drift = clockGap(at - lastTick, CLOCK_MS);
      lastTick = at;
      if (!watching() || !detectFocusLoss || drift === null) return;
      // Si los eventos hicieron su trabajo la ausencia ya se abrio o se cerro
      // recien: no se cuenta dos veces lo mismo.
      if (absenceRef.current || at - lastPresenceAt <= drift) return;
      emit({ type: "cambio-de-pestana", at: at - drift, durationMs: drift, meta: { deteccion: "reloj" } });
    }, CLOCK_MS);

    const notePresence = (event: Event) => { if (isWindowPresenceEvent(event, window)) lastPresenceAt = Date.now(); };
    window.addEventListener("focus", notePresence, captura);
    window.addEventListener("blur", notePresence, captura);

    return () => {
      window.clearInterval(integrity);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisibility, captura);
      window.removeEventListener("blur", onBlur, captura);
      window.removeEventListener("focus", onFocus, captura);
      window.removeEventListener("keydown", onKeyDown, captura);
      document.removeEventListener("copy", onClipboard, captura);
      document.removeEventListener("cut", onClipboard, captura);
      document.removeEventListener("paste", onClipboard, captura);
      document.removeEventListener("fullscreenchange", onFullscreen, captura);
      window.removeEventListener("pagehide", onPageHide, captura);
      window.removeEventListener("focus", notePresence, captura);
      window.removeEventListener("blur", notePresence, captura);
    };
  }, [blockClipboard, detectFocusLoss, participantId, requireFullscreen]);
}
