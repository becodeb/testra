import type { APIRoute } from "astro";

import { getActor, isTeacher, unauthenticated, forbidden } from "@/server/actors";
import { duplicateExam } from "@/server/repository";

export const POST: APIRoute = async ({ locals, params, request }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  const body = await request.json().catch(() => ({})) as { adapted?: boolean };
  const copy = await duplicateExam(params.id!, actor, body.adapted === true);
  return copy ? Response.json(copy, { status: 201 }) : Response.json({ error: "Evaluación inexistente" }, { status: 404 });
};
