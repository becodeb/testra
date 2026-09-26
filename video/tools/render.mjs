// Renders the scene to video: CDP capture → motion blur by exact averaging of
// subframes → lossless FFV1 chunks (resumable) → H.264 + AAC.
//
//   node video/tools/render.mjs                    whole piece → video/out/testra-demo.mp4
//   node video/tools/render.mjs --from 12 --to 14 --out video/out/test.mp4
//   node video/tools/render.mjs --from 0 --to 8 --out video/build/a.mkv   (one lossless chunk)
//   node video/tools/render.mjs --selftest         proves the averaging is exact per group
//
// Motion blur: 180° shutter. A frame where `__motion` is true at any subframe
// time gets K stratified subframes, K ∈ {blur, 2·blur, …, blur-max}, chosen so
// the largest on-screen displacement of any element across the shutter,
// divided by K, stays ≤ ghost-px (no visible strobing on fast camera moves).
// Static frames are captured once.
//
// Options: --scale 1|2 (dpr; 2 supersamples 3840×2160 → 1080p lanczos),
// --blur N (min subframes when moving, default 4; 1 disables blur),
// --blur-max N (default 16), --ghost-px P (default 2), --chunk S (seconds per
// resumable chunk, default 4), --jobs N (chunks rendered concurrently, each
// with its own Chrome and ffmpeg; default 1), --gpu (GPU raster; off by
// default for reproducible frames), --no-audio, --tune <x264 tune>, --crf N (14).
// Chunk boundaries never depend on --jobs, so the output is the same either way.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Worker } from "node:worker_threads";

import { FPS, VIDEO_DURATION as DURATION } from "../src/timeline.ts";
import { DIST_DIR, openScene, VIDEO_DIR } from "./cdp.mjs";
import { checkFfmpeg, countFrames, encodeFinal, HEIGHT, spawnFfmpeg, WIDTH } from "./encode.mjs";
import { findChrome } from "./find-bin.mjs";
import { solidPng } from "./png.mjs";

const SHUTTER = 0.5; // 180°: open for half a frame
const IN_FLIGHT = 3; // frames queued to the sink before we wait

const { values: opt } = parseArgs({
  options: {
    from: { type: "string", default: "0" },
    to: { type: "string", default: String(DURATION) },
    scale: { type: "string", default: "1" },
    blur: { type: "string", default: "4" },
    "blur-max": { type: "string", default: "16" },
    "ghost-px": { type: "string", default: "2" },
    chunk: { type: "string", default: "4" },
    jobs: { type: "string", default: "1" },
    gpu: { type: "boolean", default: false },
    out: { type: "string", default: join(VIDEO_DIR, "out", "testra-demo.mp4") },
    "no-audio": { type: "boolean", default: false },
    tune: { type: "string" },
    crf: { type: "string", default: "14" },
    selftest: { type: "boolean", default: false },
  },
});

/**
 * Injected into the page (read-only): snapshots the viewport rects of small
 * elements (text, icons, controls) and reports how far any of them moved.
 */
const RECT_PROBE = `
window.__probe = {
  snap() {
    const m = new Map();
    for (const el of document.querySelectorAll("#root *")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.width <= 480 && r.height <= 480 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight)
        m.set(el, [r.left, r.top, r.right, r.bottom]);
    }
    this.rects = m;
  },
  shift() {
    let d = 0;
    for (const [el, a] of this.rects) {
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      d = Math.max(d, Math.abs(r.left - a[0]), Math.abs(r.top - a[1]), Math.abs(r.right - a[2]), Math.abs(r.bottom - a[3]));
    }
    return d;
  },
};`;

const probe = async (scene, fn) => {
  const { result } = await scene.session.send("Runtime.evaluate", { expression: `window.__probe.${fn}()`, returnByValue: true });
  return result.value;
};

const kFor = (shift) => {
  let k = blurMin;
  while (k < blurMax && shift / k > ghostPx) k *= 2;
  return Math.min(k, blurMax);
};
const subTimes = (t, k) => Array.from({ length: k }, (_, i) => t + ((i + 0.5) / k - 0.5) * (SHUTTER / FPS));

if (opt.selftest) process.exit(await selftest());

const from = Number(opt.from);
const to = Number(opt.to);
const scale = Number(opt.scale);
const blurMin = Math.max(1, Math.round(Number(opt.blur)));
const blurMax = Math.max(blurMin, Math.round(Number(opt["blur-max"])));
const ghostPx = Number(opt["ghost-px"]);
const jobs = Math.max(1, Math.round(Number(opt.jobs)));
const gpu = opt.gpu || process.env.CHROME_GPU === "1";
const out = resolve(opt.out);
const f0 = Math.round(from * FPS);
const f1 = Math.round(to * FPS);
if (!(f1 > f0) || f0 < 0 || f1 > DURATION * FPS) throw new Error(`bad range --from ${from} --to ${to}`);
if (![1, 2].includes(scale)) throw new Error("--scale must be 1 or 2");
if (!existsSync(join(DIST_DIR, "index.html"))) {
  console.error("video/dist is missing: run `npx vite build --config video/vite.config.mjs` first");
  process.exit(1);
}

// Chunks are keyed by the built scene and the settings, so nothing stale is reused.
const sceneId = createHash("sha256").update(await readFile(join(DIST_DIR, "index.html"))).digest("hex").slice(0, 10);
const chunkDir = join(VIDEO_DIR, "build", "chunks", `${sceneId}-s${scale}-b${blurMin}-${blurMax}-g${ghostPx}`);
await mkdir(chunkDir, { recursive: true });
await mkdir(dirname(out), { recursive: true });

const ranges = [];
if (out.endsWith(".mkv")) ranges.push({ a: f0, b: f1, file: out });
else {
  const step = Math.max(1, Math.round(Number(opt.chunk) * FPS));
  for (let a = f0; a < f1; a += step) {
    const b = Math.min(f1, a + step);
    ranges.push({ a, b, file: join(chunkDir, `f${String(a).padStart(5, "0")}-${String(b).padStart(5, "0")}.mkv`) });
  }
}
// A chunk is reused only if it decodes to exactly the frames it should hold.
const todo = ranges.filter((r) => r.file === out || countFrames(r.file) !== r.b - r.a);
const total = todo.reduce((n, r) => n + r.b - r.a, 0);
console.log(`scene ${sceneId} · frames ${f0}–${f1} · scale ${scale} · blur ${blurMin}–${blurMax} (≤${ghostPx}px) · ${ranges.length - todo.length}/${ranges.length} chunks reused`);

console.log(`chrome ${findChrome()}${gpu ? " (gpu)" : ""} · ffmpeg ${checkFfmpeg()} · jobs ${jobs}`);

if (todo.length) {
  const stats = { done: 0, moving: 0, captures: 0, redo: 0, k: {}, started: performance.now() };
  const queue = [...todo];
  // Each job owns one browser and pulls whole chunks until the queue is empty.
  const job = async () => {
    const scene = await openScene({ scale, gpu });
    try {
      // Every chunk starts from a freshly loaded page, so its frames never
      // depend on which chunk this browser rendered before (keeps --jobs exact).
      let first = true;
      for (let r = queue.shift(); r; r = queue.shift()) {
        if (!first) await scene.reload();
        first = false;
        await scene.session.send("Runtime.evaluate", { expression: RECT_PROBE });
        await captureRange(scene, r, stats);
      }
      if (scene.errors.length) throw new Error(`page errors:\n${scene.errors.join("\n")}`);
    } catch (error) {
      queue.length = 0; // other jobs stop after their current chunk
      throw error;
    } finally {
      await scene.close();
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(jobs, todo.length) }, job));
  const failed = results.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
  const secs = (performance.now() - stats.started) / 1000;
  console.log(
    `captured ${stats.done} frames (${stats.moving} moving, subframes ${JSON.stringify(stats.k)}, ${stats.redo} refined, ${stats.captures} screenshots) in ${secs.toFixed(1)} s · ${(secs / stats.done).toFixed(3)} s/frame`,
  );
}

if (!out.endsWith(".mkv")) {
  const started = performance.now();
  await encodeFinal({
    chunks: ranges.map((r) => r.file),
    out,
    from: f0 / FPS,
    seconds: (f1 - f0) / FPS,
    audio: !opt["no-audio"],
    tune: opt.tune ?? null,
    crf: Number(opt.crf),
  });
  console.log(`encoded ${out} in ${((performance.now() - started) / 1000).toFixed(1)} s`);
}

// ---------------------------------------------------------------------------

function openSink(file) {
  const worker = new Worker(new URL("./frame-sink.mjs", import.meta.url), {
    workerData: { file, width: WIDTH * scale, height: HEIGHT * scale, outWidth: WIDTH, outHeight: HEIGHT },
  });
  let pending = 0;
  let waiters = [];
  let error = null;
  let finished;
  const finishedP = new Promise((ok) => (finished = ok));
  const wake = () => {
    for (const w of waiters) w();
    waiters = [];
  };
  worker.on("message", (msg) => {
    if (msg.type === "ack") pending--;
    else if (msg.type === "done") finished();
    else if (msg.type === "error") error = new Error(msg.message);
    wake();
  });
  worker.on("error", (e) => {
    error = e;
    wake();
    finished();
  });
  return {
    async send(pngs) {
      if (error) throw error;
      pending++;
      worker.postMessage({ type: "frame", pngs });
      while (pending >= IN_FLIGHT && !error) await new Promise((ok) => waiters.push(ok));
      if (error) throw error;
    },
    async end(abort = false) {
      worker.postMessage({ type: abort ? "abort" : "end" });
      await finishedP;
      await worker.terminate();
      if (error && !abort) throw error;
    },
  };
}

async function captureRange(scene, { a, b, file }, stats) {
  const partial = `${file}.partial.mkv`;
  const sink = openSink(partial);
  let lastShift = 0;
  await scene.setTime(a / FPS); // the first motion test reads layout at the chunk start
  const shot = async (t) => {
    await scene.setTime(t);
    stats.captures++;
    return scene.screenshot({ optimizeForSpeed: true });
  };
  try {
    for (let f = a; f < b; f++) {
      const t = f / FPS;
      let moving = false;
      if (blurMin > 1) for (const s of subTimes(t, blurMax)) if ((moving = await scene.motion(s))) break;
      let pngs;
      if (!moving) {
        pngs = [await shot(t)];
        lastShift = 0;
      } else {
        stats.moving++;
        let k = kFor(lastShift);
        for (;;) {
          const times = subTimes(t, k);
          pngs = [];
          for (const [i, s] of times.entries()) {
            pngs.push(await shot(s));
            if (i === 0) await probe(scene, "snap");
          }
          // First→last sample spans (k−1)/k of the shutter; extrapolate to all of it.
          lastShift = ((await probe(scene, "shift")) * k) / (k - 1);
          const need = kFor(lastShift);
          if (need <= k) break;
          stats.redo++;
          k = need;
        }
        stats.k[k] = (stats.k[k] ?? 0) + 1;
      }
      await sink.send(pngs);
      stats.done++;
      if (stats.done % 30 === 0 || stats.done === total) {
        const el = (performance.now() - stats.started) / 1000;
        const rate = stats.done / el;
        const eta = (total - stats.done) / rate;
        const rss = (process.memoryUsage().rss / 2 ** 20).toFixed(0);
        console.log(
          `frame ${stats.done}/${total} (t=${t.toFixed(3)}${jobs > 1 ? `, chunk ${a}` : ""}) · ${rate.toFixed(2)} fps · moving ${stats.moving} · ETA ${Math.floor(eta / 60)}m${String(Math.round(eta % 60)).padStart(2, "0")}s · rss ${rss} MB`,
        );
      }
    }
    await sink.end();
    await rename(partial, file);
  } catch (error) {
    await sink.end(true).catch(() => undefined);
    await rm(partial, { force: true });
    throw error;
  }
}

/**
 * Sends known solid-colour subframe groups through the real sink (decode →
 * average → ffmpeg → FFV1), decodes the chunk back and checks every output
 * frame is the rounded mean of its own group only.
 */
async function selftest() {
  const groups = [
    [0, 40, 80, 120], // 60
    [200, 200, 200, 200], // 200: bleed from the previous group would show
    [10, 11, 12, 14], // 11.75 → 12
    [77], // static frame, captured once
    [255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0], // 127.5 → 128
    [3, 5], // 4
  ];
  const mean = (g) => Math.round(g.reduce((s, v) => s + v, 0) / g.length);
  const expected = groups.map(mean);
  const expectedG = groups.map((g) => mean(g.map((v) => 255 - v)));
  const file = join(VIDEO_DIR, "build", "selftest.mkv");
  await mkdir(dirname(file), { recursive: true });
  const w = 64, h = 36;
  const worker = new Worker(new URL("./frame-sink.mjs", import.meta.url), { workerData: { file, width: w, height: h, outWidth: w, outHeight: h } });
  const replies = [];
  let wake;
  worker.on("message", (m) => {
    replies.push(m);
    wake?.();
  });
  const until = async (type) => {
    while (!replies.some((m) => m.type === type || m.type === "error")) await new Promise((ok) => (wake = ok));
    const err = replies.find((m) => m.type === "error");
    if (err) throw new Error(err.message);
  };
  for (const g of groups) worker.postMessage({ type: "frame", pngs: g.map((v) => solidPng(w, h, [v, 255 - v, v])) });
  worker.postMessage({ type: "end" });
  await until("done");
  await worker.terminate();

  const chunks = [];
  const { child, done } = spawnFfmpeg(["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { stdout: true });
  child.stdout.on("data", (d) => chunks.push(d));
  await done;
  const raw = Buffer.concat(chunks);
  const size = w * h * 3;
  const got = [];
  let uniform = true;
  for (let i = 0; i < raw.length / size; i++) {
    const fr = raw.subarray(i * size, (i + 1) * size);
    got.push(fr[0]);
    for (let p = 0; p < size; p += 3) if (fr[p] !== fr[0] || fr[p + 1] !== expectedG[i] || fr[p + 2] !== fr[0]) uniform = false;
  }
  await rm(file, { force: true });
  const ok = uniform && got.length === groups.length && got.every((v, i) => v === expected[i]);
  console.log(`selftest: groups of ${groups.map((g) => g.length).join("/")} → expected ${JSON.stringify(expected)} got ${JSON.stringify(got)}, frames uniform: ${uniform} → ${ok ? "PASS" : "FAIL"}`);
  return ok ? 0 : 1;
}
