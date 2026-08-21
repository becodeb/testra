import type { APIRoute } from "astro";
import { z } from "zod";

import { getActor, unauthenticated } from "@/server/actors";
import { participantOwnedBy, runCommand } from "@/server/repository";

const payloadSchema = z.object({ participantId: z.string().min(1) });

export const POST: APIRoute = async ({ request, locals }) => {
  const actor = getActor(locals, "student");
  if (!actor) return unauthenticated();
  const result = payloadSchema.safeParse(await request.json());
  if (!result.success) return Response.json({ error: "Heartbeat inválido" }, { status: 400 });
  const participant = await participantOwnedBy(result.data.participantId, actor);
  if (!participant) return Response.json({ error: "Participante inexistente" }, { status: 404 });
  const response = await runCommand(participant.run_id, "/heartbeat", result.data);
  return new Response(response.body, { status: response.status, headers: response.headers });
};
