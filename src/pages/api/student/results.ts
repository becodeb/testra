import type { APIRoute } from "astro";

import { getActor } from "@/server/actors";
import { getStudentResults } from "@/server/student-results";

export const GET: APIRoute = async ({ locals, request, url }) => {
  const actor = getActor(locals, "student");
  const participantId = url.searchParams.get("participante");
  if (!participantId) return Response.json({ error: "Falta el participante" }, { status: 400 });
  const results = await getStudentResults({ actor, request }, participantId);
  if (!results) return Response.json({ error: "Participante inexistente" }, { status: 404 });
  return Response.json(results, { headers: { "cache-control": "no-store" } });
};
