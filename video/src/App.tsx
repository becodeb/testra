import { cameraAt, PAGE_H, PAGE_W, STAGE_H, STAGE_W, STUDENT_X, WORLD_H, WORLD_W, type Anchors } from "./camera";
import { hoveredAnchor, isPressed } from "./cursor";
import { EASE, fadeIn, fadeOut, progress } from "./motion";
import { SceneContext } from "./scene-context";
import { T } from "./timeline";
import { CorrectionScreen } from "./scenes/correction";
import { EditorScreen } from "./scenes/editor";
import { CardText, uiPresence } from "./scenes/cards";
import { AppHeader } from "./scenes/header";
import { ReportDialog } from "./scenes/report";
import { StudentPage } from "./scenes/join";
import { MorphLayer } from "./scenes/morphs";
import { CursorView, Outro } from "./scenes/overlay";
import { ResultsScreen } from "./scenes/results";
import { RoomScreen } from "./scenes/room";

const HOVERABLE = [
  "btn-prepare",
  "btn-start",
  "btn-end",
  "btn-accept",
  "btn-publish",
  "select-trigger",
  "select-item-0",
  "select-item-1",
  "select-item-2",
  "select-item-3",
  "select-item-4",
  "btn-understood",
  "report-name",
] as const;

function Screen({ opacity, children }: { opacity: number; children: React.ReactNode }) {
  return <div className="absolute inset-0" style={{ opacity, visibility: opacity > 0 ? "visible" : "hidden" }}>{children}</div>;
}

/** Everything on stage is a pure function of t (plus the layout rects measured at t). */
export function App({ t, anchors }: { t: number; anchors: Anchors }) {
  const cam = cameraAt(t, anchors);
  const hover = hoveredAnchor(t, anchors, HOVERABLE);
  const scene = { t, anchors, hover, pressed: isPressed(t) };

  const headerIn = fadeIn(t, T.editorIn - 0.05, 0.3);
  // UI dissolves into the canvas at the outro, the header lockup flies out of it.
  const worldOut = 1 - EASE.inOut(progress(t, T.outro, T.outro + 0.18));

  const editor = t < T.morphRoom ? 1 : fadeOut(t, T.morphRoom, 0.12);
  // Acts swap while the UI is hidden behind a card.
  const room = t >= T.morphRoom && t < T.act3Swap ? 1 : 0;
  const results = (t >= T.act3Swap && t < T.act4Swap) || t >= T.morphResults ? 1 : 0;
  const correction = t >= T.act4Swap && t < T.morphResults ? 1 : 0;
  const ui = uiPresence(t);

  return (
    <SceneContext.Provider value={scene}>
      <div className="relative overflow-hidden bg-canvas" style={{ width: STAGE_W, height: STAGE_H }}>
        <div className="absolute inset-0" style={{ opacity: ui.opacity, transform: `scale(${ui.scale.toFixed(5)})`, transformOrigin: "50% 50%" }}>
        <div
          data-world=""
          className="absolute top-0 left-0"
          style={{ width: WORLD_W, height: WORLD_H, transformOrigin: "0 0", transform: `translate(${cam.tx.toFixed(3)}px, ${cam.ty.toFixed(3)}px) scale(${cam.s.toFixed(5)})`, opacity: worldOut }}
        >
          <div className="absolute top-0 left-0 flex flex-col bg-canvas" style={{ width: PAGE_W, height: PAGE_H }}>
            <div style={{ opacity: headerIn }}>
              <AppHeader hideBrand={t >= T.outro} />
            </div>
            <div className="relative flex-1">
              <Screen opacity={editor}><EditorScreen /></Screen>
              <Screen opacity={room}><RoomScreen /></Screen>
              <Screen opacity={correction}><CorrectionScreen /></Screen>
              <Screen opacity={results}><ResultsScreen /></Screen>
            </div>
            <ReportDialog />
          </div>
          <div className="absolute top-0" style={{ left: STUDENT_X, width: PAGE_W, height: PAGE_H }}>
            <StudentPage />
          </div>
          <MorphLayer />
        </div>
        <CursorView cam={cam} />
        </div>
        <Outro cam={cam} />
        <CardText />
      </div>
    </SceneContext.Provider>
  );
}
