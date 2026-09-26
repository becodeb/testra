// The timeline in VIDEO time. timeline.ts is story time on a 120 BPM grid;
// the video plays it PACE times slower, so every time-valued export is scaled
// here, explicitly and by shape (non-time numbers such as FPS, indices and
// labels are left alone). The music and its checks import this module.
import * as story from "../src/timeline.ts";

const { PACE } = story;
const s = (t) => t * PACE;

export { PACE, FPS, EXAM_CODE, STUDENT_NAME, ANSWER } from "../src/timeline.ts";
export const BPM = story.BPM / PACE; // 100
export const BEAT = s(story.BEAT);
export const BAR = s(story.BAR);
export const SIXTEENTH = s(story.SIXTEENTH);
export const THIRTY_SECOND = s(story.THIRTY_SECOND);
export const DURATION = story.VIDEO_DURATION;
export const beats = (n) => n * BEAT;
export const bars = (n) => n * BAR;

export const CARDS = story.CARDS.map((c) => ({ ...c, in: s(c.in), out: s(c.out) }));
export const T = Object.fromEntries(Object.entries(story.T).map(([k, v]) => [k, Array.isArray(v) ? v.map(s) : s(v)]));
export const CLICKS = story.CLICKS.map(s);
export const NAV = story.NAV.map((n) => ({ ...n, t: s(n.t) }));
export const codeKeyTimes = story.codeKeyTimes.map(s);
export const nameKeyTimes = story.nameKeyTimes.map(s);
export const answerKeyTimes = story.answerKeyTimes.map(s);
export const rindiendoTimes = story.rindiendoTimes.map(s);
export const entregoTimes = story.entregoTimes.map(s);
export const selectHover = story.selectHover.map(([item, t]) => [item, s(t)]);
export const progressTicks = story.progressTicks.map((ticks) => ticks.map(s));
export const EVENTS = story.EVENTS.map((e) => ({ ...e, t: s(e.t) }));
export const TWEEN_WINDOWS = story.TWEEN_WINDOWS.map(([a, b]) => [s(a), s(b)]);

// Guard: T holds times only; a new non-time key must be handled explicitly above.
for (const [k, v] of Object.entries(story.T)) {
  if (!(typeof v === "number" || (Array.isArray(v) && v.every((x) => typeof x === "number")))) throw new Error(`timeline T.${k} is not a time`);
}
