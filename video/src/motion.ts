// Pure motion primitives. Everything here is a function of time, no state.

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass?: number;
}

/** Presets tuned for <= ~1% overshoot (damping ratio 0.82–0.9). */
export const SPRINGS = {
  snappy: { stiffness: 380, damping: 34 }, // ζ≈0.87, settles ~0.25 s
  ui: { stiffness: 200, damping: 24 }, // ζ≈0.85, settles ~0.35 s
  soft: { stiffness: 120, damping: 19 }, // ζ≈0.87, settles ~0.5 s
  camera: { stiffness: 42, damping: 11.4 }, // ζ≈0.88, settles ~0.7 s
  press: { stiffness: 700, damping: 44 },
} satisfies Record<string, SpringConfig>;

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
export const progress = (t: number, t0: number, t1: number) => clamp((t - t0) / (t1 - t0));

/**
 * Analytic step response of a damped spring, 0 → 1. Zero value and zero
 * velocity at t = 0, so sums of springs stay C1-continuous.
 */
export function spring(t: number, cfg: SpringConfig = SPRINGS.ui): number {
  if (t <= 0) return 0;
  const m = cfg.mass ?? 1;
  const w0 = Math.sqrt(cfg.stiffness / m);
  const zeta = cfg.damping / (2 * Math.sqrt(cfg.stiffness * m));
  if (zeta < 0.999) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  if (zeta <= 1.001) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const s = w0 * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * w0 + s;
  const r2 = -zeta * w0 - s;
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

/** Spring from t0, rescaled so it lands exactly on 1 at t0 + dur (no end snap). */
export function springTo(t: number, t0: number, dur: number, cfg: SpringConfig = SPRINGS.ui): number {
  if (t <= t0) return 0;
  if (t >= t0 + dur) return 1;
  return spring(t - t0, cfg) / spring(dur, cfg);
}

/** Maximum overshoot fraction of a config (0 when not underdamped). */
export function overshoot(cfg: SpringConfig): number {
  const m = cfg.mass ?? 1;
  const zeta = cfg.damping / (2 * Math.sqrt(cfg.stiffness * m));
  return zeta >= 1 ? 0 : Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta));
}

export type Ease = (x: number) => number;

/** CSS-style cubic-bezier easing, solved with Newton + bisection fallback. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const ax = 3 * x1 - 3 * x2 + 1;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let u = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(u) - x;
      if (Math.abs(err) < 1e-6) return sy(u);
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0;
    let hi = 1;
    u = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(u);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return sy(u);
  };
}

export const EASE = {
  /** The app's own curve: cubic-bezier(.2,.7,.3,1). */
  app: cubicBezier(0.2, 0.7, 0.3, 1),
  inOut: cubicBezier(0.65, 0, 0.35, 1),
  out: cubicBezier(0.16, 1, 0.3, 1),
  in: cubicBezier(0.5, 0, 0.75, 0),
  linear: (x: number) => x,
} satisfies Record<string, Ease>;

/** Map t in [t0, t1] to [v0, v1] with an ease, clamped outside. */
export function interp(t: number, [t0, t1]: readonly [number, number], [v0, v1]: readonly [number, number], ease: Ease = EASE.inOut): number {
  return lerp(v0, v1, ease(progress(t, t0, t1)));
}

/** Start time of the i-th element in a stagger. */
export const stagger = (start: number, i: number, step: number) => start + i * step;

export interface Key {
  t: number;
  v: number;
  cfg?: SpringConfig;
}

/**
 * Value driven by a list of keys: each key springs from wherever the value is
 * toward its own target (sum of step responses). Keys must be sorted by t.
 */
export function keyed(t: number, keys: ReadonlyArray<Key>, fallback: SpringConfig = SPRINGS.ui): number {
  if (!keys.length) return 0;
  let v = keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    if (t <= k.t) break;
    v += (k.v - keys[i - 1].v) * spring(t - k.t, k.cfg ?? fallback);
  }
  return v;
}

/** Last key whose time has passed (for discrete state). */
export function stepAt<V>(t: number, keys: ReadonlyArray<{ t: number; v: V }>): V {
  let v = keys[0].v;
  for (const k of keys) if (t >= k.t) v = k.v;
  return v;
}

type RGBA = [number, number, number, number];

function parseColor(c: string): RGBA {
  if (c.startsWith("#")) {
    const h = c.slice(1);
    const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return [0, 0, 0, 0];
  const parts = m[1].split(",").map((p) => parseFloat(p));
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

export function mixColor(a: string, b: string, p: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  const q = clamp(p);
  const r = ca.map((x, i) => lerp(x, cb[i], q));
  return `rgba(${r[0].toFixed(1)}, ${r[1].toFixed(1)}, ${r[2].toFixed(1)}, ${r[3].toFixed(3)})`;
}

/**
 * In-place text swap: the old content leaves (opacity + small blur), then the
 * new one arrives. The two never overlap. Total 120 ms.
 */
export function swap(t: number, at: number, dur = 0.12): { showNew: boolean; style: { opacity: number; filter?: string } } {
  const half = dur / 2;
  if (t < at) return { showNew: false, style: { opacity: 1 } };
  if (t < at + half) {
    const p = (t - at) / half;
    return { showNew: false, style: { opacity: 1 - p, filter: `blur(${(p * 4).toFixed(2)}px)` } };
  }
  const p = clamp((t - at - half) / half);
  if (p >= 1) return { showNew: true, style: { opacity: 1 } };
  return { showNew: true, style: { opacity: p, filter: `blur(${((1 - p) * 4).toFixed(2)}px)` } };
}

/** Opacity-only fade in over [t0, t0 + dur]. */
export const fadeIn = (t: number, t0: number, dur = 0.12) => EASE.app(progress(t, t0, t0 + dur));
export const fadeOut = (t: number, t0: number, dur = 0.12) => 1 - EASE.app(progress(t, t0, t0 + dur));

/** Entrance: opacity + small rise, spring-driven. */
export function enter(t: number, t0: number, rise = 12, cfg: SpringConfig = SPRINGS.ui): { opacity: number; transform: string } {
  const p = spring(t - t0, cfg);
  const o = EASE.app(progress(t, t0, t0 + 0.2));
  return { opacity: o, transform: `translateY(${((1 - p) * rise).toFixed(3)}px)` };
}
