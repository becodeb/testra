// Single source of truth for timing. The music task imports this file, so it
// stays free of DOM and React.

export const BPM = 120;
export const BEAT = 60 / BPM; // 0.5 s
export const BAR = BEAT * 4; // 2 s
export const SIXTEENTH = BEAT / 4; // 0.125 s
export const THIRTY_SECOND = BEAT / 8; // 0.0625 s
export const DURATION = 24;
export const FPS = 60;

export const beats = (n: number) => n * BEAT;
export const bars = (n: number) => n * BAR;
export const snap = (t: number, grid = SIXTEENTH) => Math.round(t / grid) * grid;

export type Section = "evaluaciones" | "sesiones" | "correcciones" | "resultados";

export const T = {
  // Intro + editor
  fadeIn: 0,
  cursorEnter: 0.3,
  clickKey: 1.0, // "Fotosíntesis" radio
  saveDone: 1.625, // spinner → check
  pullOut: 2.0,
  clickPrepare: 3.0, // "Preparar para el curso"

  // Room
  morphRoom: 4.0, // button → room card
  morphRoomEnd: 4.5,
  codeType: 4.5, // K7M4QH, one char per 16th
  codeLift: 6.0, // code → chip
  codeLand: 6.5, // chip → join input
  pressContinue: 6.625,
  nameStep: 6.75,
  nameType: 6.875, // "Lucía Paredes", one char per 32nd
  pressEnter: 7.75,
  morphRow: 8.0, // join card → table row
  morphRowEnd: 8.5,
  rowsEnter: [8.5, 9.0, 9.5, 10.0], // rows 2–5
  clickStart: 10.0, // "Iniciar evaluación"
  runningSwap: 10.125,
  rindiendo: 10.125, // first row of the cascade, then 1/16 stagger
  signal: 13.0, // the AHA
  clickEnd: 15.0, // "Finalizar evaluación"
  endedSwap: 15.125,
  entrego: 15.125,
  badgeFive: 15.25,

  // Correction
  morphAi: 16.0, // Sofía's row → AI card
  morphAiEnd: 16.5,
  aiCountStart: 16.875,
  aiCountEnd: 17.375,
  clickAccept: 18.5,
  saved: 18.875,
  pushIn: 18.95,

  // Results
  morphResults: 20.0, // AI card → results row
  morphResultsEnd: 20.5,
  publishEnabled: 20.5,
  clickPublish: 21.0,
  published: 21.25,

  // Outro
  outro: 22.0,
  tagline: 22.625,
  fadeOut: 23.7,
  end: DURATION,
} as const;

export const CLICKS = [T.clickKey, T.clickPrepare, T.clickStart, T.clickEnd, T.clickAccept, T.clickPublish] as const;

/** Active top-nav tab over time; the underline slides between them. */
export const NAV: ReadonlyArray<{ t: number; section: Section }> = [
  { t: 0, section: "evaluaciones" },
  { t: 4.0, section: "sesiones" },
  { t: 16.0, section: "correcciones" },
  { t: 20.0, section: "resultados" },
];

export const EXAM_CODE = "K7M4QH";
export const STUDENT_NAME = "Lucía Paredes";

export const codeKeyTimes = EXAM_CODE.split("").map((_, i) => T.codeType + i * SIXTEENTH);
export const nameKeyTimes = STUDENT_NAME.split("").map((_, i) => T.nameType + i * THIRTY_SECOND);
export const rindiendoTimes = [0, 1, 2, 3, 4].map((i) => T.rindiendo + i * SIXTEENTH);
export const entregoTimes = [0, 1, 2, 3, 4].map((i) => T.entrego + i * SIXTEENTH);

/** Per-student "Avance" ticks (answered 1, 2, 3) between 11 and 14 s, on 8ths. */
export const progressTicks: ReadonlyArray<ReadonlyArray<number>> = [
  [11.0, 12.25, 13.5],
  [11.25, 12.5, 14.0],
  [11.5, 12.75, 14.25],
  [11.75, 13.25, 14.5],
  [12.0, 13.75, 14.75],
];

export type AccentKind = "click" | "key" | "row" | "swap" | "aha" | "morph" | "count" | "logo";

export interface AccentEvent {
  t: number;
  kind: AccentKind;
  label: string;
}

const ev = (t: number, kind: AccentKind, label: string): AccentEvent => ({ t, kind, label });

/** Everything the music may want to hit, in time order. */
export const EVENTS: ReadonlyArray<AccentEvent> = [
  ev(T.clickKey, "click", "clave"),
  ev(T.saveDone, "swap", "guardado"),
  ev(T.clickPrepare, "click", "preparar"),
  ev(T.morphRoom, "morph", "sala"),
  ...codeKeyTimes.map((t, i) => ev(t, "key", `codigo-${i + 1}`)),
  ev(T.codeLift, "morph", "codigo-vuela"),
  ev(T.nameStep, "swap", "nombre"),
  ...nameKeyTimes.map((t, i) => ev(t, "key", `nombre-${i + 1}`)),
  ev(T.pressEnter, "click", "entrar"),
  ev(T.morphRow, "morph", "fila"),
  ev(T.morphRowEnd, "row", "alumno-1"),
  ...T.rowsEnter.map((t, i) => ev(t, "row", `alumno-${i + 2}`)),
  ev(T.clickStart, "click", "iniciar"),
  ...rindiendoTimes.map((t, i) => ev(t, "swap", `rindiendo-${i + 1}`)),
  ...progressTicks.flatMap((ticks, s) => ticks.map((t, i) => ev(t, "count", `avance-${s + 1}-${i + 1}`))),
  ev(T.signal, "aha", "aviso"),
  ev(T.clickEnd, "click", "finalizar"),
  ...entregoTimes.map((t, i) => ev(t, "swap", `entrego-${i + 1}`)),
  ev(T.morphAi, "morph", "correccion"),
  ev(T.aiCountStart, "count", "sugerencia"),
  ev(T.clickAccept, "click", "aceptar"),
  ev(T.saved, "swap", "guardado"),
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
  [0, 0.9],
  [T.clickKey, T.saveDone + 0.3],
  [T.clickPrepare, T.clickPrepare + 0.2],
  [T.morphRoom, T.morphRoomEnd + 0.6],
  [T.codeLift, T.codeLand + 0.25],
  [T.pressContinue, T.nameStep + 0.2],
  [T.pressEnter, T.morphRowEnd + 0.1],
  [T.morphRowEnd, T.rowsEnter[3] + 0.6],
  [T.clickStart, T.rindiendo + 5 * SIXTEENTH + 0.2],
  [T.signal - 0.1, T.signal + 0.8],
  [T.clickEnd, T.entrego + 5 * SIXTEENTH + 0.2],
  [T.badgeFive, T.badgeFive + 0.2],
  [T.morphAi, T.aiCountEnd + 0.8],
  [T.clickAccept, T.saved + 0.8],
  [T.morphResults, T.publishEnabled + 0.3],
  [T.clickPublish, T.published + 0.3],
  [T.outro, T.tagline + 0.6],
  [T.fadeOut, DURATION],
  ...NAV.slice(1).map((n) => [n.t, n.t + 0.7] as const),
];
