// Composes the demo soundtrack in code: 120 BPM, 12 bars, 48 kHz stereo WAV.
// Every time comes from ../src/timeline.ts (imported with Node's type
// stripping), so the beat grid and the UI accents cannot drift apart.
// Usage: node video/audio/compose.mjs [--out video/build/music.wav]
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as TL from "../src/timeline.ts";
import { automation, biquad, dbToGain, gainToDb, lufs, mtof, prng, saw, SR, svf, writeWav } from "./dsp.mjs";

const { T, BEAT, BAR, SIXTEENTH, THIRTY_SECOND, DURATION, bars } = TL;
const HERE = dirname(fileURLToPath(import.meta.url));
const outArg = process.argv.indexOf("--out");
const OUT = resolve(outArg > 0 ? process.argv[outArg + 1] : `${HERE}/../build/music.wav`);

const N = Math.round(DURATION * SR);
const TARGET_LUFS = -15;
const CEILING_DB = -1.5;

// Sections, all derived from the storyboard timeline.
const S = {
  groove: T.pullOut, // kick enters
  clap: bars(2), // clap from bar 3
  build: T.morphRow,
  riser: T.signal - BAR,
  aha: T.signal,
  ahaEnd: T.clickEnd,
  light: T.morphAi,
  lift: T.morphResults,
  outro: T.outro,
  fade: T.outro + BAR * 0.6,
};

// Harmony: [start, pad voicing (MIDI), bass root (MIDI)].
const V = {
  Dm9: [[53, 57, 60, 64], 38],
  Bbmaj9: [[53, 57, 60, 62], 34],
  Fmaj9: [[52, 57, 60, 67], 41],
  C69: [[52, 57, 62, 67], 36],
  FmajAha: [[52, 57, 60, 64, 67], 41],
  Am7: [[52, 55, 60, 64], 33],
  Gm9: [[53, 57, 58, 62], 43],
};
const CHORDS = [
  [bars(0), V.Dm9],
  [bars(1), V.Bbmaj9],
  [bars(2), V.Fmaj9],
  [bars(3), V.C69],
  [bars(4), V.Dm9],
  [bars(5), V.Bbmaj9],
  [bars(6), V.C69],
  [T.signal, V.FmajAha],
  [T.clickEnd, V.Am7],
  [bars(8), V.Dm9],
  [bars(9), V.Bbmaj9],
  [bars(10), V.Gm9],
  [T.clickPublish, V.C69],
  [T.outro, V.FmajAha],
].map(([t, [pad, bass]]) => ({ t, pad, bass }));
const chordAt = (t) => CHORDS.findLast((c) => c.t <= t + 1e-9) ?? CHORDS[0];

const stereo = () => [new Float32Array(N), new Float32Array(N)];
const bus = {
  pad: stereo(),
  bass: new Float32Array(N),
  kick: new Float32Array(N),
  hats: stereo(),
  clap: stereo(),
  keys: stereo(),
  fx: stereo(),
  foley: stereo(),
  send: stereo(),
};
const rnd = prng(0x7e57a);
const idx = (t) => Math.round(t * SR);
const TAU = 2 * Math.PI;
const panGains = (pan) => [Math.cos(((pan + 1) * Math.PI) / 4), Math.sin(((pan + 1) * Math.PI) / 4)];
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const inRange = (t, a, b) => t >= a - 1e-9 && t < b - 1e-9;
const grid = (from, to, step) => {
  const out = [];
  for (let i = 0; from + i * step < to - 1e-9; i++) out.push(from + i * step);
  return out;
};

// ---------------------------------------------------------------- instruments

function padChord(t0, t1, notes, { attack = 0.08, release = 0.18, gain = 1 } = {}) {
  const start = idx(t0);
  const end = Math.min(N, idx(t1 + release * 7));
  const norm = gain / Math.sqrt(notes.length);
  for (const m of notes) {
    const f = mtof(m);
    for (let c = 0; c < 2; c++) {
      const det = c === 0 ? [-7, 2.5] : [7, -2.5];
      const incs = det.map((d) => (f * 2 ** (d / 1200)) / SR);
      const ph = [rnd(), rnd(), rnd()];
      const triInc = f / SR;
      const out = bus.pad[c];
      for (let n = start; n < end; n++) {
        const t = n / SR;
        let env = smooth((t - t0) / attack);
        if (t > t1) env *= Math.exp(-(t - t1) / release);
        const s = (saw(ph[0], incs[0]) + saw(ph[1], incs[1])) * 0.35;
        const tri = 1 - 4 * Math.abs(ph[2] - 0.5);
        out[n] += (s + tri * 0.3) * env * norm;
        ph[0] = (ph[0] + incs[0]) % 1;
        ph[1] = (ph[1] + incs[1]) % 1;
        ph[2] = (ph[2] + triInc) % 1;
      }
    }
  }
}

function bassNote(t0, m, vel, len = 0.2, decay = Infinity) {
  const f = mtof(m);
  const start = idx(t0);
  const end = Math.min(N, idx(t0 + len + 0.05));
  let ph = 0;
  const inc = f / SR;
  for (let n = start; n < end; n++) {
    const x = (n - start) / SR;
    const env = Math.min(1, x / 0.003) * Math.exp(-x / decay) * (x > len ? Math.exp(-(x - len) / 0.012) : 1);
    const body = Math.sin(TAU * ph) + 0.3 * Math.sin(2 * TAU * ph) * Math.exp(-x / 0.06);
    const bite = saw(ph, inc) * 0.35 * Math.exp(-x / 0.035);
    bus.bass[n] += (body + bite) * env * vel;
    ph = (ph + inc) % 1;
  }
}

function kick(t0, vel = 1) {
  const start = idx(t0);
  const len = 0.32;
  const end = Math.min(N, start + idx(len));
  let ph = 0;
  for (let n = start; n < end; n++) {
    const x = (n - start) / SR;
    const f = 47 + 78 * Math.exp(-x / 0.026);
    ph += f / SR;
    const amp = Math.exp(-x / 0.12) * Math.min(1, x / 0.0004) * (x > len - 0.03 ? (len - x) / 0.03 : 1);
    const click = (rnd() * 2 - 1) * Math.exp(-x / 0.0009) * 0.12;
    bus.kick[n] += (Math.sin(TAU * ph) * amp + click) * vel;
  }
}

function hat(t0, vel, decay, pan) {
  const start = idx(t0);
  const end = Math.min(N, start + idx(decay * 7));
  const [gl, gr] = panGains(pan);
  for (let n = start; n < end; n++) {
    const x = (n - start) / SR;
    const v = (rnd() * 2 - 1) * Math.exp(-x / decay) * Math.min(1, x / 0.0005) * vel;
    bus.hats[0][n] += v * gl;
    bus.hats[1][n] += v * gr;
  }
}

function clap(t0, vel) {
  const start = idx(t0);
  const end = Math.min(N, start + idx(0.45));
  for (let n = start; n < end; n++) {
    const x = (n - start) / SR;
    let env = 0;
    for (const o of [0, 0.009, 0.018]) if (x >= o) env += Math.exp(-(x - o) / 0.0035);
    if (x >= 0.018) env += 0.55 * Math.exp(-(x - 0.018) / 0.07);
    bus.clap[0][n] += (rnd() * 2 - 1) * env * vel;
    bus.clap[1][n] += (rnd() * 2 - 1) * env * vel;
  }
}

/** Two-operator FM pluck: soft e-piano at low index, bell at ratio 3. */
function pluck(target, t0, m, vel, { ratio = 2, index = 1.6, decay = 0.3, idecay = 0.1, pan = 0, send = 0.25 } = {}) {
  const f = mtof(m);
  const start = idx(t0);
  const end = Math.min(N, start + idx(decay * 7));
  const [gl, gr] = panGains(pan);
  for (let n = start; n < end; n++) {
    const x = (n - start) / SR;
    const mod = Math.sin(TAU * f * ratio * x) * index * Math.exp(-x / idecay);
    const v = Math.sin(TAU * f * x + mod) * Math.exp(-x / decay) * Math.min(1, x / 0.002) * vel;
    target[0][n] += v * gl;
    target[1][n] += v * gr;
    bus.send[0][n] += v * gl * send;
    bus.send[1][n] += v * gr * send;
  }
}

function riser(t0, t1, gain) {
  const start = idx(t0);
  const end = idx(t1);
  const tmp = [new Float32Array(N), new Float32Array(N)];
  for (let c = 0; c < 2; c++) {
    for (let n = start; n < end; n++) {
      const u = (n - start) / (end - start);
      const tail = Math.min(1, (end - n) / (0.003 * SR));
      tmp[c][n] = (rnd() * 2 - 1) * u ** 2.2 * tail * gain;
    }
    const center = automation([[t0, 350], [t1, 7500]], { log: true });
    svf(tmp[c], center, { mode: "bp", q: 1.4, from: start, to: end });
    for (let n = start; n < end; n++) {
      bus.fx[c][n] += tmp[c][n];
      bus.send[c][n] += tmp[c][n] * 0.35;
    }
  }
}

function impact(t0, gain) {
  const start = idx(t0);
  const end = Math.min(N, start + idx(2.2));
  const wash = [new Float32Array(N), new Float32Array(N)];
  let ph = 0;
  for (let n = start; n < end; n++) {
    const x = (n - start) / SR;
    ph += (52 + 40 * Math.exp(-x / 0.05)) / SR;
    const thump = Math.sin(TAU * ph) * Math.exp(-x / 0.3) * Math.min(1, x / 0.002) * gain;
    bus.fx[0][n] += thump;
    bus.fx[1][n] += thump;
    for (let c = 0; c < 2; c++) wash[c][n] = (rnd() * 2 - 1) * Math.exp(-x / 0.5) * Math.min(1, x / 0.004) * gain * 0.3;
  }
  for (let c = 0; c < 2; c++) {
    svf(wash[c], 2400, { from: start, to: end });
    for (let n = start; n < end; n++) {
      bus.fx[c][n] += wash[c][n];
      bus.send[c][n] += wash[c][n] * 0.6;
    }
  }
}

// UI foley: mouse down + up, and key ticks. Deliberately tiny.
function uiClick(t0, vel) {
  for (const [dt, v, f] of [[0, 1, 2300], [0.07, 0.45, 2900]]) {
    const start = idx(t0 + dt);
    let prev = 0;
    for (let n = start; n < Math.min(N, start + idx(0.03)); n++) {
      const x = (n - start) / SR;
      const w = rnd() * 2 - 1;
      const noise = (w - prev) * Math.exp(-x / 0.0007);
      prev = w;
      const tone = Math.sin(TAU * f * x) * Math.exp(-x / 0.004) * 0.6;
      const s = (noise * 0.5 + tone) * vel * v;
      bus.foley[0][n] += s;
      bus.foley[1][n] += s;
    }
  }
}

function keyTick(t0, vel, pan) {
  const start = idx(t0);
  const bright = 3200 + rnd() * 1600;
  const [gl, gr] = panGains(pan);
  let prev = 0;
  for (let n = start; n < Math.min(N, start + idx(0.025)); n++) {
    const x = (n - start) / SR;
    const w = rnd() * 2 - 1;
    const noise = (w - prev) * Math.exp(-x / 0.0012);
    prev = w;
    const s = (noise * 0.35 + Math.sin(TAU * bright * x) * Math.exp(-x / 0.0025) * 0.5 + Math.sin(TAU * 700 * x) * Math.exp(-x / 0.005) * 0.4) * vel;
    bus.foley[0][n] += s * gl;
    bus.foley[1][n] += s * gr;
  }
}

// ---------------------------------------------------------------- arrangement

// Pad: one segment per chord; the intro fades in slowly.
CHORDS.forEach((c, i) => {
  const next = CHORDS[i + 1]?.t ?? DURATION;
  const last = i === CHORDS.length - 1;
  padChord(c.t, last ? S.fade : next, c.pad, {
    attack: i === 0 ? BAR * 0.6 : last ? 0.03 : 0.06,
    release: last ? 0.3 : 0.14,
    gain: last ? 1.15 : 1,
  });
});

const kickTimes = grid(S.groove, S.outro, BEAT).filter((t) => Math.abs(t - (S.aha - BEAT)) > 1e-6);
for (const t of kickTimes) kick(t, 1);

// Bass on 8ths: offbeats lead, downbeats softer (the kick owns them).
for (const t of grid(S.groove, S.outro, BEAT / 2)) {
  const step = Math.round((t % BAR) / (BEAT / 2));
  const offbeat = step % 2 === 1;
  if (inRange(t, S.light, S.lift) && !offbeat) continue;
  if (inRange(t, S.aha - BEAT, S.aha)) continue; // breath before the AHA
  const root = chordAt(t).bass + (step === 7 ? 12 : 0);
  bassNote(t, root, offbeat ? 1 : 0.55, offbeat ? 0.19 : 0.14);
}
// Pickup into the AHA and the final sub.
bassNote(S.aha, chordAt(S.aha).bass, 1, 0.3);
bassNote(S.outro, chordAt(S.outro).bass, 0.55, BAR * 0.5, 0.35);

// Hats on 16ths with deterministic humanization; open hats in the build/lifts.
const openDecay = automation([[S.build, 0.03], [S.aha, 0.12], [S.ahaEnd, 0.09], [S.light, 0.05], [S.lift, 0.05], [S.outro, 0.1]]);
for (const t of grid(S.groove, S.outro, SIXTEENTH)) {
  const step = Math.round((t % BEAT) / SIXTEENTH);
  const accent = [0.55, 0.32, 0.85, 0.36][step];
  let vel = accent * (0.82 + rnd() * 0.36);
  if (inRange(t, S.light, S.lift)) vel *= 0.7;
  const open = step === 2 && (inRange(t, S.build, S.light) || inRange(t, S.lift, S.outro));
  hat(t, vel, open ? openDecay(t) : 0.022, step % 2 ? 0.25 : -0.15);
}

// Clap on 2 and 4 from bar 3.
for (const t of grid(S.clap, S.outro, BEAT)) {
  const beat = Math.round((t % BAR) / BEAT);
  if (beat === 1 || beat === 3) clap(t, inRange(t, S.light, S.lift) ? 0.7 : 1);
}

// Soft e-piano plucks: syncopated 16ths from the pad voicing, an octave up.
const pluckSteps = (t) => {
  if (t < S.groove) return [2, 6, 10, 13];
  if (inRange(t, S.light, S.lift)) return [3, 10];
  if (inRange(t, S.lift, S.outro)) return [3, 6, 10, 12, 14];
  return [3, 6, 10, 14];
};
let rot = 0;
for (const t of grid(0, S.outro, SIXTEENTH)) {
  const step = Math.round((t % BAR) / SIXTEENTH);
  if (!pluckSteps(t).includes(step)) continue;
  const pad = chordAt(t).pad;
  const m = pad[rot++ % pad.length] + 12;
  const vel = t < S.groove ? 0.35 + 0.15 * (t / S.groove) : 0.42;
  pluck(bus.keys, t, m, vel, { index: 1.2, decay: 0.28, pan: rot % 2 ? 0.3 : -0.3, send: 0.35 });
}

// AHA: bright 16th bell arpeggio, full for two beats of chorus, then easing out.
const arpVel = automation([[S.aha, 0.55], [S.ahaEnd, 0.45], [S.light, 0.08]]);
for (const [i, t] of grid(S.aha, S.light, SIXTEENTH).entries()) {
  const pad = chordAt(t).pad;
  const up = [...pad, pad[0] + 12, pad[1] + 12];
  const seq = [...up, ...up.slice(1, -1).reverse()];
  const accent = i % 4 === 0 ? 1 : 0.75;
  pluck(bus.keys, t, seq[i % seq.length] + 24, arpVel(t) * accent, { ratio: 3, index: 1.4, decay: 0.2, idecay: 0.05, pan: i % 2 ? 0.45 : -0.45, send: 0.45 });
}
// Lift for "Publicá": the arpeggio returns on 8ths, softer.
for (const [i, t] of grid(S.lift, S.outro, BEAT / 2).entries()) {
  const pad = chordAt(t).pad;
  pluck(bus.keys, t, pad[i % pad.length] + 24, 0.22 + 0.12 * (i / 8), { ratio: 3, index: 1.1, decay: 0.2, idecay: 0.05, pan: i % 2 ? 0.4 : -0.4, send: 0.45 });
}

// Musical accents on UI moments: the code types as an ascending arpeggio,
// the status cascades as runs, and the "check" moments ring a two-note chime.
const tonesFrom = (pad, count, octave) => {
  const out = [];
  for (let o = 0; out.length < count; o += 12) for (const m of pad) if (out.length < count) out.push(m + octave + o);
  return out;
};
TL.codeKeyTimes.forEach((t, i) => pluck(bus.keys, t, tonesFrom(chordAt(t).pad, 6, 12)[i], 0.3, { ratio: 2, index: 1, decay: 0.22, pan: -0.5 + i * 0.2, send: 0.4 }));
TL.rindiendoTimes.forEach((t, i) => pluck(bus.keys, t, tonesFrom(chordAt(t).pad, 5, 24)[i], 0.18, { ratio: 3, index: 0.9, decay: 0.16, pan: -0.4 + i * 0.2, send: 0.4 }));
TL.entregoTimes.forEach((t, i) => pluck(bus.keys, t, tonesFrom(chordAt(t).pad, 5, 24)[4 - i], 0.18, { ratio: 3, index: 0.9, decay: 0.16, pan: 0.4 - i * 0.2, send: 0.4 }));
for (const t of [T.saveDone, T.saved, T.published]) {
  const [a, b] = tonesFrom(chordAt(t).pad, 8, 24).slice(-2);
  pluck(bus.keys, t, a, 0.26, { ratio: 2, index: 0.8, decay: 0.45, pan: -0.2, send: 0.5 });
  pluck(bus.keys, t + THIRTY_SECOND, b, 0.22, { ratio: 2, index: 0.8, decay: 0.5, pan: 0.2, send: 0.5 });
}

// Riser into the AHA and a soft impact on it.
riser(S.riser, S.aha, 0.9);
impact(S.aha, 0.45);

// Outro: strummed bell chord over the last pad, long reverb.
tonesFrom(chordAt(S.outro).pad, 5, 12).forEach((m, i) =>
  pluck(bus.keys, S.outro + i * 0.022, m, 0.32, { ratio: 2, index: 1.1, decay: 0.55, idecay: 0.15, pan: -0.4 + i * 0.2, send: 0.7 }),
);

// UI foley from the timeline.
for (const e of TL.EVENTS) if (e.kind === "click") uiClick(e.t, 1);
[...TL.codeKeyTimes, ...TL.nameKeyTimes].forEach((t, i) => keyTick(t, 0.55 + rnd() * 0.3, i % 2 ? 0.15 : -0.1));

// ---------------------------------------------------------------- mix

// Pad: filter automation (intro opens toward the downbeat of the groove).
const padCut = automation(
  [[0, 280], [S.groove, 1900], [S.build, 1900], [S.aha - 0.01, 3600], [S.aha, 4600], [S.ahaEnd, 3600], [S.light, 2200], [S.lift, 2200], [S.outro, 3200], [DURATION, 1400]],
  { log: true },
);
const padLevel = automation([[0, 1], [S.groove, 0.8], [S.aha, 0.95], [S.ahaEnd, 0.85], [S.light, 0.72], [S.lift, 0.8], [S.outro, 1], [DURATION, 1]]);
for (let c = 0; c < 2; c++) svf(bus.pad[c], padCut, { q: 0.8 });
biquad(bus.bass, { type: "lp", freq: 1100 });
for (let c = 0; c < 2; c++) {
  svf(bus.hats[c], 7200, { mode: "hp", q: 0.7 });
  svf(bus.clap[c], 1500, { mode: "bp", q: 0.9 });
  svf(bus.keys[c], 9000, { q: 0.7 });
  svf(bus.foley[c], 9000, { q: 0.7 });
}

// Sidechain ducking from the kick (pad and bass only).
const duck = new Float32Array(N).fill(1);
for (const k of kickTimes) {
  const start = idx(k);
  for (let n = start; n < Math.min(N, start + idx(0.45)); n++) {
    const x = (n - start) / SR;
    const d = 0.42 * (x < 0.004 ? x / 0.004 : Math.exp(-(x - 0.004) / 0.1));
    duck[n] = Math.min(duck[n], 1 - d);
  }
}

// Reverb sends: pad and clap go in too.
for (let c = 0; c < 2; c++) {
  for (let n = 0; n < N; n++) bus.send[c][n] += bus.pad[c][n] * 0.35 * padLevel(n / SR) + bus.clap[c][n] * 0.4;
  svf(bus.send[c], 220, { mode: "hp" });
}
const wet = freeverb(bus.send, automation([[0, 0.85], [S.outro, 0.86], [DURATION, 0.86]]), 0.3, Math.round(0.022 * SR));

const LEVEL = { pad: 0.2, bass: 0.34, kick: 0.62, hats: 0.2, clap: 0.2, keys: 0.3, fx: 0.25, wet: 1.3, foley: 0.09 };
const mix = stereo();
const foleyOnly = stereo();
for (let c = 0; c < 2; c++) {
  for (let n = 0; n < N; n++) {
    const t = n / SR;
    const sc = duck[n];
    mix[c][n] =
      bus.pad[c][n] * LEVEL.pad * padLevel(t) * sc +
      bus.bass[n] * LEVEL.bass * sc +
      bus.kick[n] * LEVEL.kick +
      bus.hats[c][n] * LEVEL.hats +
      bus.clap[c][n] * LEVEL.clap +
      bus.keys[c][n] * LEVEL.keys +
      bus.fx[c][n] * LEVEL.fx +
      wet[c][n] * LEVEL.wet;
    foleyOnly[c][n] = bus.foley[c][n] * LEVEL.foley;
    mix[c][n] += foleyOnly[c][n];
  }
}

// ---------------------------------------------------------------- master

// DC blocker, loop-safe fades (5 ms in; cosine out to true silence at the end).
const fadeIn = idx(0.005);
const fadeFrom = idx(S.fade + 0.2);
for (const ch of mix) {
  let x1 = 0, y1 = 0;
  const r = 1 - (TAU * 12) / SR;
  for (let n = 0; n < N; n++) {
    const y = ch[n] - x1 + r * y1;
    x1 = ch[n];
    y1 = y;
    let g = 1;
    if (n < fadeIn) g = n / fadeIn;
    if (n >= fadeFrom) g = Math.cos(((n - fadeFrom) / (N - 1 - fadeFrom)) * (Math.PI / 2)) ** 2;
    ch[n] = y * g;
  }
}

const ceiling = dbToGain(CEILING_DB);
let gain = 1;
let out;
let measured;
for (let pass = 0; pass < 4; pass++) {
  out = master(mix, gain, ceiling);
  measured = lufs(out);
  if (Math.abs(measured - TARGET_LUFS) < 0.1) break;
  gain *= dbToGain(TARGET_LUFS - measured);
}
out[0][N - 1] = 0;
out[1][N - 1] = 0;

await mkdir(dirname(OUT), { recursive: true });
await writeWav(OUT, out);

const peak = Math.max(...out.map((ch) => ch.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
const foleyPeak = Math.max(...foleyOnly.map((ch) => ch.reduce((m, v) => Math.max(m, Math.abs(v)), 0))) * gain;
console.log(
  JSON.stringify({
    out: OUT,
    frames: N,
    seconds: N / SR,
    lufs: +measured.toFixed(2),
    peakDb: +gainToDb(peak).toFixed(2),
    masterGainDb: +gainToDb(gain).toFixed(2),
    foleyPeakDb: +gainToDb(foleyPeak).toFixed(2),
    kicks: kickTimes.length,
  }),
);

// ---------------------------------------------------------------- helpers

/** Gain → gentle soft clip → zero-latency offline limiter to the ceiling. */
function master(channels, g, ceil) {
  const knee = ceil * 0.8;
  const soft = (x) => {
    const a = Math.abs(x);
    if (a <= knee) return x;
    const room = ceil * 1.25 - knee;
    return Math.sign(x) * (knee + room * Math.tanh((a - knee) / room));
  };
  const res = channels.map((ch) => Float32Array.from(ch, (v) => soft(v * g)));
  const req = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const a = Math.max(Math.abs(res[0][n]), Math.abs(res[1][n]));
    req[n] = a > ceil ? ceil / a : 1;
  }
  // Forward pass: instant attack, 60 ms release. Backward pass: 2 ms attack ramp.
  const rel = 1 - Math.exp(-1 / (0.06 * SR));
  const att = 1 - Math.exp(-1 / (0.002 * SR));
  for (let n = 1; n < N; n++) req[n] = Math.min(req[n], req[n - 1] + (1 - req[n - 1]) * rel);
  for (let n = N - 2; n >= 0; n--) req[n] = Math.min(req[n], req[n + 1] + (1 - req[n + 1]) * att);
  for (const ch of res) for (let n = 0; n < N; n++) ch[n] = Math.max(-ceil, Math.min(ceil, ch[n] * req[n]));
  return res;
}

/** Freeverb (Jezar), 48 kHz tunings, with time-varying room feedback. */
function freeverb([inL, inR], room, damp, predelay) {
  const scale = SR / 44100;
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const apT = [556, 441, 341, 225];
  const make = (spread) => ({
    combs: combT.map((d) => ({ buf: new Float32Array(Math.round((d + spread) * scale)), i: 0, store: 0 })),
    aps: apT.map((d) => ({ buf: new Float32Array(Math.round((d + spread) * scale)), i: 0 })),
  });
  const sides = [make(0), make(23)];
  const outs = stereo();
  for (let n = 0; n < N; n++) {
    const fb = n % 64 === 0 ? room(n / SR) : undefined;
    const src = n - predelay;
    const input = src >= 0 ? (inL[src] + inR[src]) * 0.015 : 0;
    for (let s = 0; s < 2; s++) {
      const side = sides[s];
      if (fb !== undefined) side.fb = fb;
      let acc = 0;
      for (const cmb of side.combs) {
        const o = cmb.buf[cmb.i];
        cmb.store = o * (1 - damp) + cmb.store * damp;
        cmb.buf[cmb.i] = input + cmb.store * side.fb;
        cmb.i = (cmb.i + 1) % cmb.buf.length;
        acc += o;
      }
      for (const ap of side.aps) {
        const o = ap.buf[ap.i];
        ap.buf[ap.i] = acc + o * 0.5;
        ap.i = (ap.i + 1) % ap.buf.length;
        acc = o - acc;
      }
      outs[s][n] = acc;
    }
  }
  return outs;
}
