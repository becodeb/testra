import { keyed, SPRINGS, type SpringConfig } from "./motion";
import { reportScrollEnd } from "./report-scroll";
import { T } from "./timeline";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Anchors = Record<string, Rect>;

export const STAGE_W = 1920;
export const STAGE_H = 1080;
/** The teacher page is laid out at a natural desktop width. */
export const PAGE_W = 1440;
export const PAGE_H = 810;
/** Camera zoom 1.0 frames the page edge to edge. */
export const BASE_SCALE = STAGE_W / PAGE_W;
export const STUDENT_X = PAGE_W + 200;
export const WORLD_W = STUDENT_X + PAGE_W;
export const WORLD_H = PAGE_H;

export interface Framing {
  t: number;
  /** Anchor name, a literal world point, or a point computed from the anchors. */
  target?: string | { x: number; y: number } | ((anchors: Anchors) => { x: number; y: number });
  zoom: number;
  /** Offset from the anchor center, in world px. */
  dx?: number;
  dy?: number;
  /** Where the target point lands on screen (default: stage center). */
  at?: { sx: number; sy: number };
  /** Literal view: world coordinates of the frame's top-left corner. */
  view?: { left: number; top: number };
  /** Hard cut: the camera jumps here (only used while the world is hidden behind a card). */
  cut?: boolean;
  cfg?: SpringConfig;
}

const PAGE_CENTER = { x: PAGE_W / 2, y: PAGE_H / 2 };
/** Both pages side by side: the student's screen and the teacher's. */
const BOTH_PAGES = { x: WORLD_W / 2, y: PAGE_H / 2 };

function reportCard(i: number) {
  return (anchors: Anchors) => {
    const r = anchors[`report-card-${i}`];
    if (!r) return PAGE_CENTER;
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 - reportScrollEnd(anchors) };
  };
}

export const FRAMINGS: ReadonlyArray<Framing> = [
  // Act 1 — editor, room, student join (starts hidden behind card 1).
  { t: 0, cut: true, view: { left: 116, top: 0 }, zoom: 1.27 },
  { t: T.editorIn, view: { left: 100, top: 0 }, zoom: 1.21, cfg: SPRINGS.soft },
  { t: 4.1, view: { left: 40, top: 0 }, zoom: 1.05 },
  // While the room is being prepared, lean gently toward the button.
  { t: T.clickPrepare + 0.1, view: { left: 60, top: 0 }, zoom: 1.1, cfg: SPRINGS.soft },
  { t: 5.9, view: { left: -112, top: 62 }, zoom: 1.6 },
  { t: T.codeLift - 0.1, target: "join-card", zoom: 1.42, dy: 10 },
  { t: T.morphRow - 0.1, target: PAGE_CENTER, zoom: 1, cfg: SPRINGS.soft },

  // Act 2 — Lucía's screen, then the event travels to the teacher (behind card 2).
  { t: 12.0, cut: true, view: { left: STUDENT_X, top: 0 }, zoom: 1 },
  { t: T.dialogOpen + 0.05, target: "student-dialog", zoom: 1.85 },
  // Pull back until both screens share the frame, then push into the panel.
  { t: T.flyStart - 0.1, target: BOTH_PAGES, zoom: 0.6, cfg: SPRINGS.soft },
  { t: T.flyStart + 0.17, target: "avisos", zoom: 1.8, dy: -40, cfg: SPRINGS.soft },
  { t: 18.1, target: PAGE_CENTER, zoom: 1 },

  // Act 3 — Resultados and Lucía's report (behind card 3).
  { t: 20.2, cut: true, view: { left: 40, top: 0 }, zoom: 1.05 },
  { t: T.reportScroll + 0.1, target: reportCard(0), zoom: 1.5 },
  { t: T.reportPan, target: reportCard(1), zoom: 1.5 },

  // Act 4 — AI correction, results, outro (behind card 4).
  { t: 25.2, cut: true, target: "ai-card", zoom: 1.15 },
  { t: T.pushIn, target: "ai-note", zoom: 1.45, at: { sx: 730, sy: 850 }, cfg: SPRINGS.glide },
  { t: T.morphResults, view: { left: 40, top: 0 }, zoom: 1.05, cfg: SPRINGS.soft },
  { t: T.outro, target: PAGE_CENTER, zoom: 1 },
];

function resolve(f: Framing, anchors: Anchors): { x: number; y: number } {
  const s = f.zoom * BASE_SCALE;
  if (f.view) return { x: f.view.left + STAGE_W / 2 / s, y: f.view.top + STAGE_H / 2 / s };
  let p = PAGE_CENTER;
  if (typeof f.target === "function") p = f.target(anchors);
  else if (f.target && typeof f.target !== "string") p = f.target;
  else if (f.target) {
    const r = anchors[f.target];
    if (r) p = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }
  const x = p.x + (f.dx ?? 0);
  const y = p.y + (f.dy ?? 0);
  if (!f.at) return clampFraming(x, y, f.zoom);
  return { x: x + (STAGE_W / 2 - f.at.sx) / s, y: y + (STAGE_H / 2 - f.at.sy) / s };
}

/** Keep the view inside the world (the page has no content above or below). */
function clampFraming(x: number, y: number, z: number) {
  const halfH = PAGE_H / 2 / z;
  const halfW = PAGE_W / 2 / z;
  return {
    x: halfW * 2 >= WORLD_W ? WORLD_W / 2 : Math.min(WORLD_W - halfW, Math.max(halfW, x)),
    y: halfH * 2 >= WORLD_H ? WORLD_H / 2 : Math.min(WORLD_H - halfH, Math.max(halfH, y)),
  };
}

export interface Camera {
  cx: number;
  cy: number;
  z: number;
  /** Effective CSS scale of the world. */
  s: number;
  tx: number;
  ty: number;
}

export function cameraAt(t: number, anchors: Anchors): Camera {
  // Only the framings since the last cut take part: a cut restarts the springs.
  let from = 0;
  FRAMINGS.forEach((f, i) => {
    if (f.cut && f.t <= t) from = i;
  });
  const shot = FRAMINGS.slice(from);
  const points = shot.map((f) => resolve(f, anchors));
  const cfgOf = (f: Framing) => f.cfg ?? SPRINGS.camera;
  const cx = keyed(t, shot.map((f, i) => ({ t: f.t, v: points[i].x, cfg: cfgOf(f) })));
  const cy = keyed(t, shot.map((f, i) => ({ t: f.t, v: points[i].y, cfg: cfgOf(f) })));
  // Zoom interpolates in log space so push-ins feel uniform.
  const z = Math.exp(keyed(t, shot.map((f) => ({ t: f.t, v: Math.log(f.zoom), cfg: cfgOf(f) }))));
  const s = z * BASE_SCALE;
  return { cx, cy, z, s, tx: STAGE_W / 2 - cx * s, ty: STAGE_H / 2 - cy * s };
}

export function toScreen(cam: Camera, p: { x: number; y: number }) {
  return { x: cam.tx + p.x * cam.s, y: cam.ty + p.y * cam.s };
}

export function cameraMoving(t: number, anchors: Anchors): boolean {
  const a = cameraAt(t, anchors);
  const b = cameraAt(t + 1 / 240, anchors);
  return Math.abs(a.tx - b.tx) > 0.05 || Math.abs(a.ty - b.ty) > 0.05 || Math.abs(a.s - b.s) > 0.0002;
}
