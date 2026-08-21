import type { APIRoute } from "astro";

import { getActor, isTeacher, unauthenticated, forbidden } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { listExams, saveExam } from "@/server/repository";

export const GET: APIRoute = async ({ locals, url }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  return Response.json(await listExams(actor, url.searchParams.get("q") ?? "", url.searchParams.get("subject") ?? ""));
};

export const POST: APIRoute = async ({ locals, request }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try {
    return Response.json(await saveExam(actor, await readJson(request)), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
};
