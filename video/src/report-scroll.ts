import type { Anchors } from "./camera";
import { EASE, progress } from "./motion";
import { T } from "./timeline";

/** Visible height of the report dialog: max-h-[92dvh] of the 810 px page. */
export const REPORT_VIEWPORT = Math.round(810 * 0.92);

/** How far the report dialog is scrolled to bring "Avisos (2)" to the top. */
export function reportScrollEnd(anchors: Anchors): number {
  const inner = anchors["report-inner"];
  const avisos = anchors["report-avisos"];
  if (!inner || !avisos) return 0;
  const wanted = avisos.y - inner.y - 20;
  return Math.max(0, Math.min(wanted, inner.h - REPORT_VIEWPORT));
}

/** Scroll offset at t: a single smooth scroll, like a trackpad flick. */
export function reportScrollAt(t: number, anchors: Anchors): number {
  return reportScrollEnd(anchors) * EASE.inOut(progress(t, T.reportScroll, T.reportScroll + 0.4));
}
