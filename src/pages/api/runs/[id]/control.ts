import type { APIRoute } from "astro";
import { z } from "zod";

import { getActor, isSuperadmin, isTeacher, unauthenticated, forbidden } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { getRunForTeacher, runCommand } from "@/server/repository";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("end") }),
  z.object({ action: z.literal("adjust-time"), deltaS: z.number().int().min(-3600).max(3600) }),
]);

export const POST: APIRoute = async ({ locals, request, params }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor) && !isSuperadmin(actor)) return forbidden();
  if (!(await getRunForTeacher(params.id!, actor))) return forbidden();
  try {
    const input = schema.parse(await readJson(request));
    const path = input.action === "adjust-time" ? "/adjust-time" : `/${input.action}`;
    const response = await runCommand(params.id!, path, input.action === "adjust-time" ? { deltaS: input.deltaS } : {});
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (error) {
    return apiError(error);
  }
};
