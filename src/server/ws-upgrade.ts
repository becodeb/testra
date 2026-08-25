import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocketServer, type WebSocket } from "ws";

import { closeAbandonedLobbyRuns, getRunActor, pruneIdleRunActors } from "@/server/exam-run-actor";
import { authorizeRunSocket } from "@/server/run-socket-auth";

// server.mjs cierra el pool al apagarse a través de este re-export: es el único
// módulo de la aplicación que la entrada de producción importa directamente.
export { closeDatabase } from "@/server/db/client";
export { closeAbandonedLobbyRuns, pruneIdleRunActors };

// Atiende el upgrade de `GET /api/runs/:id/socket`. En Cloudflare esto lo hacía
// el Durable Object devolviendo un 101 con `webSocket`; en Node el upgrade nunca
// llega al handler de Astro, así que se intercepta sobre el `http.Server`.
//
// El mismo módulo lo usan el servidor de producción (src/server.ts) y el plugin
// de desarrollo declarado en astro.config.mjs.

const SOCKET_PATH = /^\/api\/runs\/([^/]+)\/socket$/;
const PING_INTERVAL_MS = 30_000;

const server = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
const alive = new WeakMap<WebSocket, boolean>();

// Los proxies cortan las conexiones ociosas. El ping del protocolo las mantiene
// abiertas sin depender de que el cliente mande tráfico de aplicación: el panel
// docente escucha mucho más de lo que habla.
const heartbeat = setInterval(() => {
  for (const socket of server.clients) {
    if (alive.get(socket) === false) {
      socket.terminate();
      continue;
    }
    alive.set(socket, false);
    socket.ping();
  }
}, PING_INTERVAL_MS);
heartbeat.unref?.();

function reject(socket: Duplex, status: number, message: string) {
  const body = JSON.stringify({ error: message });
  socket.write(
    `HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Forbidden"}\r\n` +
      "content-type: application/json\r\n" +
      `content-length: ${Buffer.byteLength(body)}\r\n` +
      "connection: close\r\n\r\n" +
      body,
  );
  socket.destroy();
}

function toRequest(request: IncomingMessage, url: URL): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, value);
  }
  return new Request(url, { method: "GET", headers });
}

/** Devuelve true si la petición era un socket de toma y ya fue atendida. */
export async function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<boolean> {
  const host = request.headers.host ?? "localhost";
  const url = new URL(request.url ?? "/", `http://${host}`);
  const match = SOCKET_PATH.exec(url.pathname);
  if (!match) return false;

  const runId = decodeURIComponent(match[1]);

  try {
    const result = await authorizeRunSocket({
      runId,
      searchParams: url.searchParams,
      request: toRequest(request, url),
    });

    if (!result.ok) {
      reject(socket, result.status, result.error);
      return true;
    }

    server.handleUpgrade(request, socket, head, (client) => {
      alive.set(client, true);
      client.on("pong", () => alive.set(client, true));
      void getRunActor(runId).accept(client, result.identity);
    });
  } catch (error) {
    console.error("[ws] falló el upgrade de la toma", runId, error);
    reject(socket, 403, "No se pudo abrir la conexión");
  }

  return true;
}
