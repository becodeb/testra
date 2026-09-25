import type { CSSProperties, ReactNode } from "react";

import type { Rect } from "../camera";
import { EXAM, STUDENTS } from "../data";
import { clamp, EASE, fadeOut, lerp, mixColor, progress, springTo, SPRINGS } from "../motion";
import { useScene } from "../scene-context";
import { STUDENT_NAME, T } from "../timeline";
import { AiCard } from "./correction";
import { JoinCard } from "./join";
import { ResultRow } from "./results";
import { RoomCard, Row } from "./room";

const PAPER = "#ffffff";
const LINE = "#e3e6eb";
const NONE = "rgba(227,230,235,0)";
const CARD_SHADOW = (a: number) => `0 1px 2px rgba(22,24,29,${(0.06 * a).toFixed(3)})`;
const LIFT_SHADOW = (a: number) => `0 14px 36px rgba(5,24,81,${(0.14 * a).toFixed(3)})`;

interface BoxLook {
  radius: number;
  bg: string;
  border: string;
  card: number; // card shadow amount
  lift: number; // lifted shadow amount
  ring?: number; // focus ring amount
}

function lerpRect(a: Rect, b: Rect, p: number): Rect {
  return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), w: lerp(a.w, b.w, p), h: lerp(a.h, b.h, p) };
}

/**
 * Morph clock: the frame reaches its target shape at 80% of the window, and
 * only then does content made for that shape fade in, so nothing is clipped.
 */
function morphClock(t: number, start: number, land: number, cfg = SPRINGS.soft) {
  const shaped = start + (land - start) * 0.8;
  return { p: springTo(t, start, shaped - start, cfg), content: EASE.app(progress(t, shaped, land)) };
}

function lookAt(a: BoxLook, b: BoxLook, p: number): CSSProperties {
  const q = clamp(p);
  const ring = lerp(a.ring ?? 0, b.ring ?? 0, q);
  const shadows = [CARD_SHADOW(lerp(a.card, b.card, q)), LIFT_SHADOW(lerp(a.lift, b.lift, q))];
  if (ring > 0.001) shadows.unshift(`0 0 0 3px rgba(10,40,120,${(0.5 * ring).toFixed(3)})`);
  return {
    borderRadius: lerp(a.radius, b.radius, q),
    background: mixColor(a.bg, b.bg, q),
    borderColor: mixColor(a.border, b.border, q),
    boxShadow: shadows.join(", "),
  };
}

/**
 * Look of a card in flight between a card and a table row: it keeps its
 * border and gains a lifted shadow mid-way, so it always reads as one object.
 */
function flightLook(p: number, r0: number, r1: number, opening = false): CSSProperties {
  const q = clamp(p);
  const lift = Math.sin(Math.PI * q) * 0.9;
  const edge = opening ? EASE.app(progress(q, 0, 0.3)) : 1 - EASE.app(progress(q, 0.75, 1));
  const card = opening ? q : 1 - q;
  return {
    borderRadius: lerp(r0, r1, EASE.app(q)),
    background: PAPER,
    borderColor: mixColor(NONE, LINE, edge),
    boxShadow: `${CARD_SHADOW(card)}, ${LIFT_SHADOW(lift)}`,
  };
}

/** A single table row drawn outside its table, with the real column widths. */
function RowCopy({ prefix, width, children }: { prefix: string; width: number; children: ReactNode }) {
  const { anchors } = useScene();
  const cols = [0, 1, 2, 3, 4, 5, 6].map((c) => anchors[`${prefix}-${c}`]?.w ?? 0);
  return (
    <table className="text-left text-sm" style={{ width, tableLayout: "fixed" }}>
      <colgroup>{cols.map((w, c) => <col key={c} style={{ width: w }} />)}</colgroup>
      <tbody>{children}</tbody>
    </table>
  );
}

/** One element whose frame travels between two layout rects. */
function Box({ rect, look, opacity = 1, children }: { rect: Rect; look: CSSProperties; opacity?: number; children?: ReactNode }) {
  return (
    <div
      className="absolute overflow-hidden border"
      style={{ left: rect.x, top: rect.y, width: Math.max(0, rect.w), height: Math.max(0, rect.h), opacity, ...look }}
    >
      {children}
    </div>
  );
}

/** "Preparar para el curso" grows into the room card. */
function ButtonToRoom() {
  const { t, anchors } = useScene();
  const from = anchors["btn-prepare"];
  const to = anchors["room-card"];
  const land = T.morphRoomEnd - 0.1;
  if (!from || !to || t < T.morphRoom || t >= land + 0.1) return null;
  const { p, content } = morphClock(t, T.morphRoom + 0.06, land);
  // The disabled button is brand at 50% over paper.
  const a: BoxLook = { radius: 6, bg: "rgba(132,147,187,1)", border: "rgba(132,147,187,1)", card: 0, lift: 0 };
  const b: BoxLook = { radius: 8, bg: PAPER, border: LINE, card: 1, lift: 0 };
  const shade = EASE.app(progress(t, T.morphRoom, T.morphRoom + 0.25));
  const label = fadeOut(t, T.morphRoom, 0.06);
  return (
    <Box rect={lerpRect(from, to, p)} look={lookAt(a, b, shade)} opacity={fadeOut(t, land, 0.1)}>
      {content > 0 ? <div className="absolute top-[-1px] left-[-1px]" style={{ width: to.w, opacity: content }}><RoomCard /></div> : null}
      {label > 0 ? (
        <span className="absolute inset-0 grid place-items-center text-sm font-semibold whitespace-nowrap text-white" style={{ opacity: label, filter: `blur(${((1 - label) * 3).toFixed(2)}px)` }}>Preparando sala…</span>
      ) : null}
    </Box>
  );
}

/** The code lifts off the room card as a chip and lands in the student's input. */
function CodeToJoin() {
  const { t, anchors } = useScene();
  const code = anchors["room-code-text"];
  const input = anchors["join-input"];
  if (!code || !input || t < T.codeLift || t >= T.codeLand + 0.03) return null;
  const lift = EASE.app(progress(t, T.codeLift, T.codeLift + 0.15));
  const lifted: Rect = { x: code.x - 14, y: code.y - 8 - 6, w: code.w + 28, h: code.h + 16 };
  const travel = springTo(t, T.codeLift + 0.1, T.codeLand - T.codeLift - 0.1, SPRINGS.ui);
  // The chip stays compact while it flies and only opens into the field at the end.
  const open = EASE.inOut(progress(travel, 0.55, 1));
  const start = lerpRect(code, lifted, lift);
  const from = { x: start.x + start.w / 2, y: start.y + start.h / 2 };
  const to = { x: input.x + input.w / 2, y: input.y + input.h / 2 };
  // Arrive from below-left so the chip never crosses the field's label.
  const c = { x: lerp(from.x, to.x, 0.55), y: Math.max(from.y, to.y) + 90 };
  const u = 1 - travel;
  const center = { x: u * u * from.x + 2 * u * travel * c.x + travel * travel * to.x, y: u * u * from.y + 2 * u * travel * c.y + travel * travel * to.y };
  const w = lerp(start.w, input.w, open);
  const h = lerp(start.h, input.h, open);
  const rect: Rect = { x: center.x - w / 2, y: center.y - h / 2, w, h };
  const flat: BoxLook = { radius: 6, bg: "rgba(255,255,255,0)", border: NONE, card: 0, lift: 0 };
  const chip: BoxLook = { radius: 8, bg: PAPER, border: LINE, card: 1, lift: 1 };
  const field: BoxLook = { radius: 6, bg: PAPER, border: "#0a2878", card: 0, lift: 0, ring: 1 };
  const look = travel > 0 ? lookAt(chip, field, open) : lookAt(flat, chip, lift);
  // Text: 30px brand mono in the room → the input's 14px (its md:text-sm wins, as in the app).
  const size = lerp(30, 14, open);
  const color = mixColor("#0a2878", "#16181d", open);
  return (
    <Box rect={rect} look={look}>
      <span
        className="mono-number absolute inset-0 flex items-center justify-center font-bold whitespace-nowrap uppercase"
        style={{ fontSize: 30, letterSpacing: `${lerp(0.18, 0.2, open)}em`, color, transform: `scale(${(size / 30).toFixed(4)})` }}
      >
        {EXAM.code}
      </span>
    </Box>
  );
}

/** The join card compresses into Lucía's row; her name travels with it. */
function JoinToRow() {
  const { t, anchors } = useScene();
  const from = anchors["join-card"];
  const to = anchors["room-row-0"];
  const nameFrom = anchors["join-name-text"];
  const nameTo = anchors["room-row-0-name"];
  if (!from || !to || t < T.morphRow || t >= T.morphRowEnd + 0.1) return null;
  const { p, content: row } = morphClock(t, T.morphRow + 0.06, T.morphRowEnd - 0.05, SPRINGS.ui);
  const content = fadeOut(t, T.morphRow, 0.06);
  const boxOpacity = fadeOut(t, T.morphRowEnd - 0.05, 0.1);
  const rect = lerpRect(from, to, p);
  // The name rides with the box, from its spot in the input to its cell in the row.
  const name = nameFrom && nameTo
    ? { x: rect.x + lerp(nameFrom.x - from.x, nameTo.x - to.x, p), y: rect.y + lerp(nameFrom.y - from.y, nameTo.y - to.y, p), h: lerp(nameFrom.h, nameTo.h, p) }
    : null;
  return (
    <>
      <Box rect={rect} look={flightLook(p, 12, 0)} opacity={boxOpacity}>
        {content > 0 ? (
          <div style={{ width: from.w, opacity: content }}>
            <JoinCard hideName />
          </div>
        ) : null}
        {row > 0 ? (
          <div className="absolute top-[-1px] left-[-1px]" style={{ opacity: row }}>
            <RowCopy prefix="room-col" width={to.w}><Row i={0} force hideName /></RowCopy>
          </div>
        ) : null}
      </Box>
      {name ? (
        <span
          className="absolute whitespace-pre text-ink"
          style={{ left: name.x, top: name.y, height: name.h, display: "flex", alignItems: "center", fontSize: 14, fontWeight: Math.round(lerp(400, 500, p)), opacity: boxOpacity }}
        >
          {STUDENT_NAME}
        </span>
      ) : null}
    </>
  );
}

/** Sofía's row opens into the AI correction card. */
function RowToAi() {
  const { t, anchors } = useScene();
  const from = anchors["room-row-1"];
  const to = anchors["ai-card"];
  const land = T.morphAiEnd - 0.05;
  if (!from || !to || t < T.morphAi || t >= land + 0.1) return null;
  const { p, content } = morphClock(t, T.morphAi + 0.06, land);
  const name = fadeOut(t, T.morphAi, 0.06);
  return (
    <Box rect={lerpRect(from, to, p)} look={flightLook(p, 0, 12, true)} opacity={fadeOut(t, land, 0.1)}>
      {content > 0 ? <div className="absolute top-[-1px] left-[-1px]" style={{ width: to.w, opacity: content }}><AiCard /></div> : null}
      {name > 0 ? <span className="absolute top-0 left-4 flex h-full items-center text-sm font-medium text-ink" style={{ opacity: name, maxHeight: from.h }}>{STUDENTS[1].name}</span> : null}
    </Box>
  );
}

/** The AI card closes into Sofía's row in the results table. */
function AiToResults() {
  const { t, anchors } = useScene();
  const from = anchors["ai-card"];
  const to = anchors["results-row-1"];
  if (!from || !to || t < T.morphResults || t >= T.morphResultsEnd + 0.1) return null;
  // The card holds while its content fades, then closes into the row.
  const { p, content: row } = morphClock(t, T.morphResults + 0.12, T.morphResultsEnd - 0.05);
  const content = fadeOut(t, T.morphResults + 0.02, 0.1);
  return (
    <Box rect={lerpRect(from, to, p)} look={flightLook(p, 12, 0)} opacity={fadeOut(t, T.morphResultsEnd - 0.05, 0.1)}>
      {content > 0 ? (
        <div style={{ width: from.w, opacity: content }}>
          <AiCard />
        </div>
      ) : null}
      {row > 0 ? (
        <div className="absolute top-[-1px] left-[-1px]" style={{ opacity: row }}>
          <RowCopy prefix="results-col" width={to.w}><ResultRow i={1} landed force /></RowCopy>
        </div>
      ) : null}
    </Box>
  );
}

/** World-space morph layer. Copies inside it are not measured as anchors. */
export function MorphLayer() {
  return (
    <div className="pointer-events-none absolute inset-0 z-40" data-no-anchors="">
      <ButtonToRoom />
      <CodeToJoin />
      <JoinToRow />
      <RowToAi />
      <AiToResults />
    </div>
  );
}
