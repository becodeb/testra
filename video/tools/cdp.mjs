// Zero-dependency Chromium driver over the DevTools protocol (Node >= 22:
// global fetch and WebSocket). Serves video/dist on an ephemeral port and
// drives the scene through window.__setTime.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const VIDEO_DIR = fileURLToPath(new URL("..", import.meta.url));
export const DIST_DIR = join(VIDEO_DIR, "dist");
export const CHROMIUM = process.env.CHROMIUM ?? "/usr/bin/chromium";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

/** Static server for the built scene, bound to localhost on a free port. */
export async function serveDist(root = DIST_DIR) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const file = normalize(join(base, path === "/" ? "index.html" : path));
    if (!file.startsWith(base + sep) && file !== base) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((ok) => server.close(ok)) };
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function waitForDevtoolsPort(userDataDir, child, timeoutMs = 20_000) {
  const file = join(userDataDir, "DevToolsActivePort");
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`chromium exited early (code ${child.exitCode})`);
    try {
      const [port] = (await readFile(file, "utf8")).split("\n");
      if (port) return Number(port);
    } catch {
      // not written yet
    }
    await sleep(50);
  }
  throw new Error("timed out waiting for DevToolsActivePort");
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8"));
      if (msg.id && this.pending.has(msg.id)) {
        const { ok, fail, method } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) fail(new Error(`${method}: ${msg.error.message}`));
        else ok(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((ok, fail) => {
      this.pending.set(id, { ok, fail, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  once(method) {
    return new Promise((ok) => {
      const fn = (params) => {
        this.listeners.set(method, (this.listeners.get(method) ?? []).filter((f) => f !== fn));
        ok(params);
      };
      this.on(method, fn);
    });
  }
}

/**
 * Launch one headless Chromium with the scene loaded at 1920×1080 CSS px;
 * `scale` is the device pixel ratio (2 captures 3840×2160).
 * Always call `close()` (it SIGKILLs the browser and removes its profile).
 */
export async function openScene({ width = 1920, height = 1080, scale = 1, query = "" } = {}) {
  const server = await serveDist();
  const userDataDir = await mkdtemp(join(tmpdir(), "testra-video-"));
  const child = spawn(
    CHROMIUM,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      "--mute-audio",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--font-render-hinting=none",
      `--window-size=${width},${height}`,
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });

  const errors = [];
  let ws;
  const close = async () => {
    try {
      ws?.close();
    } catch {
      // already closed
    }
    child.kill("SIGKILL");
    await server.close();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  };

  try {
    const port = await waitForDevtoolsPort(userDataDir, child);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((target) => target.type === "page");
    if (!page) throw new Error("no page target");
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((ok, fail) => {
      ws.addEventListener("open", ok, { once: true });
      ws.addEventListener("error", () => fail(new Error("websocket error")), { once: true });
    });
    const session = new Session(ws);

    session.on("Runtime.consoleAPICalled", ({ type, args }) => {
      if (type === "error" || type === "assert") errors.push(`console.${type}: ${args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
    });
    session.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
      errors.push(`exception: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    });
    session.on("Log.entryAdded", ({ entry }) => {
      if (entry.level === "error") errors.push(`log: ${entry.text} ${entry.url ?? ""}`.trim());
    });

    await session.send("Runtime.enable");
    await session.send("Log.enable");
    await session.send("Page.enable");
    await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
    await session.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 247, g: 248, b: 250, a: 1 } });

    const loaded = session.once("Page.loadEventFired");
    await session.send("Page.navigate", { url: `${server.url}index.html${query}` });
    await loaded;
    await evaluate(session, "window.__ready");

    return {
      session,
      errors,
      close,
      /** Render the scene at t (seconds). */
      setTime: (t) => evaluate(session, `window.__setTime(${Number(t)})`),
      /** True when something moves at t (for motion-blur subframes). */
      motion: (t) => evaluate(session, `window.__motion(${Number(t)})`),
      duration: () => evaluate(session, "window.__duration"),
      /** PNG of the viewport as a Buffer. */
      screenshot: async (options = {}) => {
        const { data } = await session.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false, ...options });
        return Buffer.from(data, "base64");
      },
      stderr: () => stderr,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

async function evaluate(session, expression) {
  const { result, exceptionDetails } = await session.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(`evaluate(${expression}): ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
  return result.value;
}
