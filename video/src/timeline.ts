// Single source of truth for timing. The music imports this file (Node type
// stripping), so it stays free of DOM and React.

export const BPM = 120;
export const BEAT = 60 / BPM; // 0.5 s
export const BAR = BEAT * 4; // 2 s
export const SIXTEENTH = BEAT / 4; // 0.125 s
export const THIRTY_SECOND = BEAT / 8; // 0.0625 s
export const DURATION = 34; // 17 bars
export const FPS = 60;

/**
 * Global pace. Everything in this file is "story time" on a 120 BPM grid; the
 * video plays it PACE times slower (video time = story time × PACE), so the
 * music runs at 120 / PACE = 100 BPM. Only the boundaries convert: main.tsx
 * (video → story), the renderer (video time) and the music (story → video).
 */
export const PACE = 1.2;
export const VIDEO_DURATION = DURATION * PACE; // 40.8 s

export const beats = (n: number) => n * BEAT;
export const bars = (n: number) => n * BAR;
export const snap = (t: number, grid = SIXTEENTH) => Math.round(t / grid) * grid;

export type Section = "evaluaciones" | "sesiones" | "correcciones" | "resultados";

/**
 * Text cards between acts. `in`: the words start rising; `out`: they start
 * lifting away while the next UI emerges. The UI recedes just before `in`.
 */
export interface Card {
  in: number;
  out: number;
  /** Words; the ones wrapped in *asterisks* are the key phrase (brand color). */
  text: string;
}

export const CARDS: ReadonlyArray<Card> = [
  { in: 0.1, out: 1.35, text: "Creá tu *examen.*" },
  { in: 11.35, out: 12.55, text: "Mientras rinden, *Testra registra.*" },
  { in: 19.6, out: 20.8, text: "Cada aviso, *con su contexto.*" },
  { in: 24.6, out: 25.8, text: "La IA sugiere. *Vos decidís.*" },
];

export const T = {
  // Scene swaps happen while the UI is hidden behind a card.
  act2Swap: 11.9,
  act3Swap: 20.0,
  act4Swap: 25.0,

  // Card 1 → editor
  editorIn: 1.5, // the editor emerges as card 1 lifts
  pullOut: 1.5, // (music) first UI on screen
  cursorEnter: 1.8,
  clickKey: 2.25, // "Fotosíntesis" radio
  saveDone: 2.875, // spinner → check
  clickSelect: 3.0, // opens "Tipo de respuesta"
  clickOption: 4.0, // clicks "Opción única" again: closes, value kept
  clickPrepare: 5.0, // "Preparar para el curso"

  // Room + student join
  morphRoom: 5.5, // button → room card
  morphRoomEnd: 6.0,
  codeType: 6.0, // K7M4QH, one char per 16th
  codeLift: 6.75, // code → chip
  codeLand: 7.25, // chip → join input
  pressContinue: 7.375,
  nameStep: 7.5,
  nameType: 7.625, // "Lucía Paredes", one char per 32nd
  pressEnter: 8.5,
  morphRow: 8.75, // join card → table row
  morphRowEnd: 9.25,
  rowsEnter: [9.5, 9.75, 10.0, 10.25], // rows 2–5
  clickStart: 10.5, // "Iniciar evaluación"; the run clock starts here
  runningSwap: 10.625,
  rindiendo: 10.625, // first row of the cascade, then 1/16 stagger

  // Card 2 → student runtime
  runtimeIn: 12.7,
  answerType: 13.0, // "clorofila", one char per 32nd
  answerSaved: 13.75,
  leave: 14.0, // Lucía leaves the window
  back: 14.5, // …and comes back 4,3 s later (screen time is compressed)
  dialogOpen: 14.75, // "Este evento quedó registrado"
  clickUnderstood: 16.5, // "Entendido"
  flyStart: 16.55, // the event flies to the teacher
  signal: 17.0, // AHA: it lands in "Avisos de actividad"
  signalPaste: 18.25, // a second signal arrives (copy/paste, question 3)
  clickEnd: 19.0, // "Finalizar evaluación"
  endedSwap: 19.125,
  entrego: 19.125,
  badgeFive: 19.25,

  // Card 3 → per-student report
  reportIn: 20.95,
  clickReport: 21.5, // Lucía's name in Resultados
  reportOpen: 21.55,
  reportScroll: 21.8, // the dialog scrolls to "Avisos (2)"
  reportPan: 23.25, // guided pan from the first card to the second

  // Card 4 → AI correction
  morphAi: 25.8, // the AI card is on screen as card 4 lifts
  morphAiEnd: 25.8,
  aiCountStart: 26.25,
  aiCountEnd: 26.75,
  clickAccept: 27.75,
  saved: 28.125,
  pushIn: 28.0,

  // Results
  morphResults: 29.25, // AI card → results row
  morphResultsEnd: 29.75,
  publishEnabled: 29.75,
  clickPublish: 30.25,
  published: 30.5,

  // Outro
  outro: 31.25,
  tagline: 31.875,
  fadeOut: 33.4,
  end: DURATION,
} as const;

/** Every click of whoever's cursor is on screen. */
export const CLICKS = [
  T.clickKey,
  T.clickSelect,
  T.clickOption,
  T.clickPrepare,
  T.clickStart,
  T.clickUnderstood,
  T.clickEnd,
  T.clickReport,
  T.clickAccept,
  T.clickPublish,
] as const;

/** Active top-nav tab over time; the underline slides between them. */
export const NAV: ReadonlyArray<{ t: number; section: Section }> = [
  { t: 0, section: "evaluaciones" },
  { t: T.morphRoom, section: "sesiones" },
  { t: T.act3Swap, section: "resultados" }, // behind card 3
  { t: T.act4Swap, section: "correcciones" }, // behind card 4
  { t: T.morphResults, section: "resultados" },
];

export const EXAM_CODE = "K7M4QH";
export const STUDENT_NAME = "Lucía Paredes";
export const ANSWER = "clorofila";

export const codeKeyTimes = EXAM_CODE.split("").map((_, i) => T.codeType + i * SIXTEENTH);
export const nameKeyTimes = STUDENT_NAME.split("").map((_, i) => T.nameType + i * THIRTY_SECOND);
export const answerKeyTimes = ANSWER.split("").map((_, i) => T.answerType + i * THIRTY_SECOND);
export const rindiendoTimes = [0, 1, 2, 3, 4].map((i) => T.rindiendo + i * SIXTEENTH);
export const entregoTimes = [0, 1, 2, 3, 4].map((i) => T.entrego + i * SIXTEENTH);
/** Menu items the pointer passes over while the select is open (index, time). */
export const selectHover: ReadonlyArray<readonly [number, number]> = [
  [0, 3.1],
  [1, 3.25],
  [2, 3.375],
  [3, 3.5],
  [4, 3.625],
  [3, 3.75],
  [2, 3.8125],
  [1, 3.875],
  [0, 3.9375],
];

/** Per-student "Avance" ticks (answered 1, 2, 3). The camera is on Lucía then. */
export const progressTicks: ReadonlyArray<ReadonlyArray<number>> = [
  [11.0, 13.75, 18.5],
  [11.125, 17.5, 18.625],
  [11.25, 17.625, 18.75],
  [11.375, 17.75, 18.5],
  [11.5, 17.875, 18.625],
];

export type AccentKind = "click" | "key" | "row" | "swap" | "aha" | "morph" | "count" | "logo" | "card" | "scene";

export interface AccentEvent {
  t: number;
  kind: AccentKind;
  label: string;
}

const ev = (t: number, kind: AccentKind, label: string): AccentEvent => ({ t, kind, label });

/** Everything the music may want to hit, in time order. */
export const EVENTS: ReadonlyArray<AccentEvent> = [
  ...CARDS.flatMap((c, i) => [ev(c.in, "card", `tarjeta-${i + 1}-entra`), ev(c.out, "card", `tarjeta-${i + 1}-sale`)]),
  ev(T.editorIn, "scene", "editor"),
  ev(T.clickKey, "click", "clave"),
  ev(T.saveDone, "swap", "guardado"),
  ev(T.clickSelect, "click", "tipo-abre"),
  ...selectHover.map(([item, t]) => ev(t, "count", `tipo-hover-${item + 1}`)),
  ev(T.clickOption, "click", "tipo-cierra"),
  ev(T.clickPrepare, "click", "preparar"),
  ev(T.morphRoom, "morph", "sala"),
  ...codeKeyTimes.map((t, i) => ev(t, "key", `codigo-${i + 1}`)),
  ev(T.codeLift, "morph", "codigo-vuela"),
  ev(T.codeLand, "swap", "codigo-llega"),
  ev(T.pressContinue, "click", "continuar"),
  ev(T.nameStep, "swap", "nombre"),
  ...nameKeyTimes.map((t, i) => ev(t, "key", `nombre-${i + 1}`)),
  ev(T.pressEnter, "click", "entrar"),
  ev(T.morphRow, "morph", "fila"),
  ev(T.morphRowEnd, "row", "alumno-1"),
  ...T.rowsEnter.map((t, i) => ev(t, "row", `alumno-${i + 2}`)),
  ev(T.clickStart, "click", "iniciar"),
  ...rindiendoTimes.map((t, i) => ev(t, "swap", `rindiendo-${i + 1}`)),
  ...progressTicks.flatMap((ticks, s) => ticks.map((t, i) => ev(t, "count", `avance-${s + 1}-${i + 1}`))),
  ev(T.runtimeIn, "scene", "alumna"),
  ...answerKeyTimes.map((t, i) => ev(t, "key", `respuesta-${i + 1}`)),
  ev(T.answerSaved, "swap", "respuesta-guardada"),
  ev(T.leave, "scene", "alumna-sale"),
  ev(T.back, "scene", "alumna-vuelve"),
  ev(T.dialogOpen, "swap", "dialogo"),
  ev(T.clickUnderstood, "click", "entendido"),
  ev(T.flyStart, "morph", "vuela-al-docente"),
  ev(T.signal, "aha", "aviso"),
  ev(T.signalPaste, "count", "aviso-2"),
  ev(T.clickEnd, "click", "finalizar"),
  ...entregoTimes.map((t, i) => ev(t, "swap", `entrego-${i + 1}`)),
  ev(T.reportIn, "scene", "resultados"),
  ev(T.clickReport, "click", "informe"),
  ev(T.reportOpen, "swap", "informe-abre"),
  ev(T.reportScroll, "morph", "informe-avisos"),
  ev(T.reportPan, "morph", "informe-segundo-aviso"),
  ev(T.morphAi, "scene", "correccion"),
  ev(T.aiCountStart, "count", "sugerencia"),
  ev(T.clickAccept, "click", "aceptar"),
  ev(T.saved, "swap", "guardado"),
  ev(T.pushIn, "morph", "la-nota-la-pones-vos"),
  ev(T.morphResults, "morph", "resultados"),
  ev(T.publishEnabled, "swap", "publicar-habilitado"),
  ev(T.clickPublish, "click", "publicar"),
  ev(T.published, "swap", "publicados"),
  ev(T.outro, "logo", "cierre"),
].sort((a, b) => a.t - b.t);

/**
 * Windows where some tween (other than camera and cursor, which are checked
 * analytically) is still moving. Used by `__motion` for motion-blur subframes.
 */
export const TWEEN_WINDOWS: ReadonlyArray<readonly [number, number]> = [
  ...CARDS.flatMap((c) => [[c.in - 0.3, c.in + 0.8] as const, [c.out - 0.1, c.out + 0.6] as const]),
  [T.clickKey, T.saveDone + 0.3],
  [T.clickSelect, T.clickOption + 0.25],
  [T.clickPrepare, T.clickPrepare + 0.2],
  [T.morphRoom, T.morphRoomEnd + 0.6],
  [T.codeLift, T.codeLand + 0.25],
  [T.pressContinue, T.nameStep + 0.2],
  [T.pressEnter, T.morphRowEnd + 0.1],
  [T.morphRowEnd, T.rowsEnter[3] + 0.6],
  [T.clickStart, T.rindiendo + 5 * SIXTEENTH + 0.2],
  [T.leave - 0.05, T.back + 0.3],
  [T.dialogOpen, T.dialogOpen + 0.3],
  [T.clickUnderstood, T.signal + 0.5],
  [T.signalPaste, T.signalPaste + 0.5],
  [T.clickEnd, T.entrego + 5 * SIXTEENTH + 0.2],
  [T.badgeFive, T.badgeFive + 0.2],
  [T.clickReport, T.reportScroll + 0.5],
  [T.aiCountStart - 0.2, T.aiCountEnd + 0.6],
  [T.clickAccept, T.saved + 0.4],
  [T.morphResults, T.publishEnabled + 0.3],
  [T.clickPublish, T.published + 0.3],
  [T.outro, T.tagline + 0.6],
  [T.fadeOut, DURATION],
  ...NAV.slice(1).map((n) => [n.t, n.t + 0.7] as const),
];
