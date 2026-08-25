import type { APIRoute } from "astro";
import { z } from "zod";

import { forbidden, getActor, isTeacher, unauthenticated } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { deleteQuickComment, listQuickComments, saveQuickComment } from "@/server/repository";

function teacher(locals: App.Locals): { actor: NonNullable<ReturnType<typeof getActor>> } | { response: Response } {
  const actor = getActor(locals, "teacher");
  if (!actor) return { response: unauthenticated() };
  if (!isTeacher(actor)) return { response: forbidden() };
  return { actor };
}

export const GET: APIRoute = async ({ locals }) => { const access = teacher(locals); return "response" in access ? access.response : Response.json(await listQuickComments(access.actor)); };
export const PUT: APIRoute = async ({ locals, request }) => { const access = teacher(locals); if ("response" in access) return access.response; try { return Response.json(await saveQuickComment(access.actor, z.object({ id: z.string().optional(), text: z.string().min(1).max(500) }).parse(await readJson(request)))); } catch (error) { return apiError(error); } };
export const DELETE: APIRoute = async ({ locals, request }) => { const access = teacher(locals); if ("response" in access) return access.response; try { const { id } = z.object({ id: z.string().min(1) }).parse(await readJson(request)); return await deleteQuickComment(access.actor, id) ? new Response(null, { status: 204 }) : forbidden(); } catch (error) { return apiError(error); } };
