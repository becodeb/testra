import type { APIRoute } from "astro";
import { z } from "zod";

import { apiError, readJson } from "@/server/api";
import { getActor, isTeacher, forbidden, unauthenticated } from "@/server/actors";
import { generateAiReport, getStoredAiReport } from "@/server/ai-reports";

const inputSchema = z.object({ scopeType: z.enum(["run", "participant"]), scopeId: z.string().min(1) });

export const GET: APIRoute = async ({ locals, url }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try {
    const input = inputSchema.parse({ scopeType: url.searchParams.get("scopeType"), scopeId: url.searchParams.get("scopeId") });
    return Response.json(await getStoredAiReport(input.scopeType, input.scopeId, actor));
  } catch (error) { return apiError(error); }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try {
    const input = inputSchema.parse(await readJson(request));
    return Response.json(await generateAiReport(input.scopeType, input.scopeId, actor));
  } catch (error) { return apiError(error); }
};
