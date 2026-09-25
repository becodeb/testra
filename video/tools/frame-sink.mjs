// Worker thread: decodes PNG subframes, averages each group exactly
// (round-half-up of the integer mean) and streams the 60 fps result as raw
// RGB into ffmpeg, which writes a lossless FFV1 chunk. Keeping this off the
// main thread lets decoding overlap with Chromium's next capture.
import { parentPort, workerData } from "node:worker_threads";

import { spawnFfmpeg } from "./encode.mjs";
import { decodePng } from "./png.mjs";

const { file, width, height, outWidth, outHeight } = workerData;
const size = width * height * 3;

const vf = [];
if (width !== outWidth || height !== outHeight) vf.push(`scale=${outWidth}:${outHeight}:flags=lanczos+accurate_rnd+full_chroma_int`);
vf.push("format=gbrp");
const { child, done } = spawnFfmpeg(
  [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`, "-framerate", "60", "-i", "-",
    "-vf", vf.join(","),
    "-fps_mode", "passthrough",
    "-c:v", "ffv1", "-level", "3", "-g", "1", "-slices", "4", "-threads", "2",
    "-f", "matroska", file,
  ],
  { stdin: true },
);
let failed = null;
done.catch((error) => {
  failed = error;
});

const sum = new Uint16Array(size); // 16 × 255 fits comfortably
const decoded = new Uint8Array(size);

const write = (buf) =>
  new Promise((ok, fail) => {
    if (failed) return fail(failed);
    if (child.stdin.write(buf)) ok();
    else child.stdin.once("drain", ok);
  });

/** One output frame from its group of subframe PNGs. */
async function frame(list) {
  const pngs = list.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p.buffer, p.byteOffset, p.byteLength)));
  const k = pngs.length;
  if (k === 1) {
    const out = new Uint8Array(size);
    check(decodePng(pngs[0], out));
    return write(out);
  }
  sum.fill(0);
  for (const png of pngs) {
    check(decodePng(png, decoded));
    for (let i = 0; i < size; i++) sum[i] += decoded[i];
  }
  const out = new Uint8Array(size);
  const half = k >> 1;
  for (let i = 0; i < size; i++) out[i] = ((sum[i] + half) / k) | 0;
  return write(out);
}

function check(img) {
  if (img.width !== width || img.height !== height) throw new Error(`capture is ${img.width}×${img.height}, expected ${width}×${height}`);
}

// Messages are handled strictly in order.
let chain = Promise.resolve();
parentPort.on("message", (msg) => {
  chain = chain.then(() => handle(msg));
});

async function handle(msg) {
  try {
    if (msg.type === "frame") {
      await frame(msg.pngs);
      parentPort.postMessage({ type: "ack", id: msg.id });
    } else if (msg.type === "end") {
      child.stdin.end();
      await done;
      parentPort.postMessage({ type: "done" });
    } else if (msg.type === "abort") {
      child.kill("SIGKILL");
      parentPort.postMessage({ type: "done" });
    }
  } catch (error) {
    child.kill("SIGKILL");
    parentPort.postMessage({ type: "error", message: String(error?.stack ?? error) });
  }
}
