import type { APIRoute } from "astro";

import { getActor, isTeacher, unauthenticated, forbidden } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { deleteExam, getExam, saveExam } from "@/server/repository";

function teacher(locals: App.Locals): { actor: NonNullable<ReturnType<typeof getActor>> } | { response: Response } {
  const actor = getActor(locals, "teacher");
  if (!actor) return { response: unauthenticated() };
  if (!isTeacher(actor)) return { response: forbidden() };
  return { actor };
}

export const GET: APIRoute = async ({ locals, params }) => {
  const access = teacher(locals);
  if ("response" in access) return access.response;
  const exam = await getExam(params.id!, access.actor);
  return exam ? Response.json(exam) : Response.json({ error: "Evaluación inexistente" }, { status: 404 });
};

export const PATCH: APIRoute = async ({ locals, request, params }) => {
  const access = teacher(locals);
  if ("response" in access) return access.response;
  try {
    const body = await readJson(request) as Record<string, unknown>;
    return Response.json(await saveExam(access.actor, { ...body, id: params.id }));
  } catch (error) {
    return apiError(error);
  }
};

export const DELETE: APIRoute = async ({ locals, params }) => {
  const access = teacher(locals);
  if ("response" in access) return access.response;
  try {
    return (await deleteExam(params.id!, access.actor))
      ? new Response(null, { status: 204 })
      : Response.json({ error: "Evaluación inexistente" }, { status: 404 });
  } catch (error) {
    return apiError(error, "No se pudo borrar la evaluación");
  }
};
