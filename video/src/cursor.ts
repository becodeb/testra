import type { Anchors } from "./camera";
import { clamp, EASE, lerp, progress, spring, SPRINGS } from "./motion";
import { CLICKS, T } from "./timeline";

export type CursorTarget = { anchor: string; fx?: number; fy?: number; dx?: number; dy?: number } | { x: number; y: number };

interface Move {
  t0: number;
  t1: number;
  to: CursorTarget;
  /** Bend of the path, as a fraction of its length (sign picks the side). */
  arc?: number;
}

const START: CursorTarget = { x: 1180, y: 900 };
const STUDENT_REST = { anchor: "runtime-input", fx: 0.72, fy: 1, dy: 44 };

/**
 * One pointer, owned by whoever's screen is on camera. Arrivals land
 * 150–250 ms before each click; after a click it follows through a little
 * into neutral space so the result reads.
 */
const MOVES: ReadonlyArray<Move> = [
  // Teacher, editor
  { t0: T.cursorEnter, t1: 2.05, to: { anchor: "key-radio" }, arc: 0.12 },
  { t0: 2.4, t1: 2.8, to: { anchor: "select-trigger", fx: 0.45 }, arc: -0.12 },
  // Menu open: glide down over every type, then back up to "Opción única".
  { t0: 3.1, t1: 3.65, to: { anchor: "select-item-4", fx: 0.35 }, arc: 0.04 },
  { t0: 3.7, t1: 3.9, to: { anchor: "select-item-0", fx: 0.35 }, arc: -0.04 },
  { t0: 4.15, t1: 4.8, to: { anchor: "btn-prepare", fx: 0.42 }, arc: -0.1 },
  { t0: 5.15, t1: 5.5, to: { anchor: "btn-prepare", fx: 0.3, fy: 1, dy: 52 }, arc: 0.1 },
  // Teacher, room (the student joins without a pointer)
  { t0: 9.6, t1: 9.61, to: { anchor: "room-table", fx: 0.42, fy: 0.62 } },
  { t0: 9.8, t1: 10.3, to: { anchor: "btn-start", fx: 0.45 }, arc: 0.1 },
  { t0: 10.65, t1: 11.0, to: { anchor: "room-controls", fx: 0.3, fy: 0.62 }, arc: -0.1 },
  // Lucía: rests by her answer, leaves the frame, comes back, acknowledges.
  { t0: 12.4, t1: 12.41, to: STUDENT_REST },
  { t0: 13.8, t1: 14.1, to: { x: 1640 + 1560, y: 700 }, arc: 0.1 },
  { t0: 14.55, t1: 15.0, to: { anchor: "student-dialog", fx: 0.62, fy: 1.3 }, arc: -0.08 },
  { t0: 15.95, t1: 16.3, to: { anchor: "btn-understood", fx: 0.45 }, arc: 0.1 },
  // Teacher again: "Finalizar evaluación".
  { t0: 18.2, t1: 18.21, to: { anchor: "room-controls", fx: 0.62, fy: 0.9, dy: 30 } },
  { t0: 18.3, t1: 18.8, to: { anchor: "btn-end", fx: 0.4 }, arc: -0.12 },
  // Resultados: open Lucía.
  { t0: 20.75, t1: 20.76, to: { anchor: "results-row-0", fx: 0.5, fy: 1.6 } },
  { t0: 20.95, t1: 21.3, to: { anchor: "report-name", fx: 0.45 }, arc: 0.1 },
  // AI correction and publishing.
  { t0: 25.7, t1: 25.71, to: { anchor: "ai-suggestion", fx: 0.8, fy: 1.4 } },
  { t0: 26.0, t1: 26.6, to: { anchor: "ai-suggestion", fx: 0.62, fy: 0.62 }, arc: 0.1 },
  { t0: 27.2, t1: 27.55, to: { anchor: "btn-accept", fx: 0.42 }, arc: -0.08 },
  { t0: 27.9, t1: 28.25, to: { anchor: "btn-accept", fx: 0.7, dy: 38 }, arc: 0.1 },
  { t0: 29.4, t1: 30.05, to: { anchor: "btn-publish", fx: 0.42 }, arc: 0.1 },
  { t0: 30.4, t1: 30.75, to: { anchor: "btn-publish", fx: -0.1, dy: 16 }, arc: -0.1 },
];

/** Visible windows [from, to]; 150 ms fades at both ends. */
const VISIBLE: ReadonlyArray<readonly [number, number]> = [
  [T.cursorEnter, 5.65],
  [9.65, 11.15],
  [12.75, 14.1],
  [14.55, 16.75],
  [18.2, 19.45],
  [20.9, 21.9],
  [26.0, 31.05],
];

export const CURSOR_SIZE = 26;

function point(target: CursorTarget, anchors: Anchors): { x: number; y: number } {
  if (!("anchor" in target)) return target;
  const r = anchors[target.anchor];
  if (!r) return { x: 0, y: 0 };
  return { x: r.x + r.w * (target.fx ?? 0.5) + (target.dx ?? 0), y: r.y + r.h * (target.fy ?? 0.5) + (target.dy ?? 0) };
}

/** Cursor tip in world coordinates. */
export function cursorWorld(t: number, anchors: Anchors): { x: number; y: number } {
  let from = point(START, anchors);
  for (const m of MOVES) {
    const to = point(m.to, anchors);
    if (t <= m.t0) return from;
    if (t < m.t1) {
      const p = EASE.inOut(progress(t, m.t0, m.t1));
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const bend = m.arc ?? 0;
      // Quadratic bezier with the control point pushed off the chord.
      const c = { x: (from.x + to.x) / 2 - dy * bend, y: (from.y + to.y) / 2 + dx * bend };
      const u = 1 - p;
      return { x: u * u * from.x + 2 * u * p * c.x + p * p * to.x, y: u * u * from.y + 2 * u * p * c.y + p * p * to.y };
    }
    from = to;
  }
  return from;
}

export function cursorOpacity(t: number): number {
  let o = 0;
  for (const [a, b] of VISIBLE) {
    if (t >= a && t <= b) o = Math.max(o, Math.min(progress(t, a, a + 0.15), 1 - progress(t, b - 0.15, b)));
  }
  return EASE.app(clamp(o));
}

/** 0 → 1 → 0 press envelope: 30 ms down, held to 90 ms, spring back. */
export function pressAmount(t: number): number {
  for (const c of CLICKS) {
    const dt = t - c;
    if (dt < 0 || dt > 0.5) continue;
    if (dt < 0.03) return EASE.out(dt / 0.03);
    if (dt < 0.09) return 1;
    return 1 - spring(dt - 0.09, SPRINGS.press);
  }
  return 0;
}

/** True while a click is physically held (drives the buttons' pressed state). */
export function isPressed(t: number): boolean {
  return CLICKS.some((c) => t >= c && t < c + 0.09);
}

export interface Ring {
  x: number;
  y: number;
  r: number;
  opacity: number;
}

/** Click rings in world coordinates. */
export function ringsAt(t: number, anchors: Anchors): Ring[] {
  const out: Ring[] = [];
  for (const c of CLICKS) {
    const dt = t - c;
    if (dt < 0 || dt > 0.3) continue;
    const p = dt / 0.3;
    const at = cursorWorld(c, anchors);
    out.push({ x: at.x, y: at.y, r: lerp(0, 22, EASE.out(p)), opacity: 0.18 * (1 - EASE.inOut(p)) });
  }
  return out;
}

/** Which anchored control the cursor is over (for hover states). */
export function hoveredAnchor(t: number, anchors: Anchors, names: ReadonlyArray<string>): string | null {
  if (cursorOpacity(t) < 0.5) return null;
  const p = cursorWorld(t, anchors);
  for (const n of names) {
    const r = anchors[n];
    if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return n;
  }
  return null;
}

export function cursorMoving(t: number, anchors: Anchors): boolean {
  const a = cursorWorld(t, anchors);
  const b = cursorWorld(t + 1 / 240, anchors);
  const pa = pressAmount(t);
  const pb = pressAmount(t + 1 / 240);
  return Math.hypot(a.x - b.x, a.y - b.y) > 0.02 || Math.abs(pa - pb) > 0.001 || Math.abs(cursorOpacity(t) - cursorOpacity(t + 1 / 240)) > 0.001;
}
