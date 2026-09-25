// Locates Chrome/Chromium/Edge and ffmpeg/ffprobe on macOS, Windows and Linux.
// Environment overrides win: CHROME (or CHROMIUM), FFMPEG, FFPROBE.
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Every directory on PATH joined with each name (plus .exe on Windows). */
function onPath(names) {
  const exts = process.platform === "win32" ? [".exe", ""] : [""];
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return dirs.flatMap((d) => names.flatMap((n) => exts.map((e) => join(d, n + e))));
}

function chromeCandidates() {
  const home = homedir();
  if (process.platform === "darwin") {
    const apps = [
      ["Google Chrome.app", "Google Chrome"],
      ["Chromium.app", "Chromium"],
      ["Microsoft Edge.app", "Microsoft Edge"],
      ["Google Chrome Canary.app", "Google Chrome Canary"],
    ];
    return ["/Applications", join(home, "Applications")].flatMap((root) => apps.map(([app, bin]) => join(root, app, "Contents", "MacOS", bin)));
  }
  if (process.platform === "win32") {
    const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
    return [
      ...roots.map((r) => join(r, "Google", "Chrome", "Application", "chrome.exe")),
      ...roots.map((r) => join(r, "Chromium", "Application", "chrome.exe")),
      ...roots.map((r) => join(r, "Microsoft", "Edge", "Application", "msedge.exe")),
    ];
  }
  return [...onPath(["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "microsoft-edge"]), "/snap/bin/chromium"];
}

export function findChrome() {
  const env = process.env.CHROME ?? process.env.CHROMIUM;
  if (env) {
    if (!isFile(env)) throw new Error(`CHROME=${env} does not exist`);
    return env;
  }
  const tried = chromeCandidates();
  const found = tried.find(isFile);
  if (found) return found;
  throw new Error(`No Chrome, Chromium or Edge found. Set CHROME=/path/to/browser. Tried:\n  ${tried.join("\n  ")}`);
}

function findTool(name, envVar, sibling) {
  const env = process.env[envVar];
  if (env) {
    if (!isFile(env)) throw new Error(`${envVar}=${env} does not exist`);
    return env;
  }
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const tried = [...onPath([name]), ...(sibling ? [join(dirname(sibling), exe)] : []), join(homedir(), ".local", "opt", "ffmpeg", exe)];
  const found = tried.find(isFile);
  if (found) return found;
  throw new Error(`${name} not found (ffmpeg 6+ required). Install it or set ${envVar}. Tried:\n  ${tried.join("\n  ")}`);
}

let ffmpeg;
let ffprobe;
export const findFfmpeg = () => (ffmpeg ??= findTool("ffmpeg", "FFMPEG"));
export const findFfprobe = () => (ffprobe ??= findTool("ffprobe", "FFPROBE", findFfmpeg()));
