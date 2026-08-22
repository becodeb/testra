import type { APIRoute } from "astro";
import { z } from "zod";

import { getActor } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { submitParticipant } from "@/server/repository";

export const POST: APIRoute = async ({ locals, request }) => {
  const actor = getActor(locals, "student");
  try {
    const input = z.object({ participantId: z.string().min(1), reason: z.enum(["manual", "timer"]) }).parse(await readJson(request));
    const result = await submitParticipant({ actor, request }, input.participantId, input.reason);
    return result ? Response.json(result) : Response.json({ error: "Participante inexistente" }, { status: 404 });
  } catch (error) {
    return apiError(error);
  }
};
