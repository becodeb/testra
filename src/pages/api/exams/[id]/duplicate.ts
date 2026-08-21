import type { APIRoute } from "astro";

import { getActor, isTeacher, unauthenticated, forbidden } from "@/server/actors";
import { duplicateExam } from "@/server/repository";

export const POST: APIRoute = async ({ locals, params }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  const copy = await duplicateExam(params.id!, actor);
  return copy ? Response.json(copy, { status: 201 }) : Response.json({ error: "Evaluación inexistente" }, { status: 404 });
};
