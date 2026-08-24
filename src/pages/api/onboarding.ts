import type { APIRoute } from "astro";
import { z } from "zod";

import { db } from "@/server/db/client";
import { serverEnv } from "@/server/env";
import { apiError, readJson } from "@/server/api";

const personalEmailDomains = new Set([
  "gmail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
]);

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return Response.json({ error: "Iniciá sesión para continuar" }, { status: 401 });
  try {
    const input = z.object({ school: z.string().trim().min(3).max(120), role: z.enum(["teacher", "student"]) }).parse(await readJson(request));
    const domain = locals.user.email.split("@").at(-1)?.toLocaleLowerCase();
    if (!domain) throw new Error("La cuenta no tiene un correo válido");
    const reusableDomain = !personalEmailDomains.has(domain);
    let organization = reusableDomain
      ? await db.prepare("SELECT id FROM organizations WHERE google_domain = ?").bind(domain).first<{ id: string }>()
      : null;

    if (input.role === "teacher" && organization) {
      const allowlist = (serverEnv.TEACHER_EMAILS ?? "").split(",").map((value) => value.trim().toLocaleLowerCase()).filter(Boolean);
      if (!allowlist.includes(locals.user.email.toLocaleLowerCase())) {
        const existing = await db.prepare("SELECT id FROM access_requests WHERE requester_user_id = ? AND organization_id = ? AND status = 'pending'")
          .bind(locals.user.id, organization.id).first<{ id: string }>();
        if (!existing) await db.prepare(
          "INSERT INTO access_requests (id, organization_id, requester_user_id, email, status, requested_at) VALUES (?, ?, ?, ?, 'pending', ?)",
        ).bind(crypto.randomUUID(), organization.id, locals.user.id, locals.user.email, Date.now()).run();
        return Response.json({ pending: true, redirect: "/solicitud-pendiente" }, { status: 202 });
      }
    }

    if (!organization) {
      organization = { id: crypto.randomUUID() };
      await db.prepare("INSERT INTO organizations (id, name, google_domain) VALUES (?, ?, ?)").bind(organization.id, input.school, reusableDomain ? domain : null).run();
    }
    // `users` es tabla de better-auth: org_admin es boolean y updated_at es
    // timestamptz, a diferencia del resto del esquema. Ver src/server/db/schema.ts.
    const firstAdmin = input.role === "teacher" && !reusableDomain
      ? true
      : input.role === "teacher" && !(await db.prepare("SELECT 1 FROM users WHERE org_id = ? AND role = 'teacher'").bind(organization.id).first());
    await db.prepare("UPDATE users SET org_id = ?, role = ?, org_admin = ?, updated_at = ? WHERE id = ?").bind(organization.id, input.role, firstAdmin, new Date(), locals.user.id).run();
    return Response.json({ redirect: input.role === "teacher" ? "/evaluaciones" : "/rendir" });
  } catch (error) {
    return apiError(error);
  }
};
