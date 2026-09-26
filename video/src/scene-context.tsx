import { createContext, useContext } from "react";

import type { Anchors } from "./camera";

export interface SceneState {
  t: number;
  anchors: Anchors;
  /** Anchor name of the control under the cursor. */
  hover: string | null;
  /** A click is being held right now. */
  pressed: boolean;
}

export const SceneContext = createContext<SceneState>({ t: 0, anchors: {}, hover: null, pressed: false });
export const useScene = () => useContext(SceneContext);

/** Marks an element as a measurable anchor (world-space layout rect). */
export const anchor = (name: string) => ({ "data-anchor": name });

/** Hover/pressed classes for a control the cursor can reach. */
export function useControl(name: string, hoverClass: string, pressedClass = "translate-y-px") {
  const { hover, pressed } = useScene();
  const over = hover === name;
  return [over ? hoverClass : "", over && pressed ? pressedClass : ""].filter(Boolean).join(" ");
}
