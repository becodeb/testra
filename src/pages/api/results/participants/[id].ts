import type { APIRoute } from "astro";

import { getActor, isTeacher, forbidden, unauthenticated } from "@/server/actors";
import { getParticipantDetail } from "@/server/repository";

export const GET: APIRoute = async ({ locals, params }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  const detail = await getParticipantDetail(params.id ?? "", actor);
  return detail ? Response.json(detail) : Response.json({ error: "Alumno no encontrado" }, { status: 404 });
};
