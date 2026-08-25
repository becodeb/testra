import type { APIRoute } from "astro";
import { z } from "zod";

import { apiError, readJson } from "@/server/api";
import { db } from "@/server/db/client";

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return Response.json({ error: "Iniciá sesión para continuar" }, { status: 401 });
  try {
    const input = z.object({ role: z.enum(["teacher", "student"]).default("teacher") })
      .parse(await readJson(request));
    // org_id se conserva como relacion historica, pero ya no condiciona el
    // acceso, no se crea por dominio y no necesita aprobacion.
    await db.prepare("UPDATE users SET role = ?, org_admin = false, updated_at = ? WHERE id = ?")
      .bind(input.role, new Date(), locals.user.id).run();
    return Response.json({ redirect: input.role === "teacher" ? "/evaluaciones" : "/rendir" });
  } catch (error) {
    return apiError(error);
  }
};
