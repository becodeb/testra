import type { APIRoute } from "astro";
import { z } from "zod";

import { getActor } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { saveAnswer } from "@/server/repository";

const answerValue = z.union([z.string().max(50_000), z.boolean(), z.array(z.string().max(200)).max(100), z.null()]);

export const POST: APIRoute = async ({ locals, request }) => {
  const actor = getActor(locals, "student");
  try {
    const input = z.object({ participantId: z.string().min(1), questionId: z.string().min(1), value: answerValue }).parse(await readJson(request));
    const saved = await saveAnswer({ actor, request }, input.participantId, input.questionId, input.value);
    return saved ? Response.json(saved) : Response.json({ error: "Participante inexistente" }, { status: 404 });
  } catch (error) {
    return apiError(error);
  }
};
