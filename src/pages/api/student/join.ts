import type { APIRoute } from "astro";
import { z } from "zod";

import { getActor, unauthenticated } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { joinRunByCode } from "@/server/repository";

export const POST: APIRoute = async ({ locals, request }) => {
  const actor = getActor(locals, "student");
  if (!actor) return unauthenticated();
  try {
    const { code } = z.object({ code: z.string().trim().length(6) }).parse(await readJson(request));
    const joined = await joinRunByCode(actor, code);
    return joined
      ? Response.json({ code: joined.run.code, status: joined.run.status })
      : Response.json({ error: "No encontramos una toma activa con ese código" }, { status: 404 });
  } catch (error) {
    return apiError(error);
  }
};
