// Usage: node video/tools/still.mjs 0.6 4.2 20.6 ...   (video time, seconds)
// Writes video/out/stills/t-XX.XX.png and fails on any page console error.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { openScene, VIDEO_DIR } from "./cdp.mjs";

const times = process.argv.slice(2).map(Number).filter((t) => Number.isFinite(t));
if (!times.length) {
  console.error("usage: node video/tools/still.mjs <t> [t ...]");
  process.exit(2);
}

const outDir = join(VIDEO_DIR, "out", "stills");
await mkdir(outDir, { recursive: true });

const scene = await openScene();
let failed = false;
try {
  for (const t of times) {
    await scene.setTime(t);
    const png = await scene.screenshot();
    const file = join(outDir, `t-${t.toFixed(2).padStart(5, "0")}.png`);
    await writeFile(file, png);
    console.log(`${file}${(await scene.motion(t)) ? "  (motion)" : ""}`);
  }
  if (scene.errors.length) {
    failed = true;
    console.error(`page errors:\n${scene.errors.join("\n")}`);
  }
} finally {
  await scene.close();
}
process.exit(failed ? 1 : 0);
