import type { APIRoute } from "astro";

import { db } from "@/server/db/client";
import { getActor } from "@/server/actors";

export const POST: APIRoute = async ({ locals, params, request, redirect }) => {
  const actor = getActor(locals, "teacher");
  if (!actor?.orgAdmin || !actor.orgId) return Response.json({ error: "Sin permiso" }, { status: 403 });
  const form = await request.formData();
  const action = form.get("action") === "approve" ? "approved" : "rejected";
  const row = await db.prepare("SELECT requester_user_id FROM access_requests WHERE id = ? AND organization_id = ? AND status = 'pending'")
    .bind(params.id, actor.orgId).first<{ requester_user_id: string }>();
  if (!row) return Response.json({ error: "Solicitud inexistente" }, { status: 404 });
  const now = Date.now();
  const statements = [db.prepare("UPDATE access_requests SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?").bind(action, now, actor.id, params.id)];
  // `users.updated_at` es timestamptz porque la tabla la maneja better-auth;
  // `access_requests.reviewed_at` sigue siendo epoch ms como el resto del esquema.
  if (action === "approved") statements.push(db.prepare("UPDATE users SET org_id = ?, role = 'teacher', org_admin = false, updated_at = ? WHERE id = ?").bind(actor.orgId, new Date(now), row.requester_user_id));
  await db.batch(statements);
  return redirect("/solicitudes", 303);
};
