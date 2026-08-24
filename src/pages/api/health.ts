import type { APIRoute } from "astro";

import { db } from "@/server/db/client";

// Chequeo de salud de Coolify. Con el Worker el estado había que deducirlo
// pidiendo /login; ahora el contenedor responde por sí mismo y solo se declara
// sano si además puede hablar con Postgres.
export const GET: APIRoute = async () => {
  try {
    await db.prepare("SELECT 1").first();
    return Response.json({ status: "ok" });
  } catch (error) {
    console.error("[health] la base no responde", error);
    return Response.json({ status: "error", detail: "database" }, { status: 503 });
  }
};
