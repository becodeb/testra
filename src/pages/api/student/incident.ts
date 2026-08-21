import type { APIRoute } from "astro";
import { z } from "zod";

import { getActor, unauthenticated } from "@/server/actors";
import { participantOwnedBy, runCommand } from "@/server/repository";

const incidentSchema = z.object({
  participantId: z.string().min(1),
  type: z.enum(["cambio-de-pestana", "ventana-sin-foco", "atajo-f12", "atajo-copiar-pegar", "salida-pantalla-completa"]),
  at: z.number().int().nonnegative(),
  durationMs: z.number().min(0).max(6 * 60 * 60 * 1000),
  meta: z.record(z.string(), z.unknown()),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const actor = getActor(locals, "student");
  if (!actor) return unauthenticated();
  const result = incidentSchema.safeParse(await request.json());
  if (!result.success) return Response.json({ error: "Incidente inválido" }, { status: 400 });
  const participant = await participantOwnedBy(result.data.participantId, actor);
  if (!participant) return Response.json({ error: "Participante inexistente" }, { status: 404 });
  const response = await runCommand(participant.run_id, "/incident", {
    participantId: result.data.participantId,
    incidentType: result.data.type,
    durationMs: result.data.durationMs,
    meta: { ...result.data.meta, clientAt: result.data.at },
  });
  return new Response(response.body, { status: response.status, headers: response.headers });
};
