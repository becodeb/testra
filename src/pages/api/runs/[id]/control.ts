import type { APIRoute } from "astro";
import { z } from "zod";

import { getActor, isSuperadmin, isTeacher, unauthenticated, forbidden } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { getRunForTeacher, runCommand } from "@/server/repository";
import { getRunCapabilities } from "@/server/exam-permissions";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("end") }),
  z.object({ action: z.literal("adjust-time"), deltaS: z.number().int().min(-3600).max(3600) }),
  z.object({ action: z.literal("participant-time"), participantId: z.uuid(), extraTimeS: z.number().int().min(0).max(86400) }),
  z.object({ action: z.literal("reopen"), participantId: z.uuid(), extraTimeS: z.number().int().min(0).max(86400).default(0) }),
]);

export const POST: APIRoute = async ({ locals, request, params }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor) && !isSuperadmin(actor)) return forbidden();
  if (!(await getRunForTeacher(params.id!, actor))) return forbidden();
  try {
    const input = schema.parse(await readJson(request));
    const capabilities = await getRunCapabilities(params.id!, actor);
    if (!capabilities.openRuns) return forbidden();
    const path = `/${input.action}`;
    const response = await runCommand(params.id!, path, { ...input, actorUserId: actor.id });
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (error) {
    return apiError(error);
  }
};
