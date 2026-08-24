import type { APIRoute } from "astro";

// El WebSocket de la toma no se atiende acá. En Node el upgrade del protocolo
// nunca llega al handler de Astro: lo intercepta el http.Server antes, en
// src/server/ws-upgrade.ts (producción vía server.mjs, desarrollo vía el plugin
// de astro.config.mjs). Esta ruta solo existe para que una petición sin cabecera
// Upgrade reciba un error que se entienda en lugar de un 404.
export const GET: APIRoute = () =>
  Response.json(
    { error: "Se esperaba una conexión WebSocket" },
    { status: 426, headers: { upgrade: "websocket", connection: "Upgrade" } },
  );
