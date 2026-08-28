import type { APIRoute } from "astro";
import { z } from "zod";

import { forbidden, getActor, isTeacher, unauthenticated } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { saveAiCriteria } from "@/server/repository";

// Permite cargar los criterios de la IA cuando el docente quiere, incluso con
// la evaluación ya tomada: antes había que decidirlo al armarla, y si te
// olvidabas no había forma de que la IA sugiriera nada.
export const POST: APIRoute = async ({ locals, request }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try {
    const input = z.object({
      runId: z.string().min(1),
      questionId: z.string().min(1),
      gradingCriteria: z.string().max(6000).default(""),
      referenceAnswer: z.string().max(10_000).default(""),
    }).parse(await readJson(request));
    const saved = await saveAiCriteria(actor, input.runId, input.questionId, input);
    return saved ? Response.json({ saved: true }) : forbidden();
  } catch (error) { return apiError(error); }
};
