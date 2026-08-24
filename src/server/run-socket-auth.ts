import { getActor, isTeacher } from "@/server/actors";
import { auth } from "@/server/auth";
import type { SocketIdentity } from "@/server/exam-run-actor";
import { getRunForTeacher, participantOwnedBy } from "@/server/repository";

// El apretón de manos del WebSocket ya no pasa por una ruta de Astro: en Node el
// upgrade lo atiende el servidor HTTP antes de que Astro vea la petición. Esta
// autorización es la misma que hacía src/pages/api/runs/[id]/socket.ts y vive
// acá para que el servidor de producción y el de desarrollo compartan una única
// implementación.

export type SocketAuthResult =
  | { ok: true; identity: SocketIdentity }
  | { ok: false; status: number; error: string };

interface AuthorizeInput {
  runId: string;
  searchParams: URLSearchParams;
  request: Request;
}

export async function authorizeRunSocket({ runId, searchParams, request }: AuthorizeInput): Promise<SocketAuthResult> {
  const role = searchParams.get("role") === "teacher" ? "teacher" : "student";
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  const locals = { user: session?.user ?? null, session: session?.session ?? null } as App.Locals;
  const actor = getActor(locals, role);

  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent") ?? "unknown";

  if (role === "teacher") {
    if (!actor) return { ok: false, status: 401, error: "Iniciá sesión para continuar" };
    if (!isTeacher(actor)) return { ok: false, status: 403, error: "No tenés permiso para realizar esta acción" };
    if (!(await getRunForTeacher(runId, actor))) {
      return { ok: false, status: 403, error: "No tenés permiso para realizar esta acción" };
    }
    return { ok: true, identity: { role: "teacher", ip, userAgent } };
  }

  const participantId = searchParams.get("participantId") ?? "";
  const participant = await participantOwnedBy(participantId, { actor, request });
  if (!participant || participant.run_id !== runId) {
    return { ok: false, status: 403, error: "No tenés permiso para realizar esta acción" };
  }

  return {
    ok: true,
    identity: {
      role: "student",
      participantId,
      userId: participant.user_id ?? participant.id,
      name: participant.display_name,
      ip,
      userAgent,
    },
  };
}

// Sustituye a CF-Connecting-IP. Detrás del proxy de Coolify la dirección real
// viaja en X-Forwarded-For; el primer valor de la lista es el cliente.
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}
