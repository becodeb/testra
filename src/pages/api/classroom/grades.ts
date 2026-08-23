import type { APIRoute } from "astro";
import { z } from "zod";

import { getActor, isTeacher, unauthenticated, forbidden } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { classroomGradePreview, sendRunGrades } from "@/server/classroom-service";

export const GET: APIRoute = async ({ locals, url }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try {
    const runId = z.string().min(1).parse(url.searchParams.get("runId"));
    const preview = await classroomGradePreview(actor, runId);
    if (!preview) return Response.json({ error: "Sesión inexistente" }, { status: 404 });
    const { token: _, ...safePreview } = preview;
    return Response.json(safePreview);
  } catch (error) { return apiError(error); }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try {
    const { runId } = z.object({ runId: z.string().min(1), confirmed: z.literal(true) }).parse(await readJson(request));
    const result = await sendRunGrades(actor, runId);
    return result ? Response.json(result) : Response.json({ error: "Sesión inexistente" }, { status: 404 });
  } catch (error) { return apiError(error); }
};
