// Joins lossless chunks (from render.mjs --out *.mkv) into the final MP4 and
// muxes the music for the same time range.
//   node video/tools/concat.mjs --out video/out/testra-demo.mp4 a.mkv b.mkv ...
//   options: --from <s> (start of the first chunk, default 0), --no-audio,
//            --tune <x264 tune>, --crf N (default 14)
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { countFrames, encodeFinal, FPS } from "./encode.mjs";

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    from: { type: "string", default: "0" },
    "no-audio": { type: "boolean", default: false },
    tune: { type: "string" },
    crf: { type: "string", default: "14" },
  },
});
if (!opt.out || !positionals.length) {
  console.error("usage: node video/tools/concat.mjs --out <file.mp4> [--from s] [--no-audio] chunk.mkv [chunk.mkv ...]");
  process.exit(2);
}
const chunks = positionals.map((p) => resolve(p));
for (const c of chunks) if (!existsSync(c)) throw new Error(`missing chunk ${c}`);

// Count frames so the audio is trimmed to exactly the video's length.
let frames = 0;
for (const c of chunks) {
  const n = countFrames(c);
  if (!n) throw new Error(`unreadable chunk ${c}`);
  frames += n;
}

await encodeFinal({
  chunks,
  out: resolve(opt.out),
  from: Number(opt.from),
  seconds: frames / FPS,
  audio: !opt["no-audio"],
  tune: opt.tune ?? null,
  crf: Number(opt.crf),
});
console.log(`${opt.out}: ${frames} frames (${(frames / FPS).toFixed(3)} s)`);
