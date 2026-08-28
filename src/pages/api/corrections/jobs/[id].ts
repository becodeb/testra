import type { APIRoute } from "astro";

import { forbidden, getActor, isTeacher, unauthenticated } from "@/server/actors";
import { apiError } from "@/server/api";
import { cancelGradingJob, getGradingJob } from "@/server/grading-jobs";

export const GET: APIRoute = async ({ locals, params }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try {
    const job = await getGradingJob(actor, params.id!);
    return job ? Response.json(job) : Response.json({ error: "Proceso inexistente" }, { status: 404 });
  } catch (error) { return apiError(error); }
};

export const DELETE: APIRoute = async ({ locals, params }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try {
    const job = await cancelGradingJob(actor, params.id!);
    return job ? Response.json(job) : Response.json({ error: "Proceso inexistente" }, { status: 404 });
  } catch (error) { return apiError(error); }
};
