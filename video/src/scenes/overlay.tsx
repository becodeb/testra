import { TESTRA_MARK as testraMark } from "../assets";

import { toScreen, type Camera, STAGE_H, STAGE_W } from "../camera";
import { CURSOR_SIZE, cursorOpacity, cursorWorld, pressAmount, ringsAt } from "../cursor";
import { EASE, fadeIn, lerp, progress, springTo, SPRINGS } from "../motion";
import { useScene } from "../scene-context";
import { T } from "../timeline";

/** Classic arrow, black with a white outline, constant size in screen space. */
export function CursorView({ cam }: { cam: Camera }) {
  const { t, anchors } = useScene();
  const opacity = cursorOpacity(t);
  const rings = ringsAt(t, anchors);
  if (opacity <= 0 && !rings.length) return null;
  const tip = toScreen(cam, cursorWorld(t, anchors));
  const scale = 1 - 0.12 * pressAmount(t);
  return (
    <>
      {rings.map((r, i) => {
        const c = toScreen(cam, r);
        return <span key={i} className="absolute rounded-full" style={{ left: c.x - r.r, top: c.y - r.r, width: r.r * 2, height: r.r * 2, background: `rgba(10,40,120,${r.opacity.toFixed(3)})` }} />;
      })}
      {opacity > 0 ? (
        <svg
          className="absolute"
          width={CURSOR_SIZE}
          height={CURSOR_SIZE}
          viewBox="0 0 24 24"
          style={{ left: tip.x - 5, top: tip.y - 2.5, opacity, transform: `scale(${scale.toFixed(4)})`, transformOrigin: "5px 2.5px", filter: "drop-shadow(0 1px 1.5px rgba(22,24,29,.28))" }}
          aria-hidden="true"
        >
          <path d="M5 2.5 L5 19.2 L9.3 15.2 L12.1 21.4 L14.9 20.2 L12.2 14.1 L18.2 14.1 Z" fill="#000" stroke="#fff" strokeWidth={1.5} strokeLinejoin="round" />
        </svg>
      ) : null}
    </>
  );
}

/** The header lockup flies to the center; the tagline follows; then empty canvas. */
export function Outro({ cam }: { cam: Camera }) {
  const { t, anchors } = useScene();
  const brand = anchors["brand"] ?? { x: 0, y: 0, w: 0, h: 0 };
  // Mounted from frame 0 (hidden) so its image is decoded before it is needed.
  const active = t >= T.outro;
  const start = toScreen(cam, { x: brand.x, y: brand.y });
  const startScale = cam.s;
  const endScale = 3.6;
  const p = springTo(t, T.outro, 0.9, SPRINGS.soft);
  const scale = lerp(startScale, endScale, p);
  // Lockup is brand.w × brand.h in CSS px at scale 1; center it on the stage above the tagline.
  const endX = STAGE_W / 2 - (brand.w * endScale) / 2;
  const endY = STAGE_H / 2 - (brand.h * endScale) / 2 - 40;
  const x = lerp(start.x, endX, p);
  const y = lerp(start.y, endY, p);
  const tagO = t < T.tagline ? 0 : fadeIn(t, T.tagline, 0.3);
  const out = 1 - EASE.inOut(progress(t, T.fadeOut, T.end - 0.02));
  return (
    <div className="pointer-events-none absolute inset-0" style={{ opacity: active ? out : 0 }}>
      <div className="absolute flex items-center gap-2.5" style={{ left: x, top: y, width: brand.w, height: brand.h, transform: `scale(${scale.toFixed(4)})`, transformOrigin: "0 0" }}>
        <span className="testra-mark" aria-hidden="true"><img src={testraMark} alt="" width={128} height={128} /></span>
        <span className="text-[1.05rem] font-bold tracking-[-.02em] text-brand-deep">Testra</span>
      </div>
      <p
        className="absolute inset-x-0 text-center text-[30px] font-medium tracking-[-.01em] text-ink-2"
        style={{ top: STAGE_H / 2 + (brand.h * endScale) / 2 - 8, opacity: tagO, filter: tagO < 1 ? `blur(${((1 - tagO) * 4).toFixed(2)}px)` : undefined, transform: `translateY(${((1 - tagO) * 8).toFixed(2)}px)` }}
      >
        Evaluaciones en línea que no deciden por vos.
      </p>
    </div>
  );
}
