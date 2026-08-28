import type { APIRoute } from "astro";
import { z } from "zod";

import { forbidden, getActor, isTeacher, unauthenticated } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { createGradingJob, resumeGradingJobs } from "@/server/grading-jobs";

export const POST: APIRoute = async ({ locals, request }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try {
    const input = z.object({ runId: z.string().min(1) }).parse(await readJson(request));
    const job = await createGradingJob(actor, input.runId);
    return Response.json(job, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
};

export const GET: APIRoute = async ({ locals }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try {
    await resumeGradingJobs();
    return Response.json({ resumed: true });
  } catch (error) {
    return apiError(error);
  }
};
