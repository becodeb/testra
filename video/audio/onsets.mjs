// Kick-onset check: finds low-band onsets in the rendered WAV and reports
// their deviation from the beat grid in timeline.ts.
// Usage: node video/audio/onsets.mjs [video/build/music.wav]
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BEAT, SIXTEENTH } from "../src/timeline.ts";
import { biquad, readWav, SR } from "./dsp.mjs";

const file = resolve(process.argv[2] ?? fileURLToPath(new URL("../build/music.wav", import.meta.url)));
const { sr, channels } = await readWav(file);
if (sr !== SR) throw new Error(`expected ${SR} Hz, got ${sr}`);

const n = channels[0].length;
const mono = new Float64Array(n);
for (let i = 0; i < n; i++) mono[i] = (channels[0][i] + channels[1][i]) / 2;

// Zero-phase low-pass (forward + backward) so filtering adds no delay.
const lowpass = (x) => {
  for (let pass = 0; pass < 2; pass++) {
    biquad(x, { type: "lp", freq: 140 });
    x.reverse();
  }
  return x;
};
const low = lowpass(mono);

// 1 ms RMS frames; an onset is a frame whose energy jumps well above the
// preceding 15 ms, with a 100 ms refractory period.
const hop = SR / 1000;
const frames = Math.floor(n / hop);
const rms = new Float64Array(frames);
for (let f = 0; f < frames; f++) {
  let acc = 0;
  for (let i = f * hop; i < (f + 1) * hop; i++) acc += low[i] * low[i];
  rms[f] = Math.sqrt(acc / hop);
}
const globalPeak = rms.reduce((m, v) => Math.max(m, v), 0);
const onsets = [];
for (let f = 20; f < frames; f++) {
  let before = 0;
  for (let k = f - 18; k < f - 3; k++) before = Math.max(before, rms[k]);
  if (rms[f] > 0.15 * globalPeak && rms[f] > 3 * before && (!onsets.length || f - onsets.at(-1).frame > 100)) {
    // Refine to the sample: first crossing of 20% of the local peak.
    const from = (f - 4) * hop;
    let peak = 0;
    for (let i = from; i < from + 25 * hop; i++) peak = Math.max(peak, Math.abs(low[i]));
    let s = from;
    while (Math.abs(low[s]) < 0.2 * peak) s++;
    onsets.push({ frame: f, t: s / SR });
  }
}

const onBeat = [];
const other = [];
for (const o of onsets) {
  const nearest8 = Math.round(o.t / (2 * SIXTEENTH)) * 2 * SIXTEENTH;
  const isBeat = Math.abs(nearest8 / BEAT - Math.round(nearest8 / BEAT)) < 1e-6;
  (isBeat ? onBeat : other).push({ t: o.t, dev: o.t - Math.round(o.t / BEAT) * BEAT });
}
const devs = onBeat.map((o) => Math.abs(o.dev) * 1000);
console.log(
  JSON.stringify({
    onsetsOnBeat: onBeat.length,
    otherOnsets: other.length,
    first: +onBeat[0]?.t.toFixed(4),
    last: +onBeat.at(-1)?.t.toFixed(4),
    meanAbsDevMs: +(devs.reduce((a, b) => a + b, 0) / devs.length).toFixed(3),
    maxAbsDevMs: +Math.max(...devs).toFixed(3),
    meanSignedDevMs: +((onBeat.reduce((a, o) => a + o.dev, 0) / onBeat.length) * 1000).toFixed(3),
  }),
);
