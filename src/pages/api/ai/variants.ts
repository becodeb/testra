import type { APIRoute } from "astro";
import { z } from "zod";
import { forbidden, getActor, isTeacher, unauthenticated } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { generateQuestionVariants } from "@/server/ai-variants";

export const POST: APIRoute = async ({ locals, request }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try { const input = z.object({ examId: z.string().min(1), questionId: z.string().min(1), count: z.number().int().min(3).max(5).default(3) }).parse(await readJson(request)); return Response.json({ variants: await generateQuestionVariants(actor, input.examId, input.questionId, input.count) }); }
  catch (error) { return apiError(error); }
};
