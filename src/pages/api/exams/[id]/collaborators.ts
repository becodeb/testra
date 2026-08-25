import type { APIRoute } from "astro";
import { z } from "zod";

import { forbidden, getActor, isTeacher, unauthenticated } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { listExamCollaborators, removeExamCollaborator, upsertExamCollaborator } from "@/server/exam-permissions";

function teacher(locals: App.Locals): { actor: NonNullable<ReturnType<typeof getActor>> } | { response: Response } {
  const actor = getActor(locals, "teacher");
  if (!actor) return { response: unauthenticated() };
  if (!isTeacher(actor)) return { response: forbidden() };
  return { actor };
}

const collaboratorSchema = z.object({
  email: z.email(),
  permission: z.enum(["view", "edit", "correct"]),
  canPublishResults: z.boolean().default(false),
  canManageClassroom: z.boolean().default(false),
});

export const GET: APIRoute = async ({ locals, params }) => {
  const access = teacher(locals); if ("response" in access) return access.response;
  const collaborators = await listExamCollaborators(params.id!, access.actor);
  return collaborators ? Response.json(collaborators) : forbidden();
};

export const PUT: APIRoute = async ({ locals, params, request }) => {
  const access = teacher(locals); if ("response" in access) return access.response;
  try { return Response.json(await upsertExamCollaborator(params.id!, access.actor, collaboratorSchema.parse(await readJson(request)))); }
  catch (error) { return apiError(error); }
};

export const DELETE: APIRoute = async ({ locals, params, request }) => {
  const access = teacher(locals); if ("response" in access) return access.response;
  try {
    const { userId } = z.object({ userId: z.string().min(1) }).parse(await readJson(request));
    return await removeExamCollaborator(params.id!, userId, access.actor) ? new Response(null, { status: 204 }) : forbidden();
  } catch (error) { return apiError(error); }
};
