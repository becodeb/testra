import type { APIRoute } from "astro";

import { getActor, isTeacher, unauthenticated, forbidden } from "@/server/actors";
import { getRunForTeacher, participantOwnedBy, runCommand } from "@/server/repository";

export const GET: APIRoute = async ({ locals, request, params, url }) => {
  const role = url.searchParams.get("role") === "teacher" ? "teacher" : "student";
  const actor = getActor(locals, role);
  if (!actor) return unauthenticated();
  if (role === "teacher") {
    if (!isTeacher(actor)) return forbidden();
    if (!(await getRunForTeacher(params.id!, actor))) return forbidden();
  } else {
    const participantId = url.searchParams.get("participantId") ?? "";
    const participant = await participantOwnedBy(participantId, actor);
    if (!participant || participant.run_id !== params.id) return forbidden();
    url.searchParams.set("userId", actor.id);
    url.searchParams.set("name", actor.name);
  }
  const query = new URLSearchParams(url.searchParams);
  const response = await runCommand(params.id!, `/connect?${query.toString()}`, undefined, request.headers);
  return response;
};
