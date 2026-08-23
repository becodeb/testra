import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import { getActor } from "@/server/actors";

const runtimeEnv = env as unknown as CloudflareEnv;
export const POST: APIRoute = async ({ locals, params, request, redirect }) => {
  const actor = getActor(locals, "teacher");
  if (!actor?.orgAdmin || !actor.orgId) return Response.json({ error: "Sin permiso" }, { status: 403 });
  const form = await request.formData();
  const action = form.get("action") === "approve" ? "approved" : "rejected";
  const row = await runtimeEnv.DB.prepare("SELECT requester_user_id FROM access_requests WHERE id = ? AND organization_id = ? AND status = 'pending'")
    .bind(params.id, actor.orgId).first<{ requester_user_id: string }>();
  if (!row) return Response.json({ error: "Solicitud inexistente" }, { status: 404 });
  const now = Date.now();
  const statements = [runtimeEnv.DB.prepare("UPDATE access_requests SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?").bind(action, now, actor.id, params.id)];
  if (action === "approved") statements.push(runtimeEnv.DB.prepare("UPDATE users SET org_id = ?, role = 'teacher', org_admin = false, updated_at = ? WHERE id = ?").bind(actor.orgId, now, row.requester_user_id));
  await runtimeEnv.DB.batch(statements);
  return redirect("/solicitudes", 303);
};
