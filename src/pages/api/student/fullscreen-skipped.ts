import type { APIRoute } from "astro";
import { z } from "zod";

import { getActor } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { noteFullscreenSkipped } from "@/server/repository";

export const POST: APIRoute = async ({ locals, request }) => {
  const actor = getActor(locals, "student");
  try {
    const input = z.object({ participantId: z.string().min(1) }).parse(await readJson(request));
    const noted = await noteFullscreenSkipped({ actor, request }, input.participantId);
    return noted ? new Response(null, { status: 202 }) : Response.json({ error: "Participante inexistente" }, { status: 404 });
  } catch (error) {
    return apiError(error);
  }
};
