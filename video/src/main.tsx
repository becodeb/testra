import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import "./styles.css";
import { App } from "./App";
import { cameraMoving, type Anchors } from "./camera";
import { cursorMoving } from "./cursor";
import { DURATION, TWEEN_WINDOWS } from "./timeline";

declare global {
  interface Window {
    __setTime: (t: number) => Promise<void>;
    __duration: number;
    __motion: (t: number) => boolean;
    __ready: Promise<void>;
  }
}

const container = document.getElementById("root")!;
const root = createRoot(container);

let anchors: Anchors = {};
/** Anchors captured at reference times, for controls that later unmount. */
let reference: Anchors = {};
const REFERENCE_TIMES = [2.0, 3.5, 4.8, 6.5, 8.0, 10.4, 13.5, 15.5, 17.5, 18.9, 21.4, 23.0, 26.5, 27.6, 30.1];

function render(t: number) {
  flushSync(() => root.render(<App t={t} anchors={anchors} />));
}

/** Layout rect of `el` in world coordinates (transforms ignored on purpose). */
function worldRect(el: HTMLElement, world: HTMLElement) {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== world) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return node === world ? { x, y, w: el.offsetWidth, h: el.offsetHeight } : null;
}

/**
 * Anchors: every `[data-anchor]`, plus `[data-anchor-each]` containers whose
 * `[data-anchor-select]` descendants become `<prefix>-0`, `<prefix>-1`… (for
 * real components that cannot carry our attributes).
 */
function measure(): Anchors {
  const world = container.querySelector<HTMLElement>("[data-world]");
  const out: Anchors = {};
  if (!world) return out;
  for (const el of container.querySelectorAll<HTMLElement>("[data-anchor]")) {
    if (el.closest("[data-no-anchors]")) continue;
    const r = worldRect(el, world);
    if (r) out[el.dataset.anchor!] = r;
  }
  for (const group of container.querySelectorAll<HTMLElement>("[data-anchor-each]")) {
    if (group.closest("[data-no-anchors]")) continue;
    group.querySelectorAll<HTMLElement>(group.dataset.anchorSelect ?? "*").forEach((el, i) => {
      const r = worldRect(el, world);
      if (r) out[`${group.dataset.anchorEach}-${i}`] = r;
    });
  }
  return out;
}

function renderSettled(t: number) {
  render(t);
  anchors = { ...reference, ...measure() };
  render(t);
}

const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

async function waitForAssets() {
  await Promise.all([
    document.fonts.load('400 16px "Inter Variable"'),
    document.fonts.load('600 16px "Inter Variable"'),
    document.fonts.load('700 16px "Inter Variable"'),
    document.fonts.load('400 16px "JetBrains Mono Variable"'),
    document.fonts.load('700 16px "JetBrains Mono Variable"'),
  ]);
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))));
}

async function setTime(t: number) {
  renderSettled(Math.min(Math.max(t, 0), DURATION));
  // Drop every compositor layer and raster tile so a frame never depends on
  // the frame rendered before it (Chrome reuses raster scales across commits).
  container.style.display = "none";
  void container.offsetHeight;
  await frames();
  container.style.display = "";
  void container.offsetHeight;
  await document.fonts.ready;
  await frames();
}

async function boot() {
  render(12);
  await waitForAssets();
  // Reference pass: remember where every control was when it existed.
  for (const rt of REFERENCE_TIMES) {
    render(rt);
    const seen = measure();
    for (const [name, rect] of Object.entries(seen)) if (!reference[name]) reference[name] = rect;
  }
  anchors = {};
  const q = new URLSearchParams(location.search).get("t");
  await setTime(q ? Number(q) : 0);
}

window.__duration = DURATION;
window.__setTime = setTime;
window.__motion = (t: number) =>
  cameraMoving(t, anchors) || cursorMoving(t, anchors) || TWEEN_WINDOWS.some(([a, b]) => t >= a && t <= b);
window.__ready = boot();
