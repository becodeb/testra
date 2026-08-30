import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { loadEnv } from "vite";

// El código del servidor lee la configuración de `process.env` (ver
// src/server/env.ts), que es de donde llega en el contenedor. Vite carga los
// archivos .env pero solo los expone en `import.meta.env`, así que en desarrollo
// hay que volcarlos a `process.env` a mano. Lo que ya venga del entorno real
// tiene prioridad: el archivo nunca pisa una variable exportada.
for (const [key, value] of Object.entries(loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), ""))) {
  process.env[key] ??= value;
}

// En producción el upgrade de los WebSockets lo atiende server.mjs. El servidor
// de desarrollo de Astro no pasa por ahí, así que se le engancha el mismo
// handler sobre el http.Server de Vite. `ssrLoadModule` lo carga con los alias y
// el TypeScript del proyecto ya resueltos, y comparte el grafo de módulos con
// las rutas: es el mismo registro de actores en ambos lados.
function devWebsocket() {
  return {
    name: "testra-dev-websocket",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.on("upgrade", async (request, socket, head) => {
        // Vite atiende su propio canal de HMR sobre este mismo evento; el
        // handler devuelve false cuando la ruta no es la de una toma y ahí no
        // hay que tocar el socket.
        try {
          const module = await server.ssrLoadModule("/src/server/ws-upgrade.ts");
          await module.handleUpgrade(request, socket, head);
        } catch (error) {
          server.config.logger.error(`[testra] falló el upgrade de WebSocket: ${error}`);
        }
      });
    },
  };
}

export default defineConfig({
  // La barra de herramientas de desarrollo se dibuja encima de la página y se
  // come clics cerca del borde inferior: en las pruebas de punta a punta hace
  // fallar acciones que en el producto funcionan. No es parte de Testra.
  devToolbar: { enabled: false },
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  // El chequeo de origen propio de Astro compara el Origin del navegador contra
  // el host de la request. El proxy que publica testra.becode.com.ar reescribe
  // Host, así que ese chequeo rechaza todos los POST de formulario. Se reemplaza
  // por uno equivalente y consciente del proxy en src/middleware.ts.
  security: { checkOrigin: false },
  vite: {
    plugins: [tailwindcss(), devWebsocket()],
  },
});
