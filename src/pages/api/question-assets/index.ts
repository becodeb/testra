import type { APIRoute } from "astro";

import { forbidden, getActor, isTeacher, unauthenticated } from "@/server/actors";
import { apiError } from "@/server/api";
import { storeQuestionImage } from "@/server/question-assets";

export const POST: APIRoute = async ({ locals, request }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try {
    const form = await request.formData();
    const examId = form.get("examId");
    const file = form.get("file");
    if (typeof examId !== "string" || !(file instanceof File)) throw new Error("Falta la imagen o la evaluación");
    return Response.json(await storeQuestionImage(actor, examId, file), { status: 201 });
  } catch (error) {
    return apiError(error, "No se pudo guardar la imagen");
  }
};
