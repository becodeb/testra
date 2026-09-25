import { ChevronDown } from "lucide-react";

import { TESTRA_MARK as testraMark } from "../assets";
import { cn } from "@/lib/utils";

import { fadeIn, keyed, SPRINGS, swap } from "../motion";
import { anchor, useScene } from "../scene-context";
import { NAV, T, type Section } from "../timeline";
import { TEACHER } from "../data";

const TABS: ReadonlyArray<{ id: Section; label: string }> = [
  { id: "evaluaciones", label: "Evaluaciones" },
  { id: "sesiones", label: "Sesiones" },
  { id: "correcciones", label: "Correcciones" },
  { id: "resultados", label: "Resultados" },
];

function activeSection(t: number): Section {
  let s: Section = NAV[0].section;
  for (const n of NAV) if (t >= n.t) s = n.section;
  return s;
}

/** Pending corrections in the nav badge: 5 when the run ends, 1 left when the queue opens. */
function correctionBadge(t: number): { value: number; pill: number; digit: { opacity: number; filter?: string } } | null {
  if (t < T.badgeFive || t >= T.saved + 0.12) return null;
  if (t < T.morphAi) return { value: 5, pill: fadeIn(t, T.badgeFive), digit: { opacity: 1 } };
  if (t < T.saved) {
    const s = swap(t, T.morphAi);
    return { value: s.showNew ? 1 : 5, pill: 1, digit: s.style };
  }
  return { value: 1, pill: 1 - (t - T.saved) / 0.12, digit: { opacity: 1 } };
}

/** AppLayout's header, as a logged-in teacher sees it on desktop. */
export function AppHeader({ hideBrand = false }: { hideBrand?: boolean }) {
  const { t, anchors } = useScene();
  const active = activeSection(t);
  const nav = anchors["nav"];
  const tabRect = (id: Section) => anchors[`nav-${id}`];

  // The underline slides between tabs on a spring (inset-x-3 like the real one).
  const keys = NAV.map((n) => {
    const r = tabRect(n.section);
    return { t: n.t, x: r && nav ? r.x - nav.x + 12 : 0, w: r ? r.w - 24 : 0 };
  });
  const ux = keyed(t, keys.map((k) => ({ t: k.t, v: k.x, cfg: SPRINGS.soft })));
  const uw = keyed(t, keys.map((k) => ({ t: k.t, v: k.w, cfg: SPRINGS.soft })));

  const badge = correctionBadge(t);

  return (
    <header className="relative z-30 border-b bg-paper" aria-label="Cabecera principal">
      <div className="mx-auto grid h-[3.75rem] max-w-[1280px] grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 lg:px-6">
        <a className="flex shrink-0 items-center gap-2.5" aria-label="Testra, inicio" style={{ opacity: hideBrand ? 0 : 1 }}>
          <span className="inline-flex items-center gap-2.5" {...anchor("brand")}>
            <span className="testra-mark" aria-hidden="true"><img src={testraMark} alt="" width={128} height={128} /></span>
            <span className="text-[1.05rem] font-bold tracking-[-.02em] text-brand-deep">Testra</span>
          </span>
        </a>
        <nav aria-label="Navegación principal" className="relative flex h-full items-center justify-self-center gap-1" {...anchor("nav")}>
          {TABS.map((tab) => (
            <a
              key={tab.id}
              {...anchor(`nav-${tab.id}`)}
              className={cn(
                "relative flex h-full items-center px-3 text-sm font-medium text-ink-2",
                tab.id === "correcciones" && "gap-2",
                active === tab.id && "font-semibold text-brand",
              )}
            >
              {tab.label}
              {tab.id === "correcciones" && badge ? (
                <span className="mono-number rounded-full bg-brand px-1.5 py-0.5 text-[.65rem] font-bold text-white" style={{ opacity: badge.pill }}>
                  <span className="inline-block" style={badge.digit}>{badge.value}</span>
                </span>
              ) : null}
            </a>
          ))}
          <span className="absolute bottom-0 left-0 h-0.5 bg-brand" style={{ transform: `translateX(${ux.toFixed(2)}px)`, width: Math.max(0, uw) }} aria-hidden="true" />
        </nav>
        <div className="col-start-3 flex items-center justify-self-end">
          <div className="relative">
            <span className="flex items-center gap-2 rounded-md p-1 text-left">
              <span className="grid size-8 overflow-hidden rounded-full bg-brand-soft text-xs font-bold text-brand">
                <span className="grid place-items-center">{TEACHER.initials}</span>
              </span>
              <span className="text-right"><span className="block max-w-40 truncate text-sm font-semibold text-ink">{TEACHER.name}</span><span className="block text-xs text-muted">{TEACHER.role}</span></span>
              <ChevronDown className="size-3.5 text-muted" />
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
