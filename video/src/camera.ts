import { keyed, SPRINGS, type SpringConfig } from "./motion";
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
  /** Anchor name, or a literal world point. */
  target?: string | { x: number; y: number };
  zoom: number;
  /** Offset from the anchor center, in world px. */
  dx?: number;
  dy?: number;
  /** Where the target point lands on screen (default: stage center). */
  at?: { sx: number; sy: number };
  /** Literal view: world coordinates of the frame's top-left corner. */
  view?: { left: number; top: number };
  cfg?: SpringConfig;
}

const PAGE_CENTER = { x: PAGE_W / 2, y: PAGE_H / 2 };

/**
 * Shots are composed so the caption corner (top-left, see overlay.tsx) always
 * sits on empty header space or empty canvas, never on UI text.
 */
export const FRAMINGS: ReadonlyArray<Framing> = [
  { t: 0, view: { left: 116, top: 0 }, zoom: 1.27 },
  { t: 0.05, view: { left: 100, top: 0 }, zoom: 1.21, cfg: SPRINGS.soft },
  { t: 1.7, view: { left: 40, top: 0 }, zoom: 1.05 },
  // While the room is being prepared, lean gently toward the button.
  { t: T.clickPrepare + 0.1, view: { left: 60, top: 0 }, zoom: 1.1, cfg: SPRINGS.soft },
  { t: 4.4, view: { left: -112, top: 62 }, zoom: 1.6 },
  { t: 5.9, target: "join-card", zoom: 1.42, dy: 10 },
  { t: T.morphRow - 0.1, target: PAGE_CENTER, zoom: 1, cfg: SPRINGS.soft },
  { t: 12.35, target: "avisos", zoom: 1.85, dy: -40 },
  { t: 14.2, target: PAGE_CENTER, zoom: 1 },
  // The card grows out of Sofía's row; the camera eases in behind it.
  { t: T.morphAi + 0.05, view: { left: 0, top: 0 }, zoom: 1 },
  { t: T.pushIn, target: "ai-note", zoom: 1.6, at: { sx: 730, sy: 850 }, cfg: SPRINGS.soft },
  { t: T.morphResults, view: { left: 40, top: 0 }, zoom: 1.05, cfg: SPRINGS.soft },
  { t: T.outro, target: PAGE_CENTER, zoom: 1 },
];

function resolve(f: Framing, anchors: Anchors): { x: number; y: number } {
  const s = f.zoom * BASE_SCALE;
  if (f.view) return { x: f.view.left + STAGE_W / 2 / s, y: f.view.top + STAGE_H / 2 / s };
  let p = PAGE_CENTER;
  if (f.target && typeof f.target !== "string") p = f.target;
  else if (f.target) {
    const r = anchors[f.target];
    if (r) p = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }
  const x = p.x + (f.dx ?? 0);
  const y = p.y + (f.dy ?? 0);
  if (!f.at) return clampFraming(x, y, f.zoom);
  return { x: x + (STAGE_W / 2 - f.at.sx) / s, y: y + (STAGE_H / 2 - f.at.sy) / s };
}

/** Keep the view inside the world vertically (the page has no content above or below). */
function clampFraming(x: number, y: number, z: number) {
  const halfH = PAGE_H / 2 / z;
  const halfW = PAGE_W / 2 / z;
  return {
    x: Math.min(WORLD_W - halfW, Math.max(halfW, x)),
    y: Math.min(WORLD_H - halfH, Math.max(halfH, y)),
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
  const points = FRAMINGS.map((f) => resolve(f, anchors));
  const cfgOf = (f: Framing) => f.cfg ?? SPRINGS.camera;
  const cx = keyed(t, FRAMINGS.map((f, i) => ({ t: f.t, v: points[i].x, cfg: cfgOf(f) })));
  const cy = keyed(t, FRAMINGS.map((f, i) => ({ t: f.t, v: points[i].y, cfg: cfgOf(f) })));
  // Zoom interpolates in log space so push-ins feel uniform.
  const z = Math.exp(keyed(t, FRAMINGS.map((f) => ({ t: f.t, v: Math.log(f.zoom), cfg: cfgOf(f) }))));
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
