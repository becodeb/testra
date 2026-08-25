import type { APIRoute } from "astro";
import { z } from "zod";

import { getActor, isSuperadmin } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { db } from "@/server/db/client";
import { runCommand } from "@/server/repository";

export const POST: APIRoute = async ({ locals, params, request }) => {
  const actor = getActor(locals);
  if (!isSuperadmin(actor)) return new Response("No encontrado", { status: 404 });
  try {
    z.object({ confirmed: z.literal(true) }).parse(await readJson(request));
    const run = await db.prepare("SELECT id, status FROM runs WHERE id = ?")
      .bind(params.id).first<{ id: string; status: string }>();
    if (!run) return Response.json({ error: "Sala inexistente" }, { status: 404 });
    if (run.status === "ended") return Response.json({ closed: true, alreadyClosed: true });
    const response = await runCommand(run.id, "/admin-end");
    if (!response.ok) return new Response(response.body, { status: response.status, headers: response.headers });
    return Response.json({ closed: true, alreadyClosed: false });
  } catch (error) {
    return apiError(error);
  }
};
