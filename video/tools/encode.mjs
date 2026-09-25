// Shared ffmpeg plumbing for render.mjs and concat.mjs.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { VIDEO_DIR } from "./cdp.mjs";

// Static builds live outside PATH on the Pi; /tmp does not survive restarts.
export const FFMPEG =
  process.env.FFMPEG ?? [join(homedir(), ".local/opt/ffmpeg/ffmpeg"), "/tmp/tools/ffmpeg"].find((p) => existsSync(p)) ?? "ffmpeg";
export const FFPROBE = FFMPEG.replace(/ffmpeg$/, "ffprobe");
export const MUSIC = join(VIDEO_DIR, "build", "music.wav");
export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export function spawnFfmpeg(args, { stdin = false, stdout = false } = {}) {
  const child = spawn(FFMPEG, args, { stdio: [stdin ? "pipe" : "ignore", stdout ? "pipe" : "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr = (stderr + d).slice(-8000);
  });
  const done = new Promise((ok, fail) => {
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited ${code}:\n${stderr}`))));
  });
  return { child, done };
}

/**
 * Joins lossless chunks, converts to BT.709 limited-range 4:2:0, encodes
 * H.264 and muxes the music (trimmed to the same range as the video).
 */
/** Number of video frames in a file, or 0 when it is missing or unreadable. */
export function countFrames(file) {
  if (!existsSync(file)) return 0;
  const r = spawnSync(FFPROBE, ["-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", file], { encoding: "utf8" });
  return r.status === 0 ? Number(r.stdout.trim()) || 0 : 0;
}

export async function encodeFinal({ chunks, out, from = 0, seconds, audio = true, tune = null, crf = 14 }) {
  const list = `${out}.chunks.txt`;
  await writeFile(list, chunks.map((c) => `file '${c.replaceAll("'", "'\\''")}'`).join("\n") + "\n");
  if (audio && !existsSync(MUSIC)) throw new Error(`missing ${MUSIC}: run node video/audio/compose.mjs first`);
  const args = ["-hide_banner", "-loglevel", "error", "-stats", "-y", "-f", "concat", "-safe", "0", "-i", list];
  if (audio) args.push("-ss", String(from), "-t", String(seconds), "-i", MUSIC);
  args.push(
    "-map", "0:v:0",
    "-vf", `setpts=N/(${FPS}*TB),scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p`,
    "-r", String(FPS),
    "-c:v", "libx264", "-preset", "slow", "-crf", String(crf),
    ...(tune ? ["-tune", tune] : []),
    "-pix_fmt", "yuv420p",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-threads", "3",
  );
  if (audio) args.push("-map", "1:a:0", "-c:a", "aac", "-b:a", "256k");
  args.push("-movflags", "+faststart", out);
  const { done } = spawnFfmpeg(args);
  try {
    await done;
  } finally {
    await rm(list, { force: true });
  }
}
