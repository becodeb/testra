import type { APIRoute } from "astro";
import { z } from "zod";

import { getActor, isTeacher, unauthenticated, forbidden } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { publishRunToClassroom } from "@/server/classroom-service";

export const POST: APIRoute = async ({ locals, request, url }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try {
    const input = z.object({ runId: z.string().min(1), courseId: z.string().min(1) }).parse(await readJson(request));
    const result = await publishRunToClassroom(actor, input.runId, input.courseId, url.origin);
    return result ? Response.json(result) : Response.json({ error: "Toma inexistente" }, { status: 404 });
  } catch (error) { return apiError(error); }
};
