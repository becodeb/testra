import type { APIRoute } from "astro";
import { z } from "zod";

import { getActor, isTeacher, unauthenticated, forbidden } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { saveManualGrade } from "@/server/repository";

export const POST: APIRoute = async ({ locals, request }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try {
    const input = z.object({ participantId: z.string().min(1), questionId: z.string().min(1), pointsAwarded: z.number().min(0), feedback: z.string().max(4000).optional(), teacherNote: z.string().max(4000).optional(), rubricScores: z.record(z.string(), z.number().min(0)).optional() }).parse(await readJson(request));
    return (await saveManualGrade(actor, input)) ? Response.json({ saved: true }) : forbidden();
  } catch (error) {
    return apiError(error);
  }
};
