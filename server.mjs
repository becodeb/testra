// Entrada de producción. El adaptador de Node en modo standalone ya sabe servir
// los estáticos y renderizar, pero levanta su propio `http.Server` y no expone
// el evento `upgrade`. Acá se le pide que no arranque solo, se crea el servidor
// a mano y se le engancha el upgrade de los WebSockets de las tomas en vivo.
//
// Los `import()` son dinámicos a propósito: los `import` estáticos se evalúan
// antes que cualquier sentencia del módulo, y ASTRO_NODE_AUTOSTART tiene que
// estar puesto antes de que se cargue el entry de Astro.

import http from "node:http";

process.env.ASTRO_NODE_AUTOSTART = "disabled";

const { handler } = await import("./dist/server/entry.mjs");
const { handleUpgrade, closeDatabase, closeAbandonedLobbyRuns, pruneIdleRunActors } = await import("./dist/ws-upgrade.mjs");

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const server = http.createServer((request, response) => {
  handler(request, response);
});

server.on("upgrade", (request, socket, head) => {
  handleUpgrade(request, socket, head)
    .then((handled) => {
      if (!handled) socket.destroy();
    })
    .catch((error) => {
      console.error("[server] error atendiendo el upgrade", error);
      socket.destroy();
    });
});

// Detrás del proxy de Coolify conviene tolerar conexiones ociosas largas: un
// alumno con la pestaña quieta no debe perder el socket.
server.keepAliveTimeout = 76_000;
server.headersTimeout = 80_000;

server.listen(port, host, () => {
  console.log(`[server] Testra escuchando en http://${host}:${port}`);
});

async function runMaintenance() {
  try {
    const closed = await closeAbandonedLobbyRuns();
    pruneIdleRunActors();
    if (closed) console.log(`[server] ${closed} sala(s) de espera abandonada(s) cerrada(s)`);
  } catch (error) {
    console.error("[server] falló el mantenimiento de salas", error);
  }
}

void runMaintenance();
const maintenanceTimer = setInterval(() => void runMaintenance(), 60_000);
maintenanceTimer.unref?.();

let closing = false;

async function shutdown(signal) {
  if (closing) return;
  closing = true;
  clearInterval(maintenanceTimer);
  console.log(`[server] ${signal} recibido, cerrando`);
  server.close();
  await closeDatabase().catch((error) => console.error("[server] error cerrando el pool", error));
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
