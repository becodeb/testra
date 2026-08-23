import type { APIRoute } from "astro";

import { getActor, isTeacher, unauthenticated, forbidden } from "@/server/actors";
import { getMonitorSnapshot } from "@/server/repository";

export const GET: APIRoute = async ({ locals, params }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  const snapshot = await getMonitorSnapshot(params.id!, actor);
  return snapshot ? Response.json(snapshot) : Response.json({ error: "Sesión inexistente" }, { status: 404 });
};
