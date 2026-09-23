import type { APIRoute } from "astro";
import { z } from "zod";

import { apiError, readJson } from "@/server/api";
import { getActor, isTeacher, forbidden, unauthenticated } from "@/server/actors";
import { generateSimilarityReport, getStoredSimilarityReport } from "@/server/similarity-reports";

const inputSchema = z.object({ runId: z.string().min(1) });

export const GET: APIRoute = async ({ locals, url }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try {
    const input = inputSchema.parse({ runId: url.searchParams.get("runId") });
    const stored = await getStoredSimilarityReport(input.runId, actor);
    return Response.json(stored ?? { report: null });
  } catch (error) { return apiError(error); }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try {
    const input = inputSchema.parse(await readJson(request));
    return Response.json(await generateSimilarityReport(input.runId, actor));
  } catch (error) { return apiError(error); }
};
