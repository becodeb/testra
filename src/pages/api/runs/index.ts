import type { APIRoute } from "astro";
import { z } from "zod";

import { getActor, isTeacher, unauthenticated, forbidden } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { createRun, listRuns } from "@/server/repository";

export const GET: APIRoute = async ({ locals }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  return Response.json(await listRuns(actor));
};

export const POST: APIRoute = async ({ locals, request }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try {
    const { examId } = z.object({ examId: z.string().min(1) }).parse(await readJson(request));
    const run = await createRun(actor, examId);
    return run ? Response.json(run, { status: 201 }) : Response.json({ error: "Evaluación inexistente" }, { status: 404 });
  } catch (error) {
    return apiError(error);
  }
};
