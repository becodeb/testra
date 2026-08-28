import type { APIRoute } from "astro";
import { z } from "zod";

import { forbidden, getActor, isTeacher, unauthenticated } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { rejectAiSuggestion } from "@/server/repository";

export const POST: APIRoute = async ({ locals, request }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try {
    const input = z.object({ participantId: z.string().min(1), questionId: z.string().min(1), action: z.literal("reject") }).parse(await readJson(request));
    return await rejectAiSuggestion(actor, input.participantId, input.questionId) ? Response.json({ saved: true }) : forbidden();
  } catch (error) { return apiError(error); }
};
