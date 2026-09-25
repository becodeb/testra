import type { CSSProperties } from "react";

import { EASE, progress } from "../motion";

const MARK_LEN = 13; // ceil(getTotalLength()) of the check path, as the app measures it

/**
 * The app's StatusBadge (status-badge.tsx) with its CSS timings replayed from t:
 * spinning arc while saving, then fill + pop + drawn check.
 */
export function StatusBadgeAt({ t, loadingFrom, doneAt }: { t: number; loadingFrom: number; doneAt: number }) {
  const done = t >= doneAt;
  const dt = t - doneAt;
  // Leaving "done" for "loading" reverts over 160 ms, like the CSS.
  const revert = t >= loadingFrom ? 1 - EASE.app(progress(t, loadingFrom, loadingFrom + 0.16)) : 1;
  const fill = done ? EASE.app(progress(dt, 0, 0.18)) : revert;
  const draw = done ? EASE.app(progress(dt, 0.05, 0.23)) : revert;
  const hop = done ? (dt < 0.09 ? EASE.app(dt / 0.09) : 1 - EASE.app(progress(dt, 0.09, 0.18))) : 0;
  const pop = done ? 1 + 0.04 * EASE.app(progress(dt, 0, 0.18)) : 1;
  const crossing = done && dt < 0.09;
  const angle = (((t - loadingFrom) / 0.9) * 360) % 360;
  const ringOpacity = done ? 1 - fill : 1;

  return (
    <span className="t-check-blur-wrap" style={{ filter: crossing ? "blur(.35px)" : "none" }}>
      <span
        className="t-check-badge"
        data-state={done ? "done" : "loading"}
        style={{ scale: String(pop), transform: `translateY(${(-2 * hop).toFixed(3)}px)` } as CSSProperties}
        role="img"
        aria-label={done ? "Guardado" : "Guardando"}
      >
        <span className="t-check-ring" aria-hidden="true" style={{ opacity: ringOpacity }} />
        <span className="t-check-arc" aria-hidden="true" style={{ opacity: ringOpacity, transform: `rotate(${angle.toFixed(2)}deg)` }} />
        <span className="t-check-fill" aria-hidden="true" style={{ opacity: fill }} />
        <span className="t-check-disc" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path className="t-check-mark" d="M8 12.5L10.8 15.5L16.4 9.5" style={{ strokeDasharray: MARK_LEN, strokeDashoffset: MARK_LEN * (1 - draw) }} />
          </svg>
        </span>
      </span>
    </span>
  );
}

/** Settled "done" badge (the saved state before anything changes). */
export function StatusBadgeDone() {
  return <StatusBadgeAt t={10} loadingFrom={0} doneAt={0} />;
}
