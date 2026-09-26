// Small offline DSP toolkit shared by compose.mjs and onsets.mjs.
import { readFile, writeFile } from "node:fs/promises";

export const SR = 48_000;

export const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
export const dbToGain = (db) => 10 ** (db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-12));

/** Deterministic PRNG (mulberry32). */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Piecewise-linear automation over [t, v] keys; `log` interpolates in log space. */
export function automation(keys, { log = false } = {}) {
  const ks = [...keys].sort((a, b) => a[0] - b[0]);
  return (t) => {
    if (t <= ks[0][0]) return ks[0][1];
    for (let i = 1; i < ks.length; i++) {
      const [t1, v1] = ks[i];
      if (t <= t1) {
        const [t0, v0] = ks[i - 1];
        const u = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
        return log ? v0 * (v1 / v0) ** u : v0 + (v1 - v0) * u;
      }
    }
    return ks[ks.length - 1][1];
  };
}

/** Band-limited sawtooth sample for phase in [0, 1) and phase increment dt. */
export function saw(phase, dt) {
  let v = 2 * phase - 1;
  if (phase < dt) {
    const x = phase / dt;
    v -= x + x - x * x - 1;
  } else if (phase > 1 - dt) {
    const x = (phase - 1) / dt;
    v -= x * x + x + x + 1;
  }
  return v;
}

/**
 * In-place TPT state-variable filter (Zavalishin). `cutoff` is a number or a
 * function of time in seconds. mode: "lp" | "hp" | "bp".
 */
export function svf(buf, cutoff, { q = 0.707, mode = "lp", from = 0, to = buf.length } = {}) {
  let ic1 = 0;
  let ic2 = 0;
  const k = 1 / q;
  const fixed = typeof cutoff === "number";
  let g = fixed ? Math.tan((Math.PI * Math.min(cutoff, SR * 0.45)) / SR) : 0;
  for (let n = from; n < to; n++) {
    if (!fixed && (n & 15) === 0) g = Math.tan((Math.PI * Math.min(cutoff(n / SR), SR * 0.45)) / SR);
    const a1 = 1 / (1 + g * (g + k));
    const v0 = buf[n];
    const v3 = v0 - ic2;
    const v1 = a1 * ic1 + g * a1 * v3;
    const v2 = ic2 + g * v1;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    buf[n] = mode === "lp" ? v2 : mode === "bp" ? v1 : v0 - k * v1 - v2;
  }
  return buf;
}

/** RBJ biquad, processed in place. */
export function biquad(buf, { type, freq, q = 0.707 }) {
  const w = (2 * Math.PI * freq) / SR;
  const cw = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === "lp") [b0, b1, b2] = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2];
  else [b0, b1, b2] = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2];
  const a0 = 1 + alpha;
  return iir(buf, [b0 / a0, b1 / a0, b2 / a0], [1, (-2 * cw) / a0, (1 - alpha) / a0]);
}

function iir(buf, b, a) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = 0; n < buf.length; n++) {
    const x = buf[n];
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    buf[n] = y;
  }
  return buf;
}

/** Integrated loudness (ITU-R BS.1770-4, gated), for 48 kHz channels. */
export function lufs(channels) {
  const block = Math.round(0.4 * SR);
  const hop = Math.round(0.1 * SR);
  const weighted = channels.map((ch) => {
    const x = Float64Array.from(ch);
    iir(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]);
    iir(x, [1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
    return x;
  });
  const powers = [];
  for (let s = 0; s + block <= weighted[0].length; s += hop) {
    let p = 0;
    for (const x of weighted) {
      let acc = 0;
      for (let n = s; n < s + block; n++) acc += x[n] * x[n];
      p += acc / block;
    }
    powers.push(p);
  }
  const loud = (p) => -0.691 + 10 * Math.log10(p);
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const abs = powers.filter((p) => loud(p) > -70);
  const rel = loud(mean(abs)) - 10;
  return loud(mean(abs.filter((p) => loud(p) > rel)));
}

export async function writeWav(file, channels) {
  const frames = channels[0].length;
  const nch = channels.length;
  const data = Buffer.alloc(frames * nch * 2);
  for (let n = 0; n < frames; n++) {
    for (let c = 0; c < nch; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][n]));
      data.writeInt16LE(Math.round(v * 32767), (n * nch + c) * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(nch, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * nch * 2, 28);
  header.writeUInt16LE(nch * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  await writeFile(file, Buffer.concat([header, data]));
}

/** Reads a 16-bit PCM WAV into Float32Array channels. */
export async function readWav(file) {
  const buf = await readFile(file);
  let off = 12;
  let fmt;
  while (off < buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") fmt = { nch: buf.readUInt16LE(off + 10), sr: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === "data") {
      if (!fmt || fmt.bits !== 16) throw new Error("expected 16-bit PCM");
      const frames = size / (2 * fmt.nch);
      const chans = Array.from({ length: fmt.nch }, () => new Float32Array(frames));
      for (let n = 0; n < frames; n++) for (let c = 0; c < fmt.nch; c++) chans[c][n] = buf.readInt16LE(off + 8 + (n * fmt.nch + c) * 2) / 32768;
      return { sr: fmt.sr, channels: chans };
    }
    off += 8 + size + (size & 1);
  }
  throw new Error("no data chunk");
}
